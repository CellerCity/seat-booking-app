import { signOutAction } from "./actions";

/**
 * The way out of a wrong number.
 *
 * This existed as a Server Action for a long time with nothing rendering it,
 * which meant someone who mistyped a digit was stuck as whoever owned that
 * number until they cleared their site data. A year-long cookie needs a visible
 * exit or it isn't a convenience, it's a trap.
 *
 * A plain form posting a Server Action, so it works with no JavaScript at all —
 * this is the control someone reaches for when the page is already behaving
 * strangely.
 */
export function SignOutLink({
  label,
  className = "text-sm text-slate-500",
}: {
  label: string;
  className?: string;
}) {
  return (
    <form action={signOutAction}>
      <button type="submit" className={`shrink-0 underline underline-offset-2 ${className}`}>
        {label}
      </button>
    </form>
  );
}
