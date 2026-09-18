ALTER TABLE "event_settings" ALTER COLUMN "stage_1_starting_tokens" SET DEFAULT 2500;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "auction_tokens" SET DEFAULT 2500;--> statement-breakpoint
-- Rulebook v3 data fix, applied to every existing event still at the
-- pre-v3 default: any moderator who hasn't already customized this
-- field for their event gets the new 2500-token Stage 1 budget applied
-- automatically. A row already changed away from 1000 (a deliberate
-- per-event customization) is left untouched.
UPDATE "event_settings" SET "stage_1_starting_tokens" = 2500 WHERE "stage_1_starting_tokens" = 1000;