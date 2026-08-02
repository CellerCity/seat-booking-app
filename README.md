# Seat Booking App

Weekly cab seat booking for a college group of ~40–50 people. Replaces a pair of
WhatsApp polls with a live, timestamped count before the contractor call and a
persistent ledger of who travelled and who paid.

- **Design:** [`SPEC.md`](./SPEC.md)
- **Status:** Milestone 1 built (the pre-event poll). Milestone 2 (boarding,
  costs, dues) not started.

## What works today

| | |
|---|---|
| Traveller | Identify by phone once, then a single **Going / Not going** tap |
| Coordinator | Live count, seats free in the last cab, **Lock count**, late additions, post-lock withdrawals, response feed with exact times |
| Membership | One-time approval queue for strangers who arrive via the link; blocklist with required reason |
| Automation | Weekly cron creates the trip and opens the poll |

Not built yet: boarding attendance, cab costs, dues, payments, settlement.

## Setup

### 1. Supabase project

Create one at [supabase.com](https://supabase.com) (free tier is far beyond this
scale). A personal account is fine while testing against the example roster, but
the project holding **real** phone numbers must be **group-owned** — see
*Continuity* below. Loading the real roster in step 4 is the cut-off point.

Connection strings live behind the **Connect** button in the project's top bar,
not under Settings. Copy the *Transaction pooler* string (port 6543) into
`DATABASE_URL` and the *Direct connection* string (port 5432) into
`DIRECT_DATABASE_URL`. The direct host is IPv6-only on free projects — on a
network without IPv6, use the *Session pooler* string (same host, port 5432) for
`DIRECT_DATABASE_URL` instead.

From *Settings → API Keys*, copy the project URL, the anon (or publishable) key,
and the service role (or secret) key.

### 2. Environment

```bash
cp .env.example .env.local
```

Fill it in. Generate the two secrets with:

```bash
openssl rand -base64 32   # once for SESSION_SECRET, once for CRON_SECRET
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses all access control. It is server-side only
and must never be given a `NEXT_PUBLIC_` prefix.

### 3. Database

```bash
npm install
npm run db:migrate
```

### 4. Roster

```bash
cp data/roster.example.csv data/roster.csv
```

Fill in the real names and numbers, then:

```bash
npm run db:seed
```

`data/roster.csv` is gitignored — it holds ~50 people's phone numbers and must
never be committed.

Every coordinator row needs an `email`, because coordinators sign in by email
magic link. The seed script warns you if one is missing. Phone numbers are
normalised to E.164, so any of `9876543210`, `+91 98765 43210` or `098765-43210`
will match the same person later.

### 5. Run

```bash
npm run dev
```

- Coordinators: `/admin` (redirects to a magic-link sign-in)

  Supabase's built-in email service allows only a few messages an hour, which
  runs out quickly while testing — and testing on a phone needs that device's
  origin in *Authentication → URL Configuration → Redirect URLs* (with a `/**`
  suffix) or Supabase silently rewrites the link back to the Site URL. To skip
  both, print a link directly:

  ```bash
  npm run dev:login -- you@example.com http://192.168.1.5:3000
  ```

  Before launch, configure custom SMTP in Supabase so coordinator sign-in does
  not depend on the shared, rate-limited sender.

- Travellers: `/t/<link_token>` — the token is on the dashboard's *Copy for
  WhatsApp* button once a trip exists

To create the first trip without waiting for the cron:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/create-trip
```

## Commands

| | |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Unit + integration tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate migrations from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Browse the database |
| `npm run db:seed` | Load roster and cab types |
| `npm run dev:login -- <email> [origin]` | Print a coordinator sign-in link without sending email |

## Tests

36 tests, no external database needed — integration tests run a real Postgres
in-process via PGlite, applying the actual generated migrations.

The money math in `src/lib/cost.ts` carries the heaviest coverage, including a
20,000-case randomised check of the one invariant that must never break:

> `perHead × riders ≤ totalCost` — no code path may ever overcharge the group.

## Design decisions worth knowing

**Attendance is the sole basis for charging.** The poll is a demand signal only.
Someone who books and doesn't travel owes nothing, however late they withdrew;
someone who turns up without booking is charged in full.

**Lock is the only hard gate.** `poll_closes_at` drives a countdown and nothing
else — it never disables booking. After lock, new bookings are separated into a
late bucket for a coordinator to accept or decline; the decision is informed by
seats free in the last cab, since that is what decides whether one more person
is free or means hiring another cab.

**Cost is floored, never rounded up.** Nobody is overcharged by a single rupee.
The remainder (under ₹50 a trip) is absorbed by coordinators, tracked per trip
and shown on the settlement screen rather than hidden. All money is whole rupees
in `integer` columns — no paise, no floating point.

**No automatic enforcement anywhere.** Declining a late request, rejecting a
registration, blocking someone — each is a deliberate coordinator action with a
name and timestamp against it. An unpaid balance never blocks a booking; it
appears as a plain fact and coordinators decide. An automated rule would misfire
on someone who paid and simply hasn't been verified yet.

**Everything socially weighty is audited.** `response_events`, `user_events` and
`due_events` are append-only and written in the same transaction as the change,
so an unaudited action is not possible.

## Security

- **No database client in the browser.** All access goes through server routes
  and server components holding the service key server-side, so a mistaken RLS
  policy cannot leak data on its own.
- Coordinator routes are guarded server-side per request; hiding UI is never the
  control.
- `link_token` is 192 bits of randomness — forwardable, not guessable.
- No funds and no payment credentials pass through the app. UPI is peer-to-peer;
  the app records only *claims* about payments.

**Known limit:** a phone number typed into a browser is not authentication. This
is deliberate for launch (see `SPEC.md` §4). The blocklist is a speed bump, not
a wall — a blocked person can re-register under a new number, though it lands in
the approval queue rather than getting in silently. Phase 4 adds OTP or Google
sign-in on top of the same user records with no migration.

## Continuity

The thing most likely to kill this project is the author graduating.

- Keep Supabase, Vercel and any domain under a **group-owned account**.
- Record credentials somewhere the coordinator group can reach.
- Milestone 3 adds in-app coordinator promotion and a weekly CSV export of the
  ledger — the only data here that cannot be reconstructed from memory.

## Deployment

Deploy to Vercel, set the same environment variables, and the cron in
`vercel.json` runs on Vercel's schedule (currently Thursday 09:00 IST, i.e.
`30 3 * * 4` in UTC). Adjust the cron and `TRIP_DAY_OF_WEEK` together if the
event moves.

Vercel rebuilds on every push to `main`. Two things it does **not** rebuild for:

- **Environment variable changes.** `NEXT_PUBLIC_*` values are inlined into the
  browser bundle at build time, so edit the variables and then redeploy.
- **The commit that existed at import time.** If the Deployments tab shows an
  older SHA than `git log origin/main -1`, a push was missed — *Redeploy* rebuilds
  the same commit, so push a new one instead.

After deploying, add the domain to Supabase → *Authentication → URL
Configuration*: as **Site URL**, and under **Redirect URLs** as
`https://your-app.vercel.app/**`. Without the `/**` suffix the callback path is
rejected, and Supabase does not report that — it silently substitutes the Site
URL, so the sign-in link lands on a page with no code to handle it and appears to
do nothing.

Note: Supabase pauses free projects after about a week of inactivity. Weekly use
keeps it warm; expect to un-pause it after a long semester break.
