import "server-only";
import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./db";
import { attendance, dues, responses, trips, users, type Trip, type User } from "./db/schema";
import { recordDueEvent, recordUserEvent } from "./audit";

/**
 * Settling up after a trip: who actually travelled, and who has paid.
 *
 * The rule this exists to enforce is the one the dashboard already promises
 * travellers — *only people who actually board are billed*. So attendance is
 * the gate: a payment cannot be recorded against someone who is marked as not
 * having travelled, and recording a payment for someone nobody marked at all
 * records the travel too, because you do not pay for a trip you did not take.
 *
 * Everything here is a coordinator's deliberate act on a named person, and
 * every money movement lands in `due_events` in the same transaction. Weeks
 * later, "I definitely paid you" is settled by the record rather than by
 * whoever remembers harder.
 */

export class SettleError extends Error {}

/** A transaction handle, so a group payment lands as one act or not at all. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LedgerRow = {
  userId: string;
  name: string;
  phone: string;
  /** Shown beside the name — several people here share one. */
  joiningYear: number | null;
  /** They said they were going. Absent for someone added after the fact. */
  booked: boolean;
  /** true travelled · false explicitly did not · null nobody has said. */
  travelled: boolean | null;
  /** Unnamed riders who came with them. Billed to them along with their own share. */
  guests: number;
  paid: boolean;
  /** Set when someone else settled this person's share. */
  paidByUserId: string | null;
  paidByName: string | null;
  /** Rupees recorded against them. 0 when no amount was ever set for the trip. */
  amount: number | null;
  paidAt: Date | null;
  /** Off the roster now, but they were on this trip. */
  archived: boolean;
};

/**
 * Everyone this trip could involve money for: whoever booked, plus anyone a
 * coordinator has since marked as having travelled or paid.
 *
 * People who withdrew and did not travel are absent — they owe nothing and a
 * settle-up list of fifty names where thirty are irrelevant is one a
 * coordinator stops reading.
 */
export async function getTripLedger(tripId: string): Promise<LedgerRow[]> {
  // Every join carries the trip predicate. Without it the joins fan out across
  // every trip the person has ever been on and last month's answers show up as
  // this week's — the same mistake the roster page guards against. The
  // (trip, user) unique constraints then guarantee at most one row from each,
  // so there is no duplication to collapse afterwards.
  // Second look at `users`, for whoever settled someone else's share. Named
  // rather than joined through `dues.paid_by_user_id` twice, so "paid by Rahul"
  // can be shown without a second query per row.
  const payer = alias(users, "payer");

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      phone: users.phone,
      joiningYear: users.joiningYear,
      isActive: users.isActive,
      going: responses.going,
      travelled: attendance.boarded,
      guests: attendance.guests,
      dueStatus: dues.status,
      amount: dues.amount,
      verifiedAt: dues.verifiedAt,
      paidByUserId: dues.paidByUserId,
      paidByName: payer.name,
    })
    .from(users)
    .leftJoin(responses, and(eq(responses.userId, users.id), eq(responses.tripId, tripId)))
    .leftJoin(attendance, and(eq(attendance.userId, users.id), eq(attendance.tripId, tripId)))
    .leftJoin(dues, and(eq(dues.userId, users.id), eq(dues.tripId, tripId)))
    .leftJoin(payer, eq(payer.id, dues.paidByUserId))
    .where(or(eq(responses.going, true), isNotNull(attendance.id), isNotNull(dues.id)))
    .orderBy(asc(users.name));

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    phone: r.phone,
    joiningYear: r.joiningYear,
    booked: r.going ?? false,
    travelled: r.travelled,
    guests: r.guests ?? 0,
    paid: r.dueStatus === "verified" || r.dueStatus === "waived",
    paidByUserId: r.paidByUserId,
    paidByName: r.paidByName,
    amount: r.amount,
    paidAt: r.verifiedAt,
    archived: !r.isActive,
  }));
}

export type LedgerTotals = {
  /** Riders, not rows — someone who brought two unnamed friends counts three. */
  travelled: number;
  /** Of those riders, how many are covered by a payment. */
  paid: number;
  /** Riders whose share is still out. */
  outstanding: number;
  /** Booked but nobody has said whether they turned up. */
  unmarked: number;
  /** Unnamed riders among the above, so the number is never quietly inflated. */
  guests: number;
  collectedRupees: number;
  outstandingRupees: number;
};

