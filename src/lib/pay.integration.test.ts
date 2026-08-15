import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test/db";

/**
 * The traveller's side of settling up.
 *
 * Two properties are load-bearing here and everything else is detail:
 *
 *  - Nothing is payable until a coordinator has both set the fare and been
 *    named to collect it. A payment screen that appears on its own is a screen
 *    that invites someone to send a guessed amount to a stale address.
 *  - A traveller's tap never settles anything. `claimed` is their word;
 *    `verified` is a coordinator's, and only a coordinator can write it.
 */

let testDb: TestDb;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { claimPayment, getPayView, retractClaim, setCollector, setUpiVpa, PayError } =
  await import("./pay");
const { markPaid, setAmountPerPerson, setGuests, setTravelled } = await import("./settle");
const { attendance, dueEvents, dues, responses, trips, users } = await import("./db/schema");

let coordinator: typeof users.$inferSelect;
let rider: typeof users.$inferSelect;
let trip: typeof trips.$inferSelect;

async function makeUser(
  name: string,
  phone: string,
  role: "traveller" | "coordinator" = "traveller",
) {
  const [user] = await testDb
    .insert(users)
    .values({ name, phone, role, approvalStatus: "approved" })
    .returning();
  return user;
}

/** Re-read the trip: the write functions act on the object they are given. */
async function fresh() {
  const [t] = await testDb.select().from(trips).where(eq(trips.id, trip.id));
  return t;
}

/** A trip with a fare set and somebody collecting — the fully open state. */
async function payable(rupees = 150) {
  await setAmountPerPerson(trip, rupees, coordinator);
  await setUpiVpa(coordinator.id, "aman@ybl");
  await setCollector(await fresh(), coordinator.id);
  return fresh();
}

async function book(userId: string, guests = 0) {
  await testDb.insert(responses).values({ tripId: trip.id, userId, going: true, guests });
}

async function dueFor(userId: string) {
  const [due] = await testDb
    .select()
    .from(dues)
    .where(and(eq(dues.tripId, trip.id), eq(dues.userId, userId)));
  return due;
}

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());
  coordinator = await makeUser("Aman", "+919000000000", "coordinator");
  rider = await makeUser("Priya", "+919000000001");

  const [t] = await testDb
    .insert(trips)
    .values({
      eventDate: "2026-08-07",
      destination: "Venue",
      departureTime: "12:15",
      status: "completed",
      linkToken: "pay-token",
    })
    .returning();
  trip = t;
});

describe("what a traveller is shown", () => {
  it("shows nothing at all to someone who was not on the trip", async () => {
    const t = await payable();
    expect((await getPayView(t, rider)).state).toBe("hidden");
  });

  it("shows nothing until a coordinator sets the fare", async () => {
    // The gate that was asked for: no announced amount, nothing to pay against.
    await book(rider.id);
    await setUpiVpa(coordinator.id, "aman@ybl");
    await setCollector(trip, coordinator.id);

    expect((await getPayView(await fresh(), rider)).state).toBe("awaiting_amount");
  });

  it("shows nothing payable until somebody is collecting", async () => {
    await book(rider.id);
    await setAmountPerPerson(trip, 150, coordinator);

    const view = await getPayView(await fresh(), rider);
    expect(view.state).toBe("awaiting_collector");
    // The amount is still shown, so they know what is coming.
    if (view.state === "awaiting_collector") expect(view.amount).toBe(150);
  });

  it("offers a payment once the fare and the collector are both set", async () => {
    await book(rider.id);
    const t = await payable(150);

    const view = await getPayView(t, rider);
    expect(view.state).toBe("due");
    if (view.state !== "due") return;

    expect(view.amount).toBe(150);
    expect(view.riders).toBe(1);
    expect(view.payee).toEqual({ vpa: "aman@ybl", name: "Aman" });
    expect(view.link).toContain("pa=aman%40ybl");
    expect(view.link).toContain("am=150.00");
  });

  it("bills the friends they booked for, before anyone has marked the bus", async () => {
    // Otherwise they are quoted one share here and silently recorded as owing
    // three the moment a coordinator marks attendance.
    await book(rider.id, 2);
    const t = await payable(150);

    const view = await getPayView(t, rider);
    if (view.state !== "due") throw new Error(`expected due, got ${view.state}`);
    expect(view.riders).toBe(3);
    expect(view.amount).toBe(450);
  });

  it("prefers what the coordinator marked over what was booked", async () => {
    await book(rider.id, 2);
    await setTravelled(trip, rider.id, true, coordinator);
    await setGuests(trip, rider.id, 1, coordinator); // only one friend actually came
    const t = await payable(150);

    const view = await getPayView(t, rider);
    if (view.state !== "due") throw new Error(`expected due, got ${view.state}`);
    expect(view.amount).toBe(300);
  });

  it("shows nothing to someone marked as not having travelled", async () => {
    await book(rider.id);
    await setTravelled(trip, rider.id, false, coordinator);
    const t = await payable();

    expect((await getPayView(t, rider)).state).toBe("hidden");
  });

  it("offers nothing on a cancelled trip", async () => {
    await book(rider.id);
    await payable();
    await testDb.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));

    expect((await getPayView(await fresh(), rider)).state).toBe("hidden");
  });
});

