ALTER TABLE "event_staff" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_staff" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "completed_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "participants" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "participants" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "joined_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "joined_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auction_lots" ALTER COLUMN "opens_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auction_lots" ALTER COLUMN "closes_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auction_rounds" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auction_rounds" ALTER COLUMN "closed_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bids" ALTER COLUMN "submitted_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bids" ALTER COLUMN "submitted_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "bank_purchases" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_purchases" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "team_inventory_transactions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_inventory_transactions" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "registered_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "completed_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "constructed_buildings" ALTER COLUMN "built_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "constructed_buildings" ALTER COLUMN "built_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "constructed_buildings" ALTER COLUMN "voided_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inspections" ALTER COLUMN "resolved_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inspections" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inspections" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "city_auctions" ALTER COLUMN "opens_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "city_auctions" ALTER COLUMN "closes_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "city_bids" ALTER COLUMN "submitted_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "city_bids" ALTER COLUMN "submitted_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "scout_reports" ALTER COLUMN "purchased_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scout_reports" ALTER COLUMN "purchased_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "score_snapshots" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "score_snapshots" ALTER COLUMN "created_at" SET DEFAULT now();