/**
 * Pure — takes the rows the page already has rather than querying again.
 *
 * Counts riders rather than names throughout. A coordinator reading "18
 * travelled, 12 paid" is checking it against a memory of the morning, and if
 * the two unnamed friends are missing from both figures the numbers look
 * settled while a share is still out.
 */
export function totalsFor(rows: LedgerRow[], amountPerPerson: number | null): LedgerTotals {
  const travelled = rows.filter((r) => r.travelled === true);
  const paid = travelled.filter((r) => r.paid);
  const unpaid = travelled.filter((r) => !r.paid);

  const riders = (list: LedgerRow[]) => list.reduce((sum, r) => sum + 1 + r.guests, 0);

  return {
    travelled: riders(travelled),
    paid: riders(paid),
    outstanding: riders(unpaid),
    unmarked: rows.filter((r) => r.travelled === null).length,
    guests: travelled.reduce((sum, r) => sum + r.guests, 0),
    collectedRupees: paid.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    outstandingRupees: riders(unpaid) * (amountPerPerson ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function assertSettleable(trip: Trip) {
  if (trip.status === "cancelled") {
    throw new SettleError("That trip was cancelled — nobody travelled on it");
  }
}

async function personById(userId: string) {
  const [person] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!person) throw new SettleError("No such person");
  return person;
}

/**
 * Record whether someone actually turned up.
 *
 * This is also the "we forgot to add them" path: a person who never booked but
 * travelled with the group gets an attendance row and nothing else. No fake
 * booking is written for them — the response table is the demand signal from
 * before the trip, and back-filling it would rewrite what the count was at the
 * moment it was read to the contractor.
 */
export async function setTravelled(
  trip: Trip,
  userId: string,
  travelled: boolean,
  coordinator: User,
): Promise<void> {
  assertSettleable(trip);
  const person = await personById(userId);

  await db.transaction(async (tx) => {
    const [due] = await tx
      .select()
      .from(dues)
      .where(and(eq(dues.tripId, trip.id), eq(dues.userId, userId)))
      .limit(1);

    // Refusing rather than cascading: money out of the record is a bigger
    // change than a mis-tap on an attendance toggle, so it takes its own act.
    if (!travelled && due && due.status !== "unpaid") {
      throw new SettleError(
        `${person.name} is marked as paid — undo the payment before saying they didn't travel`,
      );
    }

    const [existing] = await tx
      .select()
      .from(attendance)
      .where(and(eq(attendance.tripId, trip.id), eq(attendance.userId, userId)))
      .limit(1);

    if (existing) {
      await tx
        .update(attendance)
        .set({
          boarded: travelled,
          // Nobody came with someone who did not come. Leaving a "+2" against a
          // row marked "Didn't" would keep charging for riders who weren't there.
          guests: travelled ? existing.guests : 0,
          markedBy: coordinator.id,
          markedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(attendance.id, existing.id));
    } else {
      await tx.insert(attendance).values({
        tripId: trip.id,
        userId,
        boarded: travelled,
        markedBy: coordinator.id,
      });
    }
  });
}

/**
 * Record that someone has settled up, inside a caller's transaction.
 *
 * Marking an unmarked person paid also marks them as having travelled, which is
 * what makes the forgotten-traveller case one tap instead of two: a coordinator
 * who remembers "he came, and he paid me" says exactly that.
 *
 * `paidByUserId` is the friend who actually handed the money over. The share
 * still belongs to the person it is recorded against — this only says who
 * settled it, which is the difference between "he never paid" and "his mate
 * paid for him", and the question the WhatsApp process could never answer.
 */
async function markPaidTx(
  tx: Tx,
  trip: Trip,
  userId: string,
  personName: string,
  coordinator: User,
  paidByUserId: string | null,
): Promise<void> {
  const [existing] = await tx
    .select()
    .from(attendance)
    .where(and(eq(attendance.tripId, trip.id), eq(attendance.userId, userId)))
    .limit(1);

  if (existing && !existing.boarded) {
    throw new SettleError(
      `${personName} is marked as not having travelled — only riders are billed`,
    );
  }
  if (!existing) {
    await tx.insert(attendance).values({
      tripId: trip.id,
      userId,
      boarded: true,
      markedBy: coordinator.id,
    });
  }

  // Their own share plus anyone unnamed they brought. Read from the attendance
  // row rather than passed in, so the amount can never disagree with the rider
  // count the same row produces on the ledger.
  const guests = existing?.guests ?? 0;
  const amount = (trip.amountPerPerson ?? 0) * (1 + guests);

  const [due] = await tx
    .select()
    .from(dues)
    .where(and(eq(dues.tripId, trip.id), eq(dues.userId, userId)))
    .limit(1);

  if (due) {
    if (due.status === "verified" || due.status === "waived") return; // already settled
    await tx
      .update(dues)
      .set({
        amount,
        status: "verified",
        verifiedAt: new Date(),
        verifiedBy: coordinator.id,
        paidByUserId,
        updatedAt: new Date(),
      })
      .where(eq(dues.id, due.id));

    await recordDueEvent(tx, {
      dueId: due.id,
      action: "verify",
      fromStatus: due.status,
      toStatus: "verified",
      amount,
      actorId: coordinator.id,
    });
    return;
  }

  const [created] = await tx
    .insert(dues)
    .values({
      tripId: trip.id,
      userId,
      amount,
      status: "verified",
      verifiedAt: new Date(),
      verifiedBy: coordinator.id,
      paidByUserId,
    })
    .returning();

  // Two events for one tap, on purpose: the debt existing and the debt being
  // settled are separate facts, and a ledger that only ever shows them
  // together cannot answer "when did we decide he owed this?".
  await recordDueEvent(tx, {
    dueId: created.id,
    action: "generate",
    toStatus: "unpaid",
    amount,
    actorId: coordinator.id,
  });
  await recordDueEvent(tx, {
    dueId: created.id,
    action: "verify",
    fromStatus: "unpaid",
    toStatus: "verified",
    amount,
    actorId: coordinator.id,
  });
}

/** One person, settling their own share. */
export async function markPaid(trip: Trip, userId: string, coordinator: User): Promise<void> {
  assertSettleable(trip);
  const person = await personById(userId);

  await db.transaction((tx) => markPaidTx(tx, trip, userId, person.name, coordinator, null));
}

/** Nobody brings a coach party. A stray digit here would wreck the trip total. */
const MAX_GUESTS = 10;

/**
 * How many unnamed riders came with this person.
 *
 * Adding the friend to the roster is always the better answer and the screen
 * says so — a named person has a ledger, and can be chased next week or
 * credited when they pay. This is for the case where nobody can produce the
 * name and the alternative is losing the share entirely.
 *
 * Changing the count after a payment amends the amount, for the same reason
 * `setAmountPerPerson` does: leaving a settled row at the old figure is how the
 * ledger stops agreeing with the money.
 */
export async function setGuests(
  trip: Trip,
  userId: string,
  guests: number,
  coordinator: User,
): Promise<void> {
  assertSettleable(trip);
  if (!Number.isInteger(guests)) throw new SettleError("Enter a whole number of friends");
  if (guests < 0) throw new SettleError("That can't be negative");
  if (guests > MAX_GUESTS) {
    throw new SettleError(`That's more than ${MAX_GUESTS} — add them to the roster instead`);
  }

  const person = await personById(userId);

  await db.transaction(async (tx) => {
    await setGuestsTx(tx, trip, userId, guests, person.name, coordinator);
  });
}

async function setGuestsTx(
  tx: Tx,
  trip: Trip,
  userId: string,
  guests: number,
  personName: string,
  coordinator: User,
): Promise<void> {
  const [existing] = await tx
    .select()
    .from(attendance)
    .where(and(eq(attendance.tripId, trip.id), eq(attendance.userId, userId)))
    .limit(1);

  if (existing && !existing.boarded && guests > 0) {
    throw new SettleError(
      `${personName} is marked as not having travelled — nobody came with them`,
    );
  }

  if (existing) {
    await tx
      .update(attendance)
      .set({ guests, updatedAt: new Date() })
      .where(eq(attendance.id, existing.id));
  } else {
    // Recording friends for someone nobody has marked says they travelled too.
    await tx.insert(attendance).values({
      tripId: trip.id,
      userId,
      boarded: true,
      guests,
      markedBy: coordinator.id,
    });
  }

  // A settled row must not keep the old figure. Amending is audited with what
  // it moved from, so a total that changes after the fact is explainable.
  const [due] = await tx
    .select()
    .from(dues)
    .where(and(eq(dues.tripId, trip.id), eq(dues.userId, userId)))
    .limit(1);

  if (!due) return;

  const amount = (trip.amountPerPerson ?? 0) * (1 + guests);
  if (amount === due.amount) return;

  await tx.update(dues).set({ amount, updatedAt: new Date() }).where(eq(dues.id, due.id));
  await recordDueEvent(tx, {
    dueId: due.id,
    action: "amend",
    fromStatus: due.status,
    toStatus: due.status,
    amount,
    actorId: coordinator.id,
    note: `Was ₹${due.amount} · now covers ${1 + guests}`,
  });
}

/**
 * One person paying for a group — the case this screen was missing.
 *
 * Handles both halves of it in a single act, because they arrive together in a
 * single message days after the trip: the friends who can be named each get
 * their own settled row stamped with who paid, and the ones nobody can name are
 * recorded as a count against the payer. One transaction, so a group payment
 * cannot half-land and leave a coordinator guessing which names went through.
 */
export async function recordGroupPayment(
  trip: Trip,
  input: { payerId: string; coversUserIds: string[]; guests: number },
  coordinator: User,
): Promise<void> {
  assertSettleable(trip);

  const { payerId, guests } = input;
  if (!Number.isInteger(guests) || guests < 0) throw new SettleError("Enter a whole number");
  if (guests > MAX_GUESTS) {
    throw new SettleError(`That's more than ${MAX_GUESTS} — add them to the roster instead`);
  }

  const payer = await personById(payerId);
  // The payer is always covered by their own payment, and is only ever charged
  // once however the caller lists them.
  const covered = [...new Set([payerId, ...input.coversUserIds])];

  const people = await db.select().from(users).where(inArray(users.id, covered));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  for (const id of covered) {
    if (!nameOf.has(id)) throw new SettleError("No such person");
  }

  await db.transaction(async (tx) => {
    await setGuestsTx(tx, trip, payerId, guests, payer.name, coordinator);

    for (const id of covered) {
      // The payer's own share is not "paid by" anyone else.
      const paidBy = id === payerId ? null : payerId;
      await markPaidTx(tx, trip, id, nameOf.get(id)!, coordinator, paidBy);
    }
  });
}

/**
 * Take someone off this trip entirely — the person added by mistake.
 *
 * Distinct from marking them as not having travelled, which is a statement
 * about a real person who was really considered: it leaves them on the list,
 * correctly, because a coordinator looked at them and decided. This is for the
 * row that should never have existed — the wrong tap in a list of fifty names,
 * two of whom are called the same thing.
 *
 * It deliberately does not refuse when a payment is recorded. Being blocked
 * behind "undo the payment first" is exactly the dead end this exists to open,
 * and the mistaken payment is part of what has to go. The screen warns and
 * names what will be erased; the decision is the coordinator's. What is removed
 * is only this trip's attendance and dues — the person, their roster entry and
 * every other trip they are on are untouched, and if they booked this trip that
 * booking stands and they simply return to unmarked.
 *
 * The dues row is deleted rather than zeroed, and `due_events` cascades with
 * it. An audit trail for money that was never owed is a record of the mistake,
 * not of the group's finances, and leaving a settled ₹0 row behind would keep
 * them in every rider count that follows.
 */
export async function removeFromTrip(
  trip: Trip,
  userId: string,
  coordinator: User,
): Promise<void> {
  const person = await personById(userId);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(attendance)
      .where(and(eq(attendance.tripId, trip.id), eq(attendance.userId, userId)))
      .limit(1);

    const [due] = await tx
      .select()
      .from(dues)
      .where(and(eq(dues.tripId, trip.id), eq(dues.userId, userId)))
      .limit(1);

    if (!existing && !due) {
      throw new SettleError(`${person.name} has nothing recorded on this trip`);
    }

    await tx
      .delete(dues)
      .where(and(eq(dues.tripId, trip.id), eq(dues.userId, userId)));
    await tx
      .delete(attendance)
      .where(and(eq(attendance.tripId, trip.id), eq(attendance.userId, userId)));

    // The removal itself stays on the record, against the person rather than
    // against the deleted rows, so "he was on the list last week" has an
    // answer with a name and a time on it.
    await recordUserEvent(tx, {
      userId,
      action: "remove_from_trip",
      reason:
        `Removed from the ${trip.eventDate} trip` +
        (due ? ` · a recorded payment of ₹${due.amount} was erased with it` : ""),
      actorId: coordinator.id,
    });
  });
}

/** Undo a payment — the misclick, or the transfer that never landed. */
export async function markUnpaid(trip: Trip, userId: string, coordinator: User): Promise<void> {
  await db.transaction(async (tx) => {
    const [due] = await tx
      .select()
      .from(dues)
      .where(and(eq(dues.tripId, trip.id), eq(dues.userId, userId)))
      .limit(1);

    if (!due) throw new SettleError("There is no payment recorded to undo");
    if (due.status === "unpaid") return;

    await tx
      .update(dues)
      .set({ status: "unpaid", verifiedAt: null, verifiedBy: null, updatedAt: new Date() })
      .where(eq(dues.id, due.id));

    // The attendance row deliberately stays. They still travelled; what changed
    // is only whether the money arrived.
    await recordDueEvent(tx, {
      dueId: due.id,
      action: "unverify",
      fromStatus: due.status,
      toStatus: "unpaid",
      amount: due.amount,
      actorId: coordinator.id,
    });
  });
}

/**
 * Set what each rider is being asked for.
 *
 * Everyone on a trip pays the same share, so changing the figure amends the
 * rows already recorded rather than leaving half the group at the old number.
 * Each amendment is audited with the amount it moved from.
 */
export async function setAmountPerPerson(
  trip: Trip,
  amount: number | null,
  coordinator: User,
): Promise<void> {
  if (amount !== null) {
    if (!Number.isInteger(amount)) throw new SettleError("Enter whole rupees");
    if (amount < 0) throw new SettleError("That can't be negative");
    if (amount > 100_000) throw new SettleError("That looks like a typo — check the amount");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(trips)
      .set({ amountPerPerson: amount, updatedAt: new Date() })
      .where(eq(trips.id, trip.id));

    if (amount === null) return;

    // Someone who brought two unnamed friends owes three shares, so the new
    // figure is applied per rider rather than per row. Left-joined because a due
    // can exist without an attendance row only in the paid-then-unmarked case,
    // and that person still owes their own share.
    const existing = await tx
      .select({ due: dues, guests: attendance.guests })
      .from(dues)
      .leftJoin(
        attendance,
        and(eq(attendance.tripId, dues.tripId), eq(attendance.userId, dues.userId)),
      )
      .where(eq(dues.tripId, trip.id));

    for (const { due, guests } of existing) {
      const owed = amount * (1 + (guests ?? 0));
      if (due.amount === owed) continue;
      await tx
        .update(dues)
        .set({ amount: owed, updatedAt: new Date() })
        .where(eq(dues.id, due.id));
      await recordDueEvent(tx, {
        dueId: due.id,
        action: "amend",
        fromStatus: due.status,
        toStatus: due.status,
        amount: owed,
        actorId: coordinator.id,
        note: `Was ₹${due.amount}`,
      });
    }
  });
}

/**
 * People who could still be added to a trip — the roster minus everyone already
 * on the settle-up list.
 */
export async function getAddableTravellers(tripId: string) {
  return db
    .select({
      id: users.id,
      name: users.name,
      // Both are here to be searched on as much as displayed. A week after the
      // trip the coordinator may only have the number the person messaged from.
      phone: users.phone,
      joiningYear: users.joiningYear,
    })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        // Anyone already on the trip keeps their row and their dues; this list
        // is only about adding someone new, and neither of these is a person a
        // coordinator meant to bring along.
        sql`${users.approvalStatus} not in ('rejected', 'blocked')`,
        sql`not exists (select 1 from ${attendance}
                        where ${attendance.userId} = ${users.id}
                          and ${attendance.tripId} = ${tripId})`,
        sql`not exists (select 1 from ${responses}
                        where ${responses.userId} = ${users.id}
                          and ${responses.tripId} = ${tripId}
                          and ${responses.going} = true)`,
      ),
    )
    .orderBy(asc(users.name));
}
