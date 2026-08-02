import { describe, expect, it } from "vitest";
import { formatPhone, isValidPhone, normalizePhone, PhoneError } from "./phone";

describe("normalizePhone", () => {
  it("normalises every way a person might type the same number", () => {
    // All of these must collapse to one identity, or the same person ends up
    // with two records and two ledgers.
    const variants = [
      "9876543210",
      "+919876543210",
      "919876543210",
      "09876543210",
      "+91 98765 43210",
      "98765-43210",
      "  9876543210  ",
      "(98765) 43210",
      "0091 9876543210",
    ];
    for (const v of variants) {
      expect(normalizePhone(v), `failed on "${v}"`).toBe("+919876543210");
    }
  });

  it("rejects numbers that are the wrong length", () => {
    expect(() => normalizePhone("98765")).toThrow(PhoneError);
    expect(() => normalizePhone("98765432101234")).toThrow(PhoneError);
  });

  it("rejects landline-style numbers that cannot receive a link", () => {
    expect(() => normalizePhone("1234567890")).toThrow(/mobile number/);
    expect(() => normalizePhone("5876543210")).toThrow(/mobile number/);
  });

  it("rejects empty input", () => {
    expect(() => normalizePhone("")).toThrow(PhoneError);
    expect(() => normalizePhone("   ")).toThrow(PhoneError);
  });

  it("accepts each valid Indian mobile prefix", () => {
    for (const prefix of ["6", "7", "8", "9"]) {
      expect(normalizePhone(`${prefix}876543210`)).toBe(`+91${prefix}876543210`);
    }
  });

  it("is idempotent, so re-saving a stored number cannot corrupt it", () => {
    const once = normalizePhone("9876543210");
    expect(normalizePhone(once)).toBe(once);
  });
});

describe("isValidPhone", () => {
  it("reports validity without throwing", () => {
    expect(isValidPhone("9876543210")).toBe(true);
    expect(isValidPhone("nonsense")).toBe(false);
  });
});

describe("formatPhone", () => {
  it("formats for display in the roster", () => {
    expect(formatPhone("+919876543210")).toBe("98765 43210");
  });

  it("returns unrecognised input unchanged rather than mangling it", () => {
    expect(formatPhone("+1555")).toBe("+1555");
  });
});
