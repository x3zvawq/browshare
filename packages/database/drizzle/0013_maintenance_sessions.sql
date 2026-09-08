CREATE TYPE "public"."session_kind" AS ENUM('NORMAL', 'MAINTENANCE');--> statement-breakpoint
ALTER TABLE "tab_sessions" ADD COLUMN "kind" "session_kind" DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "tab_sessions" ADD COLUMN "maintenance_released_at" timestamp(3) with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "tab_sessions_maintenance_owner_unique" ON "tab_sessions" USING btree ("profile_id") WHERE "tab_sessions"."kind" = 'MAINTENANCE' and "tab_sessions"."maintenance_released_at" is null;