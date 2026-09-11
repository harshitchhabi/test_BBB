import { pgTable, text, uuid, integer, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { events, teams } from "./identity";
import { buildingRecipes } from "./buildings";
import { cityTierEnum, cityRevealStateEnum, cityAuctionStatusEnum, cityBidStatusEnum } from "./enums";

// cities: hiddenMultiplier must NEVER be selected in a query whose result
// reaches a team or public WebSocket payload before revealState = 'revealed'
// (Section 5.6, Section 8.3). The read layer built in Phase 4 enforces this
// by using a column list that omits hidden_multiplier whenever
// reveal_state = 'hidden', not by trusting callers to remember to strip it.
export const cities = pgTable("cities", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  blockNumber: integer("block_number").notNull(),
  name: text("name").notNull(),
  tier: cityTierEnum("tier").notNull(),
  openingBid: integer("opening_bid").notNull(),
  hiddenMultiplier: numeric("hidden_multiplier", { precision: 4, scale: 2 }).notNull(),
  isTrap: boolean("is_trap").notNull().default(false),
  isSleeper: boolean("is_sleeper").notNull().default(false),
  revealState: cityRevealStateEnum("reveal_state").notNull().default("hidden"),
  assignedTeamId: uuid("assigned_team_id").references(() => teams.id),
  saleOrder: integer("sale_order"),
});

// city_preferences: the "preferred buildings" hint column from Appendix B,
// used for the optional advanced scoring mode (Section 6.6, rulebook Stage
// 3 "Optional harder scoring").
export const cityPreferences = pgTable("city_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  cityId: uuid("city_id")
    .notNull()
    .references(() => cities.id, { onDelete: "cascade" }),
  buildingRecipeId: uuid("building_recipe_id")
    .notNull()
    .references(() => buildingRecipes.id),
});

export const scoutReports = pgTable("scout_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id),
  cityId: uuid("city_id")
    .notNull()
    .references(() => cities.id),
  cost: integer("cost").notNull(),
  paidFrom: text("paid_from", { enum: ["city_wallet", "leftover_budget"] }).notNull(),
  // e.g. clueType "minimum_multiplier", clueValue "3.0", or clueType
  // "maximum_multiplier", clueValue "2.5" — rulebook: "its multiplier is at
  // least 3.0" / "below 2.5".
  clueType: text("clue_type").notNull(),
  clueValue: text("clue_value").notNull(),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).defaultNow().notNull(),
});

export const cityAuctions = pgTable("city_auctions", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  cityId: uuid("city_id")
    .notNull()
    .references(() => cities.id),
  status: cityAuctionStatusEnum("status").notNull().default("pending"),
  openingBid: integer("opening_bid").notNull(),
  minimumRaise: integer("minimum_raise").notNull(),
  opensAt: timestamp("opens_at", { withTimezone: true }),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  winnerTeamId: uuid("winner_team_id").references(() => teams.id),
  winningBidId: uuid("winning_bid_id"),
});

export const cityBids = pgTable("city_bids", {
  id: uuid("id").primaryKey().defaultRandom(),
  cityAuctionId: uuid("city_auction_id")
    .notNull()
    .references(() => cityAuctions.id, { onDelete: "cascade" }),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id),
  amount: integer("amount").notNull(),
  cityWalletUsed: integer("city_wallet_used").notNull(),
  auctionTokensUsed: integer("auction_tokens_used").notNull(),
  status: cityBidStatusEnum("status").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
});
