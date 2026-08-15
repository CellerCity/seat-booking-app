import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, type User } from "../db/schema";
import { recordUserEvent } from "../audit";
import { normalizePhone } from "../phone";

/**
 * Traveller identity.
 *
 * Travellers have no accounts. They tap a WhatsApp link, type their phone
 * number once, and are remembered in a signed cookie thereafter.
 *
 * This is deliberately NOT authentication — a phone number typed into a browser
 * proves nothing. See SPEC.md §4 "Accepted risk". What contains it: every
 * action is audited, coordinators can reverse anything, no money moves through
 * the app, and the group is small and socially accountable. Phase 4 adds OTP or
 * Google sign-in on top of the same user records with no migration.
 */

export type TravellerSession = { userId?: string };

// Resolved on first use, not at import time, so a build without secrets present
// still succeeds and the failure lands at the request that actually needs it.
function sessionOptions(): SessionOptions {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters. See .env.example.",
    );
  }

  return {
    password: secret,
    cookieName: "seat_booking_traveller",
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // a year — re-identifying weekly defeats the point
      path: "/",
    },
  };
}

async function session() {
  return getIronSession<TravellerSession>(await cookies(), sessionOptions());
}

/**
 * The signed-in traveller, or null.
 *
 * Reloads from the database on every call rather than trusting the cookie's
 * contents, so a block or approval takes effect on the traveller's very next
 * request instead of whenever their cookie happens to expire.
 */
export async function getCurrentTraveller(): Promise<User | null> {
  const s = await session();
  if (!s.userId) return null;

  const [user] = await db.select().from(users).where(eq(users.id, s.userId)).limit(1);
  if (!user || !user.isActive) return null;
  return user;
}

export type LookupResult =
  | { status: "found"; user: User }
  | { status: "blocked"; user: User }
  | { status: "needs_registration"; phone: string };

/**
 * Who a typed number belongs to — a read, and nothing more.
 *
 * Separate from `identify` on purpose. A digit typed wrong silently signs
 * someone in as whoever owns that number, and everything after it — the
 * booking, the withdrawal, the payment — is attributed to a person who never
 * touched the app. So the number is looked up first and the match is shown back
 * for confirmation ("You're Priya Nair, 2023 — yes, that's me"), and only the
 * confirmation writes the cookie.
 *
 * The confirmation step re-submits the *phone number*, never a user id.
 * Accepting an id would mean anyone who learned one could become that person
 * with a single direct POST; requiring the number keeps the bar exactly where
 * it already was.
 */
export async function lookupByPhone(rawPhone: string): Promise<LookupResult> {
  const phone = normalizePhone(rawPhone);

  const [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);

  if (!user || !user.isActive) {
    return { status: "needs_registration", phone };
  }
  if (user.approvalStatus === "blocked") {
    return { status: "blocked", user };
  }

  return { status: "found", user };
}

export type IdentifyResult =
  | { status: "identified"; user: User }
  | { status: "blocked"; user: User }
  | { status: "needs_registration"; phone: string };

/**
 * Confirmed: match the number again and remember it.
 *
 * Re-reads rather than trusting anything the confirmation screen carried back,
 * so a block applied between the two steps still takes effect.
 */
export async function identify(rawPhone: string): Promise<IdentifyResult> {
  const found = await lookupByPhone(rawPhone);

  if (found.status === "needs_registration") return found;
  // No session is created — a blocked number cannot get a foothold.
  if (found.status === "blocked") return { status: "blocked", user: found.user };

  const s = await session();
  s.userId = found.user.id;
  await s.save();

  return { status: "identified", user: found.user };
}

/**
 * Self-registration for someone not on the roster.
 *
 * Created `pending`: they can book straight away, but the booking is held out
 * of the locked count until a coordinator approves them. Refusing outright
 * would strand a genuine new junior behind a coordinator's response time.
 * See SPEC.md §4.1.
 */
export async function register(rawName: string, rawPhone: string): Promise<User> {
  const phone = normalizePhone(rawPhone);
  const name = rawName.trim();

  if (name.length < 2) {
    throw new Error("Please enter your name");
  }

  const user = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (existing) return existing;

    const [created] = await tx
      .insert(users)
      .values({ name, phone, approvalStatus: "pending", memberType: "regular" })
      .returning();

    await recordUserEvent(tx, {
      userId: created.id,
      action: "register",
      toStatus: "pending",
    });

    return created;
  });

  if (user.approvalStatus !== "blocked") {
    const s = await session();
    s.userId = user.id;
    await s.save();
  }

  return user;
}

export async function signOutTraveller() {
  const s = await session();
  s.destroy();
}

/** Blocked users get a plain access-removed screen on every route. */
export function isBlocked(user: User | null): boolean {
  return user?.approvalStatus === "blocked";
}

/** Pending users may act; their bookings are held out of the count until approved. */
export function isPending(user: User | null): boolean {
  return user?.approvalStatus === "pending";
}

/** Only approved travellers count toward the number read to the contractor. */
export function countsTowardHeadcount(user: User): boolean {
  return user.approvalStatus === "approved" && user.isActive;
}
