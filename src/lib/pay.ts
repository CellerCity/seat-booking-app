import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { attendance, dues, responses, trips, users, type Trip, type User } from "./db/schema";
import { recordDueEvent } from "./audit";
import { buildUpiLink, normalizeVpa, UpiError } from "./upi";
import { IST } from "./format";

/**
 * The traveller's side of settling up.
 *
 * Two rules shape all of this, and both were asked for directly:
 *
 *  1. **Nothing is payable until a coordinator says what it costs.** The fare is
 *     announced, not calculated by the app, so until `amountPerPerson` is set
 *     there is no number anyone should be sending money against. A traveller who
 *     guesses and pays the wrong amount is a reconciliation problem, and
 *     reconciliation is the thing this app exists to remove.
 *
 *  2. **A traveller's tap is a claim, never a verification.** Identity here is a
 *     phone number typed into a browser, and a `upi://` intent gives the page no
 *     callback, so the app genuinely cannot know that money moved. `claimed`
 *     says "he says he sent it"; only a coordinator who has seen the credit in
 *     their own bank app can say `verified`. Collapsing the two would make the
 *     ledger self-certifying and worthless in exactly the argument it exists to
 *     settle.
 *
 * What it does buy: a coordinator opens the collection list and finds the people
 * who paid already at the top with a time against each — which is precisely the
 * "paid but forgot to re-poll" case that made the WhatsApp process unworkable.
 */

export class PayError extends Error {}

export type Payee = { vpa: string; name: string };

export type PayView =
  /** Not a trip this person owes anything on. No payment section is rendered. */
  | { state: "hidden" }
  /** They travelled, but no coordinator has said what it costs yet. */
  | { state: "awaiting_amount" }
  /** Fare set, but nobody has been named to collect it. */
  | { state: "awaiting_collector"; amount: number }
  | {
      state: "due";
      /** Seats they are paying for: their own plus anyone who came with them. */
      riders: number;
      perPerson: number;
      amount: number;
      payee: Payee;
      /** `upi://pay?…` — opens their UPI app with everything filled in. */
      link: string;
    }
  | {
      state: "claimed";
      /** What they said they sent, frozen at the moment they said it. */
      claimedAmount: number;
      claimedAt: Date;
      /** What they owe now. Differs only if the fare was corrected afterwards. */
      amount: number;
      payee: Payee | null;
    }
  | {
      state: "settled";
      amount: number;
      /** Set when a friend settled this share. */
      paidByName: string | null;
      waived: boolean;
      at: Date | null;
    };

/** "Cab 12 Aug" — what shows up in the payment app and on a bank statement. */
function paymentNote(trip: Trip): string {
  const day = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: IST,
  }).format(new Date(`${trip.eventDate}T00:00:00Z`));
  return `Cab ${day}`;
}

/** The trip's collector, if one has been named and their address still parses. */
function payeeOf(trip: Trip): Payee | null {
  if (!trip.collectUpiVpa || !trip.collectUpiName) return null;
  try {
    return { vpa: normalizeVpa(trip.collectUpiVpa), name: trip.collectUpiName };
  } catch {
    // Stored before validation existed, or edited in the database by hand.
    // Showing no payment option is better than showing an address that fails
    // silently inside someone's UPI app.
    return null;
  }
}

/**
 * How many shares this person owes.
 *
 * Attendance wins where it exists — a coordinator marking the bus is ground
 * truth. Where it does not, their own booking is the best statement of how many
 * seats they took, so someone who booked for two friends is shown three shares
 * rather than being quoted one and then billed three once attendance is marked.
 */
function ridersFrom(
  attendanceGuests: number | null | undefined,
  responseGuests: number | null | undefined,
): number {
  return 1 + (attendanceGuests ?? responseGuests ?? 0);
}

async function payRows(tripId: string, userId: string) {
  const [[att], [resp], [due]] = await Promise.all([
    db
      .select()
      .from(attendance)
      .where(and(eq(attendance.tripId, tripId), eq(attendance.userId, userId)))
      .limit(1),
    db
      .select()
      .from(responses)
      .where(and(eq(responses.tripId, tripId), eq(responses.userId, userId)))
      .limit(1),
    db
      .select()
      .from(dues)
      .where(and(eq(dues.tripId, tripId), eq(dues.userId, userId)))
      .limit(1),
  ]);

  return { att, resp, due };
}

