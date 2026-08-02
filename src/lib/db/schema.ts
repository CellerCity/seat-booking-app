import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema for the weekly cab seat-booking app. See SPEC.md.
 *
 * Two rules run through everything here:
 *
 *  - All money is whole rupees in `integer` columns. No paise, no `numeric`,
 *    no floating point. See SPEC.md §7.
 *  - Every state change that carries social weight is mirrored into an
 *    append-only event table, written in the same transaction as the change.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const roleEnum = pgEnum("role", ["traveller", "coordinator"]);

/** `guest` is interns and short-stay visitors only. UG cross-over travellers are `regular`. */
export const memberTypeEnum = pgEnum("member_type", ["regular", "guest"]);

/**
 * A bool cannot distinguish "not looked at yet" from "turned away at the gate"
 * from "barred after the fact", and all three behave differently. See SPEC §4.1.
 */
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "blocked",
]);

export const tripStatusEnum = pgEnum("trip_status", [
  "draft",
  "poll_open",
  "locked",
  "in_progress",
  "completed",
  "settled",
  "cancelled",
]);

/** Who performed the action: the traveller themselves, or a coordinator on their behalf. */
export const actionSourceEnum = pgEnum("action_source", ["self", "coordinator"]);

export const responseActionEnum = pgEnum("response_action", [
  "book",
  "withdraw",
  "approve_late",
  "decline_late",
]);

export const userActionEnum = pgEnum("user_action", [
  "register",
  "approve",
  "reject",
  "block",
  "unblock",
  "promote",
  "demote",
]);

export const dueStatusEnum = pgEnum("due_status", ["unpaid", "claimed", "verified", "waived"]);

export const dueActionEnum = pgEnum("due_action", [
  "generate",
  "claim",
  "verify",
  "unverify",
  "waive",
  "amend",
]);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** E.164. The primary identifier — emails are not collected yet. */
    phone: text("phone").notNull().unique(),
    /** Reserved for Phase 4 Google sign-in. Matching on this attaches an auth
     *  identity to the existing record, so no data migration is ever needed. */
    email: text("email").unique(),
    role: roleEnum("role").notNull().default("traveller"),
    memberType: memberTypeEnum("member_type").notNull().default("regular"),
    affiliation: text("affiliation"),
    approvalStatus: approvalStatusEnum("approval_status").notNull().default("pending"),
    /** Required when blocking; kept after unblocking as part of the record. */
    blockedReason: text("blocked_reason"),
    isActive: boolean("is_active").notNull().default(true),
    /** Reserved; false for everyone at launch. Coordinators can do everything else. */
    canManageCoordinators: boolean("can_manage_coordinators").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("users_approval_status_idx").on(t.approvalStatus)],
);

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventDate: date("event_date").notNull(),
    destination: text("destination").notNull(),
    departureTime: time("departure_time").notNull(),
    status: tripStatusEnum("status").notNull().default("draft"),

    pollOpenedAt: timestamp("poll_opened_at", { withTimezone: true }),
    /** Advisory deadline only. It drives the countdown and reminders but never
     *  disables booking — `locked_at` is the sole hard gate. See SPEC §5. */
    pollClosesAt: timestamp("poll_closes_at", { withTimezone: true }),

    /** The moment of the contractor call. Everything after this is late. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by").references(() => users.id),
    /** One number, because one number is what the contractor is told. */
    lockedCount: integer("locked_count"),

    /** Pasted into WhatsApp. ≥128 bits of randomness: forwardable, not guessable. */
    linkToken: text("link_token").notNull().unique(),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("trips_status_idx").on(t.status),
    index("trips_event_date_idx").on(t.eventDate),
  ],
);

// ---------------------------------------------------------------------------
// Responses — the demand signal. Never the basis for charging.
// ---------------------------------------------------------------------------

export const responses = pgTable(
  "responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    going: boolean("going").notNull(),
    /** Set once on first response and never overwritten — late detection reads
     *  this, so a later edit must not launder a late booking into an early one. */
    firstRespondedAt: timestamp("first_responded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: actionSourceEnum("source").notNull().default("self"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    /** A coordinator accepted this post-lock booking. */
    lateApproved: boolean("late_approved").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique("responses_trip_user_uq").on(t.tripId, t.userId),
    index("responses_trip_going_idx").on(t.tripId, t.going),
  ],
);

