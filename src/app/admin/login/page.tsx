import { getCoordinatorSession } from "@/lib/auth/coordinator";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { signOutCoordinatorAction } from "../session-actions";

export const dynamic = "force-dynamic";

/**
 * Coordinator sign-in: an email magic link.
 *
 * A valid Supabase login is not by itself permission to do anything — the
 * coordinator role is read from our own users table afterwards. Someone who
 * signs in with an unknown email lands back here.
 */
/**
 * The callback redirects here with ?error=... when a link fails. Without this
 * the failure is invisible — you land back on a blank sign-in form with no idea
 * why, which is indistinguishable from the page simply not working.
 */
const ERRORS: Record<string, string> = {
  missing_code:
    "That link was incomplete. Request a new one — and open it in a browser rather than letting an email app preview it.",
  invalid_link:
    "That link has expired or was already used. Sign-in links work once. Request a new one below.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { email, coordinator } = await getCoordinatorSession();
  if (coordinator) redirect("/admin");

  const errorCode = (await searchParams).error;
  const message = errorCode ? (ERRORS[errorCode] ?? "That sign-in link didn't work.") : null;

  // Authenticated, but the app doesn't know this address. Without saying so,
  // Google sign-in "works" and then silently dumps you back on a blank form —
  // the single most confusing outcome, and the likeliest one the first time a
  // new coordinator tries it.
  if (email) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5">
        <h1 className="text-xl font-bold">Not a coordinator</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          You&apos;re signed in as <strong>{email}</strong>, but that address isn&apos;t
          set up as a coordinator.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Ask an existing coordinator to add this exact address to your roster entry,
          then sign in again. If you have another Google account, try that one.
        </p>
        <form action={signOutCoordinatorAction} className="mt-6">
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
          >
            Sign out and try another account
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5">
      <h1 className="text-xl font-bold">Coordinator sign-in</h1>
      <p className="mt-1 text-sm text-slate-500">
        Coordinators only. Travellers just use the link from the group.
      </p>
      {message && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {message}
        </p>
      )}
      <div className="mt-6">
        <LoginForm />
      </div>
    </main>
  );
}
