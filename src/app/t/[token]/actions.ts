"use server";

import { revalidatePath } from "next/cache";
import {
  getCurrentTraveller,
  identify,
  register,
  signOutTraveller,
} from "@/lib/auth/traveller";
import { PhoneError } from "@/lib/phone";
import {
  bookSeat,
  getTripByToken,
  setBookingGuests,
  TripError,
  withdraw,
} from "@/lib/trips";

/**
 * Traveller actions. Three things only: book, withdraw, pay.
 * (Payment lands in Milestone 2.)
 *
 * Every one of these re-reads the user from the database, so a coordinator's
 * block or approval takes effect on the very next tap.
 */

export type ActionState = { error?: string; message?: string };

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

export async function signOutAction(): Promise<void> {
  await signOutTraveller();
  revalidatePath("/t");
}
