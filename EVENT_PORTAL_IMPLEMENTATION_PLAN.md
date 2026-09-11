# Bricks by Bid — Event Portal Implementation Plan

## 1. Purpose

This document defines the recommended rebuild of the existing bidding portal for the **Bricks by Bid** event.

The goal is to make the portal the reliable source of truth for a live, moderator-led game where teams:

1. Buy scarce materials in sequential live auctions.
2. Trade and build a property portfolio.
3. Buy one city with a hidden multiplier.
4. Receive an auditable final score and ranking.

The current portal is a helpful UI and authentication starting point, but its game state and data model need a substantial refactor to match the rulebook.

---

## 2. Rulebook model

```text
Team creation and event check-in
        |
        v
Stage 1 — Material auction
  Sequential material lots + market shocks
        |
        v
Stage 2 — Trade and build
  Team trades + finite bank + recipes + deeds
        |
        v
Stage 3 — City auction
  Scout reports + hidden multiplier + one city per team
        |
        v
Final scoring and tiebreaker
```

### 2.1 Standard event rules to encode

| Area | Standard rule |
|---|---|
| Teams | Best at 3–5 people; one designated leader uses write actions. |
| Auction budget | Every team starts Stage 1 with **1,000 auction tokens**. |
| City wallet | Every team receives a separate **500-token sealed city wallet** for Stage 3. |
| Stage 1 auction | The moderator sells one lot at a time, sequentially, grouped by material round. |
| Bid increments | Minimum raise: 50 tokens, or 25 when the opening bid is below 100. |
| Market shocks | One card is revealed at the start of each round after the first. |
| Trading | Free material-for-material swaps; maximum **four** team trades. |
| Bank | Only unsold material stock is available; bank purchases use a tax. |
| Construction | A team must provide the exact recipe to create a building and receive a deed. |
| Bonuses | Eco +10, Luxury +5, Landmark +20; each applies once per building. |
| City auction | One city per team; cities have visible tiers but hidden multipliers. |
| Scout reports | Cost 100 tokens; maximum two reports per team. |
| Winner | Highest building score plus bonuses, multiplied by city multiplier. |
| Ties | Most buildings → most valuable building → most unspent tokens. |

### 2.2 Rules that must be configurable

Do not hard-code these in React components or constants. Store them on the event so a moderator can select a version before the event starts.

- Auction timer length.
- Active Market Shock deck.
- Inspection module enabled/disabled.
- Scout report module enabled/disabled.
- Leftover material scoring enabled/disabled.
- Standard or advanced city scoring.
- Number of city blocks used.
- Exact materials, lots, recipes, city multipliers, and city preferences.
- Bank tax percentage for normal and rare materials.

---

## 3. Gap assessment: current portal vs. required portal

| Current capability | Keep? | Required change |
|---|---:|---|
| Next.js frontend | Yes | Keep the app structure; replace the game workflow. |
| Google login | Yes | Add event access and moderator/team-leader roles. |
| Team creation and joining | Yes | Scope teams to an event and enforce team-size limits if desired. |
| One `tokens` balance | No | Split auction balance, city-wallet balance, and reserved spend. |
| Simple material items | No | Use material definitions, individual material lots, and a ledger-based inventory. |
| Timed live bid | Partly | Persist each auction, lot, and bid; use rule-aware increments and controls. |
| Cart / won items | No | Replace with Inventory & Portfolio: material stock, constructed buildings, deeds, city, and score. |
| WebSocket updates | Yes | Make the database authoritative; WebSockets only broadcast committed changes. |
| Admin bid page | Partly | Evolve into a full moderator console for setup, auction, trade, construction, cities, scoring, and incidents. |
| Static rules page | No | Display the selected event settings and current stage. |

### 3.1 Important issues to fix before building new features

1. **Unify the bidding service.** The project currently has separate in-memory bidding implementations. There must be one server-side auction service.
2. **Persist all live state.** A server restart must not erase an active auction, bids, team balances, or winners.
3. **Use transactions and row locking.** A bid must verify balance, insert the bid, select the leader, and close the lot safely under concurrency.
4. **Never trust a client balance.** The server calculates valid bid amount, available funds, inventory, trade limits, and score.
5. **Add an audit log.** Moderators need to explain every reversal, trade approval, build, inspection, and final score.

