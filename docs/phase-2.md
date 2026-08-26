# Phase 2 — Stage 1 live auction

## What changed

- **Real automated tests, run against real Postgres.** No Docker/Postgres
  binary is available in this environment, so `packages/game-engine/tests/`
  spins up `@electric-sql/pglite` (actual Postgres compiled to WASM)
  exposed over a genuine TCP socket via `@electric-sql/pglite-socket` — the
  exact same `pg.Pool` + `drizzle-orm/node-postgres` stack production uses
  connects to it unchanged, migrations run from the real
  `packages/db/migrations` folder, and the tests call the real
  `auction-service.ts` functions, not a mock. `npm test` inside
  `packages/game-engine` runs 9 tests covering the Section 10 Stage-1
  bullets: bid below minimum raise rejected (and persisted), bid from a
  non-leader forbidden, bid after close rejected, a settled winner produces
  exactly one inventory credit and one token debit, two concurrent bids on
  one lot leave exactly one winner with no double-charge, an unsold lot
  moves to bank stock, and the timer sweep settles an expired lot. This
  caught one real bug (below) before it ever reached a UI.
- **Bug found and fixed: rounds never completed.** Nothing in the Phase 1
  code ever flipped `auction_rounds.status` away from `"active"`, so
  `startRound`'s "only one active round at a time" guard would have
  permanently blocked every round after the first the moment it shipped.
  Added `completeRoundIfFinished` — once every lot in a round has left
  pending/live (closed, unsold, or voided), the round is marked
  `completed` and `events.active_round_id` is cleared. Found by writing the
  Market Shock test (which starts two rounds in sequence), not by
  inspection — the value of running these against real Postgres rather
  than trusting the typecheck.
- **`packages/game-engine/src/market-shock-service.ts`** — the Stage 1
  deck. Cards are drawn from a finite pool (`copies_in_deck` per card,
  already seeded in Phase 0) computed as remaining = copies − rounds that
  already drew that card, so a card can't appear more than its physical
  deck would allow. Wired into `startRound`: every round after the first
  draws one card, applies whichever part of its effect concerns *this*
  round's material (opening-bid multiplier, first-lot discount, free
  material), and applies global effects (permanent recipe-point bumps,
  immediate token grants to every team) unconditionally. See the file's
  top comment for the deliberate interpretation of a card whose material
  doesn't match the current round — it's revealed with a note explaining
  it had no effect, not silently dropped or blocked.
- **Timer-driven auto-close.** `closeExpiredLots()` in `auction-service.ts`
  sweeps all `live` lots whose `closes_at` has passed and closes them via
  the same `closeLot` every other path uses (system-driven: `actorParticipantId: null`).
  `backend/` now runs this on a 2-second interval (configurable via
  `TIMER_SWEEP_INTERVAL_MS`, disable with `ENABLE_TIMER_SWEEP=false`) — the
  one long-running process that can poll it, since a serverless Next.js API
  route can't hold a persistent interval. This is the only place `backend/`
  gained DB access (via `game-engine`, not by reimplementing any rule) —
  everything it triggers still runs through the single auction service.
- **Read model + UI.** `GET /api/events/:id/auction-state` (current round,
  live lot with current highest bid and next minimum, pending-lot count,
  team balances with everyone but your own team's tokens stripped for
  non-staff callers) backs two real, working pages: the team Live Auction
  screen (Section 7.3 — bid box only enabled for the team leader, disabled
  with a reason otherwise) and a Stage 1 Auction Control slice of the
  moderator console (Section 7.8/7.9 — start round, open next lot, close
  lot). Both poll the read model and also listen on the WebSocket relay
  for a nudge to refetch — the WS payload itself is never trusted as the
  source of truth, only as a "something changed, go re-fetch" signal.
- Manually smoke-tested `backend/`'s HTTP surface directly (health check,
  authenticated vs. unauthenticated broadcast) — both behave as expected.
- Full `next build` and all package typechecks still pass clean with
  everything above added.

## What's covered vs. still deferred

Covered now: round start with shock draw/application, lot open/bid/close,
round completion, timer sweep, a working (if unstyled) team + moderator UI
for all of the above.

Still deferred, explicitly Phase 5 ("rehearsal hardening") or later, not
silently dropped:

- `openNextLot` still doesn't take a row lock before its "is another lot
  already live" check — flagged in Phase 1's doc already, unchanged.
- The `smallest_unsold_lot_price_increase` Market Shock effect
  (Supply Crunch) only *identifies* the affected material and logs a note
  for the moderator to apply manually via `openingBidOverride` on the next
  `startRound` call for that material — it doesn't reach forward and
  change a round that hasn't started yet. Said plainly in the code comment
  and here so it isn't mistaken for a full implementation.
- Bank stock (unsold lots) has no purchase flow yet — that's Stage 2
  (Phase 3), Phase 2 only needed unsold lots to land in the right status,
  which the tests confirm.
- The moderator round-start UI takes a raw material type ID rather than a
  picker — Phase 3's build-desk work is a natural place to add a materials
  browser shared by both.

## Deviations, called out plainly

- A drawn shock card whose material doesn't match the current round is
  revealed anyway with a "no effect" note, rather than the deck skipping
  non-matching cards or a moderator hand-picking a relevant one each round.
  This is a genuine interpretive call on an underspecified rulebook
  mechanic (cards are written as if always relevant to the round they're
  drawn in, but the deck is drawn independently of which material is
  live) — flagging it for your review rather than presenting it as the
  only reading.
- `packages/db/index.ts` gained a `DB_POOL_MAX` env var used only by the
  test harness (pglite-socket can't reliably multiplex more than one
  connection). Unset in every real deployment, where `pg.Pool`'s normal
  default applies.

## What's left for you

- Skim `packages/game-engine/tests/` once — these are the actual
  acceptance tests Section 10 asks for, not just typechecks, and they're
  worth having in front of you before Phase 3 adds more to the same
  transactional core (trades, bank purchases, construction).
- The Market Shock interpretive call above — tell me if you want a
  different rule (e.g., only cards matching the current round are eligible
  to be drawn, redrawing otherwise) before Phase 3 builds more on top of
  this deck logic.
- Try the two new pages once you have a dev DB seeded with a team and an
  event in `stage_1` — `/events/:id/auction` (team) and
  `/events/:id/moderator/auction` (staff).
