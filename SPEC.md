# Seat Booking App — Specification

**Version:** 0.2
**Date:** 2026-08-02
**Status:** Approved. Implementation plan at `~/.claude/plans/i-think-there-is-structured-newell.md`.

---

## 1. Problem

A group of ~40–50 college students travels by cab to a weekly event. Today the whole process runs on WhatsApp polls and manual tallying:

1. A poll goes up ~1 day before the event to estimate headcount.
2. Coordinators call a contractor and book cabs against that count.
3. Some travellers return early (classes, other commitments); the rest return together.
4. Back at college, a UPI QR is shared and people are asked to re-poll after paying.
5. Counts are tallied next week; unpaid people are chased; some people paid but forgot to re-poll.
6. Coordinators settle up with the contractor.

The failure is that WhatsApp has no state. Every week the same facts are re-derived by hand, and the second "poll" is really a payment checklist running on a tool that cannot remember anything.

### Constraints that shape the design

| Constraint | Consequence |
|---|---|
| Cab booking is a phone call to a contractor — it cannot be automated | The app's job is to produce a trustworthy **number** at a trustworthy **time**, not to book anything |
| Last-minute count increases are rarely possible | Response **timestamps** are first-class; there must be a hard "count locked" moment |
| Only people who actually travelled are charged | Dues derive from **attendance**, never from the poll |
| Final cost is known only after the event (2 cab types, whichever arrives) | Dues are generated **post-event**, same day |
| Backend process is restricted to a few trusted seniors | Two roles, hard separation |
| Traveller emails not yet collected; phones are known | Phone is the primary identifier; email is a nullable column from day one |
| Cabs are hired for the day, round trip, at one price | The trip has a single total cost; early returns are dispatch, not a separate hire |
| The group is peers from the same college | **No automatic enforcement anywhere.** Every exclusion is a deliberate coordinator action with a name against it |

---

## 2. Roles

### Traveller
Three actions, nothing more:
- **Book** a seat for the trip — a single Going / Not going tap
- **Withdraw** (with a warning; escalated after the count is locked)
- **Pay** outstanding dues

No account, no password, no app install. See §4.

### Coordinator
Everything a traveller can do, plus:
- Open / lock / close the poll
- See the live count and every response with its timestamp
- Add a guest or record a response on someone's behalf
- Approve or reject new self-registrations; block or unblock a user
- Mark attendance at boarding
- Enter actual cab costs and generate dues
- Verify payments, chase unpaid dues, record contractor settlement

For launch there is no separate admin role — coordinators are trusted seniors and can do everything. A `can_manage_coordinators` flag on the user record reserves the distinction for later without a schema change.

---

## 3. Why the poll moves into the app (and not the other way round)

An alternative was considered: keep polling in WhatsApp and import the results.

It fails on the primary requirement. **WhatsApp polls do not record or expose vote timestamps** — not in the UI, not under "View votes", not in an exported chat. Late-comer detection is the single feature coordinators most need, and no import method can recover data that was never captured.

Secondary problems, for the record:

| Import route | Why it fails |
|---|---|
| Long-press → Copy | Poll messages are not copyable as text; forwarding creates a fresh poll with no votes |
| Export chat → `.txt` | Poll content and per-voter data are not meaningfully included |
| Screenshot → OCR | Reads WhatsApp *display names* ("Aman ❤️", "Aman Ch (Hostel B)"), which then need fuzzy-matching to a roster. Replaces counting names with correcting a machine's guesses at names — and still no timestamps |

The poll therefore lives in the app. WhatsApp remains the distribution channel: coordinators paste a link.

---

## 4. Traveller identification (launch model)

Travellers do not create accounts.

