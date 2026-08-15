"use client";

import { useActionState, useState } from "react";
import { formatPhone, isValidPhone, normalizePhone } from "@/lib/phone";
import { identifyAction, lookupAction, registerAction, type ActionState } from "./actions";

/**
 * First visit only. Everything after this is a single tap, because the identity
 * is remembered in a cookie for a year.
 *
 * That year is exactly why this asks twice. A single wrong digit matches
 * somebody else on a roster of fifty, and without a confirmation step the app
 * silently becomes them — their booking, their withdrawal, their fare — and
 * stays that way until someone works out what happened. Showing the match back
 * costs one tap and turns that into a corrected typo.
 */
export function IdentifyForm() {
  const [needsRegistration, setNeedsRegistration] = useState(false);
  const [phone, setPhone] = useState("");
  // "That isn't me" sends them back to the number field. useActionState has no
  // reset, so the last match is dismissed here rather than cleared.
  const [retyping, setRetyping] = useState(false);

  const [lookupState, runLookup, looking] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      setRetyping(false);
      const result = await lookupAction(prev, formData);
      if (result.message === "new") setNeedsRegistration(true);
      return result;
    },
    {},
  );

  const [confirmState, runConfirm, confirming] = useActionState<ActionState, FormData>(
    identifyAction,
    {},
  );

  const [registerState, runRegister, registering] = useActionState<ActionState, FormData>(
    registerAction,
    {},
  );

  if (needsRegistration) {
    return (
      <form action={runRegister} className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">We don&apos;t have your number yet</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Add your name and a coordinator will approve you. You can book right
            away — your seat is confirmed once they do.
          </p>
        </div>

        <input type="hidden" name="phone" value={phone} />

        <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm dark:bg-slate-900">
          Registering{" "}
          <strong className="tabular-nums">
            {isValidPhone(phone) ? formatPhone(normalizePhone(phone)) : phone}
          </strong>
        </p>

        <label className="block">
          <span className="text-sm font-medium">Your name</span>
          <input
            name="name"
            required
            autoFocus
            autoComplete="name"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-slate-100"
          />
        </label>

        {registerState.error && (
          <p className="text-sm text-red-600 dark:text-red-400">{registerState.error}</p>
        )}

        <button
          type="submit"
          disabled={registering}
          className="w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {registering ? "Just a second…" : "Continue"}
        </button>

        <button
          type="button"
          onClick={() => setNeedsRegistration(false)}
          className="w-full text-sm text-slate-500 underline"
        >
          Use a different number
        </button>
      </form>
    );
  }

  // The match, shown back before anything is remembered.
  if (lookupState.found && !retyping) {
    const { name, joiningYear, phone: typed } = lookupState.found;

    return (
      <form action={runConfirm} className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Is this you?</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            We&apos;ll remember you on this phone, so it&apos;s worth a look.
          </p>
        </div>

        <input type="hidden" name="phone" value={typed} />

        <div className="rounded-xl border border-slate-200 px-4 py-4 text-center dark:border-slate-800">
          <p className="text-xl font-bold">
            {name}
            {joiningYear != null && (
              <span className="ml-2 text-sm font-normal tabular-nums text-slate-500 dark:text-slate-400">
                {joiningYear}
              </span>
            )}
          </p>
          <p className="mt-1 text-sm tabular-nums text-slate-500 dark:text-slate-400">
            {isValidPhone(typed) ? formatPhone(normalizePhone(typed)) : typed}
          </p>
        </div>

        {confirmState.error && (
          <p className="text-sm text-red-600 dark:text-red-400">{confirmState.error}</p>
        )}

        <button
          type="submit"
          disabled={confirming}
          className="w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {confirming ? "Just a second…" : "Yes, that's me"}
        </button>

        <button
          type="button"
          onClick={() => {
            setRetyping(true);
            setPhone("");
          }}
          className="w-full text-sm text-slate-500 underline"
        >
          No — try a different number
        </button>
      </form>
    );
  }

  return (
    <form action={runLookup} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">What&apos;s your number?</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Just once — we&apos;ll remember you after this.
        </p>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Mobile number</span>
        <input
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          required
          autoFocus
          placeholder="98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-slate-100"
        />
      </label>

      {lookupState.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{lookupState.error}</p>
      )}

      <button
        type="submit"
        disabled={looking}
        className="w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {looking ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
