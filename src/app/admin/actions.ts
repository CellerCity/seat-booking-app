"use server";

import { revalidatePath } from "next/cache";
import { requireCoordinator } from "@/lib/auth/coordinator";
import {
  addMember,
  approveMember,
  archiveMember,
  blockMember,
  deleteMember,
  demoteCoordinator,
  restoreMember,
  MemberError,
  promoteToCoordinator,
  rejectMember,
  unblockMember,
  updateMember,
} from "@/lib/members";
import {
  bookSeat,
  cancelTrip,
  createTrip,
  decideLateBooking,
  deleteTrip,
  lockTrip,
  TripError,
  withdraw,
} from "@/lib/trips";
import {
  markPaid,
  markUnpaid,
  recordGroupPayment,
  removeFromTrip,
  setAmountPerPerson,
  setGuests,
  setTravelled,
  SettleError,
} from "@/lib/settle";
import { db } from "@/lib/db";
import { trips, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PhoneError } from "@/lib/phone";
import { JoiningYearError } from "@/lib/joining-year";

/**
 * Coordinator actions.
 *
 * Every one starts with requireCoordinator() — the guard is per-action and
 * server-side, never inherited from the fact that a page rendered.
 */

export type ActionState = { error?: string; ok?: boolean };

function toState(e: unknown): ActionState {
  if (
    e instanceof MemberError ||
    e instanceof TripError ||
    e instanceof PhoneError ||
    e instanceof SettleError ||
    e instanceof JoiningYearError
  ) {
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

/** Remove a trip entirely — housekeeping for test runs and mistakes. */
export async function deleteTripAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    // Only ever set by the trip-history control, which has already shown the
    // coordinator what will be destroyed and had them confirm it.
    await deleteTrip(trip, { withRecords: formData.get("withRecords") === "true" });
    revalidatePath("/admin");
    revalidatePath("/admin/trips");
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

// --- Settling up after a trip -----------------------------------------------

/**
 * Each of these revalidates the trip's own page rather than /admin, because
 * settling up happens after the trip has dropped off the dashboard's list of
 * upcoming ones.
 */
function revalidateTrip(tripId: string) {
  revalidatePath(`/admin/trips/${tripId}`);
  revalidatePath("/admin/trips");
}

/** Who actually turned up — including the person nobody remembered to add. */
export async function setTravelledAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    await setTravelled(
      trip,
      String(formData.get("userId")),
      formData.get("travelled") === "true",
      coordinator,
    );
    revalidateTrip(trip.id);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/** They have settled up. Also records that they travelled, if nobody had said. */
export async function markPaidAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    await markPaid(trip, String(formData.get("userId")), coordinator);
    revalidateTrip(trip.id);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function markUnpaidAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    await markUnpaid(trip, String(formData.get("userId")), coordinator);
    revalidateTrip(trip.id);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/**
 * Take someone off this trip — the wrong name tapped in a list of fifty.
 *
 * Deliberately not gated on their payment state. The screen warns and says what
 * will be erased; refusing here is what left a coordinator with no way out.
 */
export async function removeFromTripAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    await removeFromTrip(trip, String(formData.get("userId")), coordinator);
    revalidateTrip(trip.id);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/** How many unnamed friends came with this person. */
export async function setGuestsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    const raw = String(formData.get("guests") ?? "").trim();

    if (!/^\d+$/.test(raw)) return { error: "Enter a whole number of friends" };

    await setGuests(trip, String(formData.get("userId")), Number(raw), coordinator);
    revalidateTrip(trip.id);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/**
 * One payment covering several people.
 *
 * The named friends arrive as repeated `covers` fields — a checkbox list posts
 * itself that way, and `getAll` is what reads it without the page having to
 * encode a list into one string.
 */
export async function recordGroupPaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    const raw = String(formData.get("guests") ?? "0").trim();

    if (raw && !/^\d+$/.test(raw)) return { error: "Enter a whole number of friends" };

    await recordGroupPayment(
      trip,
      {
        payerId: String(formData.get("payerId")),
        coversUserIds: formData.getAll("covers").map(String).filter(Boolean),
        guests: raw ? Number(raw) : 0,
      },
      coordinator,
    );
    revalidateTrip(trip.id);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/** What each rider is being asked for. Blank clears it. */
export async function setAmountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    const trip = await tripById(String(formData.get("tripId")));
    const raw = String(formData.get("amount") ?? "").trim();

    if (raw && !/^\d+$/.test(raw)) {
      return { error: "Enter whole rupees, digits only" };
    }

    await setAmountPerPerson(trip, raw ? Number(raw) : null, coordinator);
    revalidateTrip(trip.id);
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

/** Retire someone who has left. Hidden from the roster, kept in the ledger. */
export async function archiveMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    await archiveMember(String(formData.get("userId")), coordinator);
    revalidatePath("/admin/roster");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function restoreMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    await restoreMember(String(formData.get("userId")), coordinator);
    revalidatePath("/admin/roster");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/** Erase an entry that should never have existed. Refused if they have history. */
export async function deleteMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    await deleteMember(String(formData.get("userId")), coordinator);
    revalidatePath("/admin/roster");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/** Fix a roster entry — a misspelt name, the wrong affiliation, a bad number. */
export async function updateMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireCoordinator();
    await updateMember(String(formData.get("userId")), {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      memberType: formData.get("memberType") === "guest" ? "guest" : "regular",
      affiliation: String(formData.get("affiliation") ?? ""),
      email: String(formData.get("email") ?? ""),
      joiningYear: String(formData.get("joiningYear") ?? ""),
    });
    revalidatePath("/admin/roster");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/** Handover: make another member a coordinator, or step one back down. */
export async function promoteMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    await promoteToCoordinator(
      String(formData.get("userId")),
      String(formData.get("email") ?? ""),
      coordinator,
    );
    revalidatePath("/admin/roster");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function demoteMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const coordinator = await requireCoordinator();
    await demoteCoordinator(String(formData.get("userId")), coordinator);
    revalidatePath("/admin/roster");
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
        joiningYear: String(formData.get("joiningYear") ?? ""),
      },
      coordinator,
    );
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}
