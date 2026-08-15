import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/test/db";

/**
 * Identifying a traveller by phone number.
 *
 * The failure this guards against is quiet and lasts a year: one wrong digit
 * matches somebody else on a roster of fifty, the cookie remembers it, and from
 * then on that person's bookings, withdrawals and fare all belong to a stranger.
 * So the lookup and the remembering are two separate steps, with the match shown
 * back in between.
 */

let testDb: TestDb;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { lookupByPhone } = await import("./traveller");
const { users } = await import("../db/schema");

async function makeUser(
  name: string,
  phone: string,
  extra: Partial<typeof users.$inferInsert> = {},
) {
  const [user] = await testDb
    .insert(users)
    .values({ name, phone, approvalStatus: "approved", ...extra })
    .returning();
  return user;
}

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());
});

describe("lookupByPhone", () => {
  it("finds the person a number belongs to", async () => {
    await makeUser("Priya Nair", "+919876543210", { joiningYear: 2023 });

    const result = await lookupByPhone("98765 43210");

    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.user.name).toBe("Priya Nair");
    expect(result.user.joiningYear).toBe(2023);
  });

  it("matches however the number was typed", async () => {
    await makeUser("Priya Nair", "+919876543210");

    for (const typed of ["9876543210", "+91 98765 43210", "098765-43210", "919876543210"]) {
      const result = await lookupByPhone(typed);
      expect(result.status).toBe("found");
    }
  });

  it("does not remember anyone — that is the confirmation step's job", async () => {
    // Load-bearing, and the reason this test exists at all. Writing the session
    // here would need `cookies()`, which is unavailable outside a request, so
    // re-introducing that write breaks this test rather than shipping quietly.
    await makeUser("Priya Nair", "+919876543210");

    await expect(lookupByPhone("9876543210")).resolves.toMatchObject({ status: "found" });
  });

  it("offers registration for a number nobody has", async () => {
    const result = await lookupByPhone("9876543210");

    expect(result.status).toBe("needs_registration");
    if (result.status !== "needs_registration") return;
    // Normalized, so the registration that follows cannot store a second format.
    expect(result.phone).toBe("+919876543210");
  });

  it("turns a blocked number away without a foothold", async () => {
    await makeUser("Rahul", "+919876543210", {
      approvalStatus: "blocked",
      blockedReason: "test",
    });

    expect((await lookupByPhone("9876543210")).status).toBe("blocked");
  });

  it("treats an archived person as unknown", async () => {
    await makeUser("Old Member", "+919876543210", { isActive: false });

    expect((await lookupByPhone("9876543210")).status).toBe("needs_registration");
  });

  it("rejects what cannot be a mobile number before touching the roster", async () => {
    await expect(lookupByPhone("12345")).rejects.toThrow();
  });
});