1. Coordinator opens the poll and gets a **trip link**. They paste it into the WhatsApp group where the poll used to go.
2. Traveller taps the link. First visit only, they are asked for their **phone number**.
3. The number is matched against the pre-seeded roster. No match → short self-registration (name + phone), created `pending` for a coordinator to approve. See §4.1.
4. A match is **shown back for confirmation** — name, batch year and the number typed — with "no, try a different number" beside it. The lookup writes nothing; only the confirmation sets the cookie. One wrong digit matches somebody else on a roster of fifty, and without this step the app silently becomes that person for a year: their booking, their withdrawal, their fare. The confirmation re-submits the phone number rather than a user id, so it creates no shortcut that did not already exist.
5. Identity is stored in a signed HTTP-only cookie (1 year). Week two onward is a single tap.
6. A **"Not you?"** control is visible wherever the identity is shown, including on the payment screen. A year-long cookie without an exit is a trap, not a convenience — the alternative for someone who mistyped is clearing their site data.

Effort for the traveller is roughly the same as voting in a WhatsApp poll — two seconds slower on the first week only.

### Accepted risk

A phone number typed into a browser is not authentication. Someone with the link could impersonate another traveller and withdraw their booking.

Mitigations for launch:
- Every action is written to an append-only audit log with source and timestamp
- Coordinators can see and reverse any change
- The group is small, closed and socially accountable
- No money moves through the app — it only records claims

Upgrade path (Phase 4): one-time OTP on first identification, or Google sign-in once emails are collected. Because identity is keyed on the user record and not on the auth method, this is additive — no data migration.

### Coordinator authentication

Coordinators take money-related actions and need real auth. Given there are only a handful of them and they all have email addresses: **email magic link** (Supabase Auth). No passwords to manage, no SMS costs.

### 4.1 New-user approval — a one-time gate

`users.approval_status` is `pending` | `approved` | `rejected` | `blocked`. A boolean cannot distinguish "not looked at yet" from "turned away at the gate" from "barred after the fact", and all three behave differently.

- Roster members loaded by the seed script are **`approved` on creation** — they are already known people and are never asked.
- Only **self-registration through the link** creates a `pending` user. This is the case where the WhatsApp link gets forwarded outside the group.
- A `pending` user **may still submit a booking**, held aside and excluded from `locked_count` until approved. Refusing outright would strand a genuine new junior behind a coordinator's response time; holding costs nothing, since approval is a two-second tap.
- On approval the held booking joins the live count immediately, and the person is **never gated again** — approval is per-person, not per-trip.
- `rejected` users cannot book and do not reappear in the queue. Reversible.
- The dashboard carries a **pending-count badge**, prominent while the poll is open, since an unapproved person may be a seat that matters before lock.

### 4.2 Blocklist

For a member who turns out to be a problem — distinct from `rejected`, which is a stranger turned away at the gate. Expected to stay empty; it exists so the situation is met with a button rather than a panicked code change.

- **Block / unblock** from the roster with a required short reason. Fully audited and reversible.
- A `blocked` user's session is invalidated and every server route returns a plain "your access has been removed, please speak to a coordinator" screen. No booking, no dues, no reads.
- **Blocking is access control, not debt forgiveness.** Outstanding dues stay on the ledger and remain visible to coordinators.

**Honest limit.** Identity is a phone number typed into a browser, so a blocked person can re-register under a different number — this is a speed bump, not a wall. What makes it hold is the approval gate behind it: any new registration lands in `pending` and needs a coordinator's tap, so a re-registration never gets in silently. Against a casual nuisance that is enough; against someone determined it is not, and nothing short of verified identity (OTP or Google sign-in, Phase 4) would be.

---

## 5. Trip lifecycle

```
                    ┌──────────────────────────────────────┐
                    ▼                                      │
draft ──▶ poll_open ──▶ locked ──▶ in_progress ──▶ completed ──▶ settled
  │           │           │            │              │
  └───────────┴───────────┴────────────┴──────────────┴──▶ cancelled
```

| State | Meaning | What's possible |
|---|---|---|
| `draft` | Auto-created by a weekly cron | Coordinator edits date/time/destination |
| `poll_open` | Link is live | Travellers book and withdraw freely |
| `locked` | Count snapshotted at the moment of the contractor call | Poll stays open, but new bookings land in a **late** bucket for coordinator approval. Withdrawals show a stronger warning |
| `in_progress` | Travel day | Boarding attendance is marked |
| `completed` | Event over, everyone back | Coordinator enters actual cab costs |
| `settled` | Dues generated, contractor paid | Read-only except payment verification |
| `cancelled` | Trip called off | Read-only |

