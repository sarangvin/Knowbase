CREATE TABLE "draft_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"path" text NOT NULL,
	"space" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"siblings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'grow' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_queue" ADD CONSTRAINT "draft_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_queue" ADD CONSTRAINT "draft_queue_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_queue_vault_path_unique" ON "draft_queue" USING btree ("vault_id","path");--> statement-breakpoint
CREATE INDEX "draft_queue_status_created_idx" ON "draft_queue" USING btree ("status","created_at");