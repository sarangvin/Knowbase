CREATE TABLE IF NOT EXISTS "short_links" (
	"code" text PRIMARY KEY NOT NULL,
	"space" text,
	"ref" text,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_click_at" timestamp with time zone
);