describe("saying you have paid", () => {
  it("records a claim, and never a settled due", async () => {
    await book(rider.id);
    const t = await payable(150);

    await claimPayment(t, rider);

    const due = await dueFor(rider.id);
    expect(due.status).toBe("claimed");
    expect(due.amount).toBe(150);
    expect(due.claimedAmount).toBe(150);
    expect(due.claimedAt).not.toBeNull();
    // The two things a coordinator alone may write.
    expect(due.verifiedAt).toBeNull();
    expect(due.verifiedBy).toBeNull();
  });

  it("does not invent an attendance row", async () => {
    // Who boarded is a coordinator's observation. A traveller saying they paid
    // is not evidence they rode, and back-filling it would quietly move the
    // rider count the fare was divided by.
    await book(rider.id);
    await claimPayment(await payable(), rider);

    const rows = await testDb
      .select()
      .from(attendance)
      .where(and(eq(attendance.tripId, trip.id), eq(attendance.userId, rider.id)));
    expect(rows).toHaveLength(0);
  });

  it("audits the claim against the traveller, not a coordinator", async () => {
    await book(rider.id);
    await claimPayment(await payable(), rider);

    const due = await dueFor(rider.id);
    const events = await testDb.select().from(dueEvents).where(eq(dueEvents.dueId, due.id));

    const claim = events.find((e) => e.action === "claim");
    expect(claim).toBeDefined();
    expect(claim!.actorId).toBe(rider.id);
    expect(claim!.toStatus).toBe("claimed");
    // The debt existing and the debt being claimed are separate facts.
    expect(events.map((e) => e.action).sort()).toEqual(["claim", "generate"]);
  });

  it("refuses when no fare has been set", async () => {
    await book(rider.id);
    await expect(claimPayment(trip, rider)).rejects.toThrow(PayError);
  });

  it("refuses from someone who was not on the trip", async () => {
    const t = await payable();
    await expect(claimPayment(t, rider)).rejects.toThrow(PayError);
  });

  it("refuses from someone marked as not having travelled", async () => {
    await book(rider.id);
    await setTravelled(trip, rider.id, false, coordinator);
    await expect(claimPayment(await payable(), rider)).rejects.toThrow(PayError);
  });

  it("refuses on a cancelled trip", async () => {
    await book(rider.id);
    await payable();
    await testDb.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));

    await expect(claimPayment(await fresh(), rider)).rejects.toThrow(PayError);
  });

  it("does not reset the time when tapped twice", async () => {
    // A coordinator reads that timestamp. A second tap must not make an old
    // claim look like it arrived just now.
    await book(rider.id);
    const t = await payable();
    await claimPayment(t, rider);
    const first = (await dueFor(rider.id)).claimedAt;

    await claimPayment(t, rider);

    expect((await dueFor(rider.id)).claimedAt).toEqual(first);
  });

  it("cannot undo a payment a coordinator already verified", async () => {
    await book(rider.id);
    const t = await payable();
    await markPaid(t, rider.id, coordinator);

    await claimPayment(t, rider); // no-op
    expect((await dueFor(rider.id)).status).toBe("verified");
  });
});

