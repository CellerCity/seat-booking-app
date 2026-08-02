"use client";

import { useActionState, useState } from "react";
import { identifyAction, registerAction, type ActionState } from "./actions";

/**
 * First visit only. Everything after this is a single tap, because the identity
 * is remembered in a cookie for a year.
 */
export function IdentifyForm() {
  const [needsRegistration, setNeedsRegistration] = useState(false);
  const [phone, setPhone] = useState("");

  const [identifyState, runIdentify, identifying] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await identifyAction(prev, formData);
      if (result.message === "new") setNeedsRegistration(true);
      return result;
    },
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

  return (
    <form action={runIdentify} className="space-y-4">
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

      {identifyState.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{identifyState.error}</p>
      )}

      <button
        type="submit"
        disabled={identifying}
        className="w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {identifying ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
