# Moderator Quick Guide — Bricks by Bid

One page per situation. If the portal is behaving correctly and you just
need to run the event, you only need Sections 1–4. Sections 5–6 are for
when something goes wrong.

## 1. Before doors open

1. Confirm `packages/db/seed/data.ts` matches what you actually want for
   this event (materials, recipes, Market Shock deck, city blocks,
   `event_settings` defaults) — see `docs/phase-0.md` for exactly what was
   seeded and what wasn't (Block 5 cities are not seeded; the rulebook
   itself never printed their tier/preferred-building table).
2. Run the seed script once against your event's database:
   `cd packages/db && npx tsx seed/run.ts "Your Event Name"`.
3. Have teams register (create/join a team via a join code) while
   `event.status` is `setup` or `lobby`.
4. Confirm every real moderator has a row in `event_staff` for this event
   — only staff can start rounds, open/close lots, resolve trades and
   inspections, void/reopen, adjust balances, or reveal cities. There is
   no UI for this yet; it's a direct database insert (`INSERT INTO
   event_staff (event_id, participant_id, role) VALUES (...)`) — flag if
   you want a self-serve invite flow before your next event.

## 2. Running Stage 1 (material auction)

- Moderator console: `/events/:id/moderator/auction`.
- One round per material, sequential lots within a round. "Start round"
  picks the material; the engine handles the Market Shock draw
  automatically (nothing to do — the screen shows the card if one was
  drawn) and computes the shock-adjusted opening bid.
- "Open next lot" starts the timer. Teams bid from
  `/events/:id/auction` — only the team leader's button is active for
  everyone else, with the reason shown.
- Lots close themselves when the timer runs out (checked every 2 seconds
  by the backend relay) — you don't have to click "Close lot" unless you
  want to end it early.
- A round can't be started again until every lot in the previous round has
  closed — if "start round" says "already active," finish/close the
  current lot first.

## 3. Running Stage 2 (trade and build)

No dedicated screen yet (see `docs/phase-3.md`) — these are the raw
commands a screen will eventually wrap; call them directly if you need to
run Stage 2 before that screen exists:

- **Register a pink-slip trade**: `POST /api/events/:id/trades` (team
  leader proposes) → `POST /api/events/:id/trades/:tradeId/register`
  (you) → `POST /api/events/:id/trades/:tradeId/complete` (you, once both
  sides are physically ready). A handshake deal never touches the system
  at all — that's intentional (see `docs/phase-3.md`).
- **Bank purchase**: `POST /api/events/:id/bank-purchases` with
  `{teamId, materialTypeId, quantity}` — tax is computed automatically
  (10%, 20% on Steel/Glass/Medical).
- **Construction**: `POST /api/events/:id/buildings` with
  `{teamId, recipeId, bonuses}` — fails cleanly with `recipe_incomplete`
  if even one unit is missing. Either the team leader or you can submit
  this one (Section 8.1's own note: "according to selected workflow").
- **Inspection**: `POST /api/events/:id/inspections` (challenger team
  leader; charges 150 immediately) → `POST /api/events/:id/inspections/
  :inspectionId/resolve` with `{result: "passed"|"failed"}` (you). A
  failed building's materials go back to the bank, not the builder.

## 4. Running Stage 3 (city auction and reveal)

- Same shape as Stage 1: `POST /api/events/:id/cities/:cityId/start-
  auction`, teams bid via `POST /api/events/:id/city-auctions/:auctionId/
  bids`, you close via `.../close` (or let the timer sweep it).
- A team that already won a city is rejected automatically if it tries to
  bid again.
- **Last team, last city**: once exactly one team has no city and exactly
  one city is unsold, use `POST /api/events/:id/cities/:cityId/assign-
  last` with `{teamId}` instead of running a pointless auction — it
  assigns at the city's opening bid.
- Scout reports: `POST /api/events/:id/scout-reports` with
  `{teamId, cityId}` — capped at 2 per team, one per team per city.
- **Reveal**: `POST /api/events/:id/cities/reveal`. This is the one big
  irreversible step — it verifies every active team has a city, reveals
  every multiplier, computes every team's final score, and marks the
  event completed, all in one action. Do not call it until every city is
  sold.

## 5. When something goes wrong (CONTINGENCIES, mapped to actions)

| Situation | What to do |
|---|---|
| A team can't actually pay its winning bid | Nothing to do manually for the balance itself — `closeLot` already refuses to let it settle and marks the lot unsold. Then: `POST /api/events/:id/auction-lots/:lotId/reopen` with a reason to re-offer it immediately. |
| A bid is disputed, or you find a mistake before the lot closes | `POST /api/events/:id/bids/:bidId/void` with a reason. It does **not** auto-restore a previous bidder as the new leader — solicit fresh bids or reopen the lot yourself. |
| You need to undo an already-closed/sold lot entirely (wrong winner recorded, a scoring dispute, etc.) | `POST /api/events/:id/auction-lots/:lotId/reopen`. This refunds the winner's tokens, reverses the inventory credit (the original grant and its reversal both stay on record — nothing is deleted), and reopens the lot live. Works on `closed`, `unsold`, or `voided` lots. |
| A team drops out mid-game | `POST /api/events/:id/teams/:teamId/status` with `{status: "withdrawn", reason}`. Any city they'd already won is released back to unowned automatically; any bid they're currently winning on will fail to settle when that lot/city auction closes. Final standings only ever include `active` teams. |
| You need to disqualify a team (cheating, etc.) | Same endpoint, `{status: "disqualified", reason}`. |
| A balance dispute needs a manual correction | `POST /api/events/:id/teams/:teamId/adjust-tokens` with `{auctionTokensDelta, cityWalletTokensDelta, reason}`. Refuses to push either balance negative. |
| A genuine tied bid | The rulebook says your call is final — there's no "re-bid" command; just take the next bid from whichever team you point to, or flip a coin and note it as a `moderator.announcement` broadcast if you want it visible to everyone. |
| Running out of time | Cut list, in order, per the rulebook: (1) turn off Inspections/Scout Reports in `event_settings`, (2) shorten `auction_lot_duration_seconds`/`city_auction_duration_seconds`, (3) use `assign-last`-style direct assignment more liberally for slow city rounds, (4) batch-verify constructions at the end rather than live. |

## 6. Backup exports (moderator-only, work even if you need a paper trail)

- `GET /api/events/:id/exports/standings` — final standings as CSV
  (add `?format=json` for JSON instead).
- `GET /api/events/:id/exports/audit-log` — every mutation, actor, reason,
  and before/after state, as CSV. This is your dispute record — every
  void, reopen, withdrawal, and balance adjustment above is in here with
  who did it and why.

Team inventory statements and bid-history-per-lot exports aren't built as
dedicated endpoints yet — `GET /api/events/:id/teams/:teamId/inventory`
gives you the current stock (JSON only) in the meantime.
