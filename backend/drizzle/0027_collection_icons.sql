CREATE TABLE "collection_icons" (
	"key" text PRIMARY KEY NOT NULL,
	"icon" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
