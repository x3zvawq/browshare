ALTER TABLE "tab_sessions" ADD COLUMN "runtime_id" uuid;--> statement-breakpoint
ALTER TABLE "tab_sessions" ADD COLUMN "profile_generation" integer;--> statement-breakpoint
ALTER TABLE "tab_sessions" ADD COLUMN "worker_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "tab_sessions" ADD COLUMN "runtime_observed_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "tab_sessions" ADD CONSTRAINT "tab_sessions_runtime_identity_check" CHECK (("tab_sessions"."runtime_id" is null and "tab_sessions"."profile_generation" is null and "tab_sessions"."worker_instance_id" is null and "tab_sessions"."runtime_observed_at" is null)
        or ("tab_sessions"."runtime_id" is not null and "tab_sessions"."profile_generation" is not null and "tab_sessions"."profile_generation" > 0 and "tab_sessions"."worker_instance_id" is not null));