describe("taking a claim back", () => {
  it("returns the due to unpaid and says who withdrew it", async () => {
    await book(rider.id);
    const t = await payable();
    await claimPayment(t, rider);

    await retractClaim(t, rider);

    const due = await dueFor(rider.id);
    expect(due.status).toBe("unpaid");
    expect(due.claimedAt).toBeNull();
    expect(due.claimedAmount).toBeNull();

    const events = await testDb.select().from(dueEvents).where(eq(dueEvents.dueId, due.id));
    expect(events.at(-1)!.actorId).toBe(rider.id);
    expect(events.at(-1)!.fromStatus).toBe("claimed");
  });

  it("refuses once a coordinator has confirmed the money", async () => {
    // Past that point it is the coordinator's record of a real credit, not the
    // traveller's statement about one.
    await book(rider.id);
    const t = await payable();
    await claimPayment(t, rider);
    await markPaid(t, rider.id, coordinator);

    await expect(retractClaim(t, rider)).rejects.toThrow(PayError);
  });
});

describe("what the coordinator does with a claim", () => {
  it("adopts the claimed row rather than leaving a second one", async () => {
    await book(rider.id);
    const t = await payable(150);
    await claimPayment(t, rider);

    await markPaid(t, rider.id, coordinator);

    const rows = await testDb
      .select()
      .from(dues)
      .where(and(eq(dues.tripId, trip.id), eq(dues.userId, rider.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("verified");
    expect(rows[0].verifiedBy).toBe(coordinator.id);
    // What they said they sent survives the confirmation, so the record still
    // shows the two amounts agreed.
    expect(rows[0].claimedAmount).toBe(150);
  });

  it("keeps the claim visible on the settle-up list until it is confirmed", async () => {
    const { getTripLedger, totalsFor } = await import("./settle");
    await book(rider.id);
    const t = await payable(150);
    await setTravelled(t, rider.id, true, coordinator);
    await claimPayment(t, rider);

    const ledger = await getTripLedger(trip.id);
    const row = ledger.find((r) => r.userId === rider.id)!;

    expect(row.claimed).toBe(true);
    expect(row.paid).toBe(false); // emphatically not settled
    expect(row.claimedAmount).toBe(150);
    expect(totalsFor(ledger, 150).claimed).toBe(1);
    expect(totalsFor(ledger, 150).outstanding).toBe(1);
  });

  it("tells the traveller when the fare moved after they paid", async () => {
    await book(rider.id);
    const t = await payable(150);
    await claimPayment(t, rider);

    await setAmountPerPerson(await fresh(), 170, coordinator);

    const view = await getPayView(await fresh(), rider);
    if (view.state !== "claimed") throw new Error(`expected claimed, got ${view.state}`);
    expect(view.claimedAmount).toBe(150);
    expect(view.amount).toBe(170);
  });
});

describe("naming a collector", () => {
  it("snapshots the address, so changing it later does not rewrite history", async () => {
    await setUpiVpa(coordinator.id, "aman@ybl");
    await setCollector(trip, coordinator.id);

    await setUpiVpa(coordinator.id, "aman@okaxis");

    const t = await fresh();
    expect(t.collectUpiVpa).toBe("aman@ybl");
    expect(t.collectUpiName).toBe("Aman");
  });

  it("refuses a coordinator who has not added a UPI ID", async () => {
    await expect(setCollector(trip, coordinator.id)).rejects.toThrow(PayError);
  });

  it("refuses someone who is not a coordinator", async () => {
    await setUpiVpa(rider.id, "priya@ybl");
    await expect(setCollector(trip, rider.id)).rejects.toThrow(PayError);
  });

  it("clears the payee when nobody is collecting", async () => {
    await setUpiVpa(coordinator.id, "aman@ybl");
    await setCollector(trip, coordinator.id);

    await setCollector(await fresh(), null);

    const t = await fresh();
    expect(t.collectUpiVpa).toBeNull();
    expect(t.collectedByUserId).toBeNull();
  });

  it("normalizes what is stored, so one person cannot hold two addresses", async () => {
    await setUpiVpa(coordinator.id, "  Aman@YBL  ");
    const [saved] = await testDb.select().from(users).where(eq(users.id, coordinator.id));
    expect(saved.upiVpa).toBe("aman@ybl");
  });
});
