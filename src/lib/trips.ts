import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "./db";
import {
  attendance,
  dues,
  responseEvents,
  responses,
  settlements,
  trips,
  users,
  type Trip,
  type User,
} from "./db/schema";
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

/**
 * The trip travellers should currently be looking at.
 *
 * The date filter is load-bearing. A trip that has been and gone keeps whatever
 * status it had — nothing marks it finished — so without it the soonest
 * non-settled trip is a stale one from weeks ago, and the roster page then
 * offers to record responses against the wrong trip entirely.
 */
export async function getCurrentTrip(): Promise<Trip | null> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(
      sql`${trips.status} not in ('settled', 'cancelled')
          and ${trips.eventDate} >= current_date`,
    )
    .orderBy(trips.eventDate, trips.departureTime)
    .limit(1);
  return trip ?? null;
}

export type TripSummary = Trip & {
  /** Said they were going, before the trip. */
  booked: number;
  /** Marked as having actually turned up. */
  travelled: number;
  paid: number;
};

/**
 * Every trip, newest first — the only way to reach one that has already
 * happened.
 *
 * The dashboard deliberately shows upcoming trips only; it is the screen used
 * while phoning the contractor and a list of history on it is noise. But
 * settling up happens *after* a trip, by which point it has dropped off that
 * list, so it needs a door of its own.
 */
export async function getTripHistory(limit = 50): Promise<TripSummary[]> {
  return db
    .select({
      ...getTableColumns(trips),
      booked: sql<number>`(select count(*)::int from ${responses}
                           where ${responses.tripId} = ${trips.id}
                             and ${responses.going} = true)`,
      travelled: sql<number>`(select count(*)::int from ${attendance}
                              where ${attendance.tripId} = ${trips.id}
                                and ${attendance.boarded} = true)`,
      paid: sql<number>`(select count(*)::int from ${dues}
                         where ${dues.tripId} = ${trips.id}
                           and ${dues.status} in ('verified', 'waived'))`,
    })
    .from(trips)
    .orderBy(desc(trips.eventDate), desc(trips.departureTime))
    .limit(limit);
}

/**
 * Every trip still in play, soonest first.
 *
 * There can be more than one in a week — the regular Friday run plus a one-off —
 * so the dashboard shows a list rather than assuming a single current trip.
 * Cancelled trips stay visible until their date passes: a coordinator needs to
 * see that Saturday was called off, not have it silently vanish.
 */
export async function getUpcomingTrips(): Promise<Trip[]> {
  return db
    .select()
    .from(trips)
    .where(sql`${trips.status} <> 'settled' and ${trips.eventDate} >= current_date`)
    .orderBy(trips.eventDate, trips.departureTime);
}

export async function getTripById(id: string): Promise<Trip | null> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, id)).limit(1);
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
  /** Everyone who responded either way, for "this will remove N responses". */
  total: number;
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

  const count = {
    confirmed: 0,
    awaitingLateDecision: 0,
    awaitingApproval: 0,
    withdrewAfterLock: 0,
    total: rows.length,
  };

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

/**
 * A one-off trip a coordinator adds by hand.
 *
 * The weekly run is created by the cron; this covers the extra event, the
 * rescheduled one, and the week the timings differ. It opens the poll straight
 * away — a trip added manually is one someone wants people to respond to now.
 */
export async function createTrip(
  input: {
    eventDate: string;
    destination: string;
    departureTime: string;
    pollClosesAt?: Date | null;
  },
  coordinator: User,
): Promise<Trip> {
  const eventDate = input.eventDate.trim();
  const destination = input.destination.trim();
  const departureTime = input.departureTime.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new TripError("Pick a date");
  if (!destination) throw new TripError("Where is it going?");
  if (!/^\d{2}:\d{2}/.test(departureTime)) throw new TripError("Pick a departure time");

  // Comparing date strings is safe here: ISO dates sort chronologically, and
  // this deliberately uses the server's day rather than the browser's.
  if (eventDate < new Date().toISOString().slice(0, 10)) {
    throw new TripError("That date has already passed");
  }

  const clash = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.eventDate, eventDate),
        eq(trips.departureTime, departureTime),
        sql`${trips.status} <> 'cancelled'`,
      ),
    )
    .limit(1);

  if (clash.length > 0) {
    throw new TripError("A trip already exists that day at that time");
  }

  const [trip] = await db
    .insert(trips)
    .values({
      eventDate,
      destination,
      departureTime,
      status: "poll_open",
      pollOpenedAt: new Date(),
      pollClosesAt: input.pollClosesAt ?? null,
      linkToken: generateLinkToken(),
      createdBy: coordinator.id,
    })
    .returning();

  return trip;
}

/**
 * Call a trip off — weather, the event itself cancelled, too few people.
 *
 * One-way on purpose. Un-cancelling would rewrite what travellers were already
 * told; if the trip is back on, it is a new trip with a new link. The reason is
 * required and shown to travellers, because "cancelled" with no explanation
 * sends fifty people to WhatsApp to ask why.
 */
export async function cancelTrip(trip: Trip, reason: string, coordinator: User): Promise<Trip> {
  const note = reason.trim();
  if (note.length < 3) throw new TripError("Give a short reason — travellers see it");
  if (trip.status === "cancelled") throw new TripError("Already cancelled");
  if (trip.status === "settled") throw new TripError("That trip is already settled");

  const [updated] = await db
    .update(trips)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: coordinator.id,
      cancelReason: note,
      updatedAt: new Date(),
    })
    .where(eq(trips.id, trip.id))
    .returning();

  return updated;
}

/**
 * Remove a trip and its responses entirely.
 *
 * This is for tidying up test runs and mistaken entries, not for managing real
 * ones — a trip that happened and was called off should be cancelled, which
 * keeps the record and the reason. Cancelling is the normal act; deleting is
 * the housekeeping one.
 *
 * Every table hangs off trips with ON DELETE CASCADE, so removing a row here
 * silently takes attendance, dues and the settlement with it. That is fine for
 * a trip nobody travelled on and unacceptable for one anybody paid for, so the
 * money and attendance records are checked first and refuse the delete rather
 * than being quietly destroyed. Responses and their audit events do go — that
 * is the point of the feature.
 */
export async function deleteTrip(trip: Trip): Promise<void> {
  if (trip.status === "settled") {
    throw new TripError("That trip is settled — its record has to stay");
  }

  const [[dueRow], [attendanceRow], [settlementRow]] = await Promise.all([
    db.select({ n: count() }).from(dues).where(eq(dues.tripId, trip.id)),
    db.select({ n: count() }).from(attendance).where(eq(attendance.tripId, trip.id)),
    db.select({ n: count() }).from(settlements).where(eq(settlements.tripId, trip.id)),
  ]);

  if (dueRow.n > 0 || settlementRow.n > 0) {
    throw new TripError("That trip has money against it — cancel it instead of deleting");
  }
  if (attendanceRow.n > 0) {
    throw new TripError("People are marked as having travelled on that trip — cancel it instead");
  }

  await db.delete(trips).where(eq(trips.id, trip.id));
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
