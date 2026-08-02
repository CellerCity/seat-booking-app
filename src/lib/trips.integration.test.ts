import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test/db";

/**
 * Milestone 1 end to end, against a real Postgres.
 *
 * The scenario is a full week of the group's actual process: people book, the
 * coordinator locks the count before phoning the contractor, stragglers turn up
 * late, someone drops out, a stranger signs up through the link.
 *
 * What is really under test is the boundary between the four numbers on the
 * dashboard. Conflating any of them is what leaves someone standing at the
 * pickup point without a seat.
 */

let testDb: TestDb;

// trips.ts imports the singleton `db`, so it is redirected at the module level.
vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const {
  bookSeat,
  cancelTrip,
  createTrip,
  decideLateBooking,
  getHeadcount,
  getUpcomingTrips,
  lockTrip,
  withdraw,
  generateLinkToken,
} = await import("./trips");
const { users, trips, responses, responseEvents } = await import("./db/schema");

async function makeTrip(status: "poll_open" | "draft" = "poll_open") {
  const [trip] = await testDb
    .insert(trips)
    .values({
      eventDate: "2026-08-08",
      destination: "Event venue",
      departureTime: "07:30",
      status,
      pollOpenedAt: new Date(),
      linkToken: generateLinkToken(),
    })
    .returning();
  return trip;
}

async function makeUser(
  name: string,
  phone: string,
  approvalStatus: "pending" | "approved" | "rejected" | "blocked" = "approved",
  role: "traveller" | "coordinator" = "traveller",
) {
  const [user] = await testDb
    .insert(users)
    .values({ name, phone, approvalStatus, role })
    .returning();
  return user;
}

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());
});

describe("the weekly cycle", () => {
  it("counts only approved people who booked", async () => {
    const trip = await makeTrip();
    const a = await makeUser("Asha", "+919000000001");
    const b = await makeUser("Rahul", "+919000000002");
    const c = await makeUser("Priya", "+919000000003");

    await bookSeat(trip, a);
    await bookSeat(trip, b);
    // c never responds

    const count = await getHeadcount(trip);
    expect(count.confirmed).toBe(2);
    expect(count.awaitingApproval).toBe(0);
    expect(c.id).toBeTruthy();
  });

  it("holds a pending stranger's booking out of the count until approved", async () => {
    const trip = await makeTrip();
    const known = await makeUser("Asha", "+919000000001");
    const stranger = await makeUser("Unknown", "+919000000009", "pending");

    await bookSeat(trip, known);
    await bookSeat(trip, stranger);

    let count = await getHeadcount(trip);
    expect(count.confirmed).toBe(1);
    expect(count.awaitingApproval).toBe(1);

    // A coordinator approves them; the held booking joins the count at once,
    // with no need for the person to re-book.
    await testDb
      .update(users)
      .set({ approvalStatus: "approved" })
      .where(eq(users.id, stranger.id));

    count = await getHeadcount(trip);
    expect(count.confirmed).toBe(2);
    expect(count.awaitingApproval).toBe(0);
  });

  it("excludes blocked and rejected people from the count entirely", async () => {
    const trip = await makeTrip();
    const ok = await makeUser("Asha", "+919000000001");
    const blocked = await makeUser("Blocked", "+919000000008", "approved");
    const rejected = await makeUser("Rejected", "+919000000007", "approved");

    await bookSeat(trip, ok);
    await bookSeat(trip, blocked);
    await bookSeat(trip, rejected);
    expect((await getHeadcount(trip)).confirmed).toBe(3);

    await testDb
      .update(users)
      .set({ approvalStatus: "blocked" })
      .where(eq(users.id, blocked.id));
    await testDb
      .update(users)
      .set({ approvalStatus: "rejected" })
      .where(eq(users.id, rejected.id));

    const count = await getHeadcount(trip);
    expect(count.confirmed).toBe(1);
    expect(count.awaitingApproval).toBe(0);
  });

  it("refuses to book a blocked person", async () => {
    const trip = await makeTrip();
    const blocked = await makeUser("Blocked", "+919000000008", "blocked");
    await expect(bookSeat(trip, blocked)).rejects.toThrow(/Access removed/);
  });
});