**Locking is the key mechanic.** It captures `locked_count` and `locked_at` — one number, the total headcount, because one number is what the contractor is told. Every response after `locked_at` is automatically flagged late: a precise fact, not a judgement call.

**`poll_closes_at` is advisory only.** It displays a deadline and drives reminders, but never disables booking. **Lock is the sole hard gate** — one gate is easier to explain to forty people than two.

---

## 6. Data model

Postgres. Names are `snake_case`, all tables have `id uuid pk`, `created_at`, `updated_at`.

### `users`
| Column | Type | Notes |
|---|---|---|
| `name` | text | |
| `phone` | text unique | E.164, primary identifier |
| `email` | text null unique | Reserved for Phase 4 Google sign-in |
| `role` | enum | `traveller` \| `coordinator` |
| `member_type` | enum | `regular` \| `guest`. **`guest` means interns and short-stay visitors only.** UG cross-over travellers are `regular` — coordinators decide case by case; the schema does not presume |
| `affiliation` | text null | Free text, e.g. "UG — CSE", "Intern" |
| `joining_year` | int null | The batch. Shown beside the name everywhere, because a group this size repeats names across intakes and the year is what tells two people apart. Nothing keys on it |
| `upi_vpa` | text null | Their own UPI address, for the weeks they are collecting. Set once **by that person only** — a coordinator cannot edit another's, or one roster tap could redirect a week's fares. Normalized and lower-cased so nobody holds two |
| `approval_status` | enum | `pending` \| `approved` \| `rejected` \| `blocked`. See §4.1, §4.2 |
| `blocked_reason` | text null | Required when blocking |
| `is_active` | bool | Soft-delete for people who've left |
| `can_manage_coordinators` | bool | Reserved; false for everyone at launch |

### `trips`
| Column | Type | Notes |
|---|---|---|
| `event_date` | date | |
| `destination` | text | |
| `departure_time` | time | |
| `status` | enum | See §5 |
| `poll_opened_at` | timestamptz null | |
| `poll_closes_at` | timestamptz null | Advisory deadline shown to travellers |
| `locked_at` | timestamptz null | The moment of the contractor call |
| `locked_by` | uuid null → users | |
| `locked_count` | int null | Headcount snapshot at the moment of the contractor call |
| `amount_per_person` | int null | Rupees each rider is asked for, typed in by a coordinator. **Null means nothing is payable** — the first of the two gates in §8.1 |
| `collected_by_user_id` | uuid null → users | Which coordinator is taking the fares this week. The second gate |
| `collect_upi_vpa` | text null | Snapshot of that coordinator's `upi_vpa` at the moment they were picked, so changing it later cannot rewrite an old trip's payee |
| `collect_upi_name` | text null | Snapshot of their name, shown in the payment app |
| `link_token` | text unique | The shareable slug pasted into WhatsApp; ≥128 bits of randomness so it cannot be guessed |
| `notes` | text null | |

### `responses`
Current state of one person's intent for one trip.

| Column | Type | Notes |
|---|---|---|
| `trip_id` | uuid → trips | |
| `user_id` | uuid → users | |
| `going` | bool | |
| `first_responded_at` | timestamptz | Used for late detection — never overwritten |
| `source` | enum | `self` \| `coordinator` |
| `recorded_by` | uuid null → users | Set when `source = coordinator` |
| `late_approved` | bool | Coordinator accepted a post-lock booking |

Unique on `(trip_id, user_id)`. Derived: `is_late = first_responded_at > trips.locked_at`.

### `response_events`
Append-only audit log. Never updated, never deleted.

