CREATE TYPE "public"."auction_lot_status" AS ENUM('pending', 'live', 'closed', 'unsold', 'voided', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."auction_round_status" AS ENUM('planned', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bank_purchase_status" AS ENUM('requested', 'approved', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."bid_status" AS ENUM('accepted', 'outbid', 'rejected', 'voided', 'winning');--> statement-breakpoint
CREATE TYPE "public"."bonus_type" AS ENUM('eco', 'luxury', 'landmark');--> statement-breakpoint
CREATE TYPE "public"."city_auction_status" AS ENUM('pending', 'live', 'closed', 'voided', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."city_bid_status" AS ENUM('accepted', 'outbid', 'rejected', 'voided', 'winning');--> statement-breakpoint
CREATE TYPE "public"."city_reveal_state" AS ENUM('hidden', 'revealed');--> statement-breakpoint
CREATE TYPE "public"."city_tier" AS ENUM('metro', 'city', 'town');--> statement-breakpoint
CREATE TYPE "public"."constructed_building_status" AS ENUM('approved', 'voided');--> statement-breakpoint
CREATE TYPE "public"."event_staff_role" AS ENUM('moderator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('setup', 'lobby', 'stage_1', 'stage_2', 'stage_3', 'scoring', 'completed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."inspection_result" AS ENUM('passed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."inventory_reason" AS ENUM('auction_win', 'trade_out', 'trade_in', 'bank_purchase', 'construction', 'inspection_void', 'manual_adjustment');--> statement-breakpoint
CREATE TYPE "public"."material_lot_source" AS ENUM('auction', 'bank', 'event_grant', 'manual');--> statement-breakpoint
CREATE TYPE "public"."material_lot_status" AS ENUM('available', 'auctioning', 'sold', 'bank_stock', 'consumed', 'voided');--> statement-breakpoint
CREATE TYPE "public"."score_snapshot_phase" AS ENUM('build_desk', 'pre_reveal', 'final');--> statement-breakpoint
CREATE TYPE "public"."team_member_role" AS ENUM('leader', 'member');--> statement-breakpoint
CREATE TYPE "public"."team_status" AS ENUM('active', 'withdrawn', 'disqualified');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('draft', 'submitted', 'registered', 'completed', 'cancelled', 'rejected');--> statement-breakpoint
CREATE TABLE "event_settings" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"stage_1_starting_tokens" integer DEFAULT 1000 NOT NULL,
	"city_wallet_tokens" integer DEFAULT 500 NOT NULL,
	"minimum_raise_standard" integer DEFAULT 50 NOT NULL,
	"minimum_raise_low_opening" integer DEFAULT 25 NOT NULL,
	"low_opening_threshold" integer DEFAULT 100 NOT NULL,
	"city_minimum_raise" integer DEFAULT 25 NOT NULL,
	"trade_limit" integer DEFAULT 4 NOT NULL,
	"normal_bank_tax_percent" integer DEFAULT 10 NOT NULL,
	"rare_bank_tax_percent" integer DEFAULT 20 NOT NULL,
	"scout_report_cost" integer DEFAULT 100 NOT NULL,
	"scout_report_limit" integer DEFAULT 2 NOT NULL,
	"inspection_cost" integer DEFAULT 150 NOT NULL,
	"inspection_limit_per_team" integer DEFAULT 1 NOT NULL,
	"auction_lot_duration_seconds" integer DEFAULT 60 NOT NULL,
	"city_auction_duration_seconds" integer DEFAULT 45 NOT NULL,
	"inspections_enabled" boolean DEFAULT false NOT NULL,
	"scout_reports_enabled" boolean DEFAULT true NOT NULL,
	"leftover_scoring_enabled" boolean DEFAULT false NOT NULL,
	"leftover_units_per_point" integer DEFAULT 15 NOT NULL,
	"advanced_city_scoring_enabled" boolean DEFAULT false NOT NULL,
	"advanced_city_scoring_penalty" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"role" "event_staff_role" DEFAULT 'moderator' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "event_status" DEFAULT 'setup' NOT NULL,
	"active_round_id" uuid,
	"active_city_auction_id" uuid,
	"rules_version" text DEFAULT 'bbb-1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "participants_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"role" "team_member_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"owner_participant_id" uuid NOT NULL,
	"auction_tokens" integer DEFAULT 1000 NOT NULL,
	"city_wallet_tokens" integer DEFAULT 500 NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"scout_report_count" integer DEFAULT 0 NOT NULL,
	"inspection_count" integer DEFAULT 0 NOT NULL,
	"status" "team_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_shock_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"effect_json" text NOT NULL,
	"copies_in_deck" integer DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"material_type_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"opening_bid" integer NOT NULL,
	"source" "material_lot_source" DEFAULT 'auction' NOT NULL,
	"status" "material_lot_status" DEFAULT 'available' NOT NULL,
	"owner_team_id" uuid
);
--> statement-breakpoint
CREATE TABLE "material_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"unit_label" text DEFAULT 'units' NOT NULL,
	"sticker_price" integer NOT NULL,
	"is_rare" boolean DEFAULT false NOT NULL,
	"is_bonus_only" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"default_lot_quantity" integer NOT NULL,
	"default_opening_bid" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auction_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"material_lot_id" uuid NOT NULL,
	"lot_number" integer NOT NULL,
	"opening_bid" integer NOT NULL,
	"minimum_raise" integer NOT NULL,
	"status" "auction_lot_status" DEFAULT 'pending' NOT NULL,
	"opens_at" timestamp,
	"closes_at" timestamp,
	"winning_bid_id" uuid,
	"winner_team_id" uuid
);
--> statement-breakpoint
CREATE TABLE "auction_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"material_type_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" "auction_round_status" DEFAULT 'planned' NOT NULL,
	"market_shock_card_id" uuid,
	"started_at" timestamp,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_lot_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"status" "bid_status" NOT NULL,
	"rejection_reason" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"material_lot_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"base_price" integer NOT NULL,
	"tax_rate_percent" integer NOT NULL,
	"tax_amount" integer NOT NULL,
	"total_cost" integer NOT NULL,
	"paid_from" text DEFAULT 'auction_tokens' NOT NULL,
	"approved_by" uuid,
	"status" "bank_purchase_status" DEFAULT 'requested' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_inventory_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"material_type_id" uuid NOT NULL,
	"quantity_delta" integer NOT NULL,
	"reason" "inventory_reason" NOT NULL,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"from_team_id" uuid NOT NULL,
	"material_type_id" uuid NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"proposer_team_id" uuid NOT NULL,
	"counterparty_team_id" uuid NOT NULL,
	"status" "trade_status" DEFAULT 'draft' NOT NULL,
	"binding" boolean DEFAULT false NOT NULL,
	"moderator_id" uuid,
	"trade_number" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"registered_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "building_bonus_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constructed_building_id" uuid NOT NULL,
	"bonus_type" "bonus_type" NOT NULL,
	"source_material_type_id" uuid,
	"points" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "building_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"base_points" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constructed_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"deed_number" text NOT NULL,
	"base_points" integer NOT NULL,
	"eco_bonus" integer DEFAULT 0 NOT NULL,
	"luxury_bonus" integer DEFAULT 0 NOT NULL,
	"landmark_bonus" integer DEFAULT 0 NOT NULL,
	"status" "constructed_building_status" DEFAULT 'approved' NOT NULL,
	"built_at" timestamp DEFAULT now() NOT NULL,
	"verified_by" uuid,
	"voided_at" timestamp,
	"voided_reason" text
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"challenger_team_id" uuid NOT NULL,
	"target_building_id" uuid NOT NULL,
	"cost" integer NOT NULL,
	"paid_from" text DEFAULT 'auction_tokens' NOT NULL,
	"result" "inspection_result" DEFAULT 'cancelled' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"material_type_id" uuid NOT NULL,
	"required_quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"block_number" integer NOT NULL,
	"name" text NOT NULL,
	"tier" "city_tier" NOT NULL,
	"opening_bid" integer NOT NULL,
	"hidden_multiplier" numeric(4, 2) NOT NULL,
	"is_trap" boolean DEFAULT false NOT NULL,
	"is_sleeper" boolean DEFAULT false NOT NULL,
	"reveal_state" "city_reveal_state" DEFAULT 'hidden' NOT NULL,
	"assigned_team_id" uuid,
	"sale_order" integer
);
--> statement-breakpoint
CREATE TABLE "city_auctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"status" "city_auction_status" DEFAULT 'pending' NOT NULL,
	"opening_bid" integer NOT NULL,
	"minimum_raise" integer NOT NULL,
	"opens_at" timestamp,
	"closes_at" timestamp,
	"winner_team_id" uuid,
	"winning_bid_id" uuid
);
--> statement-breakpoint
CREATE TABLE "city_bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_auction_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"city_wallet_used" integer NOT NULL,
	"auction_tokens_used" integer NOT NULL,
	"status" "city_bid_status" NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "city_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"building_recipe_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scout_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"cost" integer NOT NULL,
	"paid_from" text NOT NULL,
	"clue_type" text NOT NULL,
	"clue_value" text NOT NULL,
	"purchased_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_participant_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"reason" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"phase" "score_snapshot_phase" NOT NULL,
	"building_points" integer NOT NULL,
	"bonus_points" integer NOT NULL,
	"leftover_points" integer DEFAULT 0 NOT NULL,
	"city_multiplier" numeric(4, 2),
	"final_score" numeric(10, 2),
	"rank" integer,
	"tiebreaker_rank" integer,
	"calculation_json" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_settings" ADD CONSTRAINT "event_settings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff" ADD CONSTRAINT "event_staff_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff" ADD CONSTRAINT "event_staff_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_participant_id_participants_id_fk" FOREIGN KEY ("owner_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_shock_cards" ADD CONSTRAINT "market_shock_cards_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_material_type_id_material_types_id_fk" FOREIGN KEY ("material_type_id") REFERENCES "public"."material_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_types" ADD CONSTRAINT "material_types_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_round_id_auction_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."auction_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_material_lot_id_material_lots_id_fk" FOREIGN KEY ("material_lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_winner_team_id_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_rounds" ADD CONSTRAINT "auction_rounds_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_rounds" ADD CONSTRAINT "auction_rounds_material_type_id_material_types_id_fk" FOREIGN KEY ("material_type_id") REFERENCES "public"."material_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_rounds" ADD CONSTRAINT "auction_rounds_market_shock_card_id_market_shock_cards_id_fk" FOREIGN KEY ("market_shock_card_id") REFERENCES "public"."market_shock_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_lot_id_auction_lots_id_fk" FOREIGN KEY ("auction_lot_id") REFERENCES "public"."auction_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_purchases" ADD CONSTRAINT "bank_purchases_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_purchases" ADD CONSTRAINT "bank_purchases_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_purchases" ADD CONSTRAINT "bank_purchases_material_lot_id_material_lots_id_fk" FOREIGN KEY ("material_lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_purchases" ADD CONSTRAINT "bank_purchases_approved_by_participants_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_inventory_transactions" ADD CONSTRAINT "team_inventory_transactions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_inventory_transactions" ADD CONSTRAINT "team_inventory_transactions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_inventory_transactions" ADD CONSTRAINT "team_inventory_transactions_material_type_id_material_types_id_fk" FOREIGN KEY ("material_type_id") REFERENCES "public"."material_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_inventory_transactions" ADD CONSTRAINT "team_inventory_transactions_created_by_participants_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_lines" ADD CONSTRAINT "trade_lines_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_lines" ADD CONSTRAINT "trade_lines_from_team_id_teams_id_fk" FOREIGN KEY ("from_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_lines" ADD CONSTRAINT "trade_lines_material_type_id_material_types_id_fk" FOREIGN KEY ("material_type_id") REFERENCES "public"."material_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_proposer_team_id_teams_id_fk" FOREIGN KEY ("proposer_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_counterparty_team_id_teams_id_fk" FOREIGN KEY ("counterparty_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_moderator_id_participants_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_bonus_uses" ADD CONSTRAINT "building_bonus_uses_constructed_building_id_constructed_buildings_id_fk" FOREIGN KEY ("constructed_building_id") REFERENCES "public"."constructed_buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_bonus_uses" ADD CONSTRAINT "building_bonus_uses_source_material_type_id_material_types_id_fk" FOREIGN KEY ("source_material_type_id") REFERENCES "public"."material_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_recipes" ADD CONSTRAINT "building_recipes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constructed_buildings" ADD CONSTRAINT "constructed_buildings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constructed_buildings" ADD CONSTRAINT "constructed_buildings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constructed_buildings" ADD CONSTRAINT "constructed_buildings_recipe_id_building_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."building_recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constructed_buildings" ADD CONSTRAINT "constructed_buildings_verified_by_participants_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_challenger_team_id_teams_id_fk" FOREIGN KEY ("challenger_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_target_building_id_constructed_buildings_id_fk" FOREIGN KEY ("target_building_id") REFERENCES "public"."constructed_buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_resolved_by_participants_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_requirements" ADD CONSTRAINT "recipe_requirements_recipe_id_building_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."building_recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_requirements" ADD CONSTRAINT "recipe_requirements_material_type_id_material_types_id_fk" FOREIGN KEY ("material_type_id") REFERENCES "public"."material_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_assigned_team_id_teams_id_fk" FOREIGN KEY ("assigned_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_auctions" ADD CONSTRAINT "city_auctions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_auctions" ADD CONSTRAINT "city_auctions_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_auctions" ADD CONSTRAINT "city_auctions_winner_team_id_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_bids" ADD CONSTRAINT "city_bids_city_auction_id_city_auctions_id_fk" FOREIGN KEY ("city_auction_id") REFERENCES "public"."city_auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_bids" ADD CONSTRAINT "city_bids_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_preferences" ADD CONSTRAINT "city_preferences_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_preferences" ADD CONSTRAINT "city_preferences_building_recipe_id_building_recipes_id_fk" FOREIGN KEY ("building_recipe_id") REFERENCES "public"."building_recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_reports" ADD CONSTRAINT "scout_reports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_reports" ADD CONSTRAINT "scout_reports_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_reports" ADD CONSTRAINT "scout_reports_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_participant_id_participants_id_fk" FOREIGN KEY ("actor_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_staff_event_participant_unique" ON "event_staff" USING btree ("event_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_participant_unique" ON "team_members" USING btree ("team_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_event_participant_unique" ON "team_members" USING btree ("event_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_event_code_unique" ON "teams" USING btree ("event_id","code");