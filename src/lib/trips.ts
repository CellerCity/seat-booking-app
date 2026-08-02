import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { responseEvents, responses, trips, users, type Trip, type User } from "./db/schema";
import { recordResponseEvent } from "./audit";

/**
 * Trip and response logic — the pre-event half of the app.
 *
 * The one rule everything here serves: produce a trustworthy number at a
 * trustworthy time, because a coordinator is going to read it down the phone to
 * a cab contractor and cannot easily revise it afterwards.
 */

export class TripError extends Error {}

/** ≥128 bits. Trip links are forwarded around WhatsApp, so they must not be guessable. */
export function generateLinkToken(): string {
  return randomBytes(24).toString("base64url");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getTripByToken(token: string): Promise<Trip | null> {
  const [trip] = await db.select().from(trips).where(eq(trips.linkToken, token)).limit(1);
  return trip ?? null;
}

/** The trip travellers should currently be looking at. */
export async function getCurrentTrip(): Promise<Trip | null> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(sql`${trips.status} not in ('settled', 'cancelled')`)
    .orderBy(trips.eventDate)
    .limit(1);
  return trip ?? null;
}

export async function getResponse(tripId: string, userId: string) {
  const [response] = await db
    .select()
    .from(responses)
    .where(and(eq(responses.tripId, tripId), eq(responses.userId, userId)))
    .limit(1);
  return response ?? null;
}

export type HeadcountBreakdown = {
  /** The number read to the contractor: approved people, booked in time or accepted late. */
  confirmed: number;
  /** Booked after lock, awaiting a coordinator's accept/decline. */
  awaitingLateDecision: number;
  /** Booked by someone not yet approved as a member. Excluded from the count. */
  awaitingApproval: number;
  /** Withdrew after the count was locked — cabs are already hired for them. */
  withdrewAfterLock: number;
};

/**
 * Every number the dashboard shows, in one query.
 *
 * The distinctions matter: only `confirmed` is real, and conflating it with the
 * other three is exactly the error that leaves people standing at the pickup
 * point without a seat.
 */
export async function getHeadcount(trip: Trip): Promise<HeadcountBreakdown> {
  const locked = trip.lockedAt;

  const rows = await db
    .select({
      going: responses.going,
      approvalStatus: users.approvalStatus,
      lateApproved: responses.lateApproved,
      firstRespondedAt: responses.firstRespondedAt,
      updatedAt: responses.updatedAt,
      isActive: users.isActive,
    })
    .from(responses)
    .innerJoin(users, eq(responses.userId, users.id))
    .where(eq(responses.tripId, trip.id));

  const count = { confirmed: 0, awaitingLateDecision: 0, awaitingApproval: 0, withdrewAfterLock: 0 };

  for (const r of rows) {
    if (!r.isActive || r.approvalStatus === "blocked" || r.approvalStatus === "rejected") continue;

    if (!r.going) {
      // A withdrawal only hurts if the cabs were already hired against it.
      if (locked && r.updatedAt > locked) count.withdrewAfterLock++;
      continue;
    }

    if (r.approvalStatus === "pending") {
      count.awaitingApproval++;
      continue;
    }

    const isLate = locked !== null && r.firstRespondedAt > locked;
    if (isLate && !r.lateApproved) count.awaitingLateDecision++;
    else count.confirmed++;
  }

  return count;
}