| Column | Type | Notes |
|---|---|---|
| `trip_id`, `user_id` | uuid | |
| `action` | enum | `book` \| `withdraw` \| `approve_late` \| `decline_late` |
| `from_value`, `to_value` | text null | |
| `occurred_at` | timestamptz | |
| `source` | enum | `self` \| `coordinator` |
| `actor_id` | uuid null → users | |

This is what answers "who withdrew after we'd already booked?" — a question with social weight, so the record needs to be exact and unarguable.

### `user_events`
Append-only. Membership decisions, which carry the same social weight.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid → users | |
| `action` | enum | `register` \| `approve` \| `reject` \| `block` \| `unblock` \| `promote` \| `demote` |
| `from_status`, `to_status` | text null | |
| `reason` | text null | Required for `block` |
| `occurred_at` | timestamptz | |
| `actor_id` | uuid null → users | |

### `due_events`
Append-only. Money disputes are the socially expensive kind, so the record must be unarguable.

| Column | Type | Notes |
|---|---|---|
| `due_id` | uuid → dues | |
| `action` | enum | `generate` \| `claim` \| `verify` \| `unverify` \| `waive` \| `amend` |
| `from_status`, `to_status` | text null | |
| `amount` | integer null | Rupees, at the time of the event |
| `occurred_at` | timestamptz | |
| `actor_id` | uuid null → users | |
| `note` | text null | |

### `cab_types`
Reference table; the group uses roughly two.

| Column | Type | Notes |
|---|---|---|
| `name` | text | e.g. "Tempo Traveller", "Sedan" |
| `capacity` | int | |
| `default_cost` | integer null | Rupees. Hint only; actual cost is entered per trip |

### `cabs`
One row per physical cab hired. **A cab is hired for the day, round trip, at one price.** Cabs that leave early are the same cabs, dispatched early so they run full — there is no separate early-return hire and no separate early-return cost.

| Column | Type | Notes |
|---|---|---|
| `trip_id` | uuid → trips | |
| `cab_type_id` | uuid → cab_types | |
| `contractor_name`, `contractor_phone` | text null | |
| `agreed_cost` | integer null | Rupees. Quoted on the call |
| `actual_cost` | integer null | Rupees. Confirmed after the event — this is what's split |
| `dispatched_early` | bool | Operational record only; has no effect on cost |

### `attendance`
Who physically boarded. **The sole basis for charging.**

| Column | Type | Notes |
|---|---|---|
| `trip_id`, `user_id` | uuid | |
| `boarded` | bool | Marked at onward boarding, when the coordinator physically sees the person |
| `marked_at` | timestamptz | |
| `marked_by` | uuid → users | |

Unique on `(trip_id, user_id)`. One tick per person per trip — no leg dimension, because cost does not vary by leg.

### `dues`
| Column | Type | Notes |
|---|---|---|
| `trip_id`, `user_id` | uuid | |
| `amount` | integer | Rupees. What they owe **now** — amended if the fare is corrected |
| `breakdown` | jsonb | Total cost, rider count and shortfall, so a traveller can see how the number was reached |
| `status` | enum | `unpaid` \| `claimed` \| `verified` \| `waived` |
| `claimed_at` | timestamptz null | Traveller tapped "I've paid". A second tap does not reset it — a coordinator reads this timestamp |
| `claimed_amount` | int null | Rupees they said they sent, frozen at that moment. A different fact from `amount`: keeping both is what lets the list say "claimed ₹150 · now ₹170" |
| `verified_at` | timestamptz null | |
| `verified_by` | uuid null → users | |
| `paid_by_user_id` | uuid null → users | Set when someone paid on this person's behalf — routine, and a main source of tally drift today |
| `method` | text null | e.g. "UPI", "cash" |
| `note` | text null | |

Unique on `(trip_id, user_id)`.

### `settlements`
| Column | Type | Notes |
|---|---|---|
| `trip_id` | uuid unique → trips | |
| `total_cab_cost` | integer | Rupees |
| `total_collected` | integer | Rupees. Rolling, from verified dues |
| `rounding_shortfall` | integer | Rupees the coordinators absorbed this trip. See §7 |
| `contractor_paid_at` | timestamptz null | |
| `contractor_paid_by` | uuid null → users | |

