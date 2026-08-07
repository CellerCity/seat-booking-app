/**
 * The batch year on a roster entry. Pure — no database, no `server-only`.
 *
 * It lives apart from members.ts precisely so `scripts/seed.ts` can use it:
 * that module is marked `server-only` and throws the moment a plain Node script
 * imports it, and the CSV loader needs exactly the same rules as the roster
 * form. Two copies of "what counts as a year" would drift.
 */

export class JoiningYearError extends Error {}

/**
 * Blank is always allowed — most of the roster arrives from a CSV that will not
 * have it, and a required field here would mean guessing, which is worse than
 * leaving it empty.
 *
 * What is refused is anything that is not a four-digit year. "24" quietly
 * stored as the year 24 is exactly the confusion this column exists to remove.
 */
export function parseJoiningYear(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (raw === "") return null;

  const latest = new Date().getFullYear() + 1;

  if (!/^\d{4}$/.test(raw)) {
    throw new JoiningYearError("Year of joining should be a four-digit year, like 2024");
  }

  const year = Number(raw);
  if (year < 1950 || year > latest) {
    throw new JoiningYearError(`Year of joining should be between 1950 and ${latest}`);
  }
  return year;
}
