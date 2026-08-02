/**
 * Trip cost splitting. Pure — no I/O, no dates, no database.
 *
 * Cabs are hired for the day, round trip, at one price, so a trip has a single
 * total cost. Everyone who actually boarded pays an equal share of it.
 *
 * The share is FLOORED to whole rupees. The group is never overcharged by so
 * much as one rupee; the small remainder is absorbed by the coordinators and
 * reported rather than hidden. See SPEC.md §7.
 */

export type CostSplit = {
  /** Rupees each rider owes. Floored. */
  perHead: number;
  /** Rupees the coordinators absorb: total - (perHead * riders). Always < riders. */
  shortfall: number;
  totalCost: number;
  riders: number;
};

export class CostError extends Error {}

/**
 * @param totalCost Sum of every cab's actual cost, in whole rupees.
 * @param riders    Number of people who actually boarded.
 */
export function splitCost(totalCost: number, riders: number): CostSplit {
  if (!Number.isInteger(totalCost)) {
    throw new CostError(`Total cost must be whole rupees, got ${totalCost}`);
  }
  if (!Number.isInteger(riders)) {
    throw new CostError(`Rider count must be a whole number, got ${riders}`);
  }
  if (totalCost < 0) {
    throw new CostError(`Total cost cannot be negative, got ${totalCost}`);
  }
  if (riders < 0) {
    throw new CostError(`Rider count cannot be negative, got ${riders}`);
  }
  // Zero riders on a finished trip means boarding was never marked, not that
  // nobody travelled. Refusing here is what surfaces the mistake.
  if (riders === 0) {
    throw new CostError(
      "Cannot split a trip with zero riders — mark boarding attendance first",
    );
  }

  const perHead = Math.floor(totalCost / riders);
  const shortfall = totalCost - perHead * riders;

  return { perHead, shortfall, totalCost, riders };
}

/**
 * Cabs needed for a headcount, and how many seats are left empty in the last one.
 *
 * The empty-seat figure is what makes a late request easy to judge: if seats
 * remain, one more person costs the group nothing; if the last cab is full,
 * one more person means hiring another whole cab.
 */
export function planCabs(
  headcount: number,
  capacity: number,
): { cabsNeeded: number; seatsFree: number } {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new CostError(`Cab capacity must be a positive whole number, got ${capacity}`);
  }
  if (headcount <= 0) return { cabsNeeded: 0, seatsFree: 0 };

  const cabsNeeded = Math.ceil(headcount / capacity);
  return { cabsNeeded, seatsFree: cabsNeeded * capacity - headcount };
}

/** Whole rupees, as shown to travellers and coordinators. */
export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}