---

## 7. Cost calculation

### Currency — whole rupees, integer arithmetic

All money is INR in **whole rupees**. No paise anywhere: no sub-rupee amount is entered, stored, calculated or displayed. Every money column is therefore **`integer`, never `numeric`/`decimal`**, which removes floating-point money bugs by construction rather than by careful handling.

### The calculation

Cabs are hired round-trip for the day, so the trip has a single total cost. Everyone who travelled pays an equal share, **floored** — no traveller is ever charged a rupee more than their true share.

```
total_cost = Σ cabs.actual_cost for the trip
riders     = count(attendance where boarded = true)

per_head   = Math.floor(total_cost / riders)        // plain integer division
shortfall  = total_cost - (per_head * riders)       // always < riders, i.e. under ₹50

due(user) = per_head, for every user who boarded
```

Rounding is **fixed at ₹1 and is not configurable** — no setting, no column, no UI.

**Rules and edge cases:**

- **Attendance is the sole basis for charging.** Someone who polled yes and didn't board is charged nothing, however late they withdrew. Someone who boarded without polling is charged in full.
- **Flooring produces a shortfall, not a surplus.** Coordinators absorb under ₹50 per trip. That is small enough to be genuinely negligible, which is exactly what makes ₹1 the only sane unit once overcharging is ruled out — at ₹10 the same rule would cost them up to ₹405 a week.
- **Tracked now, settled later.** `settlements.rounding_shortfall` records each trip's gap and the settlement screen shows the week's figure plus a running cumulative total. No mechanism to clear or redistribute it is built for launch; once a few months of real numbers exist the group can decide whether to act on it. The data is never silent and never lost.
- `riders = 0` on a `completed` trip is rejected with an error — it means boarding was never marked, not that nobody travelled.
- **Waste is visible.** The settlement screen shows cost per booked seat against cost per actual rider, so coordinators can see cabs running empty and adjust next week's booking.
- Guests are charged identically to regulars.

**The load-bearing invariant:** `per_head × riders ≤ total_cost`, always. No code path may overcharge the group.

---

## 8. Screens

### 8.1 Traveller — one page, phone-first

```
┌────────────────────────────────┐
│  Saturday 9 Aug · <destination>│
│  Leaves 07:30 · Poll closes    │
│  Fri 8:00 PM  (in 6h 12m)      │
│                                │
│   [   I'm going   ]  [ Not ]   │
│                                │
├────────────────────────────────┤
│  Your share                    │
│         ₹340                   │
│  2 seats × ₹170                │
│                                │
│  Paying as                     │
│  Priya Nair 2023   [ Not you? ]│
│  98765 43210                   │
│                                │
│  Paying                        │
│  Rahul Menon · rahul@ybl       │
│                                │
│   [   Pay ₹340 by UPI    ]     │
│         or scan                │
│        ▓▓░▓░▓▓ (QR)            │
│   [    I've sent ₹340    ]     │
├────────────────────────────────┤
│  ▸ Past trips                  │
└────────────────────────────────┘
```

A single Going / Not going tap. There is **no early-return question** — early returns are decided on the day by dispatching already-hired cabs back early so they run full, so asking in advance would collect a number that changes nothing.

