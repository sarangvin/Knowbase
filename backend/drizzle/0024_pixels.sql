CREATE TABLE "pixels" (
	"hour" timestamp with time zone NOT NULL,
	"name" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pixels_hour_name_unique" ON "pixels" USING btree ("hour","name");