import { pgTable, text, uuid, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { eventStatusEnum, eventStaffRoleEnum, teamStatusEnum, teamMemberRoleEnum } from "./enums";

// participants: kept from the legacy schema almost unchanged. It is the
// global Google-login identity (see legacy frontend/src/auth.ts signIn
// callback) and is intentionally NOT event-scoped — the same person can play
// in multiple events over time. Everything event-scoped hangs off
// team_members / event_staff instead.
export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: eventStatusEnum("status").notNull().default("setup"),
  activeRoundId: uuid("active_round_id"),
  activeCityAuctionId: uuid("active_city_auction_id"),
  rulesVersion: text("rules_version").notNull().default("bbb-1"),
  // Nullable because packages/db/seed/run.ts can create an event without
  // any signed-in participant to attribute it to (it's a CLI script, not
  // an authenticated request). When set, this is the ONLY participant
  // allowed to claim the event's first moderator slot — see
  // addEventStaff in team-service.ts. When null (an event seeded without
  // specifying one), the bootstrap falls back to "whoever gets there
  // first," which is the loophole this column exists to close for events
  // that do set it.
  createdBy: uuid("created_by").references(() => participants.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

// event_settings: every value here is the recommended default from Section
// 5.2 of the plan. Nothing in the game engine should read these as
// constants — they are always looked up per event_id.
export const eventSettings = pgTable("event_settings", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => events.id, { onDelete: "cascade" }),
  stage1StartingTokens: integer("stage_1_starting_tokens").notNull().default(1000),
  cityWalletTokens: integer("city_wallet_tokens").notNull().default(500),
  minimumRaiseStandard: integer("minimum_raise_standard").notNull().default(50),
  minimumRaiseLowOpening: integer("minimum_raise_low_opening").notNull().default(25),
  lowOpeningThreshold: integer("low_opening_threshold").notNull().default(100),
  cityMinimumRaise: integer("city_minimum_raise").notNull().default(25),
  tradeLimit: integer("trade_limit").notNull().default(4),
  normalBankTaxPercent: integer("normal_bank_tax_percent").notNull().default(10),
  rareBankTaxPercent: integer("rare_bank_tax_percent").notNull().default(20),
  scoutReportCost: integer("scout_report_cost").notNull().default(100),
  scoutReportLimit: integer("scout_report_limit").notNull().default(2),
  inspectionCost: integer("inspection_cost").notNull().default(150),
  inspectionLimitPerTeam: integer("inspection_limit_per_team").notNull().default(1),
  auctionLotDurationSeconds: integer("auction_lot_duration_seconds").notNull().default(60),
  cityAuctionDurationSeconds: integer("city_auction_duration_seconds").notNull().default(45),
  inspectionsEnabled: boolean("inspections_enabled").notNull().default(false),
  scoutReportsEnabled: boolean("scout_reports_enabled").notNull().default(true),
  leftoverScoringEnabled: boolean("leftover_scoring_enabled").notNull().default(false),
  leftoverUnitsPerPoint: integer("leftover_units_per_point").notNull().default(15),
  advancedCityScoringEnabled: boolean("advanced_city_scoring_enabled").notNull().default(false),
  advancedCityScoringPenalty: integer("advanced_city_scoring_penalty").notNull().default(1),
});

// event_staff: moderators/admins assigned to run a specific event. Distinct
// from team_members — staff never belong to a team.
export const eventStaff = pgTable(
  "event_staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    role: eventStaffRoleEnum("role").notNull().default("moderator"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    eventParticipantUnique: uniqueIndex("event_staff_event_participant_unique").on(
      table.eventId,
      table.participantId,
    ),
  }),
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    ownerParticipantId: uuid("owner_participant_id")
      .notNull()
      .references(() => participants.id),
    auctionTokens: integer("auction_tokens").notNull().default(1000),
    cityWalletTokens: integer("city_wallet_tokens").notNull().default(500),
    tradeCount: integer("trade_count").notNull().default(0),
    scoutReportCount: integer("scout_report_count").notNull().default(0),
    inspectionCount: integer("inspection_count").notNull().default(0),
    status: teamStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    eventCodeUnique: uniqueIndex("teams_event_code_unique").on(table.eventId, table.code),
  }),
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized from teams.event_id. The plan's ERD lists team_members
    // with just (team_id, participant_id), but a bare team-scoped unique
    // index can't stop one participant from joining a *second* team in the
    // same event — which the rulebook's "one designated leader" / one-team
    // model requires. Carrying event_id here lets us enforce
    // one-team-per-event-per-participant directly in the schema instead of
    // only in application code.
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    role: teamMemberRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => ({
    teamParticipantUnique: uniqueIndex("team_members_team_participant_unique").on(
      table.teamId,
      table.participantId,
    ),
    eventParticipantUnique: uniqueIndex("team_members_event_participant_unique").on(
      table.eventId,
      table.participantId,
    ),
  }),
);