Behaviour:
- Before lock — free to change anything.
- `pending` (self-registered, not yet approved) — the booking is accepted and held, with "waiting for a coordinator to approve you" shown plainly.
- `blocked` — every route returns "your access has been removed, please speak to a coordinator".
- After lock, booking — "The count is already locked. Your request goes to a coordinator; a seat isn't guaranteed."
- After lock, withdrawing — "Cabs are already booked for this count. Withdrawing now means the others split the same cost between fewer people. Withdraw anyway?" (Only shown post-lock; the pre-lock version is gentler.)
- Payment — UPI deep link with amount and reference note prefilled, **with the QR always rendered underneath** as a fallback. `upi://` intents are reliable in Android Chrome and patchier on iOS, so the QR is not optional. The QR is generated from the payee address rather than uploaded, so there is no image to store and none to go stale.
- **Two gates before anything is payable**: a coordinator has set `amount_per_person`, *and* a coordinator has been named to collect. Neither happens by default, so a traveller is never shown a figure the app guessed or an address nobody chose. Before both, the section says which one is missing.
- **The collector rotates weekly.** Each coordinator stores their own `users.upi_vpa` once; a trip records `collected_by_user_id` and *snapshots* the address and name onto `trips.collect_upi_vpa` / `collect_upi_name`. The snapshot means changing your UPI ID later cannot rewrite who an old trip's payments were made to. Deliberately not configuration — an environment variable would mean a redeploy every week, and a stale placeholder would silently become the payee.
- "I paid" sets `claimed`, not `verified`. Only a coordinator can verify. A `upi://` intent returns no callback, so the app genuinely cannot know money moved; the claim's job is to put that person in front of a coordinator with a timestamp. `dues.claimed_amount` freezes what they said they sent, so a fare corrected afterwards reads as "claimed ₹150, now ₹170" rather than a tick against a figure nobody paid.
- A traveller may **retract their own claim** until it is verified, which is why the claim button needs no confirmation dialog.
- **No payment gateway.** Considered and rejected: it requires merchant KYC for what is a student group collecting cab fare, settles T+1/T+2 (after the contractor needs paying), and settles into one registered account — which is incompatible with the weekly rotation above. Peer-to-peer UPI rotates for free and keeps the blast radius in §11.

### 8.2 Coordinator — Dashboard

The screen open while phoning the contractor.

- One big live number: **total going**. This is the number read out on the call.
- Suggested cab mix against `cab_types` capacities, with seats left empty in the last cab — the figure that decides whether one more person is free or expensive
- Countdown to `poll_closes_at` — advisory; it never disables booking
- **[ Lock count ]** — confirms, snapshots, timestamps
- Post-lock: two clearly separated lists — **Late additions** (accept / decline, judged against seats free in the last cab) and **Withdrawals after lock** (names and times)
- Live response feed: name, action, exact time, `self` or `coordinator`
- **Pending-approvals badge**, prominent while the poll is open — an unapproved person may be a seat that matters before lock

### 8.3 Coordinator — Roster

- Searchable list of everyone with their response and response time
- Sort by time, so "who responded in the last hour" is one tap
- Record a response on someone's behalf (the WhatsApp holdout who just replies "count me in") — stored as `source: coordinator` with the time it was entered
- **Add guest** — name + phone. `guest` is for interns and short-stay visitors; UG cross-over travellers are added as `regular`
- **Approval queue** — pending self-registrations with name, phone and whether they have already booked; approve / reject in one tap
- **Block / unblock** with a required reason, from the roster row
- Copy-to-clipboard: a plain-text summary for pasting back into the group

### 8.4 Coordinator — Boarding (mobile, at the pickup point)

Optimised for standing next to a cab with one hand free and bad signal.

- Everyone who booked, large tap targets, one tap = boarded
- Running count `18 / 22 boarded` pinned at the top
- **Add walk-on** — someone who never polled but turned up
- **Offline-tolerant**: writes queue locally and sync when signal returns. This screen is the only one where network failure loses irreplaceable data, so it is the only one that gets offline handling in v1.

### 8.5 Coordinator — Costs & dues

Post-event, same day.

1. Enter the cabs actually used: type, count, actual cost
2. Live preview — total cost, rider count, floored per-head amount, and the shortfall coordinators will absorb
3. **[ Generate dues ]** — writes `dues` rows for everyone who boarded
4. Regeneration is allowed while the trip is `completed`; once `settled`, amounts freeze

### 8.6 Coordinator — Ledger

