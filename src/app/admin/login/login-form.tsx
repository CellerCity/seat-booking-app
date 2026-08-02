"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

function client() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [googling, setGoogling] = useState(false);

  /**
   * Google is the primary route. It needs no inbox, survives the shared email
   * sender's rate limit, and on a phone it is one tap because the coordinator
   * is already signed into Google. The magic link stays as a fallback for
   * anyone whose Google address is not the one on the roster.
   */
  async function signInWithGoogle() {
    setGoogling(true);
    setError("");

    const { error } = await client().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/admin/auth/callback` },
    });

    if (error) {
      setError(error.message);
      setGoogling(false);
    }
    // On success the browser is already navigating to Google; leave it pending.
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");

    const { error } = await client().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/admin/auth/callback` },
    });

    if (error) {
      setError(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
        Check your email for the sign-in link. It works once, and expires in an hour.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={googling}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3 font-medium text-slate-800 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <GoogleMark />
        {googling ? "Opening Google…" : "Continue with Google"}
      </button>

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        or use your email
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-slate-100"
          />
        </label>

        <button
          type="submit"
          disabled={status === "sending"}
          className="w-full rounded-lg border border-slate-300 px-4 py-3 font-medium disabled:opacity-50 dark:border-slate-700"
        >
          {status === "sending" ? "Sending…" : "Email me a link"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.94v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.94a9 9 0 0 0 0 8.12l3.04-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .94 4.94l3.04 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
