"use client";

import { useActionState, useState } from "react";
import { setCollectorAction, setUpiVpaAction, type ActionState } from "../../actions";

type Collector = {
  id: string;
  name: string;
  joiningYear: number | null;
  upiVpa: string | null;
};

/**
 * Who is collecting this week.
 *
 * It rotates — whoever phoned the contractor usually takes the fares too — so
 * this is a per-trip choice rather than a setting. Picked from a list rather
 * than typed: a UPI address retyped every week is one that eventually gets a
 * digit wrong, and the cost of that mistake is fifty people paying a stranger.
 */
export function CollectorPicker({
  tripId,
  collectors,
  currentId,
  currentVpa,
}: {
  tripId: string;
  collectors: Collector[];
  currentId: string | null;
  currentVpa: string | null;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(setCollectorAction, {});

  const choose = (collectorId: string) => {
    const data = new FormData();
    data.set("tripId", tripId);
    data.set("collectorId", collectorId);
    run(data);
  };

  const ready = collectors.filter((c) => c.upiVpa);

  return (
    <div>
      {ready.length === 0 ? (
        <p className="text-sm text-slate-500">
          No coordinator has added a UPI ID yet, so there is nobody to collect
          into. Add yours below and you can pick yourself.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {ready.map((c) => {
            const chosen = c.id === currentId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => choose(chosen ? "" : c.id)}
                disabled={pending}
                aria-pressed={chosen}
                className={`rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ${
                  chosen
                    ? "border-emerald-600 bg-emerald-600 font-medium text-white"
                    : "border-slate-300 dark:border-slate-700"
                }`}
              >
                {c.name}
                {c.joiningYear != null && (
                  <span
                    className={`ml-1.5 text-xs tabular-nums ${
                      chosen ? "text-emerald-100" : "text-slate-500"
                    }`}
                  >
                    {c.joiningYear}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {currentVpa ? (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          Travellers pay into{" "}
          <strong className="break-all font-medium">{currentVpa}</strong>. Tap
          the highlighted name to stop collecting.
        </p>
      ) : (
        ready.length > 0 && (
          // The gate the traveller sees. Saying so here means a coordinator
          // knows why nobody can pay yet, rather than finding out from a message.
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
            Nobody is collecting, so travellers see no payment option even once
            the fare is set.
          </p>
        )
      )}

      {state.error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </div>
  );
}

/**
 * Your own UPI address.
 *
 * Only ever your own — the action reads the actor from the session and ignores
 * anything the form might say about whose it is.
 */
export function MyUpiForm({ current }: { current: string | null }) {
  const [editing, setEditing] = useState(false);
  const [state, run, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await setUpiVpaAction(prev, formData);
      // Collapse back to the saved view, but only once it actually saved —
      // otherwise a rejected address disappears along with the error explaining
      // why it was rejected.
      if (result.ok) setEditing(false);
      return result;
    },
    {},
  );

  // Nothing stored yet means the field is the whole point of the section.
  if (!editing && current !== null) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Your UPI ID:</span>
        <strong className="break-all font-medium">{current}</strong>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-slate-500 underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <form action={run} className="space-y-2">
      <label className="block text-sm">
        <span className="font-medium">Your UPI ID</span>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            name="vpa"
            defaultValue={current ?? ""}
            placeholder="yourname@bank"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {current !== null && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
            >
              Cancel
            </button>
          )}
        </div>
      </label>

      <p className="text-xs text-slate-500">
        Only you can change this. Leave it empty to remove it. Trips you have
        already collected on keep the address they were set up with.
      </p>

      {state.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </form>
  );
}