- Default view: **everyone with an outstanding balance, across all trips** — this is the carry-forward that WhatsApp cannot do
- Filter by trip
- One-tap verify on a `claimed` due, with **payer selection** when someone paid on another person's behalf
- **Nudge** — copies a ready-to-paste WhatsApp message naming unpaid people and amounts. No notification infrastructure in v1; the coordinator pastes it into the group.
- A long-outstanding balance appears as a **plain fact next to the name** — no badge of shame, no automatic consequence. Coordinators decide what to do, if anything. An automated block would misfire on someone who paid and simply hasn't been verified yet, which is the exact friction this app exists to remove.

### 8.7 Coordinator — Settlement

Per trip: total cab cost, total collected, outstanding, this trip's rounding shortfall plus the running cumulative total, and cost per booked seat vs. cost per actual rider. Mark contractor paid.

---

## 9. API surface

`/api` routes, Next.js Route Handlers. Coordinator routes are guarded by session role; traveller routes by the signed identity cookie plus a valid `link_token`.

### Public / traveller
```
POST /api/lookup                  { phone }            → returns the match for confirmation, or
                                                        needs_registration. Writes nothing.
POST /api/identify                { phone }            → confirmed: sets cookie. Takes the phone
                                                        number again, never a user id.
POST /api/register                { name, phone }       → creates `pending` user, sets cookie
POST /api/sign-out                                      → clears the cookie ("Not you?")
GET  /api/trip/:token                                   → trip + this user's response + dues
POST /api/trip/:token/book
POST /api/trip/:token/withdraw
GET  /api/me/dues
POST /api/dues/:id/claim
```

### Coordinator
```
GET   /api/admin/trips
POST  /api/admin/trips                    { event_date, destination, departure_time }
PATCH /api/admin/trips/:id                { status, poll_closes_at, ... }
POST  /api/admin/trips/:id/open
POST  /api/admin/trips/:id/lock
GET   /api/admin/trips/:id/dashboard      → live counts, feed, late list, withdrawals
GET   /api/admin/trips/:id/roster
POST  /api/admin/trips/:id/response       { user_id, going }
POST  /api/admin/trips/:id/approve-late   { user_id, accept }
GET   /api/admin/trips/:id/attendance
POST  /api/admin/trips/:id/attendance     { entries: [{user_id, boarded}] }        // batch, idempotent
GET   /api/admin/trips/:id/cabs
POST  /api/admin/trips/:id/cabs           { cab_type_id, actual_cost, dispatched_early, ... }
POST  /api/admin/trips/:id/generate-dues  → preview or commit
GET   /api/admin/ledger                   ?status=&trip=
POST  /api/admin/dues/:id/verify          { method, note, paid_by_user_id }
POST  /api/admin/dues/:id/waive           { note }
POST  /api/admin/trips/:id/settle         { contractor_paid_at }
GET   /api/admin/users                    ?approval_status=
POST  /api/admin/users                    { name, phone, member_type, affiliation }
PATCH /api/admin/users/:id                { role, is_active }
POST  /api/admin/users/:id/approve
POST  /api/admin/users/:id/reject
POST  /api/admin/users/:id/block          { reason }        // required
POST  /api/admin/users/:id/unblock
```

The attendance endpoint is **batch and idempotent** so the offline queue can replay safely.

Every state-changing coordinator route writes to the matching append-only log (`response_events`, `user_events`, `due_events`) in the **same transaction** as the change itself. An action that isn't audited must not be possible.

---

## 10. Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js (App Router) + TypeScript | One codebase serves phone and PC; PWA installable to home screen; no app store |
| UI | Tailwind + shadcn/ui | Fast to build, sane defaults, accessible primitives |
| DB | Postgres (Supabase) | Free tier is far beyond 50 users; auth included |
| ORM | Drizzle | Typed, light, straightforward migrations |
| Coordinator auth | Supabase magic link | No passwords, no SMS cost |
| Traveller auth | Signed cookie (`iron-session`) | No account needed |
| Hosting | Vercel | Free tier sufficient; cron included |
| Scheduling | Vercel Cron | Weekly `draft` trip auto-creation |

Running cost at this scale: **₹0/month**.

---

## 11. Build order

