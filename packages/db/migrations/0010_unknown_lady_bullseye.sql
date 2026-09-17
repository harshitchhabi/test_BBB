ALTER TYPE "public"."material_lot_source" ADD VALUE 'reserved_kit';--> statement-breakpoint
ALTER TABLE "material_types" ADD COLUMN "split_lots" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "material_types" ADD COLUMN "reserved_kit_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Rulebook v2 balance-audit data fix, applied to every existing event
-- (not just newly-seeded ones): Bricks/Cement/Steel/Wood/Glass move from
-- one big lot per team to round(teamCount*2.5) smaller lots per round;
-- the figures below are the new PER-LOT quantity/opening bid (total
-- supply and per-unit sticker price are unchanged). Only rows still at
-- their original pre-v2 values are touched, so this is safe to run
-- against an event a moderator already customized post-v2.
UPDATE "material_types" SET "default_lot_quantity" = 240, "default_opening_bid" = 240, "split_lots" = true, "reserved_kit_eligible" = true WHERE "key" = 'bricks' AND "default_lot_quantity" = 600;--> statement-breakpoint
UPDATE "material_types" SET "default_lot_quantity" = 120, "default_opening_bid" = 360, "split_lots" = true, "reserved_kit_eligible" = true WHERE "key" = 'cement' AND "default_lot_quantity" = 300;--> statement-breakpoint
UPDATE "material_types" SET "default_lot_quantity" = 40, "default_opening_bid" = 320, "split_lots" = true, "reserved_kit_eligible" = true WHERE "key" = 'steel' AND "default_lot_quantity" = 100;--> statement-breakpoint
UPDATE "material_types" SET "default_lot_quantity" = 48, "default_opening_bid" = 96, "split_lots" = true, "reserved_kit_eligible" = false WHERE "key" = 'wood' AND "default_lot_quantity" = 120;--> statement-breakpoint
UPDATE "material_types" SET "default_lot_quantity" = 32, "default_opening_bid" = 192, "split_lots" = true, "reserved_kit_eligible" = false WHERE "key" = 'glass' AND "default_lot_quantity" = 80;--> statement-breakpoint
-- Rulebook v2 balance-audit correction: University's printed points
-- (130) implied a per-point cost ~18% below every other building;
-- corrected to 110. Only touches a row still at the old value.
UPDATE "building_recipes" SET "base_points" = 110 WHERE "key" = 'university' AND "base_points" = 130;