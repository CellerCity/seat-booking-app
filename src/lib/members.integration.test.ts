import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test/db";

/**
 * Coordinator handover.
 *
 * This is the feature that decides whether the app survives the person who
 * built it. The failure that matters is not a wrong button — it is ending up
 * with zero coordinators, which no coordinator can then fix.
 */

let testDb: TestDb;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { promoteToCoordinator, demoteCoordinator, updateMember } = await import("./members");
const { users, userEvents } = await import("./db/schema");

async function makeUser(
  name: string,
  phone: string,
  role: "traveller" | "coordinator" = "traveller",
  approvalStatus: "pending" | "approved" | "rejected" | "blocked" = "approved",
  email: string | null = null,
) {
  const [user] = await testDb
    .insert(users)
    .values({ name, phone, role, approvalStatus, email })
    .returning();
  return user;
}

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());
});

describe("promotion", () => {
  it("promotes an approved member and records who did it", async () => {
    const boss = await makeUser("Aman", "+919000000000", "coordinator", "approved", "a@x.com");
    const member = await makeUser("Priya", "+919000000001");

    const promoted = await promoteToCoordinator(member.id, "Priya@Example.COM ", boss);

    expect(promoted.role).toBe("coordinator");
    // Stored lowercase and trimmed: Google returns a lowercase address, and a
    // mismatch here is an account that signs in and is told it is nobody.
    expect(promoted.email).toBe("priya@example.com");

    const [event] = await testDb.select().from(userEvents).where(eq(userEvents.userId, member.id));
    expect(event.action).toBe("promote");
    expect(event.actorId).toBe(boss.id);
  });

  it("insists on an email, because that is the sign-in", async () => {
    const boss = await makeUser("Aman", "+919000000000", "coordinator", "approved", "a@x.com");
    const member = await makeUser("Priya", "+919000000001");

    await expect(promoteToCoordinator(member.id, "", boss)).rejects.toThrow(/valid email/);
    await expect(promoteToCoordinator(member.id, "not-an-email", boss)).rejects.toThrow(/valid email/);
  });

  it("refuses someone who is not an approved member", async () => {
    const boss = await makeUser("Aman", "+919000000000", "coordinator", "approved", "a@x.com");
    const pending = await makeUser("Stranger", "+919000000002", "traveller", "pending");
    const blocked = await makeUser("Barred", "+919000000003", "traveller", "blocked");

    await expect(promoteToCoordinator(pending.id, "p@x.com", boss)).rejects.toThrow(/Approve them/);
    await expect(promoteToCoordinator(blocked.id, "b@x.com", boss)).rejects.toThrow(/Approve them/);
  });

  it("refuses an email another member already uses", async () => {
    const boss = await makeUser("Aman", "+919000000000", "coordinator", "approved", "a@x.com");
    const member = await makeUser("Priya", "+919000000001");

    await expect(promoteToCoordinator(member.id, "a@x.com", boss)).rejects.toThrow(/already uses/);
  });
});

describe("editing a roster entry", () => {
  it("corrects details without touching role or approval", async () => {
    const member = await makeUser("Priya", "+919876543210");

    const updated = await updateMember(member.id, {
      name: "Priya Sharma",
      phone: "98765 43210", // same number, typed loosely
      affiliation: "CSE, 3rd year",
      memberType: "guest",
    });

    expect(updated.name).toBe("Priya Sharma");
    expect(updated.affiliation).toBe("CSE, 3rd year");
    expect(updated.memberType).toBe("guest");
    // Normalised back to the same stored form, so nobody's identity moves.
    expect(updated.phone).toBe("+919876543210");
    expect(updated.role).toBe("traveller");
    expect(updated.approvalStatus).toBe("approved");
  });

  it("refuses a phone number another member already has", async () => {
    await makeUser("Rahul", "+919000000001");
    const other = await makeUser("Priya", "+919000000002");

    await expect(
      updateMember(other.id, { name: "Priya", phone: "9000000001" }),
    ).rejects.toThrow(/already uses that number/);
  });

  it("will not strip a coordinator's email and lock them out", async () => {
    const boss = await makeUser("Aman", "+919000000000", "coordinator", "approved", "a@x.com");

    await expect(
      updateMember(boss.id, { name: "Aman", phone: "+919000000000", email: "" }),
    ).rejects.toThrow(/needs an email/);
  });

  it("clears an optional affiliation when emptied", async () => {
    const member = await makeUser("Priya", "+919000000003");
    await updateMember(member.id, { name: "Priya", phone: "+919000000003", affiliation: "ECE" });
    const cleared = await updateMember(member.id, {
      name: "Priya",
      phone: "+919000000003",
      affiliation: "  ",
    });
    expect(cleared.affiliation).toBeNull();
  });
});

describe("demotion", () => {
  it("steps a coordinator back down, keeping them on the roster", async () => {
    const boss = await makeUser("Aman", "+919000000000", "coordinator", "approved", "a@x.com");
    const other = await makeUser("Priya", "+919000000001", "coordinator", "approved", "p@x.com");

    const demoted = await demoteCoordinator(other.id, boss);

    expect(demoted.role).toBe("traveller");
    expect(demoted.isActive).toBe(true);
    // The email survives: it identifies them if they are promoted again.
    expect(demoted.email).toBe("p@x.com");

    const [event] = await testDb.select().from(userEvents).where(eq(userEvents.userId, other.id));
    expect(event.action).toBe("demote");
    expect(event.actorId).toBe(boss.id);
  });

  it("will not let a coordinator demote themselves", async () => {
    const boss = await makeUser("Aman", "+919000000000", "coordinator", "approved", "a@x.com");
    await makeUser("Priya", "+919000000001", "coordinator", "approved", "p@x.com");

    await expect(demoteCoordinator(boss.id, boss)).rejects.toThrow(/your own/);
  });

  it("will not remove the last coordinator, leaving nobody who can administer it", async () => {
    const boss = await makeUser("Aman", "+919000000000", "coordinator", "approved", "a@x.com");
    const solo = await makeUser("Only", "+919000000004", "coordinator", "approved", "o@x.com");

    // Two exist, so this one can go.
    await demoteCoordinator(solo.id, boss);

    // Now `boss` is the last. Another (already demoted) person cannot remove them,
    // and neither can they remove themselves.
    await expect(demoteCoordinator(boss.id, solo)).rejects.toThrow();
  });

  it("refuses to demote someone who is not a coordinator", async () => {
    const boss = await makeUser("Aman", "+919000000000", "coordinator", "approved", "a@x.com");
    const traveller = await makeUser("Priya", "+919000000001");

    await expect(demoteCoordinator(traveller.id, boss)).rejects.toThrow(/not a coordinator/);
  });
});
