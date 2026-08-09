/**
 * A person's name with the year they joined beside it.
 *
 * Fifty people drawn from a handful of batches produce repeated names
 * constantly, and every coordinator screen asks for an action on one specific
 * person — mark them paid, accept them late, block them, archive them. The year
 * is what makes "which one is this?" answerable in place, so it travels with the
 * name everywhere rather than living in one detail line on the roster.
 *
 * Nothing is shown for anyone whose year was never recorded. That is a normal
 * state — most of the roster arrived from a CSV that predates the column — and
 * a dash or an "unknown" on half the rows would be noise standing in for
 * information.
 *
 * Renders a single element on purpose: several of the call sites are flex rows,
 * where a fragment's two children would be laid out as two separate items and
 * the year would drift to the far side of the row.
 */
export function PersonName({
  name,
  joiningYear,
  className,
}: {
  name: string;
  joiningYear?: number | null;
  className?: string;
}) {
  return (
    <span className={className}>
      {name}
      {joiningYear != null && (
        <span
          title={`Joined ${joiningYear}`}
          className="ml-1.5 text-xs font-normal tabular-nums text-slate-500 dark:text-slate-400"
        >
          {joiningYear}
        </span>
      )}
    </span>
  );
}
