"use client";

import { useActionState, useState } from "react";
import {
  markPaidAction,
  markUnpaidAction,
  setAmountAction,
  setTravelledAction,
  type ActionState,
} from "../../actions";

/**
 * The one button this screen exists for.
 *
 * Marking someone paid also records that they travelled, so the common case —
 * a coordinator working down the list on their phone while the transfers come
 * in — is a single tap per person.
 */
export function PaidToggle({
  tripId,
  userId,
  paid,
}: {
  tripId: string;
  userId: string;
  paid: boolean;
}) {
  const [paidState, pay, paying] = useActionState<ActionState, FormData>(markPaidAction, {});
  const [unpaidState, unpay, unpaying] = useActionState<ActionState, FormData>(
    markUnpaidAction,
    {},
  );

  const error = paidState.error ?? unpaidState.error;
  const pending = paying || unpaying;

  return (
    <div className="flex items-center gap-2">
      <form action={paid ? unpay : pay}>
        <input type="hidden" name="tripId" value={tripId} />
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={pending}
          className={`min-w-24 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
            paid
              ? "bg-emerald-600 text-white"
              : "border border-slate-300 dark:border-slate-700"
          }`}
        >
          {pending ? "…" : paid ? "Paid ✓" : "Mark paid"}
        </button>
      </form>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

/**
 * Whether they actually turned up.
 *
 * Three states, not two: "nobody has said" is different from "did not travel",
 * and collapsing them would quietly bill everyone who booked.
 */
export function TravelledControl({
  tripId,
  userId,
  travelled,
}: {
  tripId: string;
  userId: string;
  travelled: boolean | null;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(setTravelledAction, {});

  return (
    <div className="flex items-center gap-1.5">
      {(["yes", "no"] as const).map((choice) => {
        const isSet = travelled === (choice === "yes");
        return (
          <form key={choice} action={run}>
            <input type="hidden" name="tripId" value={tripId} />
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="travelled" value={String(choice === "yes")} />
            <button
              type="submit"
              disabled={pending}
              className={`rounded-md px-2.5 py-1 text-xs disabled:opacity-50 ${
                isSet
                  ? choice === "yes"
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "bg-amber-600 text-white"
                  : "border border-slate-300 text-slate-500 dark:border-slate-700"
              }`}
            >
              {choice === "yes" ? "Travelled" : "Didn't"}
            </button>
          </form>
        );
      })}
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </div>
  );
}

/** What each rider is being asked for. Optional — the tick list works without it. */
export function AmountForm({ tripId, amount }: { tripId: string; amount: number | null }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState<ActionState, FormData>(setAmountAction, {});

  if (state.ok && open) setOpen(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
      >
        {amount === null ? "Set amount each" : `₹${amount} each — change`}
      </button>
    );
  }

  return (
    <form
      action={run}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-300 p-3 dark:border-slate-700"
    >
      <input type="hidden" name="tripId" value={tripId} />
      <label className="text-xs">
        <span className="text-slate-600 dark:text-slate-400">
          Rupees per person — leave blank for none
        </span>
        <input
          name="amount"
          inputMode="numeric"
          defaultValue={amount ?? ""}
          placeholder="150"
          className="mt-1 w-28 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
      >
        Cancel
      </button>
      {state.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

/**
 * The person who came along but was never on the list.
 *
 * Two buttons rather than one, because "he travelled" and "he travelled and
 * paid me" are both things a coordinator remembers a week later, and making
 * them add the person first and pay second loses the second half to
 * distraction.
 */
export function AddTravellerForm({
  tripId,
  candidates,
}: {
  tripId: string;
  candidates: { id: string; name: string; phone: string }[];
}) {
  const [userId, setUserId] = useState("");
  const [travelledState, addTravelled, addingTravelled] = useActionState<ActionState, FormData>(
    setTravelledAction,
    {},
  );
  const [paidState, addPaid, addingPaid] = useActionState<ActionState, FormData>(
    markPaidAction,
    {},
  );

  const error = travelledState.error ?? paidState.error;
  const pending = addingTravelled || addingPaid;

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Everyone on the roster is already on this list.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="text-slate-600 dark:text-slate-400">
          Who came along that we missed?
        </span>
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">Pick a person…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-2">
        <form action={addTravelled}>
          <input type="hidden" name="tripId" value={tripId} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="travelled" value="true" />
          <button
            type="submit"
            disabled={!userId || pending}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-slate-700"
          >
            {addingTravelled ? "Adding…" : "They travelled"}
          </button>
        </form>
        <form action={addPaid}>
          <input type="hidden" name="tripId" value={tripId} />
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            disabled={!userId || pending}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {addingPaid ? "Adding…" : "They travelled and paid"}
          </button>
        </form>
      </div>

      <p className="text-xs text-slate-500">
        This records that they rode with us. It does not add a booking — the
        pre-trip count stays exactly as it was when it went to the contractor.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
