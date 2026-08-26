import { pgTable, text, uuid, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { events, teams, participants } from "./identity";
import { materialTypes } from "./materials";
import { constructedBuildingStatusEnum, bonusTypeEnum, inspectionResultEnum } from "./enums";

export const buildingRecipes = pgTable("building_recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  basePoints: integer("base_points").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const recipeRequirements = pgTable("recipe_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => buildingRecipes.id, { onDelete: "cascade" }),
  materialTypeId: uuid("material_type_id")
    .notNull()
    .references(() => materialTypes.id),
  requiredQuantity: integer("required_quantity").notNull(),
});

export const constructedBuildings = pgTable("constructed_buildings", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => buildingRecipes.id),
  deedNumber: text("deed_number").notNull(),
  basePoints: integer("base_points").notNull(),
  ecoBonus: integer("eco_bonus").notNull().default(0),
  luxuryBonus: integer("luxury_bonus").notNull().default(0),
  landmarkBonus: integer("landmark_bonus").notNull().default(0),
  status: constructedBuildingStatusEnum("status").notNull().default("approved"),
  builtAt: timestamp("built_at").defaultNow().notNull(),
  verifiedBy: uuid("verified_by").references(() => participants.id),
  voidedAt: timestamp("voided_at"),
  voidedReason: text("voided_reason"),
});

export const buildingBonusUses = pgTable("building_bonus_uses", {
  id: uuid("id").primaryKey().defaultRandom(),
  constructedBuildingId: uuid("constructed_building_id")
    .notNull()
    .references(() => constructedBuildings.id, { onDelete: "cascade" }),
  bonusType: bonusTypeEnum("bonus_type").notNull(),
  sourceMaterialTypeId: uuid("source_material_type_id").references(() => materialTypes.id),
  points: integer("points").notNull(),
});

export const inspections = pgTable("inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  challengerTeamId: uuid("challenger_team_id")
    .notNull()
    .references(() => teams.id),
  targetBuildingId: uuid("target_building_id")
    .notNull()
    .references(() => constructedBuildings.id),
  cost: integer("cost").notNull(),
  paidFrom: text("paid_from", { enum: ["auction_tokens"] })
    .notNull()
    .default("auction_tokens"),
  result: inspectionResultEnum("result").notNull().default("cancelled"),
  resolvedBy: uuid("resolved_by").references(() => participants.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
