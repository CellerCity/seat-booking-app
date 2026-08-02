"use server";

import { redirect } from "next/navigation";
import { signOutCoordinator } from "@/lib/auth/coordinator";

/**
 * Sign out. Deliberately NOT behind requireCoordinator().
 *
 * The person most likely to need this is someone who signed in with an email
 * the app doesn't recognise as a coordinator — exactly the person that guard
 * would turn away, leaving them stuck in a session they cannot end. Ending your
 * own session is not a privileged act.
 *
 * Kept out of actions.ts so the "every action starts with requireCoordinator()"
 * rule there stays true without exception.
 */
export async function signOutCoordinatorAction(): Promise<void> {
  await signOutCoordinator();
  redirect("/admin/login");
}
