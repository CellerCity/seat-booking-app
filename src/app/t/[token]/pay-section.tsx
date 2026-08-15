import type { PayView } from "@/lib/pay";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { ClaimPaidButton, RetractClaimButton } from "./pay-controls";
import { SignOutLink } from "./sign-out";
import { UpiQr } from "./upi-qr";

type Whoami = { name: string; joiningYear: number | null; phone: string };

/**
 * Settling up, from the traveller's side.
 *
 * Two confirmations sit in here, and both were asked for. Before the money
 * moves, the screen says who it thinks you are and who it is paying — a wrong
 * number typed weeks ago otherwise surfaces for the first time as somebody
 * else's fare leaving your account. And nothing is payable at all until a
 * coordinator has both set the fare and been named to collect it, so there is
 * never an amount on this page that somebody guessed.
 */
export function PaySection({
  token,
  view,
  whoami,
}: {
  token: string;
  view: PayView;
  whoami: Whoami;
}) {
  if (view.state === "hidden") return null;

  if (view.state === "awaiting_amount") {
    return (
      <Card>
        <h2 className="text-base font-semibold">Settling up</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          The coordinators haven&apos;t worked out this week&apos;s fare yet.
          There&apos;ll be an amount here once they do — nothing to send before then.
        </p>
      </Card>
    );
  }

  if (view.state === "awaiting_collector") {
    return (
      <Card>
        <h2 className="text-base font-semibold">Settling up</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Your share is <strong className="tabular-nums">₹{view.amount}</strong>, but
          the coordinators haven&apos;t said who&apos;s collecting yet. Hold on
          until they do rather than guessing where to send it.
        </p>
      </Card>
    );
  }

  if (view.state === "settled") {
    return (
      <Card tone="done">
        <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-100">
          {view.waived ? "Nothing to pay" : "Settled"}
        </h2>
        <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
          {view.waived ? (
            <>A coordinator has written this one off. Nothing owing.</>
          ) : (
            <>
              <span className="tabular-nums">₹{view.amount}</span>
              {view.paidByName ? <> · paid by {view.paidByName}</> : null}
              {view.at ? <> · confirmed {formatDateTime(view.at)}</> : null}
            </>
          )}
        </p>
      </Card>
    );
  }

  if (view.state === "claimed") {
    const corrected = view.amount !== view.claimedAmount;

    return (
      <Card tone="pending">
        <h2 className="text-base font-semibold text-amber-900 dark:text-amber-100">
          Waiting to be confirmed
        </h2>
        <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
          You told us you sent{" "}
          <strong className="tabular-nums">₹{view.claimedAmount}</strong> on{" "}
          {formatDateTime(view.claimedAt)}. A coordinator will tick it off once
          they see it in their account.
        </p>

        {corrected && (
          // The fare moved after they paid. Better they hear it here than be
          // chased for a difference they had no way of knowing about.
          <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
            The fare has since been corrected to{" "}
            <strong className="tabular-nums">₹{view.amount}</strong>. A coordinator
            will sort out the difference with you.
          </p>
        )}

        <div className="mt-3">
          <RetractClaimButton token={token} />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="text-center">
        <h2 className="text-base font-semibold">Your share</h2>
        <p className="mt-1 text-4xl font-bold tabular-nums">₹{view.amount}</p>
        <p className="mt-1 text-sm text-slate-500">
          {view.riders === 1
            ? `₹${view.perPerson} each`
            : `${view.riders} seats × ₹${view.perPerson} — yours plus ${
                view.riders - 1 === 1 ? "a friend" : `${view.riders - 1} friends`
              }`}
        </p>
      </div>

      <PayingAs whoami={whoami} />

      <div className="mt-4 rounded-lg bg-slate-100 px-4 py-3 dark:bg-slate-900">
        <p className="text-xs uppercase tracking-wide text-slate-500">Paying</p>
        <p className="mt-0.5 font-semibold">{view.payee.name}</p>
        <p className="text-sm break-all text-slate-600 dark:text-slate-400">
          {view.payee.vpa}
        </p>
      </div>

      <a
        href={view.link}
        className="mt-4 block w-full rounded-xl bg-slate-900 px-4 py-4 text-center text-lg font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
      >
        Pay ₹{view.amount} by UPI
      </a>

      {/* On a laptop the link opens nothing, and on a phone whose default UPI
          app is misconfigured it opens the wrong thing. The QR is the same
          payment, scannable from any handset. */}
      <div className="mt-4 flex flex-col items-center">
        <p className="text-xs text-slate-500">or scan with any UPI app</p>
        <div className="mt-2 rounded-xl bg-white p-2">
          <UpiQr text={view.link} />
        </div>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
        <ClaimPaidButton token={token} amount={view.amount} />
      </div>
    </Card>
  );
}

/**
 * Who the app thinks is paying.
 *
 * The whole reason the identify step now asks twice, restated at the one moment
 * it costs real money to have got wrong.
 */
function PayingAs({ whoami }: { whoami: Whoami }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-800">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">Paying as</p>
        <p className="mt-0.5 truncate font-semibold">
          {whoami.name}
          {whoami.joiningYear != null && (
            <span className="ml-1.5 text-xs font-normal tabular-nums text-slate-500">
              {whoami.joiningYear}
            </span>
          )}
        </p>
        <p className="text-sm tabular-nums text-slate-600 dark:text-slate-400">
          {formatPhone(whoami.phone)}
        </p>
      </div>
      <SignOutLink label="Not you?" />
    </div>
  );
}

function Card({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "done" | "pending";
}) {
  const styles = {
    plain: "border-slate-200 dark:border-slate-800",
    done: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950",
    pending: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
  }[tone];

  return <section className={`rounded-xl border px-4 py-4 ${styles}`}>{children}</section>;
}
