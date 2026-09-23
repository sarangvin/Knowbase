DROP INDEX "onboarding_jobs_user_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_jobs_user_topic_unique" ON "onboarding_jobs" USING btree ("user_id","topic");