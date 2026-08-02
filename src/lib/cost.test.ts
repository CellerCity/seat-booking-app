import { describe, expect, it } from "vitest";
import { CostError, planCabs, splitCost } from "./cost";

describe("splitCost", () => {
  it("divides evenly when the total divides cleanly", () => {
    const { perHead, shortfall } = splitCost(4500, 30);
    expect(perHead).toBe(150);
    expect(shortfall).toBe(0);
  });

  it("floors the share and reports the remainder as a shortfall", () => {
    // 4510 / 30 = 150.33 → each pays 150, coordinators absorb 10.
    const { perHead, shortfall } = splitCost(4510, 30);
    expect(perHead).toBe(150);
    expect(shortfall).toBe(10);
  });

  it("never rounds a share up, even when the remainder is nearly a whole rupee", () => {
    // 4529 / 30 = 150.966… A ceiling would charge 151 and overcollect ₹1.
    expect(splitCost(4529, 30).perHead).toBe(150);
  });

  it("charges a single rider the whole cost with nothing left over", () => {
    expect(splitCost(2400, 1)).toMatchObject({ perHead: 2400, shortfall: 0 });
  });

  it("handles a total smaller than the rider count", () => {
    // Degenerate but must not produce a fractional or negative share.
    expect(splitCost(20, 30)).toMatchObject({ perHead: 0, shortfall: 20 });
  });

  it("rejects zero riders rather than dividing by zero", () => {
    // Zero riders means boarding was never marked. Refusing surfaces the mistake.
    expect(() => splitCost(4500, 0)).toThrow(CostError);
    expect(() => splitCost(4500, 0)).toThrow(/mark boarding attendance first/);
  });

  it("rejects fractional money, so paise cannot enter the system", () => {
    expect(() => splitCost(4500.5, 30)).toThrow(CostError);
  });

  it("rejects fractional and negative inputs", () => {
    expect(() => splitCost(4500, 2.5)).toThrow(CostError);
    expect(() => splitCost(-100, 30)).toThrow(CostError);
    expect(() => splitCost(4500, -1)).toThrow(CostError);
  });

  /**
   * The load-bearing invariant. If this can ever fail, the app has taken money
   * from the group that it was not owed.
   */
  it("never overcharges: perHead * riders <= totalCost, across randomised inputs", () => {
    for (let i = 0; i < 20_000; i++) {
      const totalCost = Math.floor(Math.random() * 50_000);
      const riders = 1 + Math.floor(Math.random() * 60);
      const { perHead, shortfall } = splitCost(totalCost, riders);

      expect(perHead * riders).toBeLessThanOrEqual(totalCost);
      // And the gap is fully accounted for, never silently dropped.
      expect(perHead * riders + shortfall).toBe(totalCost);
      // Flooring can never leave a whole extra rupee per rider on the table.
      expect(shortfall).toBeLessThan(riders);
      expect(shortfall).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the shortfall negligible at realistic group sizes", () => {
    // ~45 riders is this group's ceiling, so the worst case is under ₹45.
    for (let riders = 1; riders <= 50; riders++) {
      for (const totalCost of [3000, 4500, 5231, 7777]) {
        expect(splitCost(totalCost, riders).shortfall).toBeLessThan(50);
      }
    }
  });
});

describe("planCabs", () => {
  it("reports seats free in the last cab", () => {
    // The number that decides whether one more person is free or expensive.
    expect(planCabs(22, 12)).toEqual({ cabsNeeded: 2, seatsFree: 2 });
    expect(planCabs(24, 12)).toEqual({ cabsNeeded: 2, seatsFree: 0 });
    expect(planCabs(25, 12)).toEqual({ cabsNeeded: 3, seatsFree: 11 });
  });

  it("needs no cabs for nobody", () => {
    expect(planCabs(0, 12)).toEqual({ cabsNeeded: 0, seatsFree: 0 });
  });

  it("rejects a nonsensical capacity", () => {
    expect(() => planCabs(10, 0)).toThrow(CostError);
  });
});
