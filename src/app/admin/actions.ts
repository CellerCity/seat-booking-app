"use server";

import { revalidatePath } from "next/cache";
import { requireCoordinator } from "@/lib/auth/coordinator";
import {
  addMember,
  approveMember,
  blockMember,
  MemberError,
  rejectMember,
  unblockMember,
} from "@/lib/members";
import {
  bookSeat,
  cancelTrip,
  createTrip,
  decideLateBooking,
  lockTrip,
  TripError,
  withdraw,
} from "@/lib/trips";
import { db } from "@/lib/db";
import { trips, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PhoneError } from "@/lib/phone";

/**
 * Coordinator actions.
 *
 * Every one starts with requireCoordinator() — the guard is per-action and
 * server-side, never inherited from the fact that a page rendered.
 */

export type ActionState = { error?: string; ok?: boolean };

function toState(e: unknown): ActionState {
  if (e instanceof MemberError || e instanceof TripError || e instanceof PhoneError) {
    return { error: e.message };
  }
  return { error: "Something went wrong. Please try again." };
}

async function tripById(id: string) {
  const [trip] = await db.select().from(trips).where(eq(trips.id, id)).limit(1);
  if (!trip) throw new TripError("No such trip");
  return trip;
}

async function userById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new MemberError("No such person");
  return user;
}

// --- Trip -------------------------------------------------------------------

/** Snapshot the count at the moment of the contractor call. */
export async function lockTripAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    await lockTrip(trip, coordinator);
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function openPollAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    if (trip.status !== "draft") return { error: "The poll is already open" };

    await db
      .update(trips)
      .set({ status: "poll_open", pollOpenedAt: new Date(), updatedAt: new Date() })
      .where(eq(trips.id, trip.id));

    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/** Add a one-off trip — an extra event, or one the cron does not cover. */
export async function createTripAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const closesRaw = String(formData.get("pollClosesAt") ?? "").trim();

    await createTrip(
      {
        eventDate: String(formData.get("eventDate") ?? ""),
        destination: String(formData.get("destination") ?? ""),
        departureTime: String(formData.get("departureTime") ?? ""),
        // datetime-local gives a wall-clock string with no zone. Coordinators
        // are in IST and so is every trip, so it is pinned rather than left to
        // the server's timezone, which on Vercel is UTC.
        pollClosesAt: closesRaw ? new Date(`${closesRaw}:00+05:30`) : null,
      },
      coordinator,
    );

    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/** Call a trip off. One-way, and the reason is shown to travellers. */
export async function cancelTripAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    await cancelTrip(trip, String(formData.get("reason") ?? ""), coordinator);
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/** Accept or decline a post-lock booking. Always a person's call. */
export async function decideLateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    const userId = String(formData.get("userId"));
    const accept = formData.get("accept") === "true";

    await decideLateBooking(trip, userId, accept, coordinator);
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/** Record a response for the WhatsApp holdout who just replies "count me in". */
export async function recordResponseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    const user = await userById(String(formData.get("userId")));
    const going = formData.get("going") === "true";

    if (going) {
      await bookSeat(trip, user, { source: "coordinator", actorId: coordinator.id });
    } else {
      await withdraw(trip, user, { source: "coordinator", actorId: coordinator.id });
    }

    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

// --- Membership -------------------------------------------------------------

export async function approveMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    await approveMember(String(formData.get("userId")), coordinator);
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function rejectMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    await rejectMember(String(formData.get("userId")), coordinator);
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function blockMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    await blockMember(
      String(formData.get("userId")),
      String(formData.get("reason") ?? ""),
      coordinator,
    );
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function unblockMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    await unblockMember(String(formData.get("userId")), coordinator);
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function addMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    await addMember(
      {
        name: String(formData.get("name") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        memberType: formData.get("memberType") === "guest" ? "guest" : "regular",
        affiliation: String(formData.get("affiliation") ?? ""),
      },
      coordinator,
    );
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}