export const responseEvents = pgTable(
  "response_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: responseActionEnum("action").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    source: actionSourceEnum("source").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
  },
  (t) => [index("response_events_trip_idx").on(t.tripId, t.occurredAt)],
);

// ---------------------------------------------------------------------------
// Membership decisions — same social weight as money, so same treatment.
// ---------------------------------------------------------------------------

export const userEvents = pgTable(
  "user_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: userActionEnum("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    /** Required for `block`. */
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id").references(() => users.id),
  },
  (t) => [index("user_events_user_idx").on(t.userId, t.occurredAt)],
);

// ---------------------------------------------------------------------------
// Cabs — hired for the day, round trip, at one price.
// ---------------------------------------------------------------------------

export const cabTypes = pgTable("cab_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull(),
  /** Rupees. A hint for the booking screen; actual cost is entered per trip. */
  defaultCost: integer("default_cost"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const cabs = pgTable(
  "cabs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    cabTypeId: uuid("cab_type_id")
      .notNull()
      .references(() => cabTypes.id),
    contractorName: text("contractor_name"),
    contractorPhone: text("contractor_phone"),
    /** Rupees, quoted on the call. */
    agreedCost: integer("agreed_cost"),
    /** Rupees, confirmed after the event. This is what gets split. */
    actualCost: integer("actual_cost"),
    /** Operational record of an early dispatch. Has no effect on cost — the cab
     *  was hired round-trip either way. */
    dispatchedEarly: boolean("dispatched_early").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("cabs_trip_idx").on(t.tripId)],
);

// ---------------------------------------------------------------------------
// Attendance — the sole basis for charging.
// ---------------------------------------------------------------------------

export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Marked at onward boarding, when a coordinator physically sees the person. */
    boarded: boolean("boarded").notNull().default(true),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
    markedBy: uuid("marked_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique("attendance_trip_user_uq").on(t.tripId, t.userId),
    index("attendance_trip_idx").on(t.tripId),
  ],
);

// ---------------------------------------------------------------------------
// Dues and settlement
// ---------------------------------------------------------------------------

export const dues = pgTable(
  "dues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Rupees. Floored — never more than this person's true share. */
    amount: integer("amount").notNull(),
    /** How the number was reached, so a traveller can check it themselves. */
    breakdown: jsonb("breakdown").$type<{
      totalCostRupees: number;
      riders: number;
      perHeadRupees: number;
      shortfallRupees: number;
    }>(),
    status: dueStatusEnum("status").notNull().default("unpaid"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => users.id),
    /** Someone paid on this person's behalf — routine, and a main source of
     *  tally drift in the WhatsApp process this replaces. */
    paidByUserId: uuid("paid_by_user_id").references(() => users.id),
    method: text("method"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    unique("dues_trip_user_uq").on(t.tripId, t.userId),
    index("dues_user_status_idx").on(t.userId, t.status),
    index("dues_status_idx").on(t.status),
  ],
);

export const dueEvents = pgTable(
  "due_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dueId: uuid("due_id")
      .notNull()
      .references(() => dues.id, { onDelete: "cascade" }),
    action: dueActionEnum("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    /** Rupees at the time of the event. */
    amount: integer("amount"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id").references(() => users.id),
    note: text("note"),
  },
  (t) => [index("due_events_due_idx").on(t.dueId, t.occurredAt)],
);

export const settlements = pgTable("settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id")
    .notNull()
    .unique()
    .references(() => trips.id, { onDelete: "cascade" }),
  /** Rupees. Sum of `cabs.actual_cost`. */
  totalCabCost: integer("total_cab_cost").notNull(),
  riders: integer("riders").notNull(),
  perHead: integer("per_head").notNull(),
  /** Rupees the coordinators absorbed, because per-head is floored. Under ₹50
   *  per trip at this group size. Tracked now, settled later — see SPEC §7. */
  roundingShortfall: integer("rounding_shortfall").notNull().default(0),
  /** Rupees. Rolling, from verified dues. */
  totalCollected: integer("total_collected").notNull().default(0),
  contractorPaidAt: timestamp("contractor_paid_at", { withTimezone: true }),
  contractorPaidBy: uuid("contractor_paid_by").references(() => users.id),
  note: text("note"),
  ...timestamps,
});

// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Trip = typeof trips.$inferSelect;
export type Response = typeof responses.$inferSelect;
export type Cab = typeof cabs.$inferSelect;
export type CabType = typeof cabTypes.$inferSelect;
export type Attendance = typeof attendance.$inferSelect;
export type Due = typeof dues.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
