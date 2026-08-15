import { notFound } from "next/navigation";
import { getCurrentTraveller, isBlocked, isPending } from "@/lib/auth/traveller";
import { getPayView } from "@/lib/pay";
import { getResponse, getTripByToken } from "@/lib/trips";
import { formatDeadline, formatTime, formatTripDate, relativeTime } from "@/lib/format";
import { BookingControls } from "./booking-controls";
import { IdentifyForm } from "./identify-form";
import { PaySection } from "./pay-section";
import { SignOutLink } from "./sign-out";

export const dynamic = "force-dynamic";

/**
 * The traveller's whole app: one page, one tap.
 *
 * Travellers see only their own state — never the roster, never the headcount,
 * never anyone else's dues. That isolation is enforced here by simply not
 * fetching any of it, not by hiding it in the markup.
 */
export default async function TripPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const trip = await getTripByToken(token);
  if (!trip) notFound();

  const user = await getCurrentTraveller();

  if (isBlocked(user)) {
    return (
      <Shell>
        <div className="rounded-xl border border-slate-200 p-6 text-center dark:border-slate-800">
          <h1 className="text-lg font-semibold">Your access has been removed</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Please speak to a coordinator.
          </p>
        </div>
      </Shell>
    );
  }

  const cancelled = trip.status === "cancelled";
  const notOpenYet = trip.status === "draft";
  const locked = trip.lockedAt !== null;
  const response = user ? await getResponse(trip.id, user.id) : null;
  // Everything about money is decided server-side from what a coordinator
  // recorded. `hidden` for anyone who owes nothing on this trip.
  const pay = user ? await getPayView(trip, user) : null;

  // Null once it has passed: a deadline in the past is not something to hurry
  // someone towards, and this trip may not have one at all.
  const deadlineLabel =
    trip.pollClosesAt && trip.pollClosesAt > new Date()
      ? formatDeadline(trip.pollClosesAt)
      : null;

  return (
    <Shell>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          {formatTripDate(trip.eventDate)}
        </h1>
        <p className="mt-1 text-slate-600 dark:text-slate-400">
          {trip.destination} · leaves {formatTime(trip.departureTime)}
        </p>

        {deadlineLabel && !locked && !cancelled && (
          <p className="mt-2 text-sm text-slate-500">
            Let us know by {deadlineLabel}{" "}
            <span className="text-slate-400">
              ({relativeTime(trip.pollClosesAt!)})
            </span>
          </p>
        )}
      </header>

      {cancelled ? (
        <Notice tone="warn">
          <strong className="block">This trip has been cancelled.</strong>
          {trip.cancelReason && <span className="mt-1 block">{trip.cancelReason}</span>}
        </Notice>
      ) : notOpenYet ? (
        <Notice tone="muted">
          The poll hasn&apos;t opened yet. Check back closer to the day.
        </Notice>
      ) : !user ? (
        <IdentifyForm />
      ) : (
        <div className="space-y-6">
          <BookingControls
            token={token}
            going={response?.going ?? false}
            guests={response?.guests ?? 0}
            locked={locked}
            held={isPending(user)}
            deadlineLabel={deadlineLabel}
          />

          {pay && (
            <PaySection
              token={token}
              view={pay}
              whoami={{
                name: user.name,
                joiningYear: user.joiningYear,
                phone: user.phone,
              }}
            />
          )}

          {/* Was a dead line of text saying who you were signed in as, which is
              no help at all to the person it is wrong for. Someone who typed a
              digit wrong needs a way out that isn't clearing their history. */}
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
            <span>
              Signed in as {user.name}
              {user.joiningYear != null && (
                <span className="ml-1 tabular-nums">{user.joiningYear}</span>
              )}
            </span>
            <span aria-hidden>·</span>
            <SignOutLink label="Not you?" className="text-xs text-slate-400" />
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-10">{children}</main>
  );
}

function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "muted" | "warn";
}) {
  const styles =
    tone === "warn"
      ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300";
  return <div className={`rounded-xl px-4 py-4 text-sm ${styles}`}>{children}</div>;
}