/**
 * What this traveller should see about money on this trip.
 *
 * Read-only. Everything it can return is derived from rows a coordinator wrote,
 * so a traveller cannot talk themselves into a payable state.
 */
export async function getPayView(trip: Trip, user: User): Promise<PayView> {
  if (trip.status === "cancelled" || trip.status === "draft") return { state: "hidden" };

  const { att, resp, due } = await payRows(trip.id, user.id);

  // A settled share is worth showing whatever else is true — including to
  // someone later marked as not having travelled, who would otherwise see their
  // payment vanish off the page with no explanation.
  if (due && (due.status === "verified" || due.status === "waived")) {
    const [payer] = due.paidByUserId
      ? await db.select({ name: users.name }).from(users).where(eq(users.id, due.paidByUserId))
      : [];

    return {
      state: "settled",
      amount: due.amount,
      paidByName: payer?.name ?? null,
      waived: due.status === "waived",
      at: due.verifiedAt,
    };
  }

  // Only riders are billed. No attendance row yet means nobody has marked the
  // bus, so their own booking stands in for it.
  const travelled = att ? att.boarded : resp?.going === true;
  if (!travelled) return { state: "hidden" };

  if (due && due.status === "claimed") {
    return {
      state: "claimed",
      claimedAmount: due.claimedAmount ?? due.amount,
      claimedAt: due.claimedAt ?? due.updatedAt,
      amount: due.amount,
      payee: payeeOf(trip),
    };
  }

  // The gate: no announced fare, nothing to pay against.
  if (trip.amountPerPerson === null) return { state: "awaiting_amount" };

  const riders = ridersFrom(att?.guests, resp?.guests);
  const amount = trip.amountPerPerson * riders;
  if (amount <= 0) return { state: "hidden" };

  const payee = payeeOf(trip);
  if (!payee) return { state: "awaiting_collector", amount };

  return {
    state: "due",
    riders,
    perPerson: trip.amountPerPerson,
    amount,
    payee,
    link: buildUpiLink({
      vpa: payee.vpa,
      payeeName: payee.name,
      amountRupees: amount,
      note: paymentNote(trip),
    }),
  };
}

/**
 * "I've paid" — the traveller's own word, recorded as such.
 *
 * Re-derives everything from the database rather than trusting anything the
 * page sent: server functions are reachable by direct POST, so the amount, the
 * rider count and the right to pay at all are all decided here.
 */
export async function claimPayment(trip: Trip, user: User): Promise<void> {
  if (trip.status === "cancelled") {
    throw new PayError("That trip was cancelled — there is nothing to pay");
  }
  if (trip.amountPerPerson === null) {
    throw new PayError("A coordinator hasn't set the fare for this trip yet");
  }

  await db.transaction(async (tx) => {
    const [att] = await tx
      .select()
      .from(attendance)
      .where(and(eq(attendance.tripId, trip.id), eq(attendance.userId, user.id)))
      .limit(1);
    const [resp] = await tx
      .select()
      .from(responses)
      .where(and(eq(responses.tripId, trip.id), eq(responses.userId, user.id)))
      .limit(1);

    const travelled = att ? att.boarded : resp?.going === true;
    if (!travelled) {
      throw new PayError("You're not down as having travelled on this trip");
    }

    const amount = trip.amountPerPerson! * ridersFrom(att?.guests, resp?.guests);
    if (amount <= 0) throw new PayError("There is nothing to pay");

    const [existing] = await tx
      .select()
      .from(dues)
      .where(and(eq(dues.tripId, trip.id), eq(dues.userId, user.id)))
      .limit(1);

    // Already settled, or already claimed: saying so twice is not a new fact,
    // and a second claim must not reset the time a coordinator is reading.
    if (existing) {
      if (existing.status !== "unpaid") return;

      await tx
        .update(dues)
        .set({
          status: "claimed",
          claimedAt: new Date(),
          claimedAmount: amount,
          amount,
          method: "upi",
          updatedAt: new Date(),
        })
        .where(eq(dues.id, existing.id));

      await recordDueEvent(tx, {
        dueId: existing.id,
        action: "claim",
        fromStatus: existing.status,
        toStatus: "claimed",
        amount,
        // The traveller is the actor. A `claim` is the one due event that is not
        // a coordinator's act, and the ledger should say so.
        actorId: user.id,
      });
      return;
    }

    const [created] = await tx
      .insert(dues)
      .values({
        tripId: trip.id,
        userId: user.id,
        amount,
        status: "claimed",
        claimedAt: new Date(),
        claimedAmount: amount,
        method: "upi",
      })
      .returning();

    // The debt existing and the traveller claiming to have settled it are two
    // separate facts, so they are two events even though one tap made both.
    await recordDueEvent(tx, {
      dueId: created.id,
      action: "generate",
      toStatus: "unpaid",
      amount,
      actorId: user.id,
    });
    await recordDueEvent(tx, {
      dueId: created.id,
      action: "claim",
      fromStatus: "unpaid",
      toStatus: "claimed",
      amount,
      actorId: user.id,
    });
  });
}

