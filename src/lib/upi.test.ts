import { describe, expect, it } from "vitest";
import { buildUpiLink, isValidVpa, normalizeVpa, qrModules, UpiError } from "./upi";

/**
 * The `pa=` in these links is where fifty people's money goes. Everything here
 * is about that one parameter surviving a round trip intact.
 */

describe("normalizeVpa", () => {
  it("accepts the handles people here actually use", () => {
    for (const vpa of [
      "rahul@ybl",
      "priya.nair@okaxis",
      "9876543210@paytm",
      "a_b-c.d@okhdfcbank",
      "someone@upi",
      "student2024@ibl",
    ]) {
      expect(normalizeVpa(vpa)).toBe(vpa);
    }
  });

  it("lower-cases, because a VPA is case-insensitive", () => {
    // Otherwise the same person's UPI ID can sit in the roster as two entries.
    expect(normalizeVpa("Rahul@YBL")).toBe("rahul@ybl");
  });

  it("trims what a paste brings with it", () => {
    expect(normalizeVpa("  rahul@ybl  ")).toBe("rahul@ybl");
  });

  it("says specifically what is wrong when the @ is missing", () => {
    // The commonest mistake is pasting a phone number or an account number.
    expect(() => normalizeVpa("9876543210")).toThrow(/no @/);
  });

  it("rejects what cannot be a UPI ID", () => {
    for (const bad of ["", "   ", "@ybl", "rahul@", "rahul@@ybl", "rahul ybl@x", "a@b"]) {
      expect(() => normalizeVpa(bad)).toThrow(UpiError);
    }
  });

  it("isValidVpa never throws", () => {
    expect(isValidVpa("rahul@ybl")).toBe(true);
    expect(isValidVpa("nonsense")).toBe(false);
  });
});

describe("buildUpiLink", () => {
  const base = { vpa: "rahul@ybl", payeeName: "Rahul", amountRupees: 150 };

  it("builds an intent link a UPI app will open", () => {
    const link = buildUpiLink(base);
    const url = new URL(link);

    expect(link.startsWith("upi://pay?")).toBe(true);
    expect(url.searchParams.get("pa")).toBe("rahul@ybl");
    expect(url.searchParams.get("pn")).toBe("Rahul");
    expect(url.searchParams.get("cu")).toBe("INR");
  });

  it("sends whole rupees as a two-decimal amount", () => {
    expect(new URL(buildUpiLink(base)).searchParams.get("am")).toBe("150.00");
  });

  it("normalizes the payee address rather than trusting what was stored", () => {
    const url = new URL(buildUpiLink({ ...base, vpa: " Rahul@YBL " }));
    expect(url.searchParams.get("pa")).toBe("rahul@ybl");
  });

  it("refuses an address it cannot vouch for", () => {
    expect(() => buildUpiLink({ ...base, vpa: "rahul" })).toThrow(UpiError);
  });

  it("refuses amounts that are not whole positive rupees", () => {
    expect(() => buildUpiLink({ ...base, amountRupees: 0 })).toThrow(UpiError);
    expect(() => buildUpiLink({ ...base, amountRupees: -150 })).toThrow(UpiError);
    expect(() => buildUpiLink({ ...base, amountRupees: 150.5 })).toThrow(UpiError);
  });

  it("refuses a nameless payee", () => {
    expect(() => buildUpiLink({ ...base, payeeName: "   " })).toThrow(UpiError);
  });

  it("escapes a space as %20, not +", () => {
    // URLSearchParams defaults to "+", which some UPI apps display literally.
    const link = buildUpiLink({ ...base, payeeName: "Rahul Menon" });
    expect(link).toContain("Rahul%20Menon");
    expect(link).not.toContain("+");
    expect(new URL(link).searchParams.get("pn")).toBe("Rahul Menon");
  });

  it("strips punctuation out of the note and caps its length", () => {
    // PSPs vary in what they accept in `tn`, and some reject the whole intent.
    const url = new URL(buildUpiLink({ ...base, note: "Cab — 12 Aug (trip #3)!" }));
    expect(url.searchParams.get("tn")).toBe("Cab 12 Aug trip 3");

    const long = new URL(buildUpiLink({ ...base, note: "x".repeat(80) }));
    expect(long.searchParams.get("tn")!.length).toBe(50);
  });

  it("omits the note entirely when nothing survives stripping", () => {
    const url = new URL(buildUpiLink({ ...base, note: "!!!" }));
    expect(url.searchParams.has("tn")).toBe(false);
  });
});

describe("qrModules", () => {
  it("encodes a link into a square grid", () => {
    const grid = qrModules(buildUpiLink({ vpa: "rahul@ybl", payeeName: "Rahul", amountRupees: 150 }));

    expect(grid.length).toBeGreaterThan(0);
    expect(grid.every((row) => row.length === grid.length)).toBe(true);
    expect(grid.some((row) => row.some(Boolean))).toBe(true);
  });

  it("puts a finder pattern in each of the three corners", () => {
    // Cheap proof the grid is a real QR rather than an arbitrary bitmap: the
    // 7x7 finder squares are fixed by the spec, so their centres are always dark
    // and the ring around them always light.
    const grid = qrModules("upi://pay?pa=rahul@ybl&pn=Rahul&am=150.00&cu=INR");
    const n = grid.length;

    for (const [r, c] of [
      [3, 3],
      [3, n - 4],
      [n - 4, 3],
    ]) {
      expect(grid[r][c]).toBe(true); // centre
      expect(grid[r - 2][c]).toBe(false); // the light ring
    }
  });

  it("gives different grids for different amounts", () => {
    const at150 = qrModules(buildUpiLink({ vpa: "rahul@ybl", payeeName: "R", amountRupees: 150 }));
    const at170 = qrModules(buildUpiLink({ vpa: "rahul@ybl", payeeName: "R", amountRupees: 170 }));
    expect(JSON.stringify(at150)).not.toBe(JSON.stringify(at170));
  });
});
