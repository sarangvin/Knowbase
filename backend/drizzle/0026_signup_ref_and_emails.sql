ALTER TABLE "users" ADD COLUMN "signup_ref" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_opted_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_ready_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_next_sent_at" timestamp with time zone;
