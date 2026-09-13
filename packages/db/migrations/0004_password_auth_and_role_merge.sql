-- Task 1: merge event_staff.role ("moderator" | "admin") into a single
-- "staff" value, and add username/password_hash/session_id auth columns
-- to participants (replacing Google OAuth). Hand-written, not
-- drizzle-kit's raw output — the generated version cast existing
-- "moderator"/"admin" row values straight into the new single-value
-- enum (which only accepts "staff"), and added the new NOT NULL
-- username/password_hash columns with no default, both of which fail
-- outright against a table that already has rows.

-- event_staff.role: detach from the enum, backfill every existing row to
-- "staff" (regardless of its old value), recreate the enum with just
-- that one value, then reattach.
ALTER TABLE "event_staff" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "event_staff" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
UPDATE "event_staff" SET "role" = 'staff';--> statement-breakpoint
DROP TYPE "public"."event_staff_role";--> statement-breakpoint
CREATE TYPE "public"."event_staff_role" AS ENUM('staff');--> statement-breakpoint
ALTER TABLE "event_staff" ALTER COLUMN "role" SET DATA TYPE "public"."event_staff_role" USING "role"::"public"."event_staff_role";--> statement-breakpoint
ALTER TABLE "event_staff" ALTER COLUMN "role" SET DEFAULT 'staff'::"public"."event_staff_role";--> statement-breakpoint

-- participants: relax email (backup field only, no longer the login
-- key), add the new auth columns nullable first so existing rows don't
-- violate NOT NULL, backfill them, then tighten the constraint.
ALTER TABLE "participants" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "session_id" text;--> statement-breakpoint
-- Any pre-existing rows (from the old Google-OAuth era) get a
-- placeholder username and a password hash nobody can produce a match
-- for — they're logged out for good until an admin issues that login a
-- real username/password via the new admin screen. That's the correct
-- outcome: a Google identity was never a username/password login.
UPDATE "participants" SET
  "username" = 'legacy-' || substr("id"::text, 1, 8),
  "password_hash" = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi'
WHERE "username" IS NULL;--> statement-breakpoint
ALTER TABLE "participants" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ALTER COLUMN "password_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_username_unique" UNIQUE("username");
