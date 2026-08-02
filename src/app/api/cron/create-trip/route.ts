import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { trips } from "@/lib/db/schema";
import { generateLinkToken } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * Creates the week's trip and opens the poll on schedule.
 *
 * Opening automatically rather than waiting on a coordinator to remember is
 * deliberate: the week nobody remembers is the week the app is useless and
 * everyone falls back to WhatsApp. Coordinators get a ready link instead of a
 * chore.
 *
 * Idempotent — running twice in a week creates nothing the second time.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dayOfWeek = Number(process.env.TRIP_DAY_OF_WEEK ?? "6");
  const departureTime = process.env.TRIP_DEPARTURE_TIME ?? "07:30";
  const destination = process.env.TRIP_DESTINATION ?? "Event venue";
  const closesTime = process.env.POLL_CLOSES_TIME ?? "20:00";
  // 1 = the day before the trip (an evening deadline), 0 = the morning of it.
  const closesDaysBefore = Number(process.env.POLL_CLOSES_DAYS_BEFORE ?? "1");

  const eventDate = nextOccurrence(dayOfWeek);
  const eventDateStr = isoDate(eventDate);

  const [existing] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.eventDate, eventDateStr), gte(trips.eventDate, isoDate(new Date()))))
    .limit(1);

  if (existing) {
    // Already created. Open it if it's still sitting in draft.
    if (existing.status === "draft") {
      const [opened] = await db
        .update(trips)
        .set({ status: "poll_open", pollOpenedAt: new Date(), updatedAt: new Date() })
        .where(eq(trips.id, existing.id))
        .returning();
      return NextResponse.json({ action: "opened", trip: summary(opened) });
    }
    return NextResponse.json({ action: "noop", trip: summary(existing) });
  }

  // Advisory only — this drives the countdown and never disables booking.
  const pollClosesAt = istDateTime(addDays(eventDate, -closesDaysBefore), closesTime);

  // A deadline already in the past means POLL_CLOSES_DAYS_BEFORE, POLL_CLOSES_TIME
  // and the cron schedule in vercel.json disagree — e.g. an 08:00 deadline set
  // for the day before, on a poll the cron opens at 09:00. Booking still works,
  // since lock is the only hard gate, but every traveller sees an expired
  // countdown. Say so plainly rather than shipping a dead clock.
  const misconfigured = pollClosesAt <= new Date();
  if (misconfigured) {
    console.warn(
      `[create-trip] poll_closes_at (${pollClosesAt.toISOString()}) is already past. ` +
        `Check POLL_CLOSES_DAYS_BEFORE=${closesDaysBefore}, POLL_CLOSES_TIME=${closesTime} ` +
        `against the cron schedule in vercel.json.`,
    );
  }

  const [created] = await db
    .insert(trips)
    .values({
      eventDate: eventDateStr,
      destination,
      departureTime,
      status: "poll_open",
      pollOpenedAt: new Date(),
      pollClosesAt,
      linkToken: generateLinkToken(),
    })
    .returning();

  return NextResponse.json({
    action: "created",
    trip: summary(created),
    ...(misconfigured
      ? { warning: "poll_closes_at is already in the past — check the poll schedule settings" }
      : {}),
  });
}

function summary(trip: typeof trips.$inferSelect) {
  return {
    id: trip.id,
    eventDate: trip.eventDate,
    status: trip.status,
    linkToken: trip.linkToken,
  };
}

/** The next date falling on `dayOfWeek` (0=Sun). Today counts if it matches. */
function nextOccurrence(dayOfWeek: number, from: Date = new Date()): Date {
  const d = new Date(from);
  const delta = (dayOfWeek - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "20:00" on `date`, interpreted as IST, returned as a UTC instant. */
function istDateTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  // IST is UTC+5:30 year-round — India observes no daylight saving.
  return new Date(`${isoDate(date)}T${pad(h)}:${pad(m)}:00+05:30`);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