/**
 * "Actually, that wasn't me" — the traveller taking their own claim back.
 *
 * A mis-tap on "I've paid" otherwise leaves a coordinator hunting a bank credit
 * that was never sent, and the only way out would be to message someone. This
 * is why the claim button needs no confirmation step: it is undoable, which is
 * kinder than being obstructive.
 *
 * Only ever their own, and only while it is still just a claim. Once a
 * coordinator has verified the money against their bank, the traveller no
 * longer gets to remove it — that is now the coordinator's record, not theirs.
 */
export async function retractClaim(trip: Trip, user: User): Promise<void> {
  await db.transaction(async (tx) => {
    const [due] = await tx
      .select()
      .from(dues)
      .where(and(eq(dues.tripId, trip.id), eq(dues.userId, user.id)))
      .limit(1);

    if (!due) return;
    if (due.status !== "claimed") {
      throw new PayError("A coordinator has already confirmed this — speak to them to change it");
    }

    await tx
      .update(dues)
      .set({ status: "unpaid", claimedAt: null, claimedAmount: null, updatedAt: new Date() })
      .where(eq(dues.id, due.id));

    await recordDueEvent(tx, {
      dueId: due.id,
      action: "unverify",
      fromStatus: "claimed",
      toStatus: "unpaid",
      amount: due.amount,
      actorId: user.id,
      note: "Traveller withdrew their own claim",
    });
  });
}

/**
 * Name a coordinator as this week's collector, snapshotting their UPI address.
 *
 * Snapshotted rather than read live so that changing your UPI ID next year does
 * not rewrite who last March's payments were made to.
 */
export async function setCollector(trip: Trip, collectorId: string | null): Promise<void> {
  if (collectorId === null) {
    await db
      .update(trips)
      .set({
        collectedByUserId: null,
        collectUpiVpa: null,
        collectUpiName: null,
        updatedAt: new Date(),
      })
      .where(eq(trips.id, trip.id));
    return;
  }

  const [collector] = await db.select().from(users).where(eq(users.id, collectorId)).limit(1);
  if (!collector) throw new PayError("No such person");
  if (collector.role !== "coordinator") {
    throw new PayError(`${collector.name} isn't a coordinator`);
  }
  if (!collector.upiVpa) {
    throw new PayError(`${collector.name} hasn't added their UPI ID yet`);
  }

  // Validated again on the way in. The snapshot is what fifty people will pay
  // against, and it outlives whatever the roster says later.
  let vpa: string;
  try {
    vpa = normalizeVpa(collector.upiVpa);
  } catch (e) {
    throw new PayError(
      e instanceof UpiError ? `${collector.name}'s UPI ID doesn't look right` : "Invalid UPI ID",
    );
  }

  await db
    .update(trips)
    .set({
      collectedByUserId: collector.id,
      collectUpiVpa: vpa,
      collectUpiName: collector.name,
      updatedAt: new Date(),
    })
    .where(eq(trips.id, trip.id));
}

/** Set or clear a coordinator's own UPI address. */
export async function setUpiVpa(userId: string, rawVpa: string | null): Promise<void> {
  const vpa = rawVpa === null || rawVpa.trim() === "" ? null : normalizeVpa(rawVpa);

  await db.update(users).set({ upiVpa: vpa, updatedAt: new Date() }).where(eq(users.id, userId));
}

/** Coordinators who could collect this week — anyone who has added a UPI ID. */
export async function getPossibleCollectors() {
  return db
    .select({ id: users.id, name: users.name, joiningYear: users.joiningYear, upiVpa: users.upiVpa })
    .from(users)
    .where(and(eq(users.role, "coordinator"), eq(users.isActive, true)))
    .orderBy(users.name);
}
