import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test/db";

/**
 * Settling up after a trip.
 *
 * The failures that matter here all cost real money or real trust: billing
 * someone who never rode, losing a payment that was recorded, or leaving two
 * people on a trip owing different amounts for the same seat.
 */

let testDb: TestDb;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const {
  getTripLedger,
  getAddableTravellers,
  markPaid,
  markUnpaid,
  setAmountPerPerson,
  setTravelled,
  totalsFor,
} = await import("./settle");
const { attendance, dueEvents, dues, responses, trips, users } = await import("./db/schema");

let coordinator: Awaited<ReturnType<typeof makeUser>>;
let trip: typeof trips.$inferSelect;

async function makeUser(name: string, phone: string, role: "traveller" | "coordinator" = "traveller") {
  const [user] = await testDb
    .insert(users)
    .values({ name, phone, role, approvalStatus: "approved" })
    .returning();
  return user;
}

async function makeTrip(token = "settle-token") {
  const [t] = await testDb
    .insert(trips)
    .values({
      eventDate: "2026-08-07",
      destination: "Venue",
      departureTime: "12:15",
      status: "locked",
      linkToken: token,
    })
    .returning();
  return t;
}

async function book(userId: string) {
  await testDb.insert(responses).values({ tripId: trip.id, userId, going: true });
}

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());
  coordinator = await makeUser("Aman", "+919000000000", "coordinator");
  trip = await makeTrip();
});

describe("the settle-up list", () => {
  it("shows whoever booked, and leaves out whoever withdrew", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    const quitter = await makeUser("Rahul", "+919000000002");
    await book(rider.id);
    await testDb.insert(responses).values({ tripId: trip.id, userId: quitter.id, going: false });

    const ledger = await getTripLedger(trip.id);

    expect(ledger.map((r) => r.name)).toEqual(["Priya"]);
    // Booked, but nobody has said yet whether they turned up. That is a third
    // state, not a "no" — treating it as a no would bill nobody at all.
    expect(ledger[0].travelled).toBeNull();
    expect(ledger[0].booked).toBe(true);
  });

  it("does not drag in another trip's answers", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    const other = await makeTrip("other-token");
    await testDb.insert(responses).values({ tripId: other.id, userId: rider.id, going: true });

    expect(await getTripLedger(trip.id)).toHaveLength(0);
  });

  it("keeps someone who has left the group but rode on this trip", async () => {
    const senior = await makeUser("Senior", "+919000000003");
    await book(senior.id);
    await setTravelled(trip, senior.id, true, coordinator);
    await testDb.update(users).set({ isActive: false }).where(eq(users.id, senior.id));

    const [row] = await getTripLedger(trip.id);
    expect(row.name).toBe("Senior");
    expect(row.archived).toBe(true);
  });
});

describe("marking someone paid", () => {
  it("records the payment and that they travelled, in one tap", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);
    await setAmountPerPerson(trip, 150, coordinator);

    await markPaid({ ...trip, amountPerPerson: 150 }, rider.id, coordinator);

    const [row] = await getTripLedger(trip.id);
    expect(row.paid).toBe(true);
    expect(row.amount).toBe(150);
    // You do not pay for a trip you did not take, so the attendance follows.
    expect(row.travelled).toBe(true);
  });

  it("writes both the debt and its settlement to the audit log", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);
    await markPaid(trip, rider.id, coordinator);

    const events = await testDb.select().from(dueEvents);
    expect(events.map((e) => e.action)).toEqual(["generate", "verify"]);
    expect(events.every((e) => e.actorId === coordinator.id)).toBe(true);
  });

  it("refuses to bill someone marked as not having travelled", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);
    await setTravelled(trip, rider.id, false, coordinator);

    await expect(markPaid(trip, rider.id, coordinator)).rejects.toThrow(/only riders are billed/);
    expect(await testDb.select().from(dues)).toHaveLength(0);
  });

  it("is idempotent — a double tap does not double-record", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);

    await markPaid(trip, rider.id, coordinator);
    await markPaid(trip, rider.id, coordinator);

    expect(await testDb.select().from(dues)).toHaveLength(1);
    expect(await testDb.select().from(dueEvents)).toHaveLength(2);
  });

  it("undoes a misclick, keeping the fact that they travelled", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);
    await markPaid(trip, rider.id, coordinator);

    await markUnpaid(trip, rider.id, coordinator);

    const [row] = await getTripLedger(trip.id);
    expect(row.paid).toBe(false);
    expect(row.travelled).toBe(true);

    const events = await testDb.select().from(dueEvents);
    expect(events.at(-1)?.action).toBe("unverify");
  });

  it("will not let a payment be erased by unticking attendance", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);
    await markPaid(trip, rider.id, coordinator);

    await expect(setTravelled(trip, rider.id, false, coordinator)).rejects.toThrow(
      /undo the payment/,
    );
  });
});

