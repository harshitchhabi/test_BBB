# Bricks by Bid — Event Portal

Rebuild of the "Bricks by Bid" event portal against `EVENT_PORTAL_IMPLEMENTATION_PLAN.md`
(the spec) and the rulebook (`bbb.1.docx`). Built fresh in this repo; the
legacy implementation at https://github.com/Dream-Merchants-VIT/my-bid is
kept locally under `my-bid/` (git-ignored, reference only — its auth
pattern, Next.js/Drizzle conventions, and folder layout are being reused
where they fit; its game-state model is being replaced per the plan's
Section 3 gap assessment).

Status: **Phase 2 complete** (see `docs/phase-0.md`, `docs/phase-1.md`,
`docs/phase-2.md`). Phase 3 (Stage 2: inventory ledger, trading, bank
purchases, construction/deeds, bonuses, inspections) not yet started.

## Layout

```
packages/db/          Drizzle schema (schema/), migrations/, seed data (seed/)
packages/common/      Shared types: WS event envelope, role vocabulary
packages/game-engine/ The one server-side game rules engine — every mutation
                       goes through here (team/auction/market-shock services,
                       tx + audit + broadcast helpers). Has a real test suite
                       (tests/) run against a real Postgres — see phase-2.md.
frontend/             Next.js app: Google auth (ported from legacy) +
                       Section 8.1 command endpoints under src/app/api/**,
                       plus the Stage 1 team/moderator screens
backend/              WebSocket broadcast relay + the timer-expiry sweep
                       (still zero game rules of its own — see phase-2.md)
```

## Running it locally

```
# 1. Point packages/db/.env and frontend/.env at your own dev Postgres +
#    OAuth credentials (see each package's .env.example).
cd packages/db && npm run migrate && npx tsx seed/run.ts "Test Event"

# 2. In one terminal — the WS relay + timer sweep:
cd backend && npm run dev

# 3. In another — the app:
cd frontend && npm run dev

# Run the game-engine's automated test suite (spins up its own throwaway
# Postgres, no setup needed):
cd packages/game-engine && npm test
```

## Local setup

```
cd packages/db
cp .env.example .env   # point at your own local/dev Postgres — never the
                        # legacy repo's credentials
npm install
npm run migrate
npx tsx seed/run.ts "Your Event Name"
```
