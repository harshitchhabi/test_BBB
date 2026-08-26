import { pgEnum } from "drizzle-orm/pg-core";

// Every enum below is named for the table/field it backs in
// EVENT_PORTAL_IMPLEMENTATION_PLAN.md Section 5. Kept in one file so the full
// state-machine vocabulary of the game is visible in one place.

export const eventStatusEnum = pgEnum("event_status", [
  "setup",
  "lobby",
  "stage_1",
  "stage_2",
  "stage_3",
  "scoring",
  "completed",
  "paused",
]);

export const eventStaffRoleEnum = pgEnum("event_staff_role", ["moderator", "admin"]);

export const teamStatusEnum = pgEnum("team_status", ["active", "withdrawn", "disqualified"]);

export const teamMemberRoleEnum = pgEnum("team_member_role", ["leader", "member"]);

export const materialLotSourceEnum = pgEnum("material_lot_source", [
  "auction",
  "bank",
  "event_grant",
  "manual",
]);

export const materialLotStatusEnum = pgEnum("material_lot_status", [
  "available",
  "auctioning",
  "sold",
  "bank_stock",
  "consumed",
  "voided",
]);

export const auctionRoundStatusEnum = pgEnum("auction_round_status", [
  "planned",
  "active",
  "completed",
  "cancelled",
]);

export const auctionLotStatusEnum = pgEnum("auction_lot_status", [
  "pending",
  "live",
  "closed",
  "unsold",
  "voided",
  "reopened",
]);

export const bidStatusEnum = pgEnum("bid_status", [
  "accepted",
  "outbid",
  "rejected",
  "voided",
  "winning",
]);

export const inventoryReasonEnum = pgEnum("inventory_reason", [
  "auction_win",
  "trade_out",
  "trade_in",
  "bank_purchase",
  "construction",
  "inspection_void",
  "manual_adjustment",
]);

export const tradeStatusEnum = pgEnum("trade_status", [
  "draft",
  "submitted",
  "registered",
  "completed",
  "cancelled",
  "rejected",
]);

export const bankPurchaseStatusEnum = pgEnum("bank_purchase_status", [
  "requested",
  "approved",
  "completed",
  "rejected",
]);

export const constructedBuildingStatusEnum = pgEnum("constructed_building_status", [
  "approved",
  "voided",
]);

export const bonusTypeEnum = pgEnum("bonus_type", ["eco", "luxury", "landmark"]);

export const inspectionResultEnum = pgEnum("inspection_result", [
  "passed",
  "failed",
  "cancelled",
]);

export const cityTierEnum = pgEnum("city_tier", ["metro", "city", "town"]);

export const cityRevealStateEnum = pgEnum("city_reveal_state", ["hidden", "revealed"]);

export const cityAuctionStatusEnum = pgEnum("city_auction_status", [
  "pending",
  "live",
  "closed",
  "voided",
  "reopened",
]);

export const cityBidStatusEnum = pgEnum("city_bid_status", [
  "accepted",
  "outbid",
  "rejected",
  "voided",
  "winning",
]);

export const scoreSnapshotPhaseEnum = pgEnum("score_snapshot_phase", [
  "build_desk",
  "pre_reveal",
  "final",
]);