describe("locking the count", () => {
  it("snapshots the number that gets read to the contractor", async () => {
    const trip = await makeTrip();
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    for (let i = 1; i <= 5; i++) {
      await bookSeat(trip, await makeUser(`P${i}`, `+91900000010${i}`));
    }

    const locked = await lockTrip(trip, coordinator);

    expect(locked.status).toBe("locked");
    expect(locked.lockedCount).toBe(5);
    expect(locked.lockedAt).toBeInstanceOf(Date);
  });

  it("separates a late booking from the confirmed count until a coordinator decides", async () => {
    const trip = await makeTrip();
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    const early = await makeUser("Early", "+919000000001");
    const late = await makeUser("Late", "+919000000002");

    await bookSeat(trip, early);
    const locked = await lockTrip(trip, coordinator);

    await bookSeat(locked, late);

    let count = await getHeadcount(locked);
    expect(count.confirmed).toBe(1); // unchanged — cabs were hired for 1
    expect(count.awaitingLateDecision).toBe(1);

    // Accepting is always a person's call, never automatic.
    await decideLateBooking(locked, late.id, true, coordinator);

    count = await getHeadcount(locked);
    expect(count.confirmed).toBe(2);
    expect(count.awaitingLateDecision).toBe(0);
  });

  it("keeps a declined late booking out of the count", async () => {
    const trip = await makeTrip();
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    const late = await makeUser("Late", "+919000000002");

    const locked = await lockTrip(trip, coordinator);
    await bookSeat(locked, late);
    await decideLateBooking(locked, late.id, false, coordinator);

    const count = await getHeadcount(locked);
    expect(count.confirmed).toBe(0);
    expect(count.awaitingLateDecision).toBe(0);
  });

  it("flags a withdrawal made after the cabs were hired", async () => {
    const trip = await makeTrip();
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    const dropout = await makeUser("Dropout", "+919000000003");

    await bookSeat(trip, dropout);
    const locked = await lockTrip(trip, coordinator);
    await withdraw(locked, dropout);

    const count = await getHeadcount(locked);
    expect(count.confirmed).toBe(0);
    expect(count.withdrewAfterLock).toBe(1);
    // The snapshot itself is history and must not be rewritten by a later change.
    expect(locked.lockedCount).toBe(1);
  });

  it("does not let withdraw-then-rebook launder a late booking into an on-time one", async () => {
    const trip = await makeTrip();
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    const person = await makeUser("Late", "+919000000004");

    const locked = await lockTrip(trip, coordinator);
    await bookSeat(locked, person);
    await withdraw(locked, person);
    await bookSeat(locked, person);

    // Still late: first_responded_at is set once and never overwritten.
    const count = await getHeadcount(locked);
    expect(count.awaitingLateDecision).toBe(1);
    expect(count.confirmed).toBe(0);
  });
});

describe("the audit trail", () => {
  it("records every booking and withdrawal with who, what and when", async () => {
    const trip = await makeTrip();
    const person = await makeUser("Asha", "+919000000001");

    await bookSeat(trip, person);
    await withdraw(trip, person);
    await bookSeat(trip, person);

    const events = await testDb
      .select()
      .from(responseEvents)
      .where(eq(responseEvents.tripId, trip.id));

    expect(events.map((e) => e.action)).toEqual(["book", "withdraw", "book"]);
    expect(events.every((e) => e.source === "self")).toBe(true);
    expect(events.every((e) => e.occurredAt instanceof Date)).toBe(true);
  });

  it("marks a response a coordinator entered on someone's behalf", async () => {
    const trip = await makeTrip();
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    const holdout = await makeUser("Holdout", "+919000000005");

    // The person who just replies "count me in" in the WhatsApp group.
    await bookSeat(trip, holdout, { source: "coordinator", actorId: coordinator.id });

    const [event] = await testDb
      .select()
      .from(responseEvents)
      .where(eq(responseEvents.userId, holdout.id));

    expect(event.source).toBe("coordinator");
    expect(event.actorId).toBe(coordinator.id);

    const [response] = await testDb
      .select()
      .from(responses)
      .where(eq(responses.userId, holdout.id));
    expect(response.source).toBe("coordinator");
    expect(response.recordedBy).toBe(coordinator.id);
  });

  it("is idempotent — double-tapping book does not create a second event", async () => {
    const trip = await makeTrip();
    const person = await makeUser("Asha", "+919000000001");

    await bookSeat(trip, person);
    await bookSeat(trip, person);

    const events = await testDb
      .select()
      .from(responseEvents)
      .where(eq(responseEvents.tripId, trip.id));
    expect(events).toHaveLength(1);
  });
});

