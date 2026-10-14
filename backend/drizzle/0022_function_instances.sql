CREATE TABLE "function_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"boot_cpu_ms" integer NOT NULL,
	"boot_wall_ms" integer NOT NULL,
	"first_path" text,
	"region" text,
	"deployment_id" text,
	"requests" integer DEFAULT 1 NOT NULL,
	"cpu_ms" integer NOT NULL,
	"last_request_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "function_instances_started_idx" ON "function_instances" USING btree ("started_at");