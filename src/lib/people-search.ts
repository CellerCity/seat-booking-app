/**
 * Finding one person in a list of fifty.
 *
 * A coordinator working the roster has one of two things to hand: a
 * half-remembered name, or a number showing on their phone. Matching only on
 * name loses the second case entirely — and it is the more common one, because
 * the number is what a late-comer messages from and what WhatsApp shows when
 * the name is saved as something else.
 *
 * Deliberately pure and deliberately not `server-only`: the same rules run in
 * the browser to filter a list already on the page, so a search costs nothing
 * and works at the speed of typing.
 */

export type SearchablePerson = {
  name: string;
  /** E.164, as stored. Matching strips the formatting either side. */
  phone: string;
  affiliation?: string | null;
  joiningYear?: number | null;
};

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Every word typed has to match something, so each extra word narrows rather
 * than widens — "aman 98" is how you tell two Amans apart.
 *
 * A word matches on name or affiliation as plain text, and on the phone number
 * as a run of digits anywhere in it. Numbers are compared digits-only on both
 * sides, so "+91 98765", "98765 43210" and "9876543210" all find the same
 * person regardless of how the roster stores them or how the coordinator types.
 */
export function matchesSearch(person: SearchablePerson, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true; // no query is not a filter

  const name = person.name.toLowerCase();
  const affiliation = (person.affiliation ?? "").toLowerCase();
  const year = person.joiningYear === null || person.joiningYear === undefined
    ? ""
    : String(person.joiningYear);
  const phone = digitsOf(person.phone);

  return tokens.every((token) => {
    if (name.includes(token) || affiliation.includes(token)) return true;

    let digits = digitsOf(token);
    if (digits === "") return false;
    // "09876543210" is how the number gets dialled domestically, and how it
    // therefore gets pasted. The stored form has no trunk prefix.
    if (digits.length > 1) digits = digits.replace(/^0+/, "");

    // Only a whole year matches a batch. A prefix would make "20" pick out
    // everyone who joined this century, which is not a filter.
    if (digits === year) return true;

    return digits !== "" && phone.includes(digits);
  });
}

/** The same rules over a list, keeping the order it came in. */
export function filterPeople<T extends SearchablePerson>(people: T[], query: string): T[] {
  if (query.trim() === "") return people;
  return people.filter((person) => matchesSearch(person, query));
}
