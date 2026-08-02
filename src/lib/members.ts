import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { responses, users, type User } from "./db/schema";
import { recordUserEvent } from "./audit";
import { normalizePhone } from "./phone";

/**
 * Membership decisions: approve, reject, block, unblock.
 *
 * Every one of these is a deliberate coordinator action, never an automatic
 * consequence of anything the app noticed on its own. An unpaid balance never
 * blocks a booking — coordinators see the number and use their judgement.
 * See SPEC.md §14.
 *
 * All of them are audited in the same transaction as the change, so there is
 * always a name and a timestamp behind an exclusion.
 */

export class MemberError extends Error {}

/** Self-registrations waiting on a coordinator, oldest first. */
export async function getPendingMembers() {
  return db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      createdAt: users.createdAt,
      hasBooked: sql<boolean>`exists (
        select 1 from ${responses}
        where ${responses.userId} = ${users.id} and ${responses.going} = true
      )`,
    })
    .from(users)
    .where(eq(users.approvalStatus, "pending"))
    .orderBy(asc(users.createdAt));
}

export async function countPendingMembers(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.approvalStatus, "pending"));
  return row?.n ?? 0;
}

export async function getRoster() {
  return db.select().from(users).where(eq(users.isActive, true)).orderBy(asc(users.name));
}

async function transition(
  userId: string,
  to: "approved" | "rejected" | "blocked",
  action: "approve" | "reject" | "block" | "unblock",
  coordinator: User,
  reason?: string,
): Promise<User> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!current) throw new MemberError("No such person");

    const [updated] = await tx
      .update(users)
      .set({
        approvalStatus: to,
        blockedReason: action === "block" ? (reason ?? null) : current.blockedReason,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    await recordUserEvent(tx, {
      userId,
      action,
      fromStatus: current.approvalStatus,
      toStatus: to,
      reason: reason ?? null,
      actorId: coordinator.id,
    });

    return updated;
  });
}

/** One-time gate. Once approved, a person is never asked again. */
export async function approveMember(userId: string, coordinator: User) {
  return transition(userId, "approved", "approve", coordinator);
}

export async function rejectMember(userId: string, coordinator: User) {
  return transition(userId, "rejected", "reject", coordinator);
}

/**
 * Blocking is access control, not debt forgiveness — outstanding dues stay on
 * the ledger and stay visible to coordinators.
 *
 * A reason is required. An exclusion someone has to justify in one line is much
 * harder to do casually, and the record is what makes it reviewable later.
 */
export async function blockMember(userId: string, reason: string, coordinator: User) {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new MemberError("Please give a short reason for blocking");
  }
  if (userId === coordinator.id) {
    throw new MemberError("You cannot block yourself");
  }
  return transition(userId, "blocked", "block", coordinator, trimmed);
}

export async function unblockMember(userId: string, coordinator: User) {
  return transition(userId, "approved", "unblock", coordinator);
}

/** Guests are interns and short-stay visitors. UG cross-over travellers are `regular`. */
export async function addMember(
  input: { name: string; phone: string; memberType?: "regular" | "guest"; affiliation?: string },
  coordinator: User,
): Promise<User> {
  const phone = normalizePhone(input.phone);
  const name = input.name.trim();
  if (name.length < 2) throw new MemberError("Please enter a name");

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (existing) throw new MemberError(`${existing.name} is already on the roster`);

    const [created] = await tx
      .insert(users)
      .values({
        name,
        phone,
        memberType: input.memberType ?? "regular",
        affiliation: input.affiliation?.trim() || null,
        // Added by a coordinator who knows them, so no approval step is needed.
        approvalStatus: "approved",
      })
      .returning();

    await recordUserEvent(tx, {
      userId: created.id,
      action: "approve",
      toStatus: "approved",
      reason: "Added by coordinator",
      actorId: coordinator.id,
    });

    return created;
  });
}
