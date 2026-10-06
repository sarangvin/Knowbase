ALTER TABLE "users" ADD COLUMN "access_approved_by" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "access_revoked_at" timestamp with time zone;