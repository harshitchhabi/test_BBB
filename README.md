# Bricks by Bid — Event Portal

Rebuild of the "Bricks by Bid" event portal against `EVENT_PORTAL_IMPLEMENTATION_PLAN.md`
(the spec) and the rulebook (`bbb.1.docx`). Built fresh in this repo; the
legacy implementation at https://github.com/Dream-Merchants-VIT/my-bid is
kept locally under `my-bid/` (git-ignored, reference only — its auth
pattern, Next.js/Drizzle conventions, and folder layout are being reused
where they fit; its game-state model is being replaced per the plan's
Section 3 gap assessment).

Status: **Phase 0 complete** (see `docs/phase-0.md`). Phase 1 (event-scoped
schema execution, roles, consolidated auction service, audit log) not yet
started.

## Layout

```
packages/db/       Drizzle schema (schema/), migrations/, seed data (seed/)
packages/common/    (not yet populated — shared types land here in Phase 1+)
frontend/           (not yet scaffolded)
backend/            (not yet scaffolded)
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
