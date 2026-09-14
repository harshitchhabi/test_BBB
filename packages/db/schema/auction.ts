import { pgTable, text, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { events, teams } from "./identity";
import { materialTypes, materialLots, marketShockCards } from "./materials";
import { auctionRoundStatusEnum, auctionLotStatusEnum, bidStatusEnum } from "./enums";

export const auctionRounds = pgTable("auction_rounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  materialTypeId: uuid("material_type_id")
    .notNull()
    .references(() => materialTypes.id),
  sequence: integer("sequence").notNull(),
  status: auctionRoundStatusEnum("status").notNull().default("planned"),
  marketShockCardId: uuid("market_shock_card_id").references(() => marketShockCards.id),
  startedAt: timestamp("started_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  // Set when this round drew the "Eco Incentive" Market Shock and its
  // material matches this round's material (material_free_this_round in
  // market-shock-service.ts) — the +15-instead-of-+10 Eco bonus override
  // this round's winners are entitled to. NULL for every other round.
  // closeLot reads this to credit winning teams' eco-eligible Solar
  // count; constructBuilding reads that count to decide +10 vs +15.
  ecoBonusOverride: integer("eco_bonus_override"),
});

export const auctionLots = pgTable("auction_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  roundId: uuid("round_id")
    .notNull()
    .references(() => auctionRounds.id, { onDelete: "cascade" }),
  materialLotId: uuid("material_lot_id")
    .notNull()
    .references(() => materialLots.id),
  lotNumber: integer("lot_number").notNull(),
  // Snapshot rule values at open time (Section 6.1) so a later change to
  // event_settings or a market shock never rewrites the terms a lot was
  // already sold, or is currently live, under.
  openingBid: integer("opening_bid").notNull(),
  minimumRaise: integer("minimum_raise").notNull(),
  status: auctionLotStatusEnum("status").notNull().default("pending"),
  opensAt: timestamp("opens_at", { withTimezone: true }),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  winningBidId: uuid("winning_bid_id"),
  winnerTeamId: uuid("winner_team_id").references(() => teams.id),
});

// bids: append-only. A rejected bid is still inserted with a reason —
// Section 3.1 ("never silently discard a rejected bid") — rather than
// bounced back to the client without a persisted trace.
export const bids = pgTable("bids", {
  id: uuid("id").primaryKey().defaultRandom(),
  auctionLotId: uuid("auction_lot_id")
    .notNull()
    .references(() => auctionLots.id, { onDelete: "cascade" }),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id),
  amount: integer("amount").notNull(),
  status: bidStatusEnum("status").notNull(),
  rejectionReason: text("rejection_reason"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
});
