CREATE TABLE "profile_runtime_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"command" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_runtime_outbox_profile_unique" UNIQUE("profile_id")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "runtime_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "runtime_worker_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "runtime_desired_state" varchar(16) DEFAULT 'STOPPED' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "runtime_observed_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "healthcheck_url" varchar(2048);--> statement-breakpoint
ALTER TABLE "profile_runtime_outbox" ADD CONSTRAINT "profile_runtime_outbox_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_runtime_outbox" ADD CONSTRAINT "profile_runtime_outbox_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_runtime_desired_state_check" CHECK ("profiles"."runtime_desired_state" in ('RUNNING', 'STOPPED'));
--> statement-breakpoint
UPDATE "profiles" SET "runtime_state" = 'ERROR', "runtime_error_code" = 'RUNTIME_IDENTITY_UPGRADE_REQUIRED',
  "runtime_error_summary" = 'Restart the Profile to establish a persisted Runtime identity.', "updated_at" = now()
WHERE "runtime_state" IN ('STARTING', 'RUNNING', 'MAINTAINING', 'STOPPING');
--> statement-breakpoint
CREATE FUNCTION browshare_notify_profiles_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('browshare_profiles_changed', '');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER profiles_changed_insert_delete AFTER INSERT OR DELETE ON profiles
FOR EACH STATEMENT EXECUTE FUNCTION browshare_notify_profiles_changed();
--> statement-breakpoint
CREATE TRIGGER profiles_changed_update AFTER UPDATE ON profiles FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.description IS DISTINCT FROM NEW.description
  OR OLD.business_status IS DISTINCT FROM NEW.business_status OR OLD.runtime_state IS DISTINCT FROM NEW.runtime_state
  OR OLD.runtime_generation IS DISTINCT FROM NEW.runtime_generation OR OLD.runtime_error_code IS DISTINCT FROM NEW.runtime_error_code
  OR OLD.runtime_mode IS DISTINCT FROM NEW.runtime_mode OR OLD.proxy_id IS DISTINCT FROM NEW.proxy_id
  OR OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.tab_audio_enabled IS DISTINCT FROM NEW.tab_audio_enabled
  OR OLD.quality_policy IS DISTINCT FROM NEW.quality_policy OR OLD.runtime_error_summary IS DISTINCT FROM NEW.runtime_error_summary
  OR OLD.healthcheck_url IS DISTINCT FROM NEW.healthcheck_url OR OLD.max_normal_sessions IS DISTINCT FROM NEW.max_normal_sessions
  OR OLD.delete_requested_at IS DISTINCT FROM NEW.delete_requested_at OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
EXECUTE FUNCTION browshare_notify_profiles_changed();
