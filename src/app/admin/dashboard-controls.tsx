"use client";

import { useActionState, useState } from "react";
import {
  decideLateAction,
  lockTripAction,
  openPollAction,
  type ActionState,
} from "./actions";

export function OpenPollButton({ tripId }: { tripId: string }) {
  const [state, run, pending] = useActionState<ActionState, FormData>(openPollAction, {});
  return (
    <form action={run}>
      <input type="hidden" name="tripId" value={tripId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {pending ? "Opening…" : "Open poll"}
      </button>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

/**
 * Locking is irreversible in effect — it is the moment the count is read down
 * the phone — so it asks once before doing it.
 */
export function LockButton({ tripId, count }: { tripId: string; count: number }) {
  const [confirming, setConfirming] = useState(false);
  const [state, run, pending] = useActionState<ActionState, FormData>(lockTripAction, {});

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
      >
        Lock count
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-sm">
        Lock at <strong>{count}</strong>? Anyone booking after this shows up
        separately as a late addition for you to accept or decline.
      </p>
      <div className="mt-3 flex gap-2">
        <form action={run}>
          <input type="hidden" name="tripId" value={tripId} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {pending ? "Locking…" : `Lock at ${count}`}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700"
        >
          Cancel
        </button>
      </div>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </div>
  );
}

export function LateDecisionButtons({
  tripId,
  userId,
}: {
  tripId: string;
  userId: string;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(decideLateAction, {});

  return (
    <div className="flex items-center gap-2">
      <form action={run}>
        <input type="hidden" name="tripId" value={tripId} />
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="accept" value="true" />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Accept
        </button>
      </form>
      <form action={run}>
        <input type="hidden" name="tripId" value={tripId} />
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="accept" value="false" />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700"
        >
          Decline
        </button>
      </form>
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </div>
  );
}

export function CopyCountButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
    >
      {copied ? "Copied" : "Copy for WhatsApp"}
    </button>
  );
}