describe("adding and cancelling trips", () => {
  const dayAfter = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  it("adds an extra trip in the same week, open for booking straight away", async () => {
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    await makeTrip(); // the regular weekly run

    const extra = await createTrip(
      { eventDate: dayAfter(3), destination: "Second run", departureTime: "18:00" },
      coordinator,
    );

    expect(extra.status).toBe("poll_open");
    expect(extra.createdBy).toBe(coordinator.id);
    expect(extra.linkToken).not.toBe("");

    // Both are live at once, and a booking on one does not touch the other.
    const rider = await makeUser("Rider", "+919000000021");
    await bookSeat(extra, rider);
    expect((await getHeadcount(extra)).confirmed).toBe(1);

    const upcoming = await getUpcomingTrips();
    expect(upcoming.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses a second trip on the same date and time", async () => {
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    const date = dayAfter(4);
    await createTrip({ eventDate: date, destination: "A", departureTime: "07:30" }, coordinator);

    await expect(
      createTrip({ eventDate: date, destination: "B", departureTime: "07:30" }, coordinator),
    ).rejects.toThrow(/already exists/);

    // A different time that day is a legitimate second run.
    await expect(
      createTrip({ eventDate: date, destination: "B", departureTime: "18:00" }, coordinator),
    ).resolves.toMatchObject({ status: "poll_open" });
  });

  it("refuses a trip in the past", async () => {
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    await expect(
      createTrip({ eventDate: dayAfter(-1), destination: "X", departureTime: "07:30" }, coordinator),
    ).rejects.toThrow(/already passed/);
  });

  it("cancels a trip with a reason and stops further booking", async () => {
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    const trip = await makeTrip();
    const rider = await makeUser("Rider", "+919000000022");
    await bookSeat(trip, rider);

    const cancelled = await cancelTrip(trip, "Heavy rain", coordinator);

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("Heavy rain");
    expect(cancelled.cancelledBy).toBe(coordinator.id);
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);

    // Nobody can book onto a trip that is not running.
    const latecomer = await makeUser("Late", "+919000000023");
    await expect(bookSeat(cancelled, latecomer)).rejects.toThrow(/cancelled/i);
  });

  it("requires a reason, because travellers are shown it", async () => {
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    const trip = await makeTrip();
    await expect(cancelTrip(trip, "  ", coordinator)).rejects.toThrow(/reason/i);
    await expect(cancelTrip(trip, "ok", coordinator)).rejects.toThrow(/reason/i);
  });

  it("will not cancel the same trip twice", async () => {
    const coordinator = await makeUser("Coord", "+919000000000", "approved", "coordinator");
    const trip = await makeTrip();
    const cancelled = await cancelTrip(trip, "Weather", coordinator);
    await expect(cancelTrip(cancelled, "Again", coordinator)).rejects.toThrow(/Already cancelled/);
  });
});

describe("the advisory deadline", () => {
  it("never blocks a booking, because lock is the only hard gate", async () => {
    const trip = await makeTrip();
    // Deadline an hour in the past.
    const [past] = await testDb
      .update(trips)
      .set({ pollClosesAt: new Date(Date.now() - 3_600_000) })
      .where(eq(trips.id, trip.id))
      .returning();

    const person = await makeUser("Latecomer", "+919000000006");
    await expect(bookSeat(past, person)).resolves.toMatchObject({ booked: true });
    expect((await getHeadcount(past)).confirmed).toBe(1);
  });

  it("refuses a booking on a trip whose poll has not opened", async () => {
    const draft = await makeTrip("draft");
    const person = await makeUser("Eager", "+919000000001");
    await expect(bookSeat(draft, person)).rejects.toThrow(/hasn't opened/);
  });
});
