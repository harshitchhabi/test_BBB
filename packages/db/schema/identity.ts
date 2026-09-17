import { pgTable, text, uuid, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { eventStatusEnum, eventStaffRoleEnum, teamStatusEnum, teamMemberRoleEnum } from "./enums";

// participants: the identity behind every login. Originally a Google
// OAuth identity keyed by email; replaced with admin-issued username +
// password credentials (Task 1) since this is an internal event with
// ~20-30 shared team logins and a handful of staff logins, not a public
// self-serve system. It is intentionally NOT event-scoped — the same
// login could in principle play in multiple events over time, though in
// practice one deployment serves one event. Everything event-scoped
// still hangs off team_members / event_staff, unchanged.
//
// email is now optional — kept only as a backup contact field an admin
// may fill in (e.g. to reach a team's leader outside the app), never
// used for login or lookup.
export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Set on login, cleared on logout or when an admin reissues this
  // login's password. Every authenticated request re-checks this against
  // the session cookie's own copy — a mismatch means a newer login (or an
  // admin-forced reset) superseded this session, so the old cookie is
  // refused even though it hasn't expired yet. One active session per
  // login at a time, matching "one shared credential per team."
  sessionId: text("session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
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
  // Free-form admin-editable text shown at the top of the Rules page,
  // for anything not covered by the structured settings above
  // (house rules, announcements, a reminder about a local variation).
  // Every other field on this row already drives the Rules page's
  // generated bullet points; this is the one place for plain prose.
  customRulesNote: text("custom_rules_note"),
  // The actual bulleted rule lines shown under each stage heading on
  // the Rules page, as JSON: {stage1: string[], stage2: string[],
  // stage3: string[], tiebreakers: string[]}. Deliberately independent
  // of every numeric/boolean field above and every other column on this
  // row - editing this changes ONLY what's displayed here, never any
  // actual game behavior. NULL means "show the auto-generated bullets
  // computed from the settings above" (today's original behavior); once
  // an admin edits and saves rule content, this column becomes the
  // source of truth and stops tracking the live settings values, even
  // if those change afterward - the two are deliberately decoupled once
  // a moderator has taken ownership of the wording.
  rulesContent: text("rules_content"),
});

// event_staff: staff assigned to run a specific event (the "moderator"
// vs "admin" split was merged into one role — see enums.ts). Distinct
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
    role: eventStaffRoleEnum("role").notNull().default("staff"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
    // Credited by closeLot whenever this team wins a lot in a round
    // where the "Eco Incentive" Market Shock was active for that round's
    // material (auction_rounds.eco_bonus_override set) — how many units
    // of genuinely free-this-round Solar this team has banked toward the
    // +15-instead-of-+10 Eco construction bonus. Spent (capped by
    // current holdings, so trading the physical Solar away can't be used
    // to bank the credit and cash it in on different Solar later) by
    // constructBuilding's eco-bonus branch in building-service.ts.
    ecoEligibleSolarUnits: integer("eco_eligible_solar_units").notNull().default(0),
    status: teamStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    eventCodeUnique: uniqueIndex("teams_event_code_unique").on(table.eventId, table.code),
  }),
);

// event_spectators: a read-only login for someone who is neither on a
// team nor staff (e.g. a screen at the front of the room, a family
// member watching along) — sees only the live auction/city-auction
// status (current stage, live lot/city, current bid, current leader),
// never any team's balance, inventory, or trade activity. Distinct from
// both team_members and event_staff, same shape as event_staff since
// there's no sub-role to track.
export const eventSpectators = pgTable(
  "event_spectators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    eventParticipantUnique: uniqueIndex("event_spectators_event_participant_unique").on(
      table.eventId,
      table.participantId,
    ),
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
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
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
