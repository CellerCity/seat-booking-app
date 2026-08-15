"use client";

import { useActionState } from "react";
import { claimPaymentAction, retractClaimAction, type ActionState } from "./actions";

/**
 * "I've paid."
 *
 * One tap, no confirmation dialog. A `upi://` handoff gives the page no
 * callback, so there is nothing to wait for and nothing to check — and the tap
 * is undoable, which is a better answer to a mis-tap than a modal that everyone
 * learns to dismiss.
 *
 * The wording is careful on purpose. This tells the coordinators something; it
 * does not settle anything. Saying otherwise would be the app claiming
 * knowledge it does not have.
 */
export function ClaimPaidButton({ token, amount }: { token: string; amount: number }) {
  const [state, run, pending] = useActionState<ActionState, FormData>(claimPaymentAction, {});

  return (
    <div className="space-y-2">
      <form action={run}>
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-emerald-600 px-4 py-4 text-lg font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Telling them…" : `I've sent ₹${amount}`}
        </button>
      </form>

      <p className="text-center text-xs text-slate-500">
        Tap this once the money has actually left your account. A coordinator
        checks it against their bank.
      </p>

      {state.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </div>
  );
}

/** Take back a claim made by mistake — allowed until a coordinator confirms it. */
export function RetractClaimButton({ token }: { token: string }) {
  const [state, run, pending] = useActionState<ActionState, FormData>(retractClaimAction, {});

  return (
    <div className="space-y-2">
      <form action={run}>
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          disabled={pending}
          className="w-full text-sm text-slate-500 underline disabled:opacity-50"
        >
          {pending ? "Undoing…" : "I tapped that by mistake"}
        </button>
      </form>

      {state.error && (
        <p className="text-center text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </div>
  );
}
