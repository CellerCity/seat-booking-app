import qrcode from "qrcode-generator";

/**
 * UPI payment handoff.
 *
 * No money moves through this app and no payment credentials are stored. What
 * is built here is a *handoff*: a link that opens the traveller's own UPI app
 * with the payee, the amount and a reference already filled in, and the same
 * string as a QR for whoever is reading this on a laptop.
 *
 * That handoff is one-way. A `upi://` intent gives no callback — the page never
 * learns whether the payment succeeded — which is precisely why the traveller's
 * "I've paid" is recorded as a *claim* a coordinator verifies, and never as a
 * settled due. See `claimPayment` in lib/pay.ts.
 *
 * Intent and QR are also the flows that survive: NPCI is retiring UPI Collect
 * (paying by typing a VPA into a request) for merchant transactions from
 * 28 February 2026, leaving Intent and QR as the standard.
 *
 * Deliberately not `server-only` and free of I/O, so the link builder can be
 * unit-tested directly — a wrong `pa=` here sends fifty people's money to a
 * stranger, so it is the one thing in the payment path that gets real test
 * pressure.
 */

export class UpiError extends Error {}

/**
 * A UPI address: `name@psp`.
 *
 * Lower-cased because VPAs are case-insensitive, so `Rahul@ybl` and `rahul@ybl`
 * are one address and must not be able to sit in the roster as two.
 */
export function normalizeVpa(input: string): string {
  if (typeof input !== "string") throw new UpiError("Enter a UPI ID");

  const vpa = input.trim().toLowerCase();
  if (vpa === "") throw new UpiError("Enter a UPI ID");

  if (!vpa.includes("@")) {
    throw new UpiError("A UPI ID looks like name@bank — that one has no @");
  }

  // Permissive on the account part and strict on the handle: PSP handles are a
  // short known set (@ybl, @okaxis, @paytm, @upi), while the part before the @
  // varies far more than any published rule suggests — a phone number, an email
  // local part, a bank's own scheme. Rejecting a real UPI ID is worse here than
  // accepting an odd-looking one, because the payment simply fails either way
  // but only one of them fails with the coordinator blaming the app.
  if (!/^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$/.test(vpa)) {
    throw new UpiError("That doesn't look like a UPI ID");
  }

  return vpa;
}

/** True if the input is a usable UPI ID. Never throws. */
export function isValidVpa(input: string): boolean {
  try {
    normalizeVpa(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * The note shown inside the payment app.
 *
 * Stripped to letters, digits and spaces: PSPs vary in what they accept in `tn`
 * and some reject the whole intent over a punctuation mark, which would look to
 * a traveller like the app is broken rather than like a note is malformed.
 */
function safeNote(note: string): string {
  return note
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
}

export type UpiPayment = {
  vpa: string;
  payeeName: string;
  /** Whole rupees. The app deals in no smaller unit. */
  amountRupees: number;
  note?: string;
};

/**
 * `upi://pay?...` — opens GPay, PhonePe, Paytm or any UPI app with everything
 * prefilled, and encodes identically into the QR.
 */
export function buildUpiLink({ vpa, payeeName, amountRupees, note }: UpiPayment): string {
  const pa = normalizeVpa(vpa);

  if (!Number.isInteger(amountRupees)) throw new UpiError("Amount must be whole rupees");
  if (amountRupees <= 0) throw new UpiError("There is nothing to pay");

  const pn = payeeName.trim().slice(0, 50);
  if (pn === "") throw new UpiError("The payee needs a name");

  // Ordered pa, pn, am, cu, tn — the order NPCI's own examples use. Some older
  // PSP apps parse positionally rather than by key, and none of them mind it
  // being right.
  const params = new URLSearchParams({
    pa,
    pn,
    am: amountRupees.toFixed(2),
    cu: "INR",
  });
  if (note) {
    const tn = safeNote(note);
    if (tn) params.set("tn", tn);
  }

  // URLSearchParams encodes a space as "+", which several UPI apps show
  // literally in the payee name. %20 is understood everywhere.
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}

/**
 * The QR as a grid of dark/light modules, ready to draw.
 *
 * Returned as data rather than as markup so the component decides the colours —
 * a QR baked to black renders as an unscannable smudge in dark mode.
 */
export function qrModules(text: string): boolean[][] {
  // Type 0 picks the smallest version that fits; M tolerates ~15% damage, which
  // is the usual choice for a screen and keeps the modules large enough to scan
  // off someone else's phone held at arm's length.
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
  );
}
