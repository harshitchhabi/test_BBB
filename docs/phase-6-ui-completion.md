# Phase 6 — closing the remaining gaps (UI screens, staff bootstrap, exports)

Not one of the plan's numbered phases — this is the cleanup pass that
finishes what Phases 3–5 explicitly deferred: the missing team/moderator
screens, the manual-database-insert staff bootstrap, and two export types.

## What changed

**Full Section 7 team portal**, all seven nav items now real screens
(`src/app/events/[eventId]/**`, shared `TeamNav`):

- **Event Home** (`/events/:id`) — stage timeline, team info, token
  summary cards, create/join-team form, "waiting for moderator" state.
- **Live Auction** — already existed (Phase 2).
- **Inventory** (`/events/:id/inventory`) — own team's material quantities
  plus bank stock/tax rates, backed by the Phase 3 read models.
- **Trade & Build** (`/events/:id/trade-build`) — trade proposal form
  (material lines, either direction), trade history, recipe cards with a
  live "can build now" check against current inventory and a red
  missing-materials list, Eco/Landmark bonus buttons, constructed
  buildings list. Deliberately has no register/complete/void buttons —
  Section 7.5: "support the moderator's real-world process rather than
  force every interpersonal negotiation into software."
- **City Auction** (`/events/:id/city-auction`) — wallet/leftover
  balance, live auction bid box, city list with per-city scout-report
  purchase showing only that team's own clue, owned-city state.
- **Portfolio & Score** (`/events/:id/portfolio`) — pre-reveal (deeds,
  bonus points, pre-multiplier total, city name/tier without its number)
  and post-reveal (full breakdown, rank, tiebreak placement, raw
  `calculationJson` for anyone who wants to check the arithmetic by hand).
- **Rules** (`/events/:id/rules`) — every number pulled live from this
  event's own `event_settings` row, replacing the legacy's static page per
  Section 3's gap assessment.

**Full Section 7.8/7.9 moderator console**, all built slices now real
screens (`src/app/events/[eventId]/moderator/**`, shared `ModNav`):

- **Event Setup** — the one setup step that couldn't be a seed script:
  adding moderators (see staff bootstrap below).
- **Stage 1 Auction** — already existed (Phase 2).
- **Trade Desk** — register/reject a submitted trade, complete a
  registered one, cancel either.
- **Build/Deed Desk** — every constructed building across every team,
  void a bad one, pass/fail a pending inspection.
- **Stage 3 Cities & Reveal** — start/close a city auction, one-click
  "assign to \[team\] (last team)" when exactly one team and one city are
  left, and the reveal button (Score & Reveal folds in here — see
  docs/phase-4.md on why reveal+score is one atomic action, not a
  separate screen).
- **Teams & Incidents** — every team's balances in one table, inline
  balance adjustment, withdraw/disqualify/reinstate.
- **Exports** — links to all four CSV exports (see below).

**Read-model routes added to support the above**: `GET /events/:id/
overview`, `/recipes`, `/trades/list`, `/buildings/list`, `/inspections/
list`, `/city-auctions/list` — none of these mutate anything; they exist
purely so the screens above have something to render.

**Event staff bootstrap** (`addEventStaff` in `team-service.ts`, `POST /
events/:id/staff`, wired into the Event Setup screen): closes the gap
flagged in `docs/phase-5.md` where the only way to create the first
moderator for an event was a direct database insert. Standard
first-user-becomes-admin pattern: an event with zero staff rows accepts
an add from anyone signed in; once staff exists, only existing staff can
add more. A dedicated test (`tests/phase5-incidents.test.ts`) locks in
both halves of that rule.

**Two remaining export types** (`docs/phase-5.md` flagged both as
missing): `GET /events/:id/exports/inventory` (every team's full
inventory ledger, not just current stock) and `GET /events/:id/exports/
bid-history` (every Stage 1 bid, accepted and rejected, with its
lot/round/material context) — same CSV-by-default/`?format=json` shape as
the standings and audit-log exports from Phase 5.

**Root page** (`/`) rebuilt from a static placeholder into an actual entry
point: sign in, then enter an event id to jump to it. There's still no
"list my events" concept — a moderator shares the event id (or a direct
`/events/:id` link) with participants, the same way they'd share a join
code. Building a real event directory was judged out of scope for an
event portal that runs one live event at a time; flagging the choice
rather than silently leaving `/` broken.

## Verification

- 33 tests, all against real Postgres (1 new: the staff bootstrap
  first-add / subsequent-restriction test).
- Full `next build`: 44 API routes, 13 page routes, clean typecheck.
- No changes to `packages/game-engine`'s existing service logic beyond
  the additive `addEventStaff` function — every screen here is a
  read/write client of APIs that were already built, tested, and
  documented in Phases 1–5.

## What's genuinely still open

- **No live rehearsal has happened.** Nothing here substitutes for
  running the actual screens with real people, as Phase 5 already said.
- **Styling is functional, not designed.** Every screen uses the same
  plain inline-style approach as Phase 2's original two screens —
  consistent, but nobody would call it polished. A visual design pass is
  a legitimate next step if this is heading toward a real public-facing
  event.
- **No moderator UI for seeding materials/recipes/cities/shocks** — that
  stays a `packages/db/seed` script + a direct edit to `seed/data.ts`, by
  design (Phase 0's model: config is reviewed and committed before an
  event, not authored live through a screen).
- Everything else flagged as a deviation or open question across
  `docs/phase-0.md` through `docs/phase-5.md` still stands — this pass
  didn't reopen or re-litigate any of those; it only built the UI/access
  layer on top of what they already decided.
