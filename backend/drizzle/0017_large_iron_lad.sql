ALTER TABLE "draft_queue" ADD COLUMN "total_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Existing rows have no history to recover, so seed the total from the
-- attempts they are currently charged. It understates any job that was
-- refunded or reset before this column existed, which is the whole reason
-- the column exists — but it is a floor, not a guess.
UPDATE "draft_queue" SET "total_attempts" = "attempts" WHERE "total_attempts" = 0;
