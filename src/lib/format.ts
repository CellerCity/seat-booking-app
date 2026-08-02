/**
 * Display helpers. Everything is stored in UTC and rendered in IST — the group
 * is entirely in one timezone, so a traveller should never see a UTC timestamp.
 */

export const IST = "Asia/Kolkata";

export function formatTripDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : date;
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: IST,
  }).format(d);
}

/** "07:30:00" → "7:30 AM" */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  }).format(date);
}

/** Exact clock time — what a coordinator needs when judging who was late. */
export function formatClockTime(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  }).format(date);
}

/** The IST calendar day of an instant, e.g. "2026-08-07", for comparing two. */
function istDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * A respond-by time that says which day it means.
 *
 * "by 8:00 am" is only unambiguous if the deadline is today. The regular run's
 * deadline is the morning of the trip, but a trip added by hand can have one
 * any time at all, so the day is included whenever it isn't today — and the
 * date once it is far enough out that a weekday alone could mean either week.
 */
export function formatDeadline(target: Date, now: Date = new Date()): string {
  const time = formatClockTime(target);
  if (istDay(target) === istDay(now)) return time;

  const sixDays = 6 * 24 * 60 * 60 * 1000;
  if (target.getTime() - now.getTime() > sixDays) return formatDateTime(target);

  const weekday = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    timeZone: IST,
  }).format(target);
  return `${time} on ${weekday}`;
}

/** "in 6h 12m", "2h ago". Returns null when the difference is not worth showing. */
export function relativeTime(target: Date, now: Date = new Date()): string {
  const diffMs = target.getTime() - now.getTime();
  const future = diffMs > 0;
  const mins = Math.floor(Math.abs(diffMs) / 60_000);

  if (mins < 1) return future ? "in a moment" : "just now";

  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;

  let text: string;
  if (days > 0) text = `${days}d ${hours}h`;
  else if (hours > 0) text = `${hours}h ${minutes}m`;
  else text = `${minutes}m`;

  return future ? `in ${text}` : `${text} ago`;
}
