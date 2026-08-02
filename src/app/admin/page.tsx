import Link from "next/link";
import { and, eq, gt } from "drizzle-orm";
import { requireCoordinatorPage } from "@/lib/auth/coordinator";
import { db } from "@/lib/db";
import { responses, users } from "@/lib/db/schema";
import { getHeadcount, getResponseFeed, getUpcomingTrips } from "@/lib/trips";
import { countPendingMembers } from "@/lib/members";
import {
  formatClockTime,
  formatDeadline,
  formatTime,
  formatTripDate,
  relativeTime,
} from "@/lib/format";
import { getBaseUrl } from "@/lib/base-url";
import {
  CancelTripButton,
  CopyCountButton,
  DeleteTripButton,
  LateDecisionButtons,
  LockButton,
  NewTripForm,
  OpenPollButton,
  TripLink,
} from "./dashboard-controls";

export const dynamic = "force-dynamic";

/**
 * The screen a coordinator has open while phoning the cab contractor.
 *
 * One number is authoritative. The other three figures exist precisely so they
 * are never silently folded into it.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string }>;
}) {
  await requireCoordinatorPage();

  const upcoming = await getUpcomingTrips();
  const selectedId = (await searchParams).trip;

  // More than one trip can be live at once — the weekly run plus a one-off — so
  // the dashboard picks the soonest and lets the coordinator switch.
  const trip = upcoming.find((t) => t.id === selectedId) ?? upcoming[0] ?? null;

  const tripDefaults = {
    destination: trip?.destination ?? process.env.TRIP_DESTINATION ?? "Event venue",
    departureTime: (trip?.departureTime ?? process.env.TRIP_DEPARTURE_TIME ?? "07:30").slice(0, 5),
  };

  if (!trip) {
    return (
      <div className="space-y-4">
        <EmptyState>
          No trips scheduled. The weekly cron adds one automatically — or add one now.
        </EmptyState>
        <NewTripForm defaults={tripDefaults} />
      </div>
    );
  }

  const [count, feed, pendingApprovals] = await Promise.all([
    getHeadcount(trip),
    getResponseFeed(trip.id, 40),
    countPendingMembers(),
  ]);

  const locked = trip.lockedAt !== null;
  const cancelled = trip.status === "cancelled";

  const lateBookings = locked ? await getLateBookings(trip.id, trip.lockedAt!) : [];
  const withdrawals = locked ? await getPostLockWithdrawals(trip.id, trip.lockedAt!) : [];

  const baseUrl = await getBaseUrl();
  const travellerUrl = `${baseUrl}/t/${trip.linkToken}`;

  // For the group chat. No headcount in here on purpose — this goes to fifty
  // people, and the count is a coordinator's number.
  const inviteMessage =
    `${formatTripDate(trip.eventDate)} — ${trip.destination}\n` +
    `Leaving ${formatTime(trip.departureTime)}\n` +
    (trip.pollClosesAt ? `Let us know by ${formatDeadline(trip.pollClosesAt)}\n` : "") +
    `\nTap to book your seat:\n${travellerUrl}`;

  // For a coordinator passing the number to another coordinator.
  const countSummary =
    `${formatTripDate(trip.eventDate)} — ${trip.destination}\n` +
    `Leaving ${formatTime(trip.departureTime)}\n` +
    `Count: ${count.confirmed}${locked ? " (locked)" : ""}`;

  return (
    <div className="space-y-6">
      {upcoming.length > 1 && (
        <nav className="flex flex-wrap gap-2">
          {upcoming.map((t) => {
            const active = t.id === trip.id;
            return (
              <Link
                key={t.id}
                href={`/admin?trip=${t.id}`}
                className={
                  "rounded-lg border px-3 py-1.5 text-sm " +
                  (active
                    ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                    : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400")
                }
              >
                {formatTripDate(t.eventDate)} · {formatTime(t.departureTime)}
                {t.status === "cancelled" && " · cancelled"}
              </Link>
            );
          })}
        </nav>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{formatTripDate(trip.eventDate)}</h1>
          <p className="text-sm text-slate-500">
            {trip.destination} · leaves {formatTime(trip.departureTime)} ·{" "}
            <span className="capitalize">{trip.status.replace("_", " ")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!cancelled && <CopyCountButton text={countSummary} />}
          {trip.status === "draft" && <OpenPollButton tripId={trip.id} />}
          {trip.status === "poll_open" && (
            <LockButton tripId={trip.id} count={count.confirmed} />
          )}
          {!cancelled && trip.status !== "settled" && (
            <CancelTripButton
              tripId={trip.id}
              label={`${formatTripDate(trip.eventDate)}, ${formatTime(trip.departureTime)}`}
            />
          )}
          {trip.status !== "settled" && (
            <DeleteTripButton
              tripId={trip.id}
              label={`${formatTripDate(trip.eventDate)}, ${formatTime(trip.departureTime)}`}
              responses={count.total}
            />
          )}
        </div>
      </header>

      {cancelled && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <p className="font-semibold text-amber-900 dark:text-amber-200">
            This trip is cancelled
          </p>
          {trip.cancelReason && (
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
              {trip.cancelReason}
            </p>
          )}
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Travellers opening the link see this reason.
            {trip.cancelledAt && ` Cancelled ${formatClockTime(trip.cancelledAt)}.`}
          </p>
        </div>
      )}

      {!cancelled && <TripLink url={travellerUrl} message={inviteMessage} />}

      <NewTripForm defaults={tripDefaults} />

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

        {/* No suggested cab mix here. What the contractor actually sends varies
            week to week, so a computed "N cabs, M seats free" reads as fact
            while being a guess — and the wrong kind of guess to have on screen
            during the call. The count is the number; the cabs are his answer. */}

        {trip.pollClosesAt && !locked && (
          <p className="mt-3 text-sm text-slate-500">
            Poll closes {formatDeadline(trip.pollClosesAt)} ({relativeTime(trip.pollClosesAt)})
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
            Booked after the count was locked. Accepting is your call — check with
            the contractor whether there is room.
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
