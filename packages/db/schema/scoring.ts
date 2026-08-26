import { pgTable, text, uuid, integer, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import { events, teams, participants } from "./identity";
import { scoreSnapshotPhaseEnum } from "./enums";

export const scoreSnapshots = pgTable("score_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id),
  phase: scoreSnapshotPhaseEnum("phase").notNull(),
  buildingPoints: integer("building_points").notNull(),
  bonusPoints: integer("bonus_points").notNull(),
  leftoverPoints: integer("leftover_points").notNull().default(0),
  cityMultiplier: numeric("city_multiplier", { precision: 4, scale: 2 }),
  finalScore: numeric("final_score", { precision: 10, scale: 2 }),
  rank: integer("rank"),
  tiebreakerRank: integer("tiebreaker_rank"),
  calculationJson: jsonb("calculation_json").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// audit_log: every moderator override, plus every automated state
// transition worth explaining, lands here with a before/after snapshot.
// Section 4 principle: "Moderator override with reason." reason is
// nullable only for system-generated entries (e.g. a lot closing on timer
// expiry); anything actor-initiated must populate it — enforced in the
// audit-log helper (Phase 1), not at the column level, since a NOT NULL
// constraint can't distinguish "system" from "moderator" actors.
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  actorParticipantId: uuid("actor_participant_id").references(() => participants.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  reason: text("reason"),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
