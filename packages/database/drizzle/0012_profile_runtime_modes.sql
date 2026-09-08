ALTER TABLE "profiles" ADD COLUMN "runtime_idle_timeout_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "runtime_idle_since" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "runtime_healthy_since" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "runtime_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "runtime_failure_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "runtime_retry_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_runtime_idle_timeout_check" CHECK ("profiles"."runtime_idle_timeout_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_runtime_failure_count_check" CHECK ("profiles"."runtime_failure_count" >= 0);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_runtime_failure_generation_check" CHECK ("profiles"."runtime_failure_generation" >= 0);