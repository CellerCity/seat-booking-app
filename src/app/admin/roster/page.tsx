import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { requireCoordinatorPage } from "@/lib/auth/coordinator";
import { db } from "@/lib/db";
import { responses, users } from "@/lib/db/schema";
import { getCurrentTrip } from "@/lib/trips";
import { getArchivedMembers, getPendingMembers } from "@/lib/members";
import { formatClockTime, formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { PersonName } from "../person-name";
import {
  AddMemberForm,
  ApprovalButtons,
  ArchiveControl,
  BlockControl,
  EditMemberForm,
  RecordResponseToggle,
  RoleControls,
} from "./roster-controls";
import {
  NoMatches,
  PersonRow,
  PersonSection,
  RosterSearch,
  RosterSearchBox,
  type SearchablePersonRow,
} from "./roster-search";

export const dynamic = "force-dynamic";

/**
 * Roster, approval queue and blocklist.
 *
 * This page holds every phone number in the group, so it sits behind
 * requireCoordinator() and is never reachable from a traveller link.
 */
export default async function RosterPage() {
  const me = await requireCoordinatorPage();

  const [trip, pending, archived] = await Promise.all([
    getCurrentTrip(),
    getPendingMembers(),
    getArchivedMembers(),
  ]);

  const roster = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      role: users.role,
      memberType: users.memberType,
      affiliation: users.affiliation,
      joiningYear: users.joiningYear,
      approvalStatus: users.approvalStatus,
      blockedReason: users.blockedReason,
      going: responses.going,
      guests: responses.guests,
      firstRespondedAt: responses.firstRespondedAt,
      source: responses.source,
    })
    .from(users)
    // Join only this trip's responses. Without the trip predicate the join
    // would fan out across every past trip and show stale answers as current.
    .leftJoin(
      responses,
      and(
        eq(responses.userId, users.id),
        trip ? eq(responses.tripId, trip.id) : sql`false`,
      ),
    )
    .where(eq(users.isActive, true))
    .orderBy(users.name);

  const active = roster.filter((r) => r.approvalStatus === "approved");
  const blocked = roster.filter((r) => r.approvalStatus === "blocked");

  // One search box over every list on the page, including the archived and the
  // not-yet-approved. Searching for someone and being told they aren't here,
  // when in fact they are three sections further down, is worse than no search.
  const searchable: SearchablePersonRow[] = [
    ...roster.map((p) => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      affiliation: p.affiliation,
      joiningYear: p.joiningYear,
    })),
    ...pending.map((p) => ({ id: p.id, name: p.name, phone: p.phone })),
    ...archived.map((p) => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      affiliation: p.affiliation,
      joiningYear: p.joiningYear,
    })),
  ];

  return (
    <RosterSearch people={searchable} className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Roster</h1>
          <p className="text-sm text-slate-500">
            {active.length} approved
            {blocked.length > 0 && ` · ${blocked.length} blocked`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AddMemberForm />
          <Link href="/admin" className="text-sm text-slate-500 underline">
            ← Dashboard
          </Link>
        </div>
      </header>

      <RosterSearchBox />

      {pending.length > 0 && (
        <PersonSection
          ids={pending.map((p) => p.id)}
          className="rounded-xl border border-blue-300 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950"
        >
          <h2 className="font-semibold text-blue-900 dark:text-blue-200">
            Waiting for approval ({pending.length})
          </h2>
          <p className="mt-1 text-sm text-blue-800 dark:text-blue-300">
            These people signed up through the link. They don&apos;t count toward the
            headcount until approved — approving is one-time, they&apos;re never asked
            again.
          </p>
          <ul className="mt-3 space-y-2">
            {pending.map((p) => (
              <PersonRow
                key={p.id}
                id={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 dark:bg-slate-900"
              >
                <div>
                  <PersonName name={p.name} joiningYear={p.joiningYear} className="font-medium" />
                  <span className="ml-2 text-sm text-slate-500">
                    {formatPhone(p.phone)}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">
                    signed up {formatDateTime(p.createdAt)}
                    {p.hasBooked && " · already booked"}
                  </span>
                </div>
                <ApprovalButtons userId={p.id} />
              </PersonRow>
            ))}
          </ul>
        </PersonSection>
      )}

      <PersonSection
        ids={active.map((p) => p.id)}
        className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      >
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {active.map((p) => (
            <PersonRow
              key={p.id}
              id={p.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <PersonName name={p.name} joiningYear={p.joiningYear} className="font-medium" />
                {p.role === "coordinator" && (
                  <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                    coordinator
                  </span>
                )}
                {p.memberType === "guest" && (
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    guest
                  </span>
                )}
                {/* No joining year here — it sits against the name now, on
                    every screen rather than only this one. */}
                <div className="text-sm text-slate-500">
                  {formatPhone(p.phone)}
                  {p.affiliation && ` · ${p.affiliation}`}
                  {p.role === "coordinator" && p.email && ` · ${p.email}`}
                </div>
                {p.going && p.firstRespondedAt && (
                  <div className="text-xs text-emerald-700 dark:text-emerald-400">
                    going
                    {p.guests ? ` + ${p.guests}` : ""} · responded{" "}
                    {formatClockTime(p.firstRespondedAt)}
                    {p.source === "coordinator" && " (entered by coordinator)"}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {trip && (
                  <RecordResponseToggle
                    tripId={trip.id}
                    userId={p.id}
                    going={p.going ?? false}
                    guests={p.guests ?? 0}
                  />
                )}
                <EditMemberForm
                  member={{
                    id: p.id,
                    name: p.name,
                    phone: p.phone,
                    email: p.email,
                    memberType: p.memberType,
                    affiliation: p.affiliation,
                    joiningYear: p.joiningYear,
                    isCoordinator: p.role === "coordinator",
                  }}
                />
                <RoleControls
                  userId={p.id}
                  name={p.name}
                  joiningYear={p.joiningYear}
                  email={p.email}
                  isCoordinator={p.role === "coordinator"}
                  isSelf={p.id === me.id}
                />
                {p.id !== me.id && (
                  <ArchiveControl
                    userId={p.id}
                    name={p.name}
                    joiningYear={p.joiningYear}
                    archived={false}
                  />
                )}
                <BlockControl
                  userId={p.id}
                  name={p.name}
                  joiningYear={p.joiningYear}
                  blocked={false}
                />
              </div>
            </PersonRow>
          ))}
        </ul>
      </PersonSection>

      {blocked.length > 0 && (
        <PersonSection
          ids={blocked.map((p) => p.id)}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="font-semibold">Blocked</h2>
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {blocked.map((p) => (
              <PersonRow
                key={p.id}
                id={p.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div>
                  <PersonName name={p.name} joiningYear={p.joiningYear} className="font-medium" />
                  <div className="text-sm text-slate-500">{p.blockedReason}</div>
                </div>
                <BlockControl userId={p.id} name={p.name} joiningYear={p.joiningYear} blocked />
              </PersonRow>
            ))}
          </ul>
        </PersonSection>
      )}

      {archived.length > 0 && (
        <PersonSection
          ids={archived.map((p) => p.id)}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="font-semibold">Archived</h2>
          <p className="mt-1 text-sm text-slate-500">
            People who have left. Off every count and unable to book, but their past
            trips and payments are still on the record.
          </p>
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {archived.map((p) => (
              <PersonRow
                key={p.id}
                id={p.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <div>
                  <PersonName name={p.name} joiningYear={p.joiningYear} className="font-medium" />
                  <div className="text-sm text-slate-500">
                    {formatPhone(p.phone)}
                    {p.affiliation && ` · ${p.affiliation}`}
                  </div>
                </div>
                <ArchiveControl
                  userId={p.id}
                  name={p.name}
                  joiningYear={p.joiningYear}
                  archived
                />
              </PersonRow>
            ))}
          </ul>
        </PersonSection>
      )}

      <NoMatches />
    </RosterSearch>
  );
}
