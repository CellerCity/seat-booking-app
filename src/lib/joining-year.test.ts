import { describe, expect, it } from "vitest";
import { JoiningYearError, parseJoiningYear } from "./joining-year";

describe("parseJoiningYear", () => {
  it("accepts a four-digit year, however it is typed", () => {
    expect(parseJoiningYear("2024")).toBe(2024);
    expect(parseJoiningYear(" 2024 ")).toBe(2024);
    expect(parseJoiningYear(2024)).toBe(2024);
  });

  it("treats blank as 'not recorded', which is a normal state", () => {
    expect(parseJoiningYear("")).toBeNull();
    expect(parseJoiningYear("   ")).toBeNull();
    expect(parseJoiningYear(null)).toBeNull();
    expect(parseJoiningYear(undefined)).toBeNull();
  });

  it("refuses a two-digit year rather than storing the year 24", () => {
    // The whole point of the column is telling batches apart. A row silently
    // recorded as year 24 is worse than one with no year at all.
    expect(() => parseJoiningYear("24")).toThrow(JoiningYearError);
    expect(() => parseJoiningYear("'24")).toThrow(/four-digit/);
  });

  it("refuses anything that is not a plain year", () => {
    expect(() => parseJoiningYear("2024-25")).toThrow(/four-digit/);
    expect(() => parseJoiningYear("batch 2024")).toThrow(/four-digit/);
    expect(() => parseJoiningYear("2024.0")).toThrow(/four-digit/);
  });

  it("refuses years outside a plausible range", () => {
    const nextYear = new Date().getFullYear() + 1;
    expect(() => parseJoiningYear("1899")).toThrow(/between/);
    expect(() => parseJoiningYear(String(nextYear + 1))).toThrow(/between/);
    // Next year is allowed: an incoming batch gets added before it starts.
    expect(parseJoiningYear(String(nextYear))).toBe(nextYear);
  });
});
