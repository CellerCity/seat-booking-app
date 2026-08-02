/**
 * Phone numbers are the primary identifier for travellers, so matching against
 * the roster has to survive how people actually type them: "9876543210",
 * "+91 98765 43210", "098765-43210", "91 9876543210".
 *
 * Everything is stored in E.164 (+919876543210) so a person cannot end up with
 * two records — and therefore two ledgers — by typing their number differently
 * one week to the next.
 */

export const DEFAULT_COUNTRY_CODE = "91"; // India

export class PhoneError extends Error {}

/**
 * @returns E.164, e.g. "+919876543210"
 * @throws PhoneError if the input cannot be a valid Indian mobile number
 */
export function normalizePhone(input: string): string {
  if (typeof input !== "string") {
    throw new PhoneError("Phone number is required");
  }

  // Strip everything that is not a digit or a leading +.
  let digits = input.trim().replace(/[\s()\-.]/g, "");
  const hadPlus = digits.startsWith("+");
  digits = digits.replace(/\D/g, "");

  if (digits.length === 0) {
    throw new PhoneError("Phone number is required");
  }

  // "09876543210" — the trunk prefix used when dialling domestically.
  if (!hadPlus && digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // "919876543210" or "+919876543210"
  if (digits.length === 12 && digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    digits = digits.slice(DEFAULT_COUNTRY_CODE.length);
  }

  // "00919876543210" — international prefix.
  if (digits.length === 14 && digits.startsWith(`00${DEFAULT_COUNTRY_CODE}`)) {
    digits = digits.slice(4);
  }

  if (digits.length !== 10) {
    throw new PhoneError("Enter a 10-digit mobile number");
  }

  // Indian mobile numbers start 6–9. Catches transposed or mistyped entries
  // early, rather than creating a ghost roster entry nobody can match later.
  if (!/^[6-9]/.test(digits)) {
    throw new PhoneError("That doesn't look like a mobile number");
  }

  return `+${DEFAULT_COUNTRY_CODE}${digits}`;
}

/** True if the input is a usable number. Never throws. */
export function isValidPhone(input: string): boolean {
  try {
    normalizePhone(input);
    return true;
  } catch {
    return false;
  }
}

/** "+919876543210" → "98765 43210", for display in the coordinator roster. */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const local = digits.length === 12 ? digits.slice(2) : digits;
  if (local.length !== 10) return e164;
  return `${local.slice(0, 5)} ${local.slice(5)}`;
}
