ALTER TABLE "users" ALTER COLUMN "bonus_freezes" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "starting_freezes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_lesson_bonus_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
-- Accounts that existed before these rules keep what they had: two regular
-- freezes, the one-off bonus from 0019, no first-lesson bonus on top, and
-- their last sign-in as the last time they were seen.
UPDATE "users" SET "starting_freezes" = 2, "first_lesson_bonus_at" = now(), "last_seen_at" = coalesce("last_login_at", "created_at");
