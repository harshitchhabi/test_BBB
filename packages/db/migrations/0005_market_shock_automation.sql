ALTER TABLE "event_staff" ALTER COLUMN "role" SET DEFAULT 'staff';--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "eco_eligible_solar_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "material_types" ADD COLUMN "pending_opening_bid_increase_percent" integer;--> statement-breakpoint
ALTER TABLE "auction_rounds" ADD COLUMN "eco_bonus_override" integer;