---

## 4. Architecture recommendation

```text
                         +---------------------+
                         | PostgreSQL database |
                         | source of truth     |
                         +----------+----------+
                                    |
                       transactional commands
                                    |
+-------------------+    +----------v----------+    +--------------------+
| Team portal       |<-->| Next.js API/service  |<-->| Moderator portal   |
| leader + viewers  |    | game rules engine    |    | event operations   |
+-------------------+    +----------+----------+    +--------------------+
                                    |
                              committed events
                                    |
                           +--------v--------+
                           | WebSocket layer |
                           | live updates    |
                           +-----------------+
```

### Principles

- **Database first:** changing the UI cannot change the game state directly.
- **Server-authoritative:** all rules are evaluated server-side.
- **Append-only where possible:** bids, inventory movements, payments, audit events, and score snapshots should remain explainable.
- **Event scoped:** every team, lot, recipe, city, and transaction belongs to an event.
- **Moderator override with reason:** emergencies happen; every manual override must be recorded with actor, reason, before state, and after state.

---

## 5. Detailed data schema

### 5.1 Entity relationship overview

```text
events
  ├── event_settings
  ├── event_staff
  ├── teams ───────────── team_members
  ├── material_types ──── material_lots
  ├── auction_rounds ──── auction_lots ──── bids
  ├── team_inventory_transactions
  ├── trades ──────────── trade_lines
  ├── building_recipes ── recipe_requirements
  ├── constructed_buildings ── building_bonus_uses
  ├── cities ──────────── city_preferences
  ├── scout_reports
  ├── city_auctions ───── city_bids
  ├── inspections
  ├── score_snapshots
  └── audit_log
```

### 5.2 Identity and event tables

#### `events`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key. |
| `name` | text | Event display name. |
| `status` | enum | `setup`, `lobby`, `stage_1`, `stage_2`, `stage_3`, `scoring`, `completed`, `paused`. |
| `active_round_id` | UUID nullable | Current Stage 1 auction round. |
| `active_city_auction_id` | UUID nullable | Current Stage 3 city auction. |
| `rules_version` | text | Human-readable rulebook version. |
| `created_at`, `started_at`, `completed_at` | timestamp | Lifecycle tracking. |

#### `event_settings`

| Field | Type | Recommended default |
|---|---|---:|
| `event_id` | UUID | Unique FK to event. |
| `stage_1_starting_tokens` | integer | 1000 |
| `city_wallet_tokens` | integer | 500 |
| `minimum_raise_standard` | integer | 50 |
| `minimum_raise_low_opening` | integer | 25 |
| `low_opening_threshold` | integer | 100 |
| `trade_limit` | integer | 4 |
| `normal_bank_tax_percent` | integer | 10 |
| `rare_bank_tax_percent` | integer | 20 |
| `scout_report_cost` | integer | 100 |
| `scout_report_limit` | integer | 2 |
| `inspection_cost` | integer | 150 |
| `auction_lot_duration_seconds` | integer | Moderator-selected |
| `inspections_enabled` | boolean | false by default |
| `scout_reports_enabled` | boolean | true by default |
| `leftover_scoring_enabled` | boolean | false by default |
| `advanced_city_scoring_enabled` | boolean | false by default |

#### `teams`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key. |
| `event_id` | UUID | Required FK. |
| `name`, `code` | text | Code unique within an event. |
| `owner_participant_id` | UUID | Team leader. |
| `auction_tokens` | integer | Starts at 1,000. |
| `city_wallet_tokens` | integer | Starts at 500. |
| `trade_count` | integer | Count of completed team-to-team trades. |
| `status` | enum | `active`, `withdrawn`, `disqualified`. |
| `created_at` | timestamp | Audit field. |

#### `team_members`

| Field | Type | Notes |
|---|---|---|
| `team_id`, `participant_id` | UUID | Composite unique index. |
| `role` | enum | `leader` or `member`. |
| `joined_at` | timestamp | Audit field. |

### 5.3 Stage 1: materials and auctions

