"use client";

import { useActionState, useState } from "react";
import {
  bookAction,
  setGuestsAction,
  withdrawAction,
  type ActionState,
} from "./actions";

type Props = {
  token: string;
  going: boolean;
  /** Seats they have booked for friends who won't tap the link themselves. */
  guests: number;
  locked: boolean;
  held: boolean;
  /**
   * The trip's own respond-by time, already formatted in IST, or null when it
   * has none or it has passed. Passed in rather than assumed: the regular run
   * has a deadline the night before, but a one-off added on the day does not,
   * and telling someone the count goes to the contractor "tomorrow" when the
   * trip leaves in three hours is worse than saying nothing.
   */
  deadlineLabel: string | null;
};

/**
 * Book / withdraw.
 *
 * The withdrawal warning is deliberately gentler before the count is locked
 * than after. Before lock, changing your mind is free. After lock the cabs are
 * already hired, so the group pays for a seat nobody sits in — the traveller
 * should be told that plainly, once, and then trusted to decide.
 */
export function BookingControls({ token, going, guests, locked, held, deadlineLabel }: Props) {
  const [confirming, setConfirming] = useState(false);

  const [bookState, runBook, booking] = useActionState<ActionState, FormData>(bookAction, {});
  const [withdrawState, runWithdraw, withdrawing] = useActionState<ActionState, FormData>(
    withdrawAction,
    {},
  );

  const error = bookState.error ?? withdrawState.error;

  if (!going) {
    return (
      <div className="space-y-3">
        <form action={runBook}>
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            disabled={booking}
            className="w-full rounded-xl bg-emerald-600 px-4 py-4 text-lg font-semibold text-white disabled:opacity-50"
          >
            {booking ? "Booking…" : "I'm going"}
          </button>
        </form>

        {locked && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            The count is already locked and cabs are booked. You can still ask —
            a coordinator will confirm whether there&apos;s a seat.
          </p>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-emerald-50 px-4 py-4 text-center dark:bg-emerald-950">
        <p className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
          {guests > 0 ? `You + ${guests} going` : "You're going"}
        </p>
        {held && (
          <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
            Waiting for a coordinator to approve you.
          </p>
        )}
      </div>

      <GuestsField token={token} guests={guests} />

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-700 dark:border-slate-700 dark:text-slate-300"
        >
          Can&apos;t make it
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            {locked
              ? "Cabs are already booked for this count. Dropping out now means everyone else splits the same cost between fewer people."
              : deadlineLabel
                ? `Let us know before ${deadlineLabel} if you can — after that the count goes to the cab contractor.`
                : "Let us know as early as you can — the count goes to the cab contractor before the trip."}
          </p>
          <div className="flex gap-2">
            <form action={runWithdraw} className="flex-1">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                disabled={withdrawing}
                className="w-full rounded-lg bg-amber-700 px-4 py-3 font-medium text-white disabled:opacity-50"
              >
                {withdrawing ? "Updating…" : "Yes, withdraw"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-3 dark:border-slate-700"
            >
              Never mind
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

/**
 * Seats for friends coming along.
 *
 * Plus and minus rather than a text field: this is a thumb on a phone, and the
 * only numbers anyone needs are the first few. It asks for a count and not for
 * names because at poll time the count is the whole job — the number goes down
 * the phone to the contractor, and who owes what is settled after the trip.
 */
function GuestsField({ token, guests }: { token: string; guests: number }) {
  const [state, run, pending] = useActionState<ActionState, FormData>(setGuestsAction, {});

  const step = (next: number) => {
    const data = new FormData();
    data.set("token", token);
    data.set("guests", String(next));
    run(data);
  };

  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Booking for friends?</p>
          <p className="text-xs text-slate-500">
            Add a seat for anyone coming with you who won&apos;t tap this
            themselves.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => step(guests - 1)}
            disabled={pending || guests === 0}
            aria-label="One fewer friend"
            className="size-9 rounded-lg border border-slate-300 text-lg disabled:opacity-30 dark:border-slate-700"
          >
            −
          </button>
          <span className="w-6 text-center text-lg font-semibold tabular-nums">{guests}</span>
          <button
            type="button"
            onClick={() => step(guests + 1)}
            disabled={pending}
            aria-label="One more friend"
            className="size-9 rounded-lg border border-slate-300 text-lg disabled:opacity-30 dark:border-slate-700"
          >
            +
          </button>
        </div>
      </div>
      {state.error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </div>
  );
}
