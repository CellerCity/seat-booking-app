"use client";

import { useActionState, useState } from "react";
import {
  addMemberAction,
  approveMemberAction,
  blockMemberAction,
  recordResponseAction,
  rejectMemberAction,
  unblockMemberAction,
  type ActionState,
} from "../actions";

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
