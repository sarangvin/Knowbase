CREATE TABLE "freeze_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"day" text NOT NULL,
	"coins" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "freeze_purchases" ADD CONSTRAINT "freeze_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "freeze_purchases_user_seq_unique" ON "freeze_purchases" USING btree ("user_id","seq");