### Milestone 1 — Replace the pre-event poll
Schema and migrations · coordinator magic-link auth · roster seeding · traveller identify-by-phone · trip auto-creation and auto-open · poll link · book / withdraw · live dashboard with timestamps · lock + snapshot · late and post-lock-withdrawal lists · approval queue · blocklist.

*Usable the week it ships. Kills the biggest pain on its own.*

### Milestone 2 — Replace the post-event poll
Boarding screen with offline queue · walk-ons · cab and cost entry · due generation · traveller dues view · UPI deep link + QR · claim / verify · ledger with cross-trip carry-forward · nudge text.

*After this the app covers the full weekly loop.*

### Milestone 3 — Hardening
Settlement records · trip history and per-person history · basic analytics (attendance trend, chronic late responders, average per-head cost) · coordinator promotion UI · weekly automated CSV export · coordinator undo on audited actions.

### Phase 4 — Later
Email collection → Google sign-in mapped onto existing users by email · OTP on first identification · web push · multiple concurrent events / destinations · separate admin role.

---

## 12. Security posture

The Supabase free tier is the **same infrastructure** as its paid plans — same managed Postgres, TLS in transit, encryption at rest, same auth service. Paid plans buy operational headroom, not a stronger security model. Nothing here is insecure *because* it is free.

**What actually protects the data:**

- **No database client in the browser.** Supabase's public `anon` key is designed for direct browser access with RLS as the only barrier — one wrong policy exposes every phone number and ledger row. Instead all access goes through Next.js server routes holding the service key server-side. RLS is enabled on every table as defence-in-depth, but a policy mistake alone cannot leak data.
- **Route guards on every coordinator endpoint**, checked server-side against the session role. Hiding UI is never the control.
- **Long random `link_token`** (≥128 bits), so trip links can be forwarded but not guessed.
- **Secrets in environment variables**, never committed; the service key never reaches a client bundle.
- **Small blast radius by design.** No funds move through the app and no payment credentials are stored — UPI is peer-to-peer between traveller and coordinator, and the app records only *claims* about payments. No card data, no PCI scope, no wallet to drain. The sensitive asset is ~50 names and phone numbers plus who-owes-what.

Free-tier limits are operational, not security: idle projects pause after about a week (weekly use keeps it warm), backup options are thin (hence the weekly CSV export), and the size limits are orders of magnitude beyond 50 people. *Confirm current figures at setup rather than trusting these.*

**Upgrading later is a billing toggle, not a migration**, and nothing here creates lock-in — it is a standard Next.js app on plain Postgres, so moving to Neon, Railway or self-hosted would be a connection-string change.

---

## 13. Continuity

The failure mode that kills college projects is not a bug; it is the author graduating.

- Supabase, Vercel and any domain live under a **group-owned account** from day one, not a personal login. Credentials recorded where the coordinator group can reach them.
- **In-app promotion** of a traveller to coordinator, so handover needs no developer.
- **Weekly automated CSV export** of users, trips, attendance and dues. The ledger is the only asset here that cannot be reconstructed from memory.

---

## 14. Settled decisions

| Question | Decision |
|---|---|
| Rounding unit | ₹1, fixed, not configurable |
| Rounding direction | Floor — never overcharge by a single rupee |
| Rounding shortfall | Tracked per trip with a running total; no settlement mechanism at launch |
| `poll_closes_at` | Advisory only; **lock** is the sole hard gate |
| Early-return question | **Not asked.** Decided on the day by dispatching hired cabs back early |
| Chronic non-payers | **Never auto-blocked.** Coordinators see the balance and use their judgement |
| Malicious users | Explicit coordinator blocklist, audited and reversible |
| UG cross-over travellers | `regular`, at coordinator discretion |
| `guest` | Interns and short-stay visitors only |
| Timezone | Store UTC, render IST |
| Partial payments | Out of scope at launch; `waived` covers goodwill |

**No automatic enforcement anywhere in the app.** Every exclusion — declining a late request, rejecting a registration, blocking someone — is a deliberate coordinator action with a name and a timestamp against it. The app surfaces facts; people make the calls.
