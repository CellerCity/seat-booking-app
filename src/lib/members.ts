import "server-only";
import { asc, count, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { attendance, dues, responses, users, type User } from "./db/schema";
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

/** People who have left. Kept out of the roster, kept in the ledger. */
export async function getArchivedMembers() {
  return db.select().from(users).where(eq(users.isActive, false)).orderBy(asc(users.name));
}

/**
 * Retire someone who has left — the graduating senior, the intern whose stay
 * ended.
 *
 * This is the normal way people leave, and it is not a delete. `is_active` is
 * already honoured everywhere: they vanish from the roster, drop out of every
 * headcount, and cannot sign in as either traveller or coordinator. What stays
 * is history — which trips they travelled on, and what they paid. Deleting the
 * row would erase that from past trips too, quietly rewriting settled numbers
 * that other people's shares were calculated from.
 */
export async function archiveMember(userId: string, coordinator: User): Promise<User> {
  if (userId === coordinator.id) throw new MemberError("You cannot archive yourself");

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!current) throw new MemberError("No such person");
    if (!current.isActive) throw new MemberError(`${current.name} is already archived`);

    if (current.role === "coordinator") {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(sql`${users.role} = 'coordinator' and ${users.isActive} = true`);
      if (n <= 1) throw new MemberError("That is the last coordinator — promote someone else first");
    }

    const [updated] = await tx
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    await recordUserEvent(tx, {
      userId,
      action: "archive",
      toStatus: "archived",
      reason: `Archived by ${coordinator.name}`,
      actorId: coordinator.id,
    });

    return updated;
  });
}

export async function restoreMember(userId: string, coordinator: User): Promise<User> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!current) throw new MemberError("No such person");
    if (current.isActive) throw new MemberError(`${current.name} is already on the roster`);

    const [updated] = await tx
      .update(users)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    await recordUserEvent(tx, {
      userId,
      action: "restore",
      toStatus: "active",
      reason: `Restored by ${coordinator.name}`,
      actorId: coordinator.id,
    });

    return updated;
  });
}

/**
 * Erase someone entirely. Only for entries that should never have existed.
 *
 * Every table hangs off users with ON DELETE CASCADE, so this takes their
 * responses, attendance, dues and payment history with it — including their
 * share of trips that are already settled. That is right for a duplicate row or
 * a typo'd number and wrong for anyone who has ever travelled, so a person with
 * any history is refused and must be archived instead.
 */
export async function deleteMember(userId: string, coordinator: User): Promise<void> {
  if (userId === coordinator.id) throw new MemberError("You cannot delete yourself");

  const [current] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!current) throw new MemberError("No such person");
  if (current.role === "coordinator") {
    throw new MemberError("Remove their coordinator access first");
  }

  const [[responseRow], [attendanceRow], [dueRow]] = await Promise.all([
    db.select({ n: count() }).from(responses).where(eq(responses.userId, userId)),
    db.select({ n: count() }).from(attendance).where(eq(attendance.userId, userId)),
    db.select({ n: count() }).from(dues).where(eq(dues.userId, userId)),
  ]);

  if (attendanceRow.n > 0 || dueRow.n > 0) {
    throw new MemberError(
      `${current.name} has travel or payment history — archive them instead of deleting`,
    );
  }
  if (responseRow.n > 0) {
    throw new MemberError(`${current.name} has responded to trips — archive them instead`);
  }

  await db.delete(users).where(eq(users.id, userId));
}

/**
 * Correct a roster entry.
 *
 * Details get typed in a hurry — a misspelt name, the wrong department, a phone
 * number off by a digit — and until now the only fix was a database edit. This
 * changes who someone *is*, never what they are allowed to do: role, approval
 * status and the blocklist all have their own audited paths and are untouched
 * here.
 *
 * A changed phone number is a real identity change, since travellers identify
 * by phone, so it is normalised and checked for collisions the same way a new
 * member is.
 */
