# Phase 3 — Stage 2: inventory, trading, building, bank, inspections

## What changed

- **`packages/game-engine/src/inventory-service.ts`** — the queryable view
  Section 5.4 describes: current stock is always `SUM(quantity_delta)`,
  computed fresh, never a mutable column. Used by every other Phase 3
  service to check "does this team actually have enough" before consuming
  anything.
- **`trade-service.ts`** — propose → moderator registers (this is the
  "pink slip" moment, `binding` flips true) → moderator completes (atomic
  ledger movement for both sides, both `trade_count`s increment together)
  → or reject/cancel at any point before completion. A handshake deal is
  deliberately never represented in the system at all — see the file's
  top comment for why that's the faithful reading of "not enforced."
- **`bank-service.ts`** — finite bank stock purchase with the 10%/20%
  (rare: Steel/Glass/Medical) tax, rounded up per the rulebook. Locks every
  `bank_stock` lot for the material being bought before checking total
  availability, so two teams buying the last of something concurrently
  can't both see it as available.
- **`building-service.ts`** — exact recipe check (fails on even one
  missing unit, before anything is consumed), deed issuance, and all three
  bonuses (Eco/Luxury/Landmark) — each optional, each consuming its own
  material, each capped at one per building by construction (there's no
  "add a bonus to an existing building" path, only at construction time).
  Every consumed unit — recipe and bonus alike — lands in
  `team_inventory_transactions` tagged with the building's id, which is
  what makes the Phase 3 acceptance check ("every building's consumed
  materials can be traced to inventory sources") true by construction, not
  by convention.
- **`inspection-service.ts`** — 150 tokens charged the moment a challenge
  is filed (forfeited on a pass, per the rulebook), and a failed inspection
  reads back the exact consumed-material rows tagged to that building and
  recreates them as fresh `bank_stock` lots — "materials go to the bank,"
  not back to the team that built it.
- **9 new tests, 17 total, still against real Postgres** (see Phase 2 for
  the harness). Covers: construction fails on one missing unit; a
  successful build with Eco+Landmark bonuses traces every consumed unit
  back through the ledger; Luxury bonus rejected on an ineligible recipe;
  trade completion conserves total quantity across teams and the 5th trade
  is refused once the limit is hit; bank purchase tax math and stock
  depletion; a failed inspection voids the building and returns materials
  to the bank, not the target team.
- **API routes** for every new command (`trades`, `trades/:id/{register,
  complete,reject,cancel}`, `bank-purchases`, `buildings`,
  `buildings/:id/void`, `inspections`, `inspections/:id/resolve`) plus two
  read models (`teams/:id/inventory`, `bank-stock`). `next build` passes
  clean — 22 routes total now.

## A real gap found while wiring API routes, fixed everywhere at once

Writing the routes surfaced that **none of Phase 1/2/3's engine functions
actually verified the caller's role themselves** — `placeBid`,
`startRound`, `proposeTrade`, `purchaseFromBank`, `constructBuilding`,
`requestInspection`, `registerTrade`, `completeTrade`, `rejectTrade`,
`cancelTrade`, `voidBuilding`, `resolveInspection` all just *trusted* a
`participantId` parameter without checking it was actually that team's
leader (for team actions) or actual event staff (for moderator actions).
The API-route layer was the only thing enforcing it, which contradicts
Section 4 outright: "all rules are evaluated server-side" means inside the
engine, not "inside whichever caller happens to check first." Fixed by
adding two shared helpers to `team-service.ts` —
`assertTeamLeaderTx`/`assertTeamLeaderOrStaffTx` (team-scoped) and
`assertStaffTx` (moderator-scoped) — and wiring them into every one of the
functions above, including retrofitting Phase 1/2's `auction-service.ts`.
Two regression tests lock this in: a non-leader team member is rejected
from construction/bank-purchase/trade-proposal/inspection-request, and a
non-staff participant is rejected from every moderator-only action, even
when the target id doesn't exist (the auth check runs before the
existence check).

## Deviations, called out plainly

- **`bank_purchases.material_lot_id`** (Section 5.4) models one purchase
  as targeting a single lot. A real purchase here can span multiple
  partially-depleted `bank_stock` lots (buy 30 units when the bank has two
  lots of 20 left over from two different unsold auction lots). The
  `bank_purchases` row still gets written (with the first lot as a
  representative reference) and the actual quantity moved is fully
  correct and traceable via `team_inventory_transactions`, but the
  single-lot FK doesn't capture the full split. Flagging this rather than
  quietly picking one lot and pretending it's the whole story.
- **The Eco Incentive Market Shock's +15-instead-of-+10 override** (noted
  as deferred in Phase 2) is still not wired through — `constructBuilding`
  always applies the standard +10 for an Eco bonus. There's no per-unit
  record linking "this Solar came from a free-this-round lot" to check
  against. Said again here since Stage 2 construction was the natural
  place it would have landed.
- Construction is intentionally allowed from **either** the team leader
  or event staff (`assertTeamLeaderOrStaffTx`), unlike every other Phase 3
  action which is strictly one or the other — this matches Section 8.1's
  own annotation ("Team leader/moderator, according to selected
  workflow") and the rulebook's real desk process (a team hands materials
  to a moderator who checks and enters them).

## What's still deferred

- No Trade & Build UI screen yet (Section 7.5) — Phase 3 prioritized the
  engine, its tests, and closing the authorization gap over a fourth round
  of frontend screens in one sitting. The API surface is complete and
  tested; the screen is a comparatively mechanical follow-up once you've
  seen how Phase 2's two screens read.
- Optional leftover-material scoring (`leftover_scoring_enabled` in
  `event_settings`) isn't touched yet — that's a Phase 4 scoring-time
  calculation, not a Stage 2 concern.
- Advanced city-preference scoring is untouched — Phase 4.

## What's left for you

- The `bank_purchases.material_lot_id` single-lot-reference deviation
  above — flag if you'd rather see a proper `bank_purchase_lines` child
  table before Phase 4, or if the current ledger-based traceability is
  good enough for how the moderator desk will actually use this data.
- Whether construction should stay leader-or-staff, or whether you want it
  restricted to one or the other for your event's actual physical
  process.
