ALTER TABLE "workers" ADD COLUMN "runtime_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "last_snapshot_at" timestamp(3) with time zone;