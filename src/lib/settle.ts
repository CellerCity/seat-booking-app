import "server-only";
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { attendance, dues, responses, trips, users, type Trip, type User } from "./db/schema";
import { recordDueEvent } from "./audit";

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
  paid: boolean;
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
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      phone: users.phone,
      joiningYear: users.joiningYear,
      isActive: users.isActive,
      going: responses.going,
      travelled: attendance.boarded,
      dueStatus: dues.status,
      amount: dues.amount,
      verifiedAt: dues.verifiedAt,
    })
    .from(users)
    .leftJoin(responses, and(eq(responses.userId, users.id), eq(responses.tripId, tripId)))
    .leftJoin(attendance, and(eq(attendance.userId, users.id), eq(attendance.tripId, tripId)))
    .leftJoin(dues, and(eq(dues.userId, users.id), eq(dues.tripId, tripId)))
    .where(or(eq(responses.going, true), isNotNull(attendance.id), isNotNull(dues.id)))
    .orderBy(asc(users.name));

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    phone: r.phone,
    joiningYear: r.joiningYear,
    booked: r.going ?? false,
    travelled: r.travelled,
    paid: r.dueStatus === "verified" || r.dueStatus === "waived",
    amount: r.amount,
    paidAt: r.verifiedAt,
    archived: !r.isActive,
  }));
}

export type LedgerTotals = {
  travelled: number;
  /** Marked as having travelled but not yet paid. */
  outstanding: number;
  paid: number;
  /** Booked but nobody has said whether they turned up. */
  unmarked: number;
  collectedRupees: number;
  outstandingRupees: number;
};

/** Pure — takes the rows the page already has rather than querying again. */
export function totalsFor(rows: LedgerRow[], amountPerPerson: number | null): LedgerTotals {
  const travelled = rows.filter((r) => r.travelled === true);
  const paid = travelled.filter((r) => r.paid);
  const unpaid = travelled.filter((r) => !r.paid);

  return {
    travelled: travelled.length,
    paid: paid.length,
    outstanding: unpaid.length,
    unmarked: rows.filter((r) => r.travelled === null).length,
    collectedRupees: paid.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    outstandingRupees: unpaid.length * (amountPerPerson ?? 0),
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
        .set({ boarded: travelled, markedBy: coordinator.id, markedAt: new Date(), updatedAt: new Date() })
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
 * Record that someone has settled up.
 *
 * Marking an unmarked person paid also marks them as having travelled, which is
 * what makes the forgotten-traveller case one tap instead of two: a coordinator
 * who remembers "he came, and he paid me" says exactly that.
 */
export async function markPaid(trip: Trip, userId: string, coordinator: User): Promise<void> {
  assertSettleable(trip);
  const person = await personById(userId);
  const amount = trip.amountPerPerson ?? 0;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(attendance)
      .where(and(eq(attendance.tripId, trip.id), eq(attendance.userId, userId)))
      .limit(1);

    if (existing && !existing.boarded) {
      throw new SettleError(
        `${person.name} is marked as not having travelled — only riders are billed`,
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

    const existing = await tx.select().from(dues).where(eq(dues.tripId, trip.id));

    for (const due of existing) {
      if (due.amount === amount) continue;
      await tx.update(dues).set({ amount, updatedAt: new Date() }).where(eq(dues.id, due.id));
      await recordDueEvent(tx, {
        dueId: due.id,
        action: "amend",
        fromStatus: due.status,
        toStatus: due.status,
        amount,
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