describe("the person nobody remembered to add", () => {
  it("goes on the list without inventing a booking for them", async () => {
    const walkOn = await makeUser("Karthik", "+919000000004");

    await markPaid(trip, walkOn.id, coordinator);

    const [row] = await getTripLedger(trip.id);
    expect(row.name).toBe("Karthik");
    expect(row.travelled).toBe(true);
    expect(row.paid).toBe(true);
    // The pre-trip count is what was read down the phone to the contractor.
    // Back-filling a response would rewrite it after the fact.
    expect(row.booked).toBe(false);
    expect(await testDb.select().from(responses)).toHaveLength(0);
  });

  it("offers only people not already on the list", async () => {
    const booked = await makeUser("Priya", "+919000000001");
    const missing = await makeUser("Karthik", "+919000000004");
    await book(booked.id);

    const names = (await getAddableTravellers(trip.id)).map((c) => c.name);
    expect(names).toContain("Karthik");
    expect(names).toContain("Aman"); // the coordinator rides too
    expect(names).not.toContain("Priya");

    await setTravelled(trip, missing.id, true, coordinator);
    expect((await getAddableTravellers(trip.id)).map((c) => c.name)).not.toContain("Karthik");
  });
});

describe("the amount each rider owes", () => {
  it("amends what is already recorded, so nobody is left on the old figure", async () => {
    const early = await makeUser("Priya", "+919000000001");
    const late = await makeUser("Rahul", "+919000000002");
    await book(early.id);
    await book(late.id);

    // Paid before the coordinator got round to entering the amount.
    await markPaid(trip, early.id, coordinator);
    await setAmountPerPerson(trip, 150, coordinator);

    const ledger = await getTripLedger(trip.id);
    expect(ledger.find((r) => r.name === "Priya")?.amount).toBe(150);

    const amendments = (await testDb.select().from(dueEvents)).filter(
      (e) => e.action === "amend",
    );
    expect(amendments).toHaveLength(1);
    expect(amendments[0].note).toBe("Was ₹0");
  });

  it("rejects a figure that is not whole rupees, or is absurd", async () => {
    await expect(setAmountPerPerson(trip, 12.5, coordinator)).rejects.toThrow(/whole rupees/);
    await expect(setAmountPerPerson(trip, -1, coordinator)).rejects.toThrow(/negative/);
    await expect(setAmountPerPerson(trip, 1_000_000, coordinator)).rejects.toThrow(/typo/);
  });

  it("refuses to settle a cancelled trip", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await testDb.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));

    await expect(
      markPaid({ ...trip, status: "cancelled" }, rider.id, coordinator),
    ).rejects.toThrow(/cancelled/);
  });
});

describe("the totals a coordinator reads", () => {
  it("counts only riders, and prices only what is outstanding", async () => {
    const rows = [
      { travelled: true, paid: true, amount: 150 },
      { travelled: true, paid: true, amount: 150 },
      { travelled: true, paid: false, amount: null },
      { travelled: false, paid: false, amount: null },
      { travelled: null, paid: false, amount: null },
    ].map((r, i) => ({
      userId: String(i),
      name: `P${i}`,
      phone: "+9190000000" + i,
      joiningYear: null,
      booked: true,
      paidAt: null,
      archived: false,
      ...r,
    }));

    const totals = totalsFor(rows, 150);

    expect(totals.travelled).toBe(3);
    expect(totals.paid).toBe(2);
    expect(totals.outstanding).toBe(1);
    expect(totals.unmarked).toBe(1);
    expect(totals.collectedRupees).toBe(300);
    expect(totals.outstandingRupees).toBe(150);
  });

  it("reports no money at all when no amount was ever set", () => {
    const totals = totalsFor(
      [
        {
          userId: "1",
          name: "P",
          phone: "+919000000001",
          joiningYear: null,
          booked: true,
          travelled: true,
          paid: true,
          amount: 0,
          paidAt: null,
          archived: false,
        },
      ],
      null,
    );

    expect(totals.paid).toBe(1);
    expect(totals.collectedRupees).toBe(0);
    expect(totals.outstandingRupees).toBe(0);
  });
});

describe("attendance rows", () => {
  it("records who marked them and when", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);

    await setTravelled(trip, rider.id, true, coordinator);

    const [row] = await testDb
      .select()
      .from(attendance)
      .where(and(eq(attendance.tripId, trip.id), eq(attendance.userId, rider.id)));

    expect(row.boarded).toBe(true);
    expect(row.markedBy).toBe(coordinator.id);
  });

  it("flips an existing row rather than failing on the unique constraint", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);

    await setTravelled(trip, rider.id, true, coordinator);
    await setTravelled(trip, rider.id, false, coordinator);

    const rows = await testDb.select().from(attendance).where(eq(attendance.tripId, trip.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].boarded).toBe(false);
  });
});
