ALTER TABLE "proxies" ADD COLUMN "configuration_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "proxies" ADD COLUMN "last_probe_worker_id" uuid;--> statement-breakpoint
ALTER TABLE "proxies" ADD COLUMN "last_probe_mode" varchar(16);--> statement-breakpoint
ALTER TABLE "proxies" ADD COLUMN "last_exit_ip" varchar(45);--> statement-breakpoint
ALTER TABLE "proxies" ADD COLUMN "last_probe_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "route_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "runtime_route_version" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "runtime_proxy_health" jsonb;--> statement-breakpoint
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_last_probe_worker_id_workers_id_fk" FOREIGN KEY ("last_probe_worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
DROP TRIGGER profiles_changed_update ON profiles;
--> statement-breakpoint
-- Periodic check timestamps and latency alone do not invalidate every open list.
CREATE TRIGGER profiles_changed_update AFTER UPDATE ON profiles FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.description IS DISTINCT FROM NEW.description
  OR OLD.business_status IS DISTINCT FROM NEW.business_status OR OLD.runtime_state IS DISTINCT FROM NEW.runtime_state
  OR OLD.runtime_generation IS DISTINCT FROM NEW.runtime_generation OR OLD.runtime_error_code IS DISTINCT FROM NEW.runtime_error_code
  OR OLD.runtime_mode IS DISTINCT FROM NEW.runtime_mode OR OLD.proxy_id IS DISTINCT FROM NEW.proxy_id
  OR OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.tab_audio_enabled IS DISTINCT FROM NEW.tab_audio_enabled
  OR OLD.quality_policy IS DISTINCT FROM NEW.quality_policy OR OLD.runtime_error_summary IS DISTINCT FROM NEW.runtime_error_summary
  OR OLD.healthcheck_url IS DISTINCT FROM NEW.healthcheck_url OR OLD.max_normal_sessions IS DISTINCT FROM NEW.max_normal_sessions
  OR OLD.route_version IS DISTINCT FROM NEW.route_version
  OR OLD.runtime_route_version IS DISTINCT FROM NEW.runtime_route_version
  OR (OLD.runtime_proxy_health->>'status') IS DISTINCT FROM (NEW.runtime_proxy_health->>'status')
  OR (OLD.runtime_proxy_health->>'errorCode') IS DISTINCT FROM (NEW.runtime_proxy_health->>'errorCode')
  OR (OLD.runtime_proxy_health->>'httpStatus') IS DISTINCT FROM (NEW.runtime_proxy_health->>'httpStatus')
  OR OLD.delete_requested_at IS DISTINCT FROM NEW.delete_requested_at OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
EXECUTE FUNCTION browshare_notify_profiles_changed();

--> statement-breakpoint
CREATE TRIGGER proxies_changed_insert_delete AFTER INSERT OR DELETE ON proxies
FOR EACH STATEMENT EXECUTE FUNCTION browshare_notify_profiles_changed();
--> statement-breakpoint
-- Explicit probes refresh their visible result; internal in-flight correlation stays private.
CREATE TRIGGER proxies_changed_update AFTER UPDATE ON proxies FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name
  OR OLD.configuration_version IS DISTINCT FROM NEW.configuration_version
  OR OLD.health_status IS DISTINCT FROM NEW.health_status
  OR OLD.last_checked_at IS DISTINCT FROM NEW.last_checked_at
  OR OLD.last_succeeded_at IS DISTINCT FROM NEW.last_succeeded_at
  OR OLD.last_error_summary IS DISTINCT FROM NEW.last_error_summary
  OR OLD.last_probe_worker_id IS DISTINCT FROM NEW.last_probe_worker_id
  OR OLD.last_probe_mode IS DISTINCT FROM NEW.last_probe_mode
  OR OLD.last_exit_ip IS DISTINCT FROM NEW.last_exit_ip
  OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
EXECUTE FUNCTION browshare_notify_profiles_changed();
