import Link from "next/link";
import { and, eq, gt } from "drizzle-orm";
import { requireCoordinatorPage } from "@/lib/auth/coordinator";
import { db } from "@/lib/db";
import { cabTypes, responses, users } from "@/lib/db/schema";
import { getCurrentTrip, getHeadcount, getResponseFeed } from "@/lib/trips";
import { countPendingMembers } from "@/lib/members";
import { planCabs } from "@/lib/cost";
import { formatClockTime, formatTime, formatTripDate, relativeTime } from "@/lib/format";
import {
  CopyCountButton,
  LateDecisionButtons,
  LockButton,
  OpenPollButton,
} from "./dashboard-controls";

export const dynamic = "force-dynamic";

/**
 * The screen a coordinator has open while phoning the cab contractor.
 *
 * One number is authoritative. The other three figures exist precisely so they
 * are never silently folded into it.
 */
export default async function DashboardPage() {
  await requireCoordinatorPage();

  const trip = await getCurrentTrip();
  if (!trip) {
    return (
      <EmptyState>
        No trip scheduled yet. The weekly cron creates one automatically.
      </EmptyState>
    );
  }

  const [count, feed, pendingApprovals, [defaultCab]] = await Promise.all([
    getHeadcount(trip),
    getResponseFeed(trip.id, 40),
    countPendingMembers(),
    db.select().from(cabTypes).where(eq(cabTypes.isActive, true)).limit(1),
  ]);

  const capacity = defaultCab?.capacity ?? 12;
  const { cabsNeeded, seatsFree } = planCabs(count.confirmed, capacity);
  const locked = trip.lockedAt !== null;

  const lateBookings = locked ? await getLateBookings(trip.id, trip.lockedAt!) : [];
  const withdrawals = locked ? await getPostLockWithdrawals(trip.id, trip.lockedAt!) : [];

  const whatsappSummary =
    `${formatTripDate(trip.eventDate)} — ${trip.destination}\n` +
    `Leaving ${formatTime(trip.departureTime)}\n` +
    `Count: ${count.confirmed}${locked ? " (locked)" : ""}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{formatTripDate(trip.eventDate)}</h1>
          <p className="text-sm text-slate-500">
            {trip.destination} · leaves {formatTime(trip.departureTime)} ·{" "}
            <span className="capitalize">{trip.status.replace("_", " ")}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CopyCountButton text={whatsappSummary} />
          {trip.status === "draft" && <OpenPollButton tripId={trip.id} />}
          {trip.status === "poll_open" && (
            <LockButton tripId={trip.id} count={count.confirmed} />
          )}
        </div>
      </header>

      {pendingApprovals > 0 && (
        <Link
          href="/admin/roster"
          className="block rounded-lg bg-blue-50 px-4 py-3 text-sm font-medium text-blue-900 dark:bg-blue-950 dark:text-blue-200"
        >
          {pendingApprovals} {pendingApprovals === 1 ? "person is" : "people are"} waiting
          for approval — they don&apos;t count until you approve them →
        </Link>
      )}

      {/* The number read down the phone. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-medium text-slate-500">
          {locked ? "Locked count" : "Going"}
        </p>
        <p className="mt-1 text-6xl font-bold tabular-nums">{count.confirmed}</p>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span className="text-slate-600 dark:text-slate-400">
            <strong className="tabular-nums">{cabsNeeded}</strong>{" "}
            {defaultCab?.name ?? "cab"}
            {cabsNeeded === 1 ? "" : "s"} at {capacity} seats
          </span>
          <span
            className={
              seatsFree === 0
                ? "font-medium text-amber-700 dark:text-amber-400"
                : "text-slate-600 dark:text-slate-400"
            }
          >
            {seatsFree === 0
              ? "Last cab is full — one more person means another cab"
              : `${seatsFree} seat${seatsFree === 1 ? "" : "s"} free in the last cab`}
          </span>
        </div>

        {trip.pollClosesAt && !locked && (
          <p className="mt-3 text-sm text-slate-500">
            Poll closes {formatClockTime(trip.pollClosesAt)} ({relativeTime(trip.pollClosesAt)})
            — advisory only, booking stays open until you lock.
          </p>
        )}

        {locked && trip.lockedAt && (
          <p className="mt-3 text-sm text-slate-500">
            Locked at {formatClockTime(trip.lockedAt)} · snapshot {trip.lockedCount}
          </p>
        )}
      </section>

      {locked && lateBookings.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="font-semibold text-amber-900 dark:text-amber-200">
            Late additions ({lateBookings.length})
          </h2>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            {seatsFree > 0
              ? `${seatsFree} seat${seatsFree === 1 ? "" : "s"} free, so these cost nothing extra.`
              : "The last cab is full — accepting means hiring another cab."}
          </p>
          <ul className="mt-3 space-y-2">
            {lateBookings.map((b) => (
              <li
                key={b.userId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 dark:bg-slate-900"
              >
                <span>
                  {b.name}{" "}
                  <span className="text-sm text-slate-500">
                    booked {formatClockTime(b.firstRespondedAt)}
                  </span>
                </span>
                <LateDecisionButtons tripId={trip.id} userId={b.userId} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {locked && withdrawals.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-semibold">Withdrew after lock ({withdrawals.length})</h2>
          <p className="mt-1 text-sm text-slate-500">
            Cabs are already hired for these seats. Nobody is charged for a seat they
            didn&apos;t use — only people who actually board are billed.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {withdrawals.map((w) => (
              <li key={w.userId} className="flex justify-between">
                <span>{w.name}</span>
                <span className="text-slate-500">{formatClockTime(w.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Responses</h2>
          <Link href="/admin/roster" className="text-sm text-slate-500 underline">
            Full roster →
          </Link>
        </div>

        {feed.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nobody has responded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {feed.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <span>
                  {e.userName}{" "}
                  <span
                    className={
                      e.action === "withdraw"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-emerald-700 dark:text-emerald-400"
                    }
                  >
                    {labelFor(e.action)}
                  </span>
                  {e.source === "coordinator" && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      entered by coordinator
                    </span>
                  )}
                </span>
                <time className="tabular-nums text-slate-500">
                  {formatClockTime(e.occurredAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function labelFor(action: string) {
  switch (action) {
    case "book":
      return "is going";
    case "withdraw":
      return "withdrew";
    case "approve_late":
      return "accepted (late)";
    case "decline_late":
      return "declined (late)";
    default:
      return action;
  }
}

/**
 * Both of these compare against `lockedAt`, and both must use the typed
 * operators rather than a raw sql`` template. Inside a raw template Drizzle has
 * no column type to consult, so a Date reaches the driver unserialised and the
 * query dies with ERR_INVALID_ARG_TYPE. eq/gt map the value through the column
 * definition, which is what converts it.
 */
async function getLateBookings(tripId: string, lockedAt: Date) {
  return db
    .select({
      userId: users.id,
      name: users.name,
      firstRespondedAt: responses.firstRespondedAt,
    })
    .from(responses)
    .innerJoin(users, eq(responses.userId, users.id))
    .where(
      and(
        eq(responses.tripId, tripId),
        eq(responses.going, true),
        eq(responses.lateApproved, false),
        gt(responses.firstRespondedAt, lockedAt),
        eq(users.approvalStatus, "approved"),
      ),
    );
}

async function getPostLockWithdrawals(tripId: string, lockedAt: Date) {
  return db
    .select({ userId: users.id, name: users.name, updatedAt: responses.updatedAt })
    .from(responses)
    .innerJoin(users, eq(responses.userId, users.id))
    .where(
      and(
        eq(responses.tripId, tripId),
        eq(responses.going, false),
        gt(responses.updatedAt, lockedAt),
      ),
    );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">
      {children}
    </div>
  );
}
