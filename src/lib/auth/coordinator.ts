import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, type User } from "../db/schema";

/**
 * Coordinator authentication.
 *
 * Coordinators take money-related actions, so unlike travellers they get real
 * auth: an email magic link via Supabase. No passwords to manage, no SMS costs,
 * and only a handful of people need it.
 *
 * The Supabase session establishes *who* someone is. The coordinator role is
 * then read from our own `users` table, so a valid Supabase login is not by
 * itself permission to do anything.
 */

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/** The signed-in coordinator, or null. Never throws. */
export async function getCurrentCoordinator(): Promise<User | null> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser?.email) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, authUser.email.toLowerCase()))
    .limit(1);

  if (!user || !user.isActive) return null;
  if (user.role !== "coordinator") return null;
  if (user.approvalStatus !== "approved") return null;

  return user;
}

/**
 * Who is signed in, and whether that gets them anything.
 *
 * `getCurrentCoordinator` collapses "nobody is signed in" and "signed in with
 * an email that isn't a coordinator" into the same null, which is right for a
 * guard and useless for the sign-in page. Someone who has just authenticated
 * with Google and lands back on a blank login form has no way to tell that the
 * app worked perfectly and simply doesn't know their address.
 */
export async function getCoordinatorSession(): Promise<{
  email: string | null;
  coordinator: User | null;
}> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  const email = authUser?.email?.toLowerCase() ?? null;
  if (!email) return { email: null, coordinator: null };

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  const usable =
    user && user.isActive && user.role === "coordinator" && user.approvalStatus === "approved";

  return { email, coordinator: usable ? user : null };
}

export async function signOutCoordinator(): Promise<void> {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
}

export class NotAuthorizedError extends Error {
  constructor(message = "Coordinators only") {
    super(message);
    this.name = "NotAuthorizedError";
  }
}

/**
 * Guard for every coordinator route and page.
 *
 * Checked server-side on each request. Hiding UI is never the control — the
 * roster, the counts and the ledger are only ever assembled after this returns.
 */
export async function requireCoordinator(): Promise<User> {
  const user = await getCurrentCoordinator();
  if (!user) throw new NotAuthorizedError();
  return user;
}

/**
 * The same guard, for pages rather than actions.
 *
 * Layouts and pages render concurrently, so a page that threw while the layout
 * redirected logged a NotAuthorizedError on every signed-out visit — an alarming
 * stack trace for the most ordinary event there is. Redirecting instead keeps
 * the guard (a page still never renders without a coordinator) while leaving
 * the logs meaning what they say.
 *
 * Server actions keep the throwing variant: there is no page to send anyone to,
 * and a mutation must fail loudly rather than quietly redirect.
 */
export async function requireCoordinatorPage(): Promise<User> {
  const user = await getCurrentCoordinator();
  if (!user) redirect("/admin/login");
  return user;
}
