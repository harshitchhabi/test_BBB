import { pgTable, text, uuid, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { events, teams, participants } from "./identity";
import { materialTypes, materialLots } from "./materials";
import { inventoryReasonEnum, tradeStatusEnum, bankPurchaseStatusEnum } from "./enums";

// team_inventory_transactions: the ledger. Current stock is a derived view
// (SUM(quantity_delta) grouped by team_id, material_type_id) per Section
// 5.4 — there is deliberately no mutable "stock count" column on any table
// for a team to trust or a client to spoof.
export const teamInventoryTransactions = pgTable("team_inventory_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  materialTypeId: uuid("material_type_id")
    .notNull()
    .references(() => materialTypes.id),
  quantityDelta: integer("quantity_delta").notNull(),
  reason: inventoryReasonEnum("reason").notNull(),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: uuid("related_entity_id"),
  createdBy: uuid("created_by").references(() => participants.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const trades = pgTable("trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  proposerTeamId: uuid("proposer_team_id")
    .notNull()
    .references(() => teams.id),
  // NULL means "an open offer" - not directed at any specific team, any
  // other team's leader may accept it, at which point this column is
  // filled in with whichever team did (first to accept wins). A normal
  // two-party trade sets this at proposal time, same as before.
  counterpartyTeamId: uuid("counterparty_team_id").references(() => teams.id),
  status: tradeStatusEnum("status").notNull().default("draft"),
  // true = registered "pink slip" (binding, moderator-enforced); false =
  // handshake (not enforced by the system beyond bookkeeping). Rulebook
  // Stage 2 "Trading".
  binding: boolean("binding").notNull().default(false),
  moderatorId: uuid("moderator_id").references(() => participants.id),
  tradeNumber: integer("trade_number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const tradeLines = pgTable("trade_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tradeId: uuid("trade_id")
    .notNull()
    .references(() => trades.id, { onDelete: "cascade" }),
  // NULL means "whoever accepts this open offer provides this line" -
  // filled in with the accepting team's id the moment someone accepts.
  // A normal two-party trade's lines are always fully specified (either
  // the proposer's or the known counterparty's id) at proposal time,
  // same as before.
  fromTeamId: uuid("from_team_id").references(() => teams.id),
  // NULL means this line trades TOKENS instead of a material — "credits
  // for materials and vice versa," per the rulebook's leftover-tokens-
  // are-spendable-anywhere model. `quantity` below is then the token
  // amount, not a material count. Exactly one trade side needs to be a
  // material for a trade to mean anything, but that's a proposeTrade-
  // time UX concern, not a DB constraint — nothing stops (and nothing
  // needs to stop) an all-tokens trade at the schema level.
  materialTypeId: uuid("material_type_id").references(() => materialTypes.id),
  quantity: integer("quantity").notNull(),
});

export const bankPurchases = pgTable("bank_purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id),
  materialLotId: uuid("material_lot_id")
    .notNull()
    .references(() => materialLots.id),
  quantity: integer("quantity").notNull(),
  basePrice: integer("base_price").notNull(),
  taxRatePercent: integer("tax_rate_percent").notNull(),
  taxAmount: integer("tax_amount").notNull(),
  totalCost: integer("total_cost").notNull(),
  paidFrom: text("paid_from", { enum: ["auction_tokens"] })
    .notNull()
    .default("auction_tokens"),
  approvedBy: uuid("approved_by").references(() => participants.id),
  status: bankPurchaseStatusEnum("status").notNull().default("requested"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