#### `material_types`

One record for each material: Bricks, Cement, Steel, Wood, Glass, Pipes, Wires, Medical, Furniture, Marble, Tiles, Solar, Blueprint.

| Field | Type | Notes |
|---|---|---|
| `id`, `event_id` | UUID | Event-scoped material definition. |
| `key`, `name` | text | Stable server-facing key and human name. |
| `unit_label` | text | For example, `units`, `panels`, or `blueprint`. |
| `sticker_price` | integer | Used to calculate / explain opening price. |
| `is_rare` | boolean | Used for bank tax. |
| `is_bonus_only` | boolean | True for material that is not a recipe material. |
| `sort_order` | integer | Moderator UI ordering. |

#### `material_lots`

Represents a real finite lot in the game. It is the unit being auctioned, held by the bank, or transferred to a team.

| Field | Type | Notes |
|---|---|---|
| `id`, `event_id`, `material_type_id` | UUID | Required references. |
| `quantity` | integer | Quantity represented by this lot. |
| `opening_bid` | integer | Base price before any active shock. |
| `source` | enum | `auction`, `bank`, `event_grant`, `manual`. |
| `status` | enum | `available`, `auctioning`, `sold`, `bank_stock`, `consumed`, `voided`. |
| `owner_team_id` | UUID nullable | Set when team owns it. |

#### `auction_rounds`

| Field | Type | Notes |
|---|---|---|
| `id`, `event_id`, `material_type_id` | UUID | One round per material. |
| `sequence` | integer | Controls the material order. |
| `status` | enum | `planned`, `active`, `completed`, `cancelled`. |
| `market_shock_id` | UUID nullable | Revealed shock for this round. |
| `started_at`, `closed_at` | timestamp | Lifecycle. |

#### `auction_lots` and `bids`

`auction_lots` tracks the live sale of one lot. `bids` is append-only bid history.

| `auction_lots` field | Notes |
|---|---|
| `round_id`, `material_lot_id`, `lot_number` | Identifies the sold lot. |
| `opening_bid`, `minimum_raise` | Snapshot rule values at lot opening. |
| `status` | `pending`, `live`, `closed`, `unsold`, `voided`, `reopened`. |
| `opens_at`, `closes_at` | The authoritative timer. |
| `winning_bid_id`, `winner_team_id` | Filled only when closed. |

| `bids` field | Notes |
|---|---|
| `auction_lot_id`, `team_id`, `amount`, `submitted_at` | The bid record. |
| `status` | `accepted`, `outbid`, `rejected`, `voided`, `winning`. |
| `rejection_reason` | Never silently discard a rejected bid. |

### 5.4 Inventory and Stage 2 trading

#### `team_inventory_transactions`

This is the essential ledger. Do not rely only on a mutable stock counter.

| Field | Type | Notes |
|---|---|---|
| `id`, `event_id`, `team_id`, `material_type_id` | Required references. |
| `quantity_delta` | Positive for receipt; negative for spend/transfer. |
| `reason` | `auction_win`, `trade_out`, `trade_in`, `bank_purchase`, `construction`, `inspection_void`, `manual_adjustment`. |
| `related_entity_type`, `related_entity_id` | Links to bid, trade, building, etc. |
| `created_by`, `created_at` | Full audit trail. |

The current stock becomes a queryable view:

```text
current quantity for team and material = SUM(quantity_delta)
```

#### `trades` and `trade_lines`

| Table | Essential fields |
|---|---|
| `trades` | event_id, proposer_team_id, counterparty_team_id, status (`draft`, `submitted`, `registered`, `completed`, `cancelled`, `rejected`), binding, moderator_id, trade_number, timestamps |
| `trade_lines` | trade_id, from_team_id, material_type_id, quantity |

Rules enforced when a trade is completed:

1. Both teams are active.
2. The material quantities exist.
3. Neither team has exceeded its four-trade limit.
4. A moderator registers the trade if it must be binding.
5. Inventory ledger rows are inserted atomically for both sides.
6. Both `trade_count` values increment in the same transaction.

#### `bank_purchases`

