import { pgTable, text, uuid, integer, boolean } from "drizzle-orm/pg-core";
import { events } from "./identity";
import { materialLotSourceEnum, materialLotStatusEnum } from "./enums";

// material_types: one record per material (Bricks, Cement, Steel, Wood,
// Glass, Pipes, Wires, Medical, Furniture, Marble, Tiles, Solar, Blueprint —
// per rulebook "Lot (material)" table and plan Section 5.3).
//
// Deviation from plan Section 5.3: the plan's material_types table only has
// key/name/unit_label/sticker_price/is_rare/is_bonus_only/sort_order. It has
// no notion of "how many units come in one auction lot" or "what a lot of
// this material opens at" — those live only on material_lots, which
// represent a single already-materialized lot. But Phase 1's round/lot
// generator needs a *template* to stamp out one lot per team per material
// when a round starts (rulebook: "the moderator adds one of each lot below
// for each team in the room"). defaultLotQuantity/defaultOpeningBid carry
// that template so lot generation isn't hard-coded. They are seed/reference
// values only — every real auction_lots row still snapshots its own
// opening_bid so mid-event edits here never retroactively change a lot
// that's already live or sold.
export const materialTypes = pgTable("material_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  unitLabel: text("unit_label").notNull().default("units"),
  stickerPrice: integer("sticker_price").notNull(),
  isRare: boolean("is_rare").notNull().default(false),
  isBonusOnly: boolean("is_bonus_only").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  defaultLotQuantity: integer("default_lot_quantity").notNull(),
  defaultOpeningBid: integer("default_opening_bid").notNull(),
});

export const materialLots = pgTable("material_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  materialTypeId: uuid("material_type_id")
    .notNull()
    .references(() => materialTypes.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull(),
  openingBid: integer("opening_bid").notNull(),
  source: materialLotSourceEnum("source").notNull().default("auction"),
  status: materialLotStatusEnum("status").notNull().default("available"),
  ownerTeamId: uuid("owner_team_id"),
});

// market_shock_cards: not in the plan's Section 5 ERD, but auction_rounds
// (Section 5.3) has a market_shock_id FK that has to point somewhere, and
// Phase 0 explicitly requires seeding "Market Shock cards." Modeled as its
// own event-scoped, configurable deck rather than a hard-coded switch
// statement in the auction engine, per Section 2.2 ("Active Market Shock
// deck" must be configurable).
export const marketShockCards = pgTable("market_shock_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  // Machine-readable effect the auction engine applies when this card is
  // revealed for a round, e.g.
  //   { "type": "opening_bid_multiplier", "material_key": "steel", "multiplier": 2 }
  //   { "type": "flat_bonus_points", "recipe_keys": ["hospital","industry"], "points": 15 }
  //   { "type": "next_lot_price_multiplier", "material_key": "glass", "multiplier": 0.5 }
  //   { "type": "smallest_unsold_lot_price_increase", "percent": 50 }
  //   { "type": "grant_tokens_all_teams", "amount": 200 }
  //   { "type": "material_free_this_round", "material_key": "solar", "eco_bonus_override": 15 }
  effectJson: text("effect_json").notNull(),
  copiesInDeck: integer("copies_in_deck").notNull().default(2),
  active: boolean("active").notNull().default(true),
});
