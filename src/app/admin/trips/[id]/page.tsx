import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoordinatorPage } from "@/lib/auth/coordinator";
import { getTripById } from "@/lib/trips";
import { getAddableTravellers, getTripLedger, totalsFor } from "@/lib/settle";
import { formatRupees } from "@/lib/cost";
import { formatClockTime, formatTime, formatTripDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { PersonName } from "../../person-name";
import {
  AddTravellerForm,
  AmountForm,
  GuestsControl,
  PaidForOthersForm,
  PaidToggle,
  RemoveFromTripControl,
  TravelledControl,
} from "./settle-controls";

export const dynamic = "force-dynamic";

/**
 * Settling up after a trip: who actually rode, and who has paid.
 *
 * The screen a coordinator has open in the days after, working down the list as
 * the transfers arrive. It is the half of the job WhatsApp handled worst — a
 * second poll used as a payment checklist, with no memory from one week to the
 * next of who was still outstanding.
 */
export default async function TripSettlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCoordinatorPage();

  const { id } = await params;
  const trip = await getTripById(id);
  if (!trip) notFound();

  const [ledger, candidates] = await Promise.all([
    getTripLedger(trip.id),
    getAddableTravellers(trip.id),
  ]);

  const totals = totalsFor(ledger, trip.amountPerPerson);
  const cancelled = trip.status === "cancelled";

  // Anyone a payment could cover: the people already on this trip, plus the rest
  // of the roster — the friend someone paid for is often precisely the person
  // nobody had added yet. Built once and handed to every row by the same
  // reference, rather than a filtered copy per person.
  const payable = [
    ...ledger.map((r) => ({
      id: r.userId,
      name: r.name,
      phone: r.phone,
      joiningYear: r.joiningYear,
      paid: r.paid,
    })),
    ...candidates.map((c) => ({ ...c, paid: false })),
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{formatTripDate(trip.eventDate)}</h1>
          <p className="text-sm text-slate-500">
            {trip.destination} · left {formatTime(trip.departureTime)}
            {trip.lockedCount !== null && ` · ${trip.lockedCount} booked at lock`}
          </p>
        </div>
        <Link href="/admin/trips" className="text-sm text-slate-500 underline">
          ← All trips
        </Link>
      </header>

      {cancelled ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <p className="font-semibold text-amber-900 dark:text-amber-200">
            This trip was cancelled
          </p>
          {trip.cancelReason && (
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
              {trip.cancelReason}
            </p>
          )}
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Nobody travelled, so there is nothing to settle.
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-6">
                <Stat label="Travelled" value={totals.travelled} />
                <Stat label="Paid" value={totals.paid} tone="good" />
                <Stat
                  label="Still to pay"
                  value={totals.outstanding}
                  tone={totals.outstanding > 0 ? "warn" : undefined}
                />
              </div>
              {/* These count riders, not rows. Saying so keeps a coordinator
                  from reading "20 travelled" against a roster of 18 names and
                  assuming the screen is wrong. */}
              {totals.guests > 0 && (
                <p className="w-full text-xs text-slate-500">
                  Counting riders, including {totals.guests} unnamed{" "}
                  {totals.guests === 1 ? "friend" : "friends"} someone brought.
                </p>
              )}
              <AmountForm tripId={trip.id} amount={trip.amountPerPerson} />
            </div>

            {trip.amountPerPerson !== null && (
              <p className="mt-4 text-sm text-slate-500">
                {formatRupees(trip.amountPerPerson)} each ·{" "}
                {formatRupees(totals.collectedRupees)} collected
                {totals.outstandingRupees > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <span className="font-medium text-amber-700 dark:text-amber-400">
                      {formatRupees(totals.outstandingRupees)} still out
                    </span>
                  </>
                )}
              </p>
            )}

            {totals.unmarked > 0 && (
              <p className="mt-2 text-sm text-slate-500">
                {totals.unmarked}{" "}
                {totals.unmarked === 1 ? "person booked but hasn't" : "people booked but haven't"}{" "}
                been marked as travelled or not. Marking someone paid counts them as
                having travelled.
              </p>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            {ledger.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-500">
                Nobody booked this trip, and nobody has been added.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {ledger.map((r) => (
                  <li
                    key={r.userId}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <PersonName
                        name={r.name}
                        joiningYear={r.joiningYear}
                        className="font-medium"
                      />
                      {!r.booked && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          added after
                        </span>
                      )}
                      {r.archived && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
                          archived
                        </span>
                      )}
                      <div className="text-sm text-slate-500">
                        {formatPhone(r.phone)}
                        {r.guests > 0 &&
                          ` · with ${r.guests} ${r.guests === 1 ? "friend" : "friends"} we can't name`}
                      </div>
                      {r.paid && r.paidAt && (
                        <div className="text-xs text-emerald-700 dark:text-emerald-400">
                          paid {formatRupees(r.amount ?? 0)} · marked{" "}
                          {formatClockTime(r.paidAt)}
                          {/* The whole point of recording the payer: weeks later
                              this is the difference between "he never paid" and
                              "his mate paid for him". */}
                          {r.paidByName && ` · by ${r.paidByName}`}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <TravelledControl
                        tripId={trip.id}
                        userId={r.userId}
                        travelled={r.travelled}
                      />
                      <GuestsControl
                        tripId={trip.id}
                        userId={r.userId}
                        guests={r.guests}
                      />
                      <PaidToggle tripId={trip.id} userId={r.userId} paid={r.paid} />
                      <PaidForOthersForm
                        tripId={trip.id}
                        payer={{
                          id: r.userId,
                          name: r.name,
                          joiningYear: r.joiningYear,
                        }}
                        others={payable}
                        amountPerPerson={trip.amountPerPerson}
                        guests={r.guests}
                      />
                      <RemoveFromTripControl
                        tripId={trip.id}
                        userId={r.userId}
                        name={r.name}
                        joiningYear={r.joiningYear}
                        paid={r.paid}
                        amount={r.amount}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-semibold">Someone we missed</h2>
            <p className="mt-1 mb-3 text-sm text-slate-500">
              For the person who turned up on the day, or who never got round to
              booking but rode with us anyway.
            </p>
            <AddTravellerForm tripId={trip.id} candidates={candidates} />
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn";
}) {
  const colour =
    tone === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : "";

  return (
    <div>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`text-3xl font-bold tabular-nums ${colour}`}>{value}</p>
    </div>
  );
}
