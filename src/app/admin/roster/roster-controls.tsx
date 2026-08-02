"use client";

import { useActionState, useState } from "react";
import {
  addMemberAction,
  approveMemberAction,
  archiveMemberAction,
  blockMemberAction,
  deleteMemberAction,
  demoteMemberAction,
  restoreMemberAction,
  promoteMemberAction,
  recordResponseAction,
  rejectMemberAction,
  unblockMemberAction,
  updateMemberAction,
  type ActionState,
} from "../actions";

/**
 * Retiring someone who has left, and the rarer case of erasing a bad entry.
 *
 * Archive is offered and delete is not, because archive is almost always the
 * right answer: a graduating senior's trips and payments are part of other
 * people's settled numbers. Delete only appears once someone is archived, and
 * the server refuses it for anyone with any history.
 */
export function ArchiveControl({
  userId,
  name,
  archived,
}: {
  userId: string;
  name: string;
  archived: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [archiveState, archive, archiving] = useActionState<ActionState, FormData>(
    archiveMemberAction,
    {},
  );
  const [restoreState, restore, restoring] = useActionState<ActionState, FormData>(
    restoreMemberAction,
    {},
  );
  const [deleteState, remove, removing] = useActionState<ActionState, FormData>(
    deleteMemberAction,
    {},
  );

  const error = archiveState.error ?? restoreState.error ?? deleteState.error;

  if (archived) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <form action={restore}>
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            disabled={restoring}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-slate-700"
          >
            {restoring ? "Restoring…" : "Back on roster"}
          </button>
        </form>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-700 dark:border-red-900 dark:text-red-400"
          >
            Delete
          </button>
        ) : (
          <form action={remove} className="flex items-center gap-2">
            <input type="hidden" name="userId" value={userId} />
            <span className="text-xs text-red-700 dark:text-red-400">
              Erase {name} permanently?
            </span>
            <button
              type="submit"
              disabled={removing}
              className="rounded-md bg-red-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {removing ? "Deleting…" : "Yes"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700"
            >
              No
            </button>
          </form>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700"
        >
          Archive
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <form action={archive} className="rounded-lg border border-slate-300 p-3 dark:border-slate-700">
      <input type="hidden" name="userId" value={userId} />
      <p className="text-xs">
        Archive <strong>{name}</strong>? They come off the roster and out of every
        count, and can no longer book. Their past trips and payments stay on the
        record.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={archiving}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {archiving ? "Archiving…" : "Archive"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700"
        >
          Never mind
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}

/**
 * Correcting a roster entry.
 *
 * Details get typed in a hurry, and until now a wrong affiliation or a
 * mistyped digit needed database access to fix. Deliberately limited to who
 * someone is — role, approval and blocking each have their own audited control.
 */
export function EditMemberForm({
  member,
}: {
  member: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    memberType: "regular" | "guest";
    affiliation: string | null;
    isCoordinator: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState<ActionState, FormData>(updateMemberAction, {});

  if (state.ok && open) setOpen(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700"
      >
        Edit
      </button>
    );
  }

  return (
    <form
      action={run}
      className="w-full rounded-lg border border-slate-300 p-3 dark:border-slate-700"
    >
      <input type="hidden" name="userId" value={member.id} />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="text-slate-600 dark:text-slate-400">Name</span>
          <input
            name="name"
            required
            defaultValue={member.name}
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="block text-xs">
          <span className="text-slate-600 dark:text-slate-400">Phone</span>
          <input
            name="phone"
            required
            defaultValue={member.phone}
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="block text-xs">
          <span className="text-slate-600 dark:text-slate-400">Affiliation</span>
          <input
            name="affiliation"
            defaultValue={member.affiliation ?? ""}
            placeholder="Department, year, or how they're with us"
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="block text-xs">
          <span className="text-slate-600 dark:text-slate-400">
            Email {member.isCoordinator && <span className="text-amber-600">(sign-in)</span>}
          </span>
          <input
            type="email"
            name="email"
            defaultValue={member.email ?? ""}
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="block text-xs">
          <span className="text-slate-600 dark:text-slate-400">Type</span>
          <select
            name="memberType"
            defaultValue={member.memberType}
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="regular">Regular</option>
            <option value="guest">Guest (intern or short visit)</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700"
        >
          Cancel
        </button>
      </div>
      {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

/**
 * Promote a member to coordinator, or step one back down.
 *
 * This is the handover control: without it the only way to add a coordinator is
 * a database edit, so the app outlives whoever set it up. Both directions
 * confirm first — they change who can see every phone number in the group, and
 * the roster is a long list of small buttons.
 *
 * The email is required because it *is* the sign-in. Coordinators are matched to
 * their row by the address Google returns, so the wrong address here produces an
 * account that authenticates fine and is told it is not a coordinator.
 */
export function RoleControls({
  userId,
  name,
  email,
  isCoordinator,
  isSelf,
}: {
  userId: string;
  name: string;
  email: string | null;
  isCoordinator: boolean;
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [promoteState, promote, promoting] = useActionState<ActionState, FormData>(
    promoteMemberAction,
    {},
  );
  const [demoteState, demote, demoting] = useActionState<ActionState, FormData>(
    demoteMemberAction,
    {},
  );

  const error = promoteState.error ?? demoteState.error;

  if (isSelf) {
    return <span className="text-xs text-slate-400">you</span>;
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700"
        >
          {isCoordinator ? "Remove coordinator" : "Make coordinator"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  if (isCoordinator) {
    return (
      <form action={demote} className="rounded-lg border border-slate-300 p-3 dark:border-slate-700">
        <input type="hidden" name="userId" value={userId} />
        <p className="text-xs">
          Remove coordinator access from <strong>{name}</strong>? They stay on the roster
          as a traveller and keep their booking history.
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            disabled={demoting}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {demoting ? "Removing…" : "Remove access"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700"
          >
            Never mind
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </form>
    );
  }

  return (
    <form action={promote} className="rounded-lg border border-slate-300 p-3 dark:border-slate-700">
      <input type="hidden" name="userId" value={userId} />
      <p className="text-xs">
        Make <strong>{name}</strong> a coordinator? They will see every phone number,
        the full roster and all counts.
      </p>
      <label className="mt-2 block text-xs">
        <span className="text-slate-600 dark:text-slate-400">
          Their sign-in email — must match the Google account they use
        </span>
        <input
          type="email"
          name="email"
          required
          defaultValue={email ?? ""}
          placeholder="name@gmail.com"
          className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
        />
      </label>
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={promoting}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {promoting ? "Promoting…" : "Make coordinator"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700"
        >
          Never mind
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}

export function ApprovalButtons({ userId }: { userId: string }) {
  const [approveState, approve, approving] = useActionState<ActionState, FormData>(
    approveMemberAction,
    {},
  );
  const [rejectState, reject, rejecting] = useActionState<ActionState, FormData>(
    rejectMemberAction,
    {},
  );

  return (
    <div className="flex items-center gap-2">
      <form action={approve}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={approving}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Approve
        </button>
      </form>
      <form action={reject}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={rejecting}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700"
        >
          Reject
        </button>
      </form>
      {(approveState.error ?? rejectState.error) && (
        <span className="text-sm text-red-600">
          {approveState.error ?? rejectState.error}
        </span>
      )}
    </div>
  );
}

/**
 * Blocking requires a written reason.
 *
 * An exclusion someone has to justify in one line is much harder to do
 * casually, and the reason is what makes the decision reviewable later.
 */
export function BlockControl({
  userId,
  name,
  blocked,
}: {
  userId: string;
  name: string;
  blocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [blockState, block, blocking] = useActionState<ActionState, FormData>(
    blockMemberAction,
    {},
  );
  const [, unblock, unblocking] = useActionState<ActionState, FormData>(
    unblockMemberAction,
    {},
  );

  if (blocked) {
    return (
      <form action={unblock}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={unblocking}
          className="text-sm text-slate-500 underline disabled:opacity-50"
        >
          {unblocking ? "…" : "Unblock"}
        </button>
      </form>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-slate-400 underline"
      >
        Block
      </button>
    );
  }

  return (
    <form action={block} className="w-full space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
      <input type="hidden" name="userId" value={userId} />
      <p className="text-sm">
        Block {name}? They lose access immediately. Any dues they owe stay on the
        ledger.
      </p>
      <input
        name="reason"
        required
        placeholder="Reason (required)"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={blocking}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {blocking ? "Blocking…" : "Block"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600"
        >
          Cancel
        </button>
      </div>
      {blockState.error && <p className="text-sm text-red-600">{blockState.error}</p>}
    </form>
  );
}

/** For the holdout who replies "count me in" in the group instead of tapping. */
export function RecordResponseToggle({
  tripId,
  userId,
  going,
}: {
  tripId: string;
  userId: string;
  going: boolean;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(
    recordResponseAction,
    {},
  );

  return (
    <form action={run}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="going" value={going ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
          going
            ? "border border-slate-300 dark:border-slate-700"
            : "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
        }`}
      >
        {pending ? "…" : going ? "Remove" : "Mark going"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

export function AddMemberForm() {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState<ActionState, FormData>(addMemberAction, {});

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
      >
        Add person
      </button>
    );
  }

  return (
    <form
      action={run}
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="name"
          required
          placeholder="Name"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
        <input
          name="phone"
          required
          inputMode="numeric"
          placeholder="Mobile number"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
        <select
          name="memberType"
          defaultValue="regular"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
        >
          <option value="regular">Regular</option>
          <option value="guest">Guest (intern / short visit)</option>
        </select>
        <input
          name="affiliation"
          placeholder="Affiliation (optional)"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm dark:border-slate-700"
        >
          Cancel
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
