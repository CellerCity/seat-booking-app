import Link from "next/link";
import { requireCoordinatorPage } from "@/lib/auth/coordinator";
import { getTripHistory } from "@/lib/trips";
import { formatRupees } from "@/lib/cost";
import { formatTime, formatTripDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Every trip, newest first.
 *
 * The dashboard shows upcoming trips only — it is the screen used while phoning
 * the contractor, and history on it is noise. But a trip needs settling up
 * *after* it happens, by which point it has dropped off that list, so this is
 * the door back to it.
 */
export default async function TripHistoryPage() {
  await requireCoordinatorPage();

  const trips = await getTripHistory();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Trips</h1>
          <p className="text-sm text-slate-500">
            Open one to settle up — who travelled, and who has paid.
          </p>
        </div>
        <Link href="/admin" className="text-sm text-slate-500 underline">
          ← Dashboard
        </Link>
      </header>

      {trips.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          No trips yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {trips.map((t) => {
            const upcoming = t.eventDate >= today;
            const cancelled = t.status === "cancelled";
            const owing = t.travelled - t.paid;

            return (
              <li key={t.id}>
                <Link
                  href={`/admin/trips/${t.id}`}
                  className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-600"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="font-medium">{formatTripDate(t.eventDate)}</span>
                      <span className="ml-2 text-sm text-slate-500">
                        {t.destination} · {formatTime(t.departureTime)}
                      </span>
                      {upcoming && !cancelled && (
                        <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                          upcoming
                        </span>
                      )}
                      {cancelled && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          cancelled
                        </span>
                      )}
                    </div>

                    <div className="text-sm tabular-nums text-slate-500">
                      {cancelled ? (
                        "—"
                      ) : t.travelled === 0 ? (
                        <>
                          {t.booked} booked
                          {!upcoming && " · nobody marked as travelled yet"}
                        </>
                      ) : (
                        <>
                          {t.travelled} travelled · {t.paid} paid
                          {owing > 0 && (
                            <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">
                              · {owing} owing
                              {t.amountPerPerson !== null &&
                                ` (${formatRupees(owing * t.amountPerPerson)})`}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