export async function updateMember(
  userId: string,
  input: {
    name: string;
    phone: string;
    memberType?: "regular" | "guest";
    affiliation?: string;
    email?: string;
  },
): Promise<User> {
  const name = input.name.trim();
  if (name.length < 2) throw new MemberError("Please enter a name");

  const phone = normalizePhone(input.phone);
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new MemberError("That email doesn't look right");
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!current) throw new MemberError("No such person");

    const [phoneClash] = await tx.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (phoneClash && phoneClash.id !== userId) {
      throw new MemberError(`${phoneClash.name} already uses that number`);
    }

    if (email) {
      const [emailClash] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
      if (emailClash && emailClash.id !== userId) {
        throw new MemberError(`${emailClash.name} already uses that email`);
      }
    }

    // A coordinator signs in by email, so clearing it would lock them out of an
    // account they still hold. Removing access is demotion's job, not editing's.
    if (current.role === "coordinator" && !email) {
      throw new MemberError("A coordinator needs an email — remove their access first");
    }

    const [updated] = await tx
      .update(users)
      .set({
        name,
        phone,
        email,
        memberType: input.memberType ?? current.memberType,
        affiliation: input.affiliation?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    return updated;
  });
}

/**
 * Make someone a coordinator.
 *
 * This is the handover feature: without it, the only way to add a coordinator is
 * a database edit, which means the project dies with whoever holds the
 * credentials. See SPEC §13.
 *
 * An email is required and is the whole point — coordinators sign in by email,
 * whether by Google or a magic link, and are matched to this row by it. A
 * coordinator without one is an account nobody can ever use. Only approved
 * members can be promoted: pending, rejected and blocked people are exactly the
 * ones a coordinator has not vouched for.
 */
export async function promoteToCoordinator(
  userId: string,
  email: string,
  coordinator: User,
): Promise<User> {
  const address = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    throw new MemberError("A coordinator needs a valid email — it is how they sign in");
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!current) throw new MemberError("No such person");
    if (current.role === "coordinator") throw new MemberError(`${current.name} already is one`);
    if (current.approvalStatus !== "approved") {
      throw new MemberError("Approve them as a member first");
    }

    const [clash] = await tx.select().from(users).where(eq(users.email, address)).limit(1);
    if (clash && clash.id !== userId) {
      throw new MemberError(`${clash.name} already uses that email`);
    }

    const [updated] = await tx
      .update(users)
      .set({ role: "coordinator", email: address, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    await recordUserEvent(tx, {
      userId,
      action: "promote",
      fromStatus: "traveller",
      toStatus: "coordinator",
      reason: `Promoted by ${coordinator.name}`,
      actorId: coordinator.id,
    });

    return updated;
  });
}

/**
 * Step someone back down to traveller.
 *
 * Refuses to remove the last coordinator: an app with none cannot be
 * administered by anyone, and recovering from that needs database access —
 * precisely what this feature exists to avoid needing.
 */
export async function demoteCoordinator(userId: string, coordinator: User): Promise<User> {
  if (userId === coordinator.id) {
    throw new MemberError("You cannot remove your own coordinator access");
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!current) throw new MemberError("No such person");
    if (current.role !== "coordinator") throw new MemberError(`${current.name} is not a coordinator`);

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(sql`${users.role} = 'coordinator' and ${users.isActive} = true`);

    if (n <= 1) throw new MemberError("That is the last coordinator — promote someone else first");

    const [updated] = await tx
      .update(users)
      // The email stays: it is how they are identified if promoted again, and
      // dropping it would silently orphan their sign-in history.
      .set({ role: "traveller", updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    await recordUserEvent(tx, {
      userId,
      action: "demote",
      fromStatus: "coordinator",
      toStatus: "traveller",
      reason: `Demoted by ${coordinator.name}`,
      actorId: coordinator.id,
    });

    return updated;
  });
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
