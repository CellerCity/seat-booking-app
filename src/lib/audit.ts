import "server-only";
import type { db as Db } from "./db";
import { dueEvents, responseEvents, userEvents } from "./db/schema";

/**
 * Append-only audit writers.
 *
 * Every one of these takes a transaction handle rather than the global `db`,
 * because an audit row must be written in the SAME transaction as the change it
 * records. An action that isn't audited must not be possible — if the audit
 * insert fails, the change rolls back with it.
 *
 * These tables are never updated and never deleted from. When something is
 * disputed weeks later — who withdrew after we'd booked, who marked him paid —
 * this is the record that settles it.
 */

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

export async function recordResponseEvent(
  tx: Tx,
  event: {
    tripId: string;
    userId: string;
    action: "book" | "withdraw" | "approve_late" | "decline_late";
    fromValue?: string | null;
    toValue?: string | null;
    source: "self" | "coordinator";
    actorId?: string | null;
  },
) {
  await tx.insert(responseEvents).values({
    tripId: event.tripId,
    userId: event.userId,
    action: event.action,
    fromValue: event.fromValue ?? null,
    toValue: event.toValue ?? null,
    source: event.source,
    actorId: event.actorId ?? null,
  });
}

export async function recordUserEvent(
  tx: Tx,
  event: {
    userId: string;
    action: "register" | "approve" | "reject" | "block" | "unblock" | "promote" | "demote";
    fromStatus?: string | null;
    toStatus?: string | null;
    reason?: string | null;
    actorId?: string | null;
  },
) {
  await tx.insert(userEvents).values({
    userId: event.userId,
    action: event.action,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    reason: event.reason ?? null,
    actorId: event.actorId ?? null,
  });
}

export async function recordDueEvent(
  tx: Tx,
  event: {
    dueId: string;
    action: "generate" | "claim" | "verify" | "unverify" | "waive" | "amend";
    fromStatus?: string | null;
    toStatus?: string | null;
    amount?: number | null;
    actorId?: string | null;
    note?: string | null;
  },
) {
  await tx.insert(dueEvents).values({
    dueId: event.dueId,
    action: event.action,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    amount: event.amount ?? null,
    actorId: event.actorId ?? null,
    note: event.note ?? null,
  });
}