| Field | Notes |
|---|---|
| `team_id`, `material_lot_id`, `quantity` | What is bought. |
| `base_price`, `tax_rate`, `tax_amount`, `total_cost` | Price snapshot for disputes. |
| `paid_from` | Usually auction-token balance. |
| `approved_by` | Moderator decision if required. |
| `status` | `requested`, `approved`, `completed`, `rejected`. |

### 5.5 Buildings, deeds, bonuses, and inspections

#### `building_recipes` and `recipe_requirements`

| Table | Essential fields |
|---|---|
| `building_recipes` | event_id, name, base_points, active, sort_order |
| `recipe_requirements` | recipe_id, material_type_id, required_quantity |

Seed recipes from the rulebook: Park, Vineyard, Home, Office, Mall, Apartment, University, Hospital, and Industry.

#### `constructed_buildings`

| Field | Notes |
|---|---|
| `team_id`, `recipe_id` | Who built what. |
| `deed_number` | Human-friendly, unique identifier for the moderator desk. |
| `base_points` | Snapshot from recipe at construction time. |
| `eco_bonus`, `luxury_bonus`, `landmark_bonus` | Snapshot values, zero when absent. |
| `status` | `approved`, `voided`. |
| `built_at`, `verified_by` | Audit record. |
| `voided_at`, `voided_reason` | Required if invalidated. |

#### `building_bonus_uses`

| Field | Notes |
|---|---|
| `constructed_building_id` | A building may have one row per bonus type. |
| `bonus_type` | `eco`, `luxury`, `landmark`. |
| `source_material_type_id` | Solar, Marble/Tiles, Blueprint. |
| `points` | 10, 5, or 20. |

#### `inspections`

| Field | Notes |
|---|---|
| `challenger_team_id`, `target_building_id` | Who challenged which building. |
| `cost`, `paid_from` | Normally 150 from allowed tokens. |
| `result` | `passed`, `failed`, `cancelled`. |
| `resolved_by`, `resolved_at` | Moderator decision. |

If an inspection fails, void the building and create compensating inventory/bank ledger records exactly according to the selected event policy.

### 5.6 Stage 3: cities, scouts, and city bids

#### `cities` and `city_preferences`

| Table | Essential fields |
|---|---|
| `cities` | event_id, block_number, name, tier, opening_bid, hidden_multiplier, reveal_state, assigned_team_id, sale_order |
| `city_preferences` | city_id, building_recipe_id |

The multiplier must be selected only in server-side queries until the reveal. Never send unrevealed multiplier values to the team browser.

#### `scout_reports`

| Field | Notes |
|---|---|
| `team_id`, `city_id` | A purchased hint. |
| `cost`, `paid_from` | 100 tokens, city wallet or leftover budget, based on rule setting. |
| `clue_type`, `clue_value` | For example `minimum_multiplier: 3.0`. |
| `purchased_at` | Used to enforce maximum two reports. |

#### `city_auctions` and `city_bids`

| Table | Essential fields |
|---|---|
| `city_auctions` | event_id, city_id, status, opening_bid, minimum_raise, opens_at, closes_at, winner_team_id, winning_bid_id |
| `city_bids` | city_auction_id, team_id, amount, city_wallet_used, auction_tokens_used, status, submitted_at |

Completion checks:

- A team may win exactly one city.
- A team cannot bid after it has a city.
- Spend cannot exceed the combined permitted city-auction funds.
- The final remaining team/city case follows the rulebook’s minimum-base assignment.

### 5.7 Score, tiebreaking, and auditing

#### `score_snapshots`

| Field | Notes |
|---|---|
| `event_id`, `team_id`, `phase` | Snapshot at build desk, reveal, final, etc. |
| `building_points`, `bonus_points`, `leftover_points` | Scoring components. |
| `city_multiplier`, `final_score` | Final calculation snapshot. |
| `rank`, `tiebreaker_rank` | Final placement data. |
| `calculation_json` | Fully explainable calculation details. |

#### `audit_log`

| Field | Notes |
|---|---|
| `event_id`, `actor_participant_id` | Who acted. |
| `action`, `entity_type`, `entity_id` | What changed. |
| `reason` | Mandatory for moderator overrides. |
| `before_json`, `after_json` | State evidence. |
| `created_at` | Timeline. |

