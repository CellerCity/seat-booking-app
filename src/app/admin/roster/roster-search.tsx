"use client";

import {
  createContext,
  useContext,
  useDeferredValue,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { matchesSearch, type SearchablePerson } from "@/lib/people-search";

/**
 * Search over the roster, done in the browser.
 *
 * The whole roster — fifty people — is already on the page, so filtering it
 * costs a string comparison and happens at the speed of typing. A server round
 * trip per keystroke would be slower and would be one more way for the page to
 * fail on a patchy connection at a cab stand.
 *
 * The rows themselves stay Server Components: they are passed in as children
 * and this only decides which of them to render, so nothing about who may read
 * a phone number moves into the client bundle.
 */

type SearchState = {
  query: string;
  setQuery: (value: string) => void;
  /** Ids of everyone matching the current query. */
  matched: Set<string>;
  total: number;
};

const RosterSearchContext = createContext<SearchState | null>(null);

function useRosterSearch(): SearchState {
  const state = useContext(RosterSearchContext);
  if (!state) {
    throw new Error("Roster search components must sit inside <RosterSearch>");
  }
  return state;
}

export type SearchablePersonRow = SearchablePerson & { id: string };

/**
 * Renders the page container itself rather than sitting invisibly above it, so
 * the sections it wraps stay exactly where they were in the markup — the search
 * is a filter over the roster page, not a layer that reshapes it.
 */
export function RosterSearch({
  people,
  className,
  children,
}: {
  people: SearchablePersonRow[];
  className?: string;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  // Keystrokes stay responsive while the list re-filters behind them.
  const deferred = useDeferredValue(query);

  const matched = useMemo(
    () =>
      new Set(
        people.filter((person) => matchesSearch(person, deferred)).map((person) => person.id),
      ),
    [people, deferred],
  );

  const value = useMemo(
    () => ({ query: deferred, setQuery, matched, total: people.length }),
    [deferred, matched, people.length],
  );

  return (
    <RosterSearchContext.Provider value={value}>
      <div className={className}>{children}</div>
    </RosterSearchContext.Provider>
  );
}

/** The box itself. Lives wherever the page wants it, not next to the list. */
export function RosterSearchBox() {
  const { query, setQuery, matched, total } = useRosterSearch();
  const id = useId();
  const searching = query.trim() !== "";

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="sr-only">
        Search the roster by name or phone number
      </label>
      <div className="relative">
        <input
          id={id}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          placeholder="Search by name or number"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-16 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        {searching && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute inset-y-0 right-2 my-auto h-6 rounded px-2 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Clear
          </button>
        )}
      </div>
      <p aria-live="polite" className="min-h-4 text-xs text-slate-500">
        {searching &&
          (matched.size === 0
            ? "No one matches"
            : `Showing ${matched.size} of ${total}`)}
      </p>
    </div>
  );
}

/**
 * One person's row. Renders nothing when they are filtered out — hiding with
 * CSS would leave a `flex` utility fighting the `hidden` attribute, and an
 * unrendered row cannot be tabbed into by mistake.
 */
export function PersonRow({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const { matched } = useRosterSearch();
  if (!matched.has(id)) return null;
  return <li className={className}>{children}</li>;
}

/**
 * A whole section — blocked, archived, waiting for approval. Disappears while
 * searching if it holds nobody matching, so a search leaves only the answer and
 * not four empty headings.
 */
export function PersonSection({
  ids,
  className,
  children,
}: {
  ids: string[];
  className?: string;
  children: ReactNode;
}) {
  const { query, matched } = useRosterSearch();
  if (query.trim() !== "" && !ids.some((id) => matched.has(id))) return null;
  return <section className={className}>{children}</section>;
}

/** Shown only when a search excludes everybody, so the page is never blank. */
export function NoMatches() {
  const { query, matched } = useRosterSearch();
  if (query.trim() === "" || matched.size > 0) return null;

  return (
    <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
      Nobody on the roster matches <strong>{query}</strong>. Try fewer words, or
      part of their number.
    </p>
  );
}
