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
  recordGroupPayment,
  removeFromTrip,
  setAmountPerPerson,
  setGuests,
  setTravelled,
  totalsFor,
} = await import("./settle");
const { attendance, dueEvents, dues, responses, trips, userEvents, users } = await import(
  "./db/schema"
);

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

/**
 * Set what each rider owes and hand back the trip as it now stands.
 *
 * The write functions take the trip they were given, so a test that sets an
 * amount and then keeps passing the stale object bills everyone ₹0 — and the
 * assertions still read as though they were about the amount.
 */
async function priced(rupees: number) {
  await setAmountPerPerson(trip, rupees, coordinator);
  const [t] = await testDb.select().from(trips).where(eq(trips.id, trip.id));
  return t;
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
      guests: 0,
      paidByUserId: null,
      paidByName: null,
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
          guests: 0,
          paidByUserId: null,
          paidByName: null,
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

describe("one payment covering several people", () => {
  it("settles the payer and each named friend, and records who paid", async () => {
    const payer = await makeUser("Rahul", "+919000000001");
    const friend = await makeUser("Priya", "+919000000002");
    await book(payer.id);
    await book(friend.id);

    await recordGroupPayment(
      await priced(150),
      { payerId: payer.id, coversUserIds: [friend.id], guests: 0 },
      coordinator,
    );

    const ledger = await getTripLedger(trip.id);
    const rahul = ledger.find((r) => r.name === "Rahul")!;
    const priya = ledger.find((r) => r.name === "Priya")!;

    expect(rahul.paid).toBe(true);
    expect(priya.paid).toBe(true);
    // The share stays the friend's own. What is recorded is who settled it —
    // the difference between "she never paid" and "Rahul paid for her".
    expect(priya.amount).toBe(150);
    expect(priya.paidByName).toBe("Rahul");
    expect(rahul.paidByUserId).toBeNull();
  });

  it("marks the friends as having travelled, without inventing bookings", async () => {
    const payer = await makeUser("Rahul", "+919000000001");
    const friend = await makeUser("Priya", "+919000000002");
    await book(payer.id);

    await recordGroupPayment(
      trip,
      { payerId: payer.id, coversUserIds: [friend.id], guests: 0 },
      coordinator,
    );

    const priya = (await getTripLedger(trip.id)).find((r) => r.name === "Priya")!;
    expect(priya.travelled).toBe(true);
    // The response table is the demand signal from before the trip. Writing one
    // now would rewrite the count that was read to the contractor.
    expect(priya.booked).toBe(false);
  });

  it("bills the payer for the friends nobody can name", async () => {
    const payer = await makeUser("Rahul", "+919000000001");
    await book(payer.id);

    await recordGroupPayment(
      await priced(150),
      { payerId: payer.id, coversUserIds: [], guests: 2 },
      coordinator,
    );

    const ledger = await getTripLedger(trip.id);
    expect(ledger[0].guests).toBe(2);
    expect(ledger[0].amount).toBe(450); // three riders at 150

    const totals = totalsFor(ledger, 150);
    expect(totals.travelled).toBe(3);
    expect(totals.paid).toBe(3);
    expect(totals.guests).toBe(2);
    expect(totals.collectedRupees).toBe(450);
  });

  it("charges the payer once however they are listed", async () => {
    const payer = await makeUser("Rahul", "+919000000001");
    await book(payer.id);

    await recordGroupPayment(
      await priced(150),
      { payerId: payer.id, coversUserIds: [payer.id], guests: 0 },
      coordinator,
    );

    const rows = await testDb.select().from(dues).where(eq(dues.tripId, trip.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(150);
  });

  it("lands as one act — a bad name in the list settles nobody", async () => {
    const payer = await makeUser("Rahul", "+919000000001");
    await book(payer.id);
    await setAmountPerPerson(trip, 150, coordinator);

    await expect(
      recordGroupPayment(
        trip,
        { payerId: payer.id, coversUserIds: ["00000000-0000-0000-0000-000000000000"], guests: 0 },
        coordinator,
      ),
    ).rejects.toThrow(/No such person/);

    // Not even the payer, who would otherwise have been the first write through.
    expect(await testDb.select().from(dues).where(eq(dues.tripId, trip.id))).toHaveLength(0);
  });

  it("refuses a crowd, which is a typo rather than a cab", async () => {
    const payer = await makeUser("Rahul", "+919000000001");
    await book(payer.id);

    await expect(
      recordGroupPayment(trip, { payerId: payer.id, coversUserIds: [], guests: 40 }, coordinator),
    ).rejects.toThrow(/roster/);
  });
});

describe("unnamed friends", () => {
  it("counts them as riders on an unpaid row too", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);
    await setTravelled(trip, rider.id, true, coordinator);

    await setGuests(trip, rider.id, 2, coordinator);

    const totals = totalsFor(await getTripLedger(trip.id), 150);
    expect(totals.travelled).toBe(3);
    expect(totals.outstanding).toBe(3);
    // Three shares are out, not one. Billing only the named rider is how the
    // group ends up short without anyone noticing.
    expect(totals.outstandingRupees).toBe(450);
  });

  it("amends a settled amount when the count changes", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);
    const priced150 = await priced(150);
    await markPaid(priced150, rider.id, coordinator);

    await setGuests(priced150, rider.id, 1, coordinator);

    expect((await getTripLedger(trip.id))[0].amount).toBe(300);

    const events = await testDb.select().from(dueEvents);
    expect(events.some((e) => e.action === "amend" && e.amount === 300)).toBe(true);
  });

  it("applies a changed per-person amount per rider, not per row", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);
    const priced150 = await priced(150);
    await setGuests(priced150, rider.id, 2, coordinator);
    await markPaid(priced150, rider.id, coordinator);

    await setAmountPerPerson(trip, 200, coordinator);

    expect((await getTripLedger(trip.id))[0].amount).toBe(600);
  });

  it("clears them when the person is marked as not having travelled", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);
    await setGuests(trip, rider.id, 2, coordinator);

    await setTravelled(trip, rider.id, false, coordinator);

    expect((await getTripLedger(trip.id))[0].guests).toBe(0);
  });
});