---

## 6. Game engine workflows

### 6.1 Start an auction lot

```text
Moderator selects next lot
  → server confirms event is in Stage 1
  → server calculates shock-adjusted opening bid and increment
  → transaction marks previous lot complete and this lot live
  → committed event broadcasts live lot to all connected clients
```

### 6.2 Place a bid

```text
Team leader submits amount
  → authenticate user and verify team-leader role
  → lock active auction lot and team row
  → verify event stage, timer, lot status, increment, and spendable balance
  → insert accepted bid or rejected bid with reason
  → update highest bidder state
  → commit transaction
  → broadcast committed bid update
```

### 6.3 Close a lot

```text
Timer ends or moderator closes lot
  → lock auction lot
  → select highest valid bid
  → debit winner's auction tokens
  → mark lot sold and create material inventory credit
  → or move unsold lot into finite bank stock
  → store audit entry and broadcast result
```

### 6.4 Register and complete a trade

```text
Teams negotiate outside or in the portal
  → moderator registers the agreed trade
  → server validates stock and trade limits
  → trade becomes binding if registered
  → moderator completes the trade
  → atomic negative/positive inventory ledger entries for both teams
  → live inventories refresh for both teams
```

### 6.5 Construct a building

```text
Team chooses a recipe
  → server sums available inventory
  → server confirms every exact recipe requirement
  → server consumes materials through inventory ledger entries
  → creates constructed building + deed number + bonus records
  → recomputes team score snapshot
```

### 6.6 Final scoring

```text
Moderator reveals multipliers
  → server marks cities revealed
  → calculate each active team's score from approved, non-voided buildings
  → apply optional leftover and advanced-scoring policy
  → apply city multiplier
  → sort and apply ordered tiebreakers
  → persist final score snapshots
  → publish results
```

---

## 7. Product layout

### 7.1 Team portal navigation

```text
Event Home
├── Live Auction
├── Inventory
├── Trade & Build
├── City Auction
├── Portfolio & Score
└── Rules
```

### 7.2 Team home / event lobby

**Purpose:** orient teams before the event and between stages.

- Event title and current stage.
- Team name, members, and leader marker.
- Stage timeline with locked/unlocked states.
- Quick token cards: Stage 1 balance, city-wallet balance, trades remaining.
- Announcements from moderators.
- “Waiting for moderator” state when no action is available.

### 7.3 Live Auction screen

**Layout**

```text
+---------------------------------------------------------------+
| Stage 1: Material Auction | Round: Steel | Live / Timer       |
+-------------------------+-------------------+-----------------+
| Current lot             | Bid panel         | Team summary    |
| material, quantity      | opening bid       | auction tokens  |
| market shock effect     | min next bid      | inventory count |
| remaining time          | bid input/button  | recent wins     |
+-------------------------+-------------------+-----------------+
| Live bid history / auction outcome / moderator announcement  |
+---------------------------------------------------------------+
```

Rules for the UI:

- All members can watch.
- Only the authenticated team leader can submit a bid.
- Disable the bid button when the server declares it invalid; always show the reason.
- Show enough information to bid correctly, but never show other teams’ hidden data.
- Show recent auction outcomes after a lot closes.

### 7.4 Inventory screen

**Purpose:** replace the current cart.

Sections:

1. Material quantities by type.
2. Material source history: won, traded, bought from bank, consumed.
3. Available bank stock and tax rates during Stage 2.
4. Download/print-friendly inventory statement for moderator checks.

### 7.5 Trade & Build screen

```text
+--------------------------+---------------------------+
| Trade desk               | Build desk                |
| Trades remaining: 4      | Recipe cards              |
| Create/receive offer     | “Can build now” filter    |
| Registered trade status  | Missing material list     |
| Trade history            | Construct / request check |
+--------------------------+---------------------------+
| Constructed buildings / deeds / bonuses / current base score  |
+---------------------------------------------------------------+
```

Use moderator approval for binding registered trades and construction if the event keeps a physical moderator desk. The portal should support the moderator’s real-world process rather than force every interpersonal negotiation into software.

### 7.6 City Auction screen

Sections:

