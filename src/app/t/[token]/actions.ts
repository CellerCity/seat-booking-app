"use server";

import { revalidatePath } from "next/cache";
import {
  getCurrentTraveller,
  identify,
  lookupByPhone,
  register,
  signOutTraveller,
} from "@/lib/auth/traveller";
import { claimPayment, PayError, retractClaim } from "@/lib/pay";
import { PhoneError } from "@/lib/phone";
import {
  bookSeat,
  getTripByToken,
  setBookingGuests,
  TripError,
  withdraw,
} from "@/lib/trips";

/**
 * Traveller actions. Four things only: identify, book, withdraw, say you paid.
 *
 * Every one of these re-reads the user from the session and the database rather
 * than taking an id from the form, so a coordinator's block or approval takes
 * effect on the very next tap — and so a direct POST, which these are reachable
 * by, cannot act as somebody else.
 */

export type ActionState = {
  error?: string;
  message?: string;
  /** A roster match awaiting confirmation. Nothing is remembered until it comes. */
  found?: { name: string; joiningYear: number | null; phone: string };
};

/**
 * Step one: whose number is this?
 *
 * A read only. The cookie is not written here, because a mistyped digit would
 * otherwise sign this person in as whoever owns that number and quietly
 * attribute their bookings — and their payments — to a stranger.
 */
export async function lookupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const phone = String(formData.get("phone") ?? "");

  try {
    const result = await lookupByPhone(phone);

    if (result.status === "blocked") {
      return { error: "Your access has been removed. Please speak to a coordinator." };
    }
    if (result.status === "needs_registration") {
      return { message: "new" };
    }

    return {
      found: {
        name: result.user.name,
        joiningYear: result.user.joiningYear,
        phone,
      },
    };
  } catch (e) {
    if (e instanceof PhoneError) return { error: e.message };
    return { error: "Something went wrong. Please try again." };
  }
}

/**
 * Step two: yes, that's me.
 *
 * Takes the phone number again rather than a user id — accepting an id would
 * let anyone who learned one become that person with a single POST.
 */
export async function identifyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const phone = String(formData.get("phone") ?? "");

  try {
    const result = await identify(phone);

    if (result.status === "blocked") {
      return { error: "Your access has been removed. Please speak to a coordinator." };
    }
    if (result.status === "needs_registration") {
      return { message: "new" };
    }

    revalidatePath("/t");
    return {};
  } catch (e) {
    if (e instanceof PhoneError) return { error: e.message };
    return { error: "Something went wrong. Please try again." };
  }
}

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "");
  const phone = String(formData.get("phone") ?? "");

  try {
    await register(name, phone);
    revalidatePath("/t");
    return {};
  } catch (e) {
    if (e instanceof PhoneError) return { error: e.message };
    if (e instanceof Error) return { error: e.message };
    return { error: "Something went wrong. Please try again." };
  }
}

export async function bookAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");

  const user = await getCurrentTraveller();
  if (!user) return { error: "Please enter your phone number first." };

  const trip = await getTripByToken(token);
  if (!trip) return { error: "This trip link is no longer valid." };

  try {
    await bookSeat(trip, user, { source: "self" });
    revalidatePath(`/t/${token}`);
    return {};
  } catch (e) {
    if (e instanceof TripError) return { error: e.message };
    return { error: "Something went wrong. Please try again." };
  }
}

/** Seats for friends coming along, alongside their own. */
export async function setGuestsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const raw = String(formData.get("guests") ?? "").trim();

  const user = await getCurrentTraveller();
  if (!user) return { error: "Please enter your phone number first." };

  const trip = await getTripByToken(token);
  if (!trip) return { error: "This trip link is no longer valid." };
  if (!/^\d+$/.test(raw)) return { error: "Enter a whole number of friends." };

  try {
    await setBookingGuests(trip, user, Number(raw), { source: "self" });
    revalidatePath(`/t/${token}`);
    return {};
  } catch (e) {
    if (e instanceof TripError) return { error: e.message };
    return { error: "Something went wrong. Please try again." };
  }
}

export async function withdrawAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");

  const user = await getCurrentTraveller();
  if (!user) return { error: "Please enter your phone number first." };

  const trip = await getTripByToken(token);
  if (!trip) return { error: "This trip link is no longer valid." };

  try {
    await withdraw(trip, user, { source: "self" });
    revalidatePath(`/t/${token}`);
    return {};
  } catch (e) {
    if (e instanceof TripError) return { error: e.message };
    return { error: "Something went wrong. Please try again." };
  }
}

/**
 * "I've paid" — recorded as the traveller's word, not as a settled due.
 *
 * The amount is recomputed on the server from the fare a coordinator set and
 * the rider count on record. Nothing about what is owed comes from the page.
 */
export async function claimPaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");

  const user = await getCurrentTraveller();
  if (!user) return { error: "Please enter your phone number first." };

  const trip = await getTripByToken(token);
  if (!trip) return { error: "This trip link is no longer valid." };

  try {
    await claimPayment(trip, user);
    revalidatePath(`/t/${token}`);
    return {};
  } catch (e) {
    if (e instanceof PayError) return { error: e.message };
    return { error: "Something went wrong. Please try again." };
  }
}

/** Undo an "I've paid" — only their own, and only before a coordinator checks it. */
export async function retractClaimAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");

  const user = await getCurrentTraveller();
  if (!user) return { error: "Please enter your phone number first." };

  const trip = await getTripByToken(token);
  if (!trip) return { error: "This trip link is no longer valid." };

  try {
    await retractClaim(trip, user);
    revalidatePath(`/t/${token}`);
    return {};
  } catch (e) {
    if (e instanceof PayError) return { error: e.message };
    return { error: "Something went wrong. Please try again." };
  }
}

export async function signOutAction(): Promise<void> {
  await signOutTraveller();
  revalidatePath("/t");
}
