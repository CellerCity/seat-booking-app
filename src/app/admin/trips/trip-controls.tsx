"use client";

import { useActionState, useState } from "react";
import { formatRupees } from "@/lib/cost";
import { deleteTripAction, type ActionState } from "../actions";

/**
 * Deleting a past trip, records and all.
 *
 * The dashboard already deletes an empty upcoming trip — the duplicate created
 * by a mis-tap. This is the harder case: a real trip that should not be on the
 * books, whose attendance and payments go with it. There was no way to do that
 * at all, which meant a bad trip stayed on the history screen forever.
 *
 * So the warning does the work the refusal used to. It counts out loud what is
 * about to be destroyed — riders, payments, rupees — because "delete this trip"
 * and "delete eighteen people's settled payments" are the same click and only
 * one of them is what anybody means. Cancelling is offered alongside, since for
 * a trip that genuinely happened it is nearly always the right answer.
 */
export function DeleteTripControl({
  tripId,
  label,
  booked,
  travelled,
  paid,
  amountPerPerson,
}: {
  tripId: string;
  label: string;
  booked: number;
  travelled: number;
  paid: number;
  amountPerPerson: number | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, run, pending] = useActionState<ActionState, FormData>(deleteTripAction, {});

  const hasRecords = travelled > 0 || paid > 0;
  const money = amountPerPerson === null ? null : paid * amountPerPerson;

  if (!confirming) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-700 dark:border-red-900 dark:text-red-400"
        >
          Delete
        </button>
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    );
  }

  return (
    <form
      action={run}
      className="w-full rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950"
    >
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="withRecords" value="true" />

      <p className="text-sm font-semibold text-red-900 dark:text-red-200">
        Permanently delete {label}?
      </p>

      {hasRecords ? (
        <>
          <p className="mt-1 text-sm text-red-800 dark:text-red-300">
            This erases the trip and everything recorded on it:
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-red-800 dark:text-red-300">
            {travelled > 0 && (
              <li>
                {travelled} {travelled === 1 ? "rider" : "riders"} marked as having travelled
              </li>
            )}
            {paid > 0 && (
              <li>
                {paid} recorded {paid === 1 ? "payment" : "payments"}
                {money !== null && money > 0 && ` totalling ${formatRupees(money)}`}
              </li>
            )}
            {booked > 0 && <li>{booked} bookings and the response history</li>}
          </ul>
          <p className="mt-2 text-sm text-red-900 dark:text-red-200">
            It cannot be undone, and nothing here is recoverable from anywhere else.
            If the trip really happened, cancel it instead — that keeps the record.
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-red-800 dark:text-red-300">
          {booked > 0
            ? `This also deletes ${booked} booking${booked === 1 ? "" : "s"} and the response history. `
            : "Nothing is recorded against it. "}
          This cannot be undone.
        </p>
      )}

      <p className="mt-2 text-xs text-red-800 dark:text-red-400">
        People, their roster entries and their other trips are not affected.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete permanently"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          Keep it
        </button>
      </div>
      {state.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
