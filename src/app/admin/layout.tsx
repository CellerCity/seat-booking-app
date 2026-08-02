import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentCoordinator } from "@/lib/auth/coordinator";

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
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <Link href="/admin" className="font-semibold">
            Seat booking
          </Link>
          <span className="text-sm text-slate-500">{coordinator.name}</span>
        </div>
      </nav>
      <div className="mx-auto max-w-5xl px-5 py-6">{children}</div>
    </div>
  );
}
