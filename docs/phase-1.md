# Phase 1 — Foundation and migrations

## What changed

**Architecture decision (Section 4's diagram, made concrete):** the plan's
architecture diagram shows one "Next.js API/service game rules engine" box
between the two portals and the database, with a separate WebSocket layer
for broadcast. Legacy `my-bid` instead had *two* independent, in-memory
bidding implementations — `backend/lib/bidding-manager.ts` (unused dead
code wired to `socket.io`) and `backend/websocket-server.ts` (a standalone
`ws` server with three hard-coded team IDs, handling `place_bid` messages
sent *over the socket itself*, mutating `teams.tokens` directly with no row
locking, no persisted session, and no relation to the separate
`frontend/src/app/api/bid/route.ts`, which was a third, simpler, and
differently-buggy path to the same balance column). That's Section 3.1
issue #1 exactly. Fixed by:

- **`packages/game-engine`** — the one place any game-state mutation
  happens. `team-service.ts` (team creation/join, participant→role
  resolution) and `auction-service.ts` (round start, lot open, bid
  placement, lot close) are the whole surface so far. Every mutation runs
  inside `runInTransaction` (`tx.ts`), which takes out `SELECT ... FOR
  UPDATE` locks on the team and lot rows before validating anything —
  concurrent bids on one lot, or two bids draining one team's balance at
  once, serialize instead of racing — and can only *queue* WebSocket
  broadcasts, which are only actually sent once Postgres has committed
  (Section 4 / 8.2's "broadcast only after commit" is structural here, not
  a convention every call site has to remember).
- **`backend/`** rebuilt from scratch as a pure WebSocket relay: no DB
  connection, no rules, ~120 lines. It holds event-scoped rooms and relays
  whatever `game-engine`'s `broadcast.ts` POSTs to `/internal/broadcast`
  (secret-header-authenticated) to every client in that event's room. This
  is the only thing a long-running process is actually needed for —
  Next.js on Vercel can't hold persistent WS connections itself.
- **`frontend/`** scaffolded with the legacy repo's exact working Google
  login (`auth.ts` root wrapper + `src/auth.ts` `authOptions` +
  `participants` upsert-on-sign-in — ported unchanged, since nothing in
  the gap assessment flagged it) plus the Section 8.1 command endpoints
  that exist so far, each: resolve the signed-in participant, resolve
  their role for the event via `getParticipantContext` (never trust a
  client-asserted role), call into `game-engine`, map a thrown `GameError`
  to the matching HTTP status. `next build` passes clean (7 dynamic API
  routes, full typecheck) with no DB connection available in this
  environment — nothing touches the database at build/module-load time,
  only at request time.
- **Roles and event membership**: `event_staff` (moderator/admin) and
  `team_members.role` (leader/member) from the Phase 0 schema are now
  wired up — `getParticipantContext(eventId, participantId)` is the one
  function every route calls to find out who someone is for an event, and
  `packages/common/src/roles.ts` gives both the engine and (eventually) the
  UI one shared vocabulary for it instead of comparing strings ad hoc.
- **Audit logging**: `game-engine/src/audit.ts`'s `recordAudit` writes
  actor + action + entity + before/after JSON on every mutation, and throws
  if an `isOverride: true` entry is missing a `reason` — so a corrective
  action (voiding a bid whose team couldn't pay, force-closing a lot with
  no bids) can't ship without one, per Section 4's "every manual override
  must be recorded with actor, reason, before state, and after state."
  Routine actions (placing a bid, opening a lot) are still fully attributed
  but don't require inventing an artificial "reason" for a non-override.
- **Transaction/lock helpers**: `runInTransaction` (above) plus the
  team-then-lot lock ordering convention documented in
  `auction-service.ts`, so future additions (trades, city bids) that need
  to lock more than one row have a stated order to follow instead of each
  picking their own and risking a deadlock.
- **Deprecating the old one-balance model**: nothing to do here — this
  repo never carried the legacy `teams.tokens` / `items` / `wonItems`
  tables forward in the first place (Phase 0 schema replaced them
  entirely).

## What's covered vs. deferred to Phase 2

Implemented now (enough to prove the architecture, not the full Stage 1
rulebook):

- `startRound` — instantiates one `material_lot` + `auction_lot` per active
  team for a material, snapshotting opening bid and the increment rule from
  `event_settings`.
- `openNextLot` — opens the next pending lot in sequence, sets the timer
  window from `event_settings.auction_lot_duration_seconds`.
- `placeBid` — full lock-safe validation: team-leader-only, lot must be
  live and unexpired, amount must clear `minimumRaise` over the current
  winning bid (or the opening bid), amount must not exceed the team's
  balance. A rule violation is still persisted as a `rejected` bid with a
  reason, never silently dropped.
- `closeLot` — settles the winner (debit tokens, credit a
  `team_inventory_transactions` row, mark the `material_lot` sold), or
  moves an unsold lot to bank stock, or voids a bid whose team can no
  longer cover it at close time (balance never goes negative).

Deliberately NOT built yet — these are Phase 2 ("Stage 1 live auction")
scope:

- **Market Shock application.** `startRound` accepts an
  `openingBidOverride` for the caller to pass a shock-adjusted price, but
  nothing yet reads `market_shock_cards.effect_json` and applies it
  automatically when a round starts.
- **Bank stock re-offering / low-stock UI signals**, the full Section 7.3
  Live Auction screen, and the moderator round-control console.
- **Timer-driven auto-close.** `closeLot` accepts
  `actorParticipantId: null` for exactly this (a scheduler closing an
  expired lot with no moderator click), but no scheduler exists yet.
- Everything Stage 2/3 (trading, building, cities) — unaffected by Phase 1.

## Deviations / notes

- `openNextLot` does not yet take a row lock before checking "is another
  lot already live" — a moderator's own double-click race is the only
  realistic way to hit that gap, and it's explicitly Phase 5
  ("rehearsal hardening: concurrent... reopen lot") scope, not Phase 1's.
  Flagging it now rather than silently deferring it.
- The cross-process broadcast path (`game-engine` → HTTP → `backend`'s WS
  relay) has not been exercised end-to-end against a running `backend/`
  process in this session — no long-running processes were started. The
  code paths compile and the relay's shape (`/internal/broadcast`,
  `/health`, `ws://.../ws` with `{type:"join",eventId}`) is settled, but
  running both processes together and watching a broadcast actually land
  is worth doing before Phase 2 builds a UI against it.
- Seed/migration from Phase 0 still hasn't been run against a real
  database in this session (no dev Postgres provisioned here either) —
  still your two-command smoke test: `npm run migrate` then
  `npx tsx seed/run.ts` inside `packages/db`.

## What's left in Phase 1

Nothing code-side beyond the above. What's actually still open:

- Run the smoke test against a real dev Postgres: migrate, seed, then
  exercise `createTeam` → `joinTeam` → `startRound` → `openNextLot` →
  `placeBid` → `closeLot` end to end and confirm the audit log and
  inventory ledger read back sensibly.
- Stand up `backend/` locally alongside `frontend/` and confirm a
  broadcast actually reaches a connected WebSocket client.
- Your review of the authorization model: right now `createTeam` allows
  team creation whenever `event.status` is `setup` or `lobby` — confirm
  that matches how you want registration to actually be gated (e.g.
  whether moderators pre-create teams vs. teams self-serve with a join
  code, and whether registration should ever be allowed to stay open past
  `lobby`).
