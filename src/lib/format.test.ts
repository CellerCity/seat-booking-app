import { describe, expect, it } from "vitest";
import { formatDeadline, formatTime, formatTripDate } from "./format";

/**
 * These exist because of a real bug: the withdrawal warning told everyone the
 * count went to the contractor "tomorrow", which was true only for the regular
 * weekly run. A trip added by hand can have a deadline at any time, including
 * later the same day, so the wording has to follow the trip rather than the
 * habit.
 */

// 08:00 IST on Friday 7 August 2026.
const deadline = new Date("2026-08-07T02:30:00Z");

describe("formatDeadline", () => {
  it("gives just the time when the deadline is today in IST", () => {
    const sameDayMorning = new Date("2026-08-07T01:00:00Z"); // 06:30 IST, same day
    expect(formatDeadline(deadline, sameDayMorning)).toBe("8:00 am");
  });

  it("names the day when the deadline is not today", () => {
    const dayBefore = new Date("2026-08-06T03:30:00Z"); // Thu 09:00 IST
    expect(formatDeadline(deadline, dayBefore)).toBe("8:00 am on Friday");
  });

  it("uses the date once a weekday alone could mean either week", () => {
    const wayBefore = new Date("2026-07-28T03:30:00Z"); // 10 days earlier
    const text = formatDeadline(deadline, wayBefore);
    expect(text).toContain("Aug");
    expect(text).not.toContain("on Friday");
  });

  it("still resolves the day by IST, not the server's timezone", () => {
    // 23:00 UTC on the 6th is already 04:30 IST on the 7th — the same IST day
    // as the deadline, so no weekday should be added. A server running in UTC
    // would get this wrong.
    const lateUtc = new Date("2026-08-06T23:00:00Z");
    expect(formatDeadline(deadline, lateUtc)).toBe("8:00 am");
  });
});

describe("existing formatters still hold", () => {
  it("renders a departure time in 12-hour form", () => {
    expect(formatTime("07:30:00")).toBe("7:30 AM");
    expect(formatTime("12:15")).toBe("12:15 PM");
    expect(formatTime("00:05")).toBe("12:05 AM");
  });

  it("renders a trip date with its weekday", () => {
    expect(formatTripDate("2026-08-07")).toContain("Friday");
  });
});

describe("the year on a trip date", () => {
  const inAugust2026 = new Date("2026-08-02T06:00:00Z");

  it("is left off for a trip in the current year", () => {
    const text = formatTripDate("2026-08-07", inAugust2026);
    expect(text).toBe("Friday, 7 August");
    expect(text).not.toContain("2026");
  });

  it("is shown for a trip in another year", () => {
    // The case this exists for: booked in December, travelling in January.
    const inDecember = new Date("2026-12-30T06:00:00Z");
    expect(formatTripDate("2027-01-02", inDecember)).toBe("Saturday, 2 January 2027");
  });

  it("is shown for a past year too, which is what history will need", () => {
    expect(formatTripDate("2025-08-07", inAugust2026)).toContain("2025");
  });

  it("decides by the IST year, not the server's", () => {
    // 31 Dec 2026 19:00 UTC is already 1 Jan 2027 in IST. A trip on 2 Jan 2027
    // is therefore the *same* IST year as "now" and needs no year, even though
    // a UTC server would say otherwise.
    const newYearEveUtc = new Date("2026-12-31T19:00:00Z");
    expect(formatTripDate("2027-01-02", newYearEveUtc)).toBe("Saturday, 2 January");
  });
});
