import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentCoordinator } from "@/lib/auth/coordinator";
import { signOutCoordinatorAction } from "./session-actions";

export const dynamic = "force-dynamic";

/**
 * Coordinator area guard.
 *
 * Checked server-side on every request. Nothing below this — no roster, no
 * counts, no phone numbers, no ledger — is even fetched unless this passes.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isLoginPage = pathname.includes("/admin/login");

  const coordinator = await getCurrentCoordinator();

  if (!coordinator && !isLoginPage) {
    redirect("/admin/login");
  }

  if (!coordinator) return <>{children}</>;

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <nav className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
          <Link href="/admin" className="font-semibold">
            Seat booking
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/admin/trips" className="text-sm text-slate-500 hover:underline">
              Trips
            </Link>
            <Link href="/admin/roster" className="text-sm text-slate-500 hover:underline">
              Roster
            </Link>
            <span className="text-sm text-slate-500">{coordinator.name}</span>
            <form action={signOutCoordinatorAction}>
              <button
                type="submit"
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </nav>
      <div className="mx-auto max-w-5xl px-5 py-6">{children}</div>
    </div>
  );
}
