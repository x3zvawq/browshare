CREATE TRIGGER workers_changed_insert_delete AFTER INSERT OR DELETE ON workers
FOR EACH STATEMENT EXECUTE FUNCTION browshare_notify_profiles_changed();
--> statement-breakpoint
-- Heartbeat times, metrics and repeated capability payloads do not invalidate the overview.
CREATE TRIGGER workers_changed_update AFTER UPDATE ON workers FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name
  OR OLD.status IS DISTINCT FROM NEW.status
  OR OLD.max_active_tabs IS DISTINCT FROM NEW.max_active_tabs
  OR OLD.disabled_at IS DISTINCT FROM NEW.disabled_at
  OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
  OR OLD.last_probe_error_code IS DISTINCT FROM NEW.last_probe_error_code)
EXECUTE FUNCTION browshare_notify_profiles_changed();
--> statement-breakpoint
CREATE TRIGGER tab_sessions_changed_insert_delete AFTER INSERT OR DELETE ON tab_sessions
FOR EACH STATEMENT EXECUTE FUNCTION browshare_notify_profiles_changed();
--> statement-breakpoint
-- Lease/observation and input/frame timestamps change continuously without changing list occupancy.
CREATE TRIGGER tab_sessions_changed_update AFTER UPDATE ON tab_sessions FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status
  OR OLD.kind IS DISTINCT FROM NEW.kind
  OR OLD.worker_id IS DISTINCT FROM NEW.worker_id
  OR OLD.profile_id IS DISTINCT FROM NEW.profile_id
  OR OLD.display_name IS DISTINCT FROM NEW.display_name
  OR OLD.maintenance_released_at IS DISTINCT FROM NEW.maintenance_released_at)
EXECUTE FUNCTION browshare_notify_profiles_changed();
