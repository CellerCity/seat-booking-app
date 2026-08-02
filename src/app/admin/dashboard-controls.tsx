"use client";

import { useActionState, useState } from "react";
import {
  cancelTripAction,
  createTripAction,
  decideLateAction,
  deleteTripAction,
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

/**
 * Calling a trip off. Irreversible, and everyone who booked sees the reason, so
 * it asks once and will not proceed on an empty explanation.
 */
export function CancelTripButton({ tripId, label }: { tripId: string; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, run, pending] = useActionState<ActionState, FormData>(cancelTripAction, {});

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300"
      >
        Cancel trip
      </button>
    );
  }

  return (
    <form
      action={run}
      className="w-full rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950"
    >
      <input type="hidden" name="tripId" value={tripId} />
      <p className="text-sm text-amber-900 dark:text-amber-200">
        Call off <strong>{label}</strong>? Everyone who booked will see this reason.
        It can&apos;t be undone — if it&apos;s back on, add it as a new trip.
      </p>
      <input
        name="reason"
        required
        minLength={3}
        autoFocus
        placeholder="Heavy rain — we'll reschedule"
        className="mt-3 w-full rounded-lg border border-amber-300 px-3 py-2 text-sm dark:border-amber-800 dark:bg-slate-900"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Cancelling…" : "Cancel this trip"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700"
        >
          Never mind
        </button>
      </div>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

/**
 * Removing a trip outright — for test runs and mistaken entries.
 *
 * Cancelling is the normal act and keeps the record; this throws it away. It
 * says how many responses go with it, because that is the part people forget is
 * attached. Trips with money or attendance against them are refused server-side.
 */
export function DeleteTripButton({
  tripId,
  label,
  responses,
}: {
  tripId: string;
  label: string;
  responses: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, run, pending] = useActionState<ActionState, FormData>(deleteTripAction, {});

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-400"
      >
        Delete
      </button>
    );
  }

  return (
    <form
      action={run}
      className="w-full rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950"
    >
      <input type="hidden" name="tripId" value={tripId} />
      <p className="text-sm text-red-900 dark:text-red-200">
        Permanently delete <strong>{label}</strong>
        {responses > 0 && (
          <>
            {" "}
            and {responses} response{responses === 1 ? "" : "s"} to it
          </>
        )}
        ? This cannot be undone. To keep the record instead, cancel it.
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
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700"
        >
          Keep it
        </button>
      </div>
      {state.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

/** Adding an extra trip: a second run in a week, or a replacement for a cancelled one. */
export function NewTripForm({ defaults }: { defaults: { destination: string; departureTime: string } }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState<ActionState, FormData>(createTripAction, {});

  if (state.ok && open) setOpen(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
      >
        + Add a trip
      </button>
    );
  }

  return (
    <form
      action={run}
      className="w-full rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <p className="text-sm font-medium">Add a trip</p>
      <p className="mt-1 text-xs text-slate-500">
        For an extra run this week, or one the weekly schedule doesn&apos;t cover. The
        poll opens straight away.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-400">Date</span>
          <input
            type="date"
            name="eventDate"
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-400">Leaves at</span>
          <input
            type="time"
            name="departureTime"
            required
            defaultValue={defaults.departureTime}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-slate-600 dark:text-slate-400">Destination</span>
          <input
            name="destination"
            required
            defaultValue={defaults.destination}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-slate-600 dark:text-slate-400">
            Respond-by deadline <span className="text-slate-400">(optional)</span>
          </span>
          <input
            type="datetime-local"
            name="pollClosesAt"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Shown as a countdown. Never blocks booking — only Lock does that.
          </span>
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? "Adding…" : "Add trip"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700"
        >
          Cancel
        </button>
      </div>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: async () => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
  };
}

export function CopyCountButton({ text }: { text: string }) {
  const { copied, copy } = useCopy(text);

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
    >
      {copied ? "Copied" : "Copy count"}
    </button>
  );
}

/**
 * The link travellers actually need, and the message to paste with it.
 *
 * This is the one thing a coordinator has to do for the app to be used at all,
 * so it sits on the dashboard in full rather than being assembled by hand from
 * a token. The message deliberately carries no headcount: it is going into a
 * group of fifty people, and counts are a coordinator's business.
 */
export function TripLink({ url, message }: { url: string; message: string }) {
  const link = useCopy(url);
  const invite = useCopy(message);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm font-medium">Traveller link</p>
      <p className="mt-1 text-xs text-slate-500">
        Paste this in the group. Anyone with it can book — no sign-in, no app.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800">
          {url}
        </code>
        <button
          type="button"
          onClick={link.copy}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
        >
          {link.copied ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={invite.copy}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          {invite.copied ? "Copied" : "Copy message"}
        </button>
      </div>
    </section>
  );
}