- Available city cards: name, visible tier, opening bid, and preference hints if advanced scoring is active.
- Wallet/balance cards.
- Scout-report purchase flow, showing only the purchasing team’s private clue.
- Current city auction with timer, bid entry, and result.
- Owned city state; once won, the team cannot bid further.
- Hidden multiplier placeholder until moderator reveal.

### 7.7 Portfolio and final score screen

Before reveal:

- Approved deeds and bonus points.
- Current pre-multiplier score.
- City name/tier without multiplier.

After reveal:

- Building points.
- Bonus points.
- Leftover points if enabled.
- City multiplier.
- Final score.
- Rank and tiebreaker explanation if needed.

### 7.8 Moderator console navigation

```text
Moderator Dashboard
├── Event Setup
├── Teams & Balances
├── Stage 1 Auction Control
├── Stage 2 Trade Desk
├── Build / Deed Desk
├── Stage 3 City Auction
├── Score & Reveal
├── Incident Console
└── Audit / Exports
```

### 7.9 Moderator controls required

| Area | Controls |
|---|---|
| Event setup | Seed/verify materials, recipes, cities, shocks, settings, teams. |
| Auction | Start round, reveal shock, start/close/extend/reopen/void lot, record payment failure, assign unsold lot to bank. |
| Trade desk | Register, approve, reject, complete, or cancel trades. |
| Build desk | Verify recipe, create/void deed, apply bonuses, resolve inspection. |
| City auction | Start city, accept/close/reopen bid, assign last city, reveal multipliers. |
| Incidents | Team withdrawal, balance adjustment, dispute note, manual correction. |
| Exports | Team inventory, bid history, deeds, final standings, audit log. |

---

## 8. API and real-time contract

### 8.1 Command endpoints

Use server-side routes/actions for commands. Every action authenticates the user and validates role, event status, and input.

| Command | Actor |
|---|---|
| `POST /events/:id/auction-lots/:id/bids` | Team leader |
| `POST /events/:id/auction-lots/:id/open` | Moderator |
| `POST /events/:id/auction-lots/:id/close` | Moderator |
| `POST /events/:id/trades` | Team leader or moderator |
| `POST /events/:id/trades/:id/register` | Moderator |
| `POST /events/:id/trades/:id/complete` | Moderator |
| `POST /events/:id/buildings` | Team leader/moderator, according to selected workflow |
| `POST /events/:id/scout-reports` | Team leader |
| `POST /events/:id/city-auctions/:id/bids` | Team leader |
| `POST /events/:id/cities/reveal` | Moderator |
| `POST /events/:id/overrides` | Moderator/admin with reason |

### 8.2 WebSocket events

Broadcast after the database transaction is committed.

```text
event.stage_changed
auction.round_started
auction.lot_opened
auction.bid_accepted
auction.lot_closed
inventory.changed
trade.changed
building.constructed
inspection.resolved
city.auction_opened
city.bid_accepted
city.assigned
score.revealed
moderator.announcement
```

### 8.3 Security rules

- The team leader can submit a team bid, trade request, build request, scout report, and city bid.
- Team members may view their own team’s state but cannot write game actions.
- Moderators can control their assigned event only.
- Clients receive their own private balance, inventory, scout reports, and score detail.
- Hidden multipliers and private scout reports never appear in public WebSocket payloads.
- All moderator overrides require an explanation.

---

## 9. Delivery plan

### Phase 0 — Confirm game settings and seed content

**Goal:** convert the paper rules into a verified event configuration.

- Create the event and its selected options.
- Seed materials and one finite material kit per team.
- Seed building recipes and recipe requirements.
- Seed Market Shock cards.
- Seed the required city blocks, tiers, preferences, and hidden multipliers.
- Select whether inspections, scout reports, leftover scoring, and advanced scoring are enabled.
- Reconcile the rulebook values with any event-specific changes before implementation.

**Acceptance check:** a moderator can review the entire game configuration before players enter.

### Phase 1 — Foundation and migrations

**Goal:** make persistent, event-safe game state.