/** Live feed for the dashboard: who did what, exactly when. */
export async function getResponseFeed(tripId: string, limit = 100) {
  return db
    .select({
      id: responseEvents.id,
      action: responseEvents.action,
      occurredAt: responseEvents.occurredAt,
      source: responseEvents.source,
      userName: users.name,
      userId: users.id,
    })
    .from(responseEvents)
    .innerJoin(users, eq(responseEvents.userId, users.id))
    .where(eq(responseEvents.tripId, tripId))
    .orderBy(desc(responseEvents.occurredAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function assertPollUsable(trip: Trip) {
  // `poll_closes_at` is advisory and deliberately not checked — it drives the
  // countdown and reminders but never disables booking. Lock is the only gate,
  // and even lock does not refuse a booking; it reroutes it to a coordinator.
  if (trip.status === "cancelled") throw new TripError("This trip was cancelled");
  if (trip.status === "draft") throw new TripError("The poll hasn't opened yet");
  if (trip.status === "settled") throw new TripError("This trip is already settled");
}

export type BookOutcome = {
  booked: boolean;
  /** Booked after lock: a coordinator has to accept it, so no seat is promised. */
  isLate: boolean;
  /** The member isn't approved yet, so the booking is held out of the count. */
  isHeld: boolean;
};

export async function bookSeat(
  trip: Trip,
  user: User,
  opts: { source: "self" | "coordinator"; actorId?: string } = { source: "self" },
): Promise<BookOutcome> {
  assertPollUsable(trip);
  if (user.approvalStatus === "blocked") throw new TripError("Access removed");
  if (user.approvalStatus === "rejected") throw new TripError("Not a member of this group");

  const isLate = trip.lockedAt !== null;
  const isHeld = user.approvalStatus === "pending";

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(responses)
      .where(and(eq(responses.tripId, trip.id), eq(responses.userId, user.id)))
      .limit(1);

    if (existing?.going) return; // already booked; nothing to record

    if (existing) {
      // Re-booking after a withdrawal. `firstRespondedAt` is deliberately NOT
      // updated: a withdraw-then-rebook must not launder a late booking into
      // an on-time one.
      await tx
        .update(responses)
        .set({ going: true, updatedAt: new Date() })
        .where(eq(responses.id, existing.id));
    } else {
      await tx.insert(responses).values({
        tripId: trip.id,
        userId: user.id,
        going: true,
        source: opts.source,
        recordedBy: opts.actorId ?? null,
      });
    }

    await recordResponseEvent(tx, {
      tripId: trip.id,
      userId: user.id,
      action: "book",
      toValue: "going",
      source: opts.source,
      actorId: opts.actorId ?? null,
    });
  });

  return { booked: true, isLate, isHeld };
}

export async function withdraw(
  trip: Trip,
  user: User,
  opts: { source: "self" | "coordinator"; actorId?: string } = { source: "self" },
): Promise<{ afterLock: boolean }> {
  assertPollUsable(trip);
  if (user.approvalStatus === "blocked") throw new TripError("Access removed");

  const afterLock = trip.lockedAt !== null;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(responses)
      .where(and(eq(responses.tripId, trip.id), eq(responses.userId, user.id)))
      .limit(1);

    if (!existing || !existing.going) return;

    await tx
      .update(responses)
      .set({ going: false, lateApproved: false, updatedAt: new Date() })
      .where(eq(responses.id, existing.id));

    await recordResponseEvent(tx, {
      tripId: trip.id,
      userId: user.id,
      action: "withdraw",
      fromValue: "going",
      toValue: "not_going",
      source: opts.source,
      actorId: opts.actorId ?? null,
    });
  });

  return { afterLock };
}

/**
 * Snapshot the count at the moment of the contractor call.
 *
 * After this, every new booking is provably late — a fact with a timestamp
 * rather than a judgement call about who was slow.
 */
export async function lockTrip(trip: Trip, coordinator: User): Promise<Trip> {
  if (trip.status !== "poll_open") {
    throw new TripError(`Cannot lock a trip that is ${trip.status}`);
  }

  const { confirmed } = await getHeadcount(trip);

  const [updated] = await db
    .update(trips)
    .set({
      status: "locked",
      lockedAt: new Date(),
      lockedBy: coordinator.id,
      lockedCount: confirmed,
      updatedAt: new Date(),
    })
    .where(eq(trips.id, trip.id))
    .returning();

  return updated;
}

/** A coordinator accepting or declining a post-lock booking. Always a person's call. */
export async function decideLateBooking(
  trip: Trip,
  userId: string,
  accept: boolean,
  coordinator: User,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(responses)
      .where(and(eq(responses.tripId, trip.id), eq(responses.userId, userId)))
      .limit(1);

    if (!existing) throw new TripError("No booking to decide on");

    await tx
      .update(responses)
      .set({
        lateApproved: accept,
        going: accept,
        updatedAt: new Date(),
      })
      .where(eq(responses.id, existing.id));

    await recordResponseEvent(tx, {
      tripId: trip.id,
      userId,
      action: accept ? "approve_late" : "decline_late",
      toValue: accept ? "going" : "not_going",
      source: "coordinator",
      actorId: coordinator.id,
    });
  });
}
