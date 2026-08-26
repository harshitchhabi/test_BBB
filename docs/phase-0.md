# Phase 0 — Confirm game settings and seed content

## What changed

- Fresh repo initialized at the project root (not inside the legacy `my-bid`
  clone — that stays local-only, git-ignored, reference material). Branch:
  `codex/bricks-by-bid-event-engine`.
- Full Section 5 Drizzle schema written under `packages/db/schema/`, split
  by domain (`identity`, `materials`, `auction`, `inventory`, `buildings`,
  `cities`, `scoring`, plus a shared `enums.ts`) — 28 tables total. This
  covers the whole plan, not just the Phase-0 subset, because Drizzle
  generates one migration from the whole schema graph and later phases'
  tables reference Phase-0 tables (e.g. `auction_lots.material_lot_id` →
  `material_lots`). Only the **seed data** is Phase-0 scoped; no
  auction/trade/building/city runtime rows are created by this phase.
- `npx drizzle-kit generate` run successfully (offline schema diff, no DB
  connection made) → `packages/db/migrations/0000_init_event_portal.sql`,
  429 lines, 20 enum types, all FKs resolved, all three unique indexes
  present. Full `tsc --noEmit` passes.
- Seed content written and cross-reference-validated in
  `packages/db/seed/data.ts` + `run.ts`:
  - 13 material types (Bricks, Cement, Steel, Wood, Glass, Pipes, Wires,
    Medical, Furniture, Marble, Tiles, Solar, Blueprint) with the rulebook's
    exact per-team lot quantities and opening bids, `isRare` set for Steel/
    Glass/Medical (Stage 2 bank tax), `isBonusOnly` set for Solar/Blueprint
    (never a recipe ingredient).
  - 6 Market Shock cards (Steel Embargo, Construction Boom, Glass Surplus,
    Supply Crunch, Investor Grant, Eco Incentive) with a machine-readable
    `effectJson` the Phase 2 auction engine will interpret, instead of a
    hard-coded switch statement.
  - 9 building recipes (Park through Hospital/Industry) with exact
    recipe_requirements, transcribed from rulebook Appendix A.
  - 40 cities across Blocks 1–4 with tier, opening bid, hidden multiplier,
    trap/sleeper flags, and preferred-building hints from Appendix B/C.
    Verified programmatically: every recipe/material key a seed row
    references actually exists, and each block's "every building type is a
    preferred type for exactly three cities" balance claim holds.
- Legacy repo read in full before any of this was written: confirmed the
  gap-assessment table against the actual code —
  `packages/db/schema.ts` (single `tokens` int, no event scoping),
  `backend/lib/bidding-manager.ts` vs. `backend/websocket-server.ts` (two
  independent in-memory bidding managers, one hard-coding three team IDs,
  neither persisting sessions/bids/timers, both racing to mutate
  `teams.tokens` directly with no row locking), `frontend/src/auth.ts`
  (NextAuth + Google provider + `participants` upsert-on-sign-in — this
  pattern is being kept), and the team create/join/bid API routes (`ownerId`
  == sole write permission, no leader/member role table, no event scoping).

## Deviations from the plan's Section 5 (and why)

1. **`market_shock_cards` table added.** Section 5's ERD has
   `auction_rounds.market_shock_id` but never defines the table it points
   to. Added an event-scoped `market_shock_cards` table with a JSON
   `effectJson` column so the shock deck stays configurable per Section 2.2
   ("Active Market Shock deck" must not be hard-coded).
2. **`material_types` gained `default_lot_quantity` / `default_opening_bid`.**
   The plan puts quantity/opening_bid only on `material_lots` (an
   already-materialized lot), but Phase 1's round/lot generator needs a
   *template* to stamp out one lot per team per material when a round
   starts. These two columns are seed/reference values only — every real
   `auction_lots` row still snapshots its own `opening_bid` at open time, so
   editing the template later never rewrites a lot that's live or sold.
3. **`team_members` gained a denormalized `event_id`.** The plan's ERD has
   `team_members(team_id, participant_id)` only. A team-scoped unique index
   can't stop one participant from joining a *second* team in the same
   event. Carrying `event_id` lets the schema itself enforce
   one-team-per-event-per-participant via a unique index, instead of
   relying on application code to remember the check.
4. **Block 5 cities not seeded — a gap in the rulebook itself, not a
   schema deviation.** Appendix C (Secret Multiplier Key) lists Block 5's
   ten cities and their multipliers, but Appendix B (the tier/opening-bid/
   preferred-buildings table) only prints Blocks 1–4; Block 5's table is
   simply absent from the source document. Seeding 40 cities across Blocks
   1–4 already exceeds "one block per 8–10 teams" for any realistic event
   size, so this doesn't block anything — but flagging it now rather than
   guessing at tier/preference data the rulebook never specified. The
   multipliers are preserved in `seed/data.ts` under
   `BLOCK_5_MULTIPLIERS_ONLY_NO_TIER_DATA` for whenever you supply the
   missing half.

## Security note (separate from the plan, found while reading the legacy repo)

`my-bid/packages/db/.env` is tracked in the legacy repo's git history with a
live Supabase Postgres password. You said you'd rotate it yourself — this
new repo never reads or references that credential; `packages/db/.env` here
is git-ignored and ships only a `.env.example` with a local placeholder.

## What's left in Phase 0

- Nothing left in the *code* — schema and seed data are complete and
  verified offline. What's outstanding is **your review**: Phase 0's
  acceptance check is "a moderator can review the entire game configuration
  before players enter." That's this document plus `packages/db/seed/data.ts`.
  Specifically worth your eyes on:
  - Auction lot durations and city auction durations were not specified
    anywhere in the rulebook as fixed numbers (it's explicitly
    moderator-selected) — I defaulted `auction_lot_duration_seconds` to 60
    and `city_auction_duration_seconds` to 45 in `event_settings`. Change
    these before the event if you have real numbers.
  - `inspections_enabled` defaults to `false` and `scout_reports_enabled`
    defaults to `true`, matching the plan's Section 5.2 recommended
    defaults — confirm that's what you actually want for this event.
  - The seed script has not been run against a real database yet (no dev
    Postgres provisioned in this session). Running it is a two-command
    smoke test once you have `DATABASE_URL` pointed at your own dev
    instance: `npm run migrate` then `npx tsx seed/run.ts`.
- Not started: Phase 1 (event-scoped schema *execution* against a live DB,
  roles wiring, the consolidated server-side auction service, audit-log
  helper, transaction helpers, deprecating the legacy one-balance model).
