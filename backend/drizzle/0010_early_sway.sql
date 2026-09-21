CREATE TABLE "flashcard_decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"cards" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flashcard_decks" ADD CONSTRAINT "flashcard_decks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flashcard_decks_user_day_unique" ON "flashcard_decks" USING btree ("user_id","day");