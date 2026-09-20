CREATE TABLE "onboarding_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"status" text NOT NULL,
	"space" text,
	"open_path" text,
	"error" text,
	"notes_total" integer DEFAULT 0 NOT NULL,
	"notes_drafted" integer DEFAULT 0 NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_jobs" ADD CONSTRAINT "onboarding_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_jobs_user_unique" ON "onboarding_jobs" USING btree ("user_id");