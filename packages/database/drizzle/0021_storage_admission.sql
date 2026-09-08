ALTER TABLE "workers" ADD COLUMN "storage_quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "storage_policy_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "storage_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "storage_quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "storage_policy_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "storage_usage" jsonb;
--> statement-breakpoint
ALTER TABLE workers ADD CONSTRAINT workers_storage_quota_check CHECK (storage_quota_bytes is null or storage_quota_bytes between 0 and 9007199254740991);
--> statement-breakpoint
ALTER TABLE profiles ADD CONSTRAINT profiles_storage_quota_check CHECK (storage_quota_bytes is null or storage_quota_bytes between 0 and 9007199254740991);
--> statement-breakpoint
CREATE FUNCTION browshare_notify_storage_policy_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'workers' THEN
    PERFORM pg_notify('browshare_storage_policy_changed', json_build_object('workerId', NEW.id)::text);
  ELSE
    PERFORM pg_notify('browshare_storage_policy_changed', json_build_object('workerId', NEW.worker_id, 'profileId', NEW.id)::text);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workers_storage_policy_update AFTER UPDATE ON workers FOR EACH ROW
WHEN (OLD.storage_policy_version IS DISTINCT FROM NEW.storage_policy_version)
EXECUTE FUNCTION browshare_notify_storage_policy_changed();
--> statement-breakpoint
CREATE TRIGGER profiles_storage_policy_update AFTER UPDATE ON profiles FOR EACH ROW
WHEN (OLD.storage_policy_version IS DISTINCT FROM NEW.storage_policy_version)
EXECUTE FUNCTION browshare_notify_storage_policy_changed();
--> statement-breakpoint
CREATE TRIGGER workers_storage_changed AFTER UPDATE ON workers FOR EACH ROW
WHEN (OLD.storage_policy_version IS DISTINCT FROM NEW.storage_policy_version
 OR OLD.storage_snapshot->>'diskState' IS DISTINCT FROM NEW.storage_snapshot->>'diskState'
 OR OLD.storage_snapshot->>'quotaState' IS DISTINCT FROM NEW.storage_snapshot->>'quotaState'
 OR OLD.storage_snapshot->>'appliedPolicyVersion' IS DISTINCT FROM NEW.storage_snapshot->>'appliedPolicyVersion')
EXECUTE FUNCTION browshare_notify_profiles_changed();
--> statement-breakpoint
CREATE TRIGGER profiles_storage_changed AFTER UPDATE ON profiles FOR EACH ROW
WHEN (OLD.storage_policy_version IS DISTINCT FROM NEW.storage_policy_version
 OR OLD.storage_usage->>'quotaState' IS DISTINCT FROM NEW.storage_usage->>'quotaState'
 OR OLD.storage_usage->>'appliedPolicyVersion' IS DISTINCT FROM NEW.storage_usage->>'appliedPolicyVersion')
EXECUTE FUNCTION browshare_notify_profiles_changed();