describe("removing someone added by mistake", () => {
  it("takes them off the trip entirely", async () => {
    const wrong = await makeUser("Priya", "+919000000001");
    await setTravelled(trip, wrong.id, true, coordinator);

    await removeFromTrip(trip, wrong.id, coordinator);

    expect(await getTripLedger(trip.id)).toHaveLength(0);
    expect(await testDb.select().from(attendance)).toHaveLength(0);
  });

  it("does not refuse because a payment was recorded", async () => {
    const wrong = await makeUser("Priya", "+919000000001");
    await markPaid(await priced(150), wrong.id, coordinator);

    // The point of it: being told to undo the payment first, on the screen
    // where the payment itself was the mistake, is a dead end.
    await removeFromTrip(trip, wrong.id, coordinator);

    expect(await testDb.select().from(dues)).toHaveLength(0);
    expect(await getTripLedger(trip.id)).toHaveLength(0);
  });

  it("leaves the booking, the person and their other trips alone", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    const other = await makeTrip("other-trip-token");
    await book(rider.id);
    await setTravelled(trip, rider.id, true, coordinator);
    await setTravelled(other, rider.id, true, coordinator);

    await removeFromTrip(trip, rider.id, coordinator);

    // They booked, so they belong on the list — just back to unmarked.
    const ledger = await getTripLedger(trip.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].travelled).toBeNull();
    expect(await getTripLedger(other.id)).toHaveLength(1);
    expect(await testDb.select().from(users).where(eq(users.id, rider.id))).toHaveLength(1);
  });

  it("leaves a trace with a name and a time on it", async () => {
    const wrong = await makeUser("Priya", "+919000000001");
    await markPaid(await priced(150), wrong.id, coordinator);

    await removeFromTrip(trip, wrong.id, coordinator);

    const [event] = await testDb
      .select()
      .from(userEvents)
      .where(eq(userEvents.userId, wrong.id));

    expect(event.action).toBe("remove_from_trip");
    expect(event.actorId).toBe(coordinator.id);
    expect(event.reason).toContain("150");
  });

  it("says so when there is nothing recorded to remove", async () => {
    const rider = await makeUser("Priya", "+919000000001");
    await book(rider.id);

    await expect(removeFromTrip(trip, rider.id, coordinator)).rejects.toThrow(/nothing recorded/);
  });
});