- Introduce the event-scoped schema in Section 5.
- Write database migrations and repeatable seed scripts.
- Add roles and event membership.
- Consolidate bidding into one server-side game service.
- Add audit logging and transaction helpers.
- Remove/deprecate the old one-balance / `wonItems` model after migration.

**Acceptance check:** server restart does not lose any state, and an audit report explains all mutations.

### Phase 2 — Stage 1 live auction

**Goal:** run material rounds reliably under concurrent bids.

- Moderator round and lot control.
- Live bid placement with lock-safe validation.
- Correct bid increments and opening bids.
- Market Shock application.
- Winner settlement, finite inventory award, and unsold bank stock.
- Team auction interface and moderator monitor.

**Acceptance check:** simultaneous bid test produces one valid leader/winner and no negative balances.

### Phase 3 — Inventory, trading, and building

**Goal:** complete Stage 2 with full traceability.

- Inventory ledger and stock view.
- Moderator-registered binding trade flow.
- Finite bank purchase flow and tax calculation.
- Recipe check, construction, deed issuance, and bonuses.
- Optional inspection flow.

**Acceptance check:** every building’s consumed materials can be traced to inventory sources.

### Phase 4 — Cities and scoring

**Goal:** deliver a dramatic, correct finale.

- City selection and auction control.
- Private scout reports and allowed wallet usage.
- One-city-per-team enforcement.
- Hidden multiplier protection and controlled reveal.
- Standard score calculation, ranks, and tiebreakers.
- Advanced scoring only if selected and separately tested.

**Acceptance check:** final table includes a reproducible calculation for every team.

### Phase 5 — Event rehearsal and operational hardening

**Goal:** ensure staff can run the real event.

- Seed 8–10 dummy teams and run a full rehearsal.
- Test reconnects, refreshes, concurrent bids, timer expiry, and server restart.
- Test void/reopen lot, failed payment, disqualification, and team dropout.
- Prepare moderator quick guide and exported backup score sheet.
- Run a final configuration check before opening the actual event.

**Acceptance check:** moderators can handle the rulebook contingencies without changing the database manually.

---

## 10. Test plan

### Automated tests

- Bid amount is rejected when below the valid increment.
- Bid is rejected after lot close or from a non-leader.
- Two simultaneous bids cannot overspend a balance.
- Winning a lot creates exactly one inventory credit and one payment debit.
- Unsold lots are available to the bank and cannot exceed finite stock.
- Trade completion conserves total material quantity across teams.
- Trade limit cannot exceed four.
- Construction fails when even one required unit is missing.
- A bonus cannot be applied twice to one building.
- Team cannot buy a second city.
- Unrevealed multiplier is absent from team/public responses.
- Tiebreakers execute in the specified order.

### Manual rehearsal scenarios

1. No bids on a lot.
2. Bidder cannot pay; moderator voids and re-offers the lot.
3. Moderator extends and then closes a lot.
4. A registered trade is completed; a handshake trade is not enforced.
5. An invalid building is found via inspection.
6. A city auction reaches the last team / last city situation.
7. A server or browser restarts during a live lot.
8. Two teams finish tied on score, then on building count, and the next tiebreak resolves it.

---

## 11. Implementation order for this repository

1. Create a feature branch, for example `bricks-by-bid-event-engine`.
2. Add an `events` domain module and event-scoped database migration.
3. Build and test server-side command handlers before changing visual design.
4. Replace the existing raw-material constants with database seed data.
5. Replace the single token field with the dual-wallet model and ledger entries.
6. Consolidate the duplicated bidding manager into one persistent service.
7. Build the Stage 1 moderator and team screens.
8. Add Stage 2 inventory/trade/build flows.
9. Add Stage 3 city/scoring flows.
10. Update the rules page from active event configuration.
11. Perform full rehearsal before UI polish and deployment.

---

## 12. Definition of done

The portal is ready for the event only when:

- Every rule selected for the event is represented as configuration or enforced server-side.
- Every bid, balance update, material movement, trade, building, city win, and score is persisted.
- Team members cannot alter another team’s data or submit leader-only actions.
- Moderators can run all stages and contingencies without direct database edits.
- Final standings include an auditable score breakdown and tiebreak explanation.
- A complete live rehearsal has succeeded with the expected team count.
