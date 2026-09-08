CREATE TABLE "browshare_internal"."bootstrap_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"completed_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bootstrap_state_singleton_check" CHECK ("singleton")
);
--> statement-breakpoint
CREATE FUNCTION "browshare_internal"."assert_system_manager_exists"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (SELECT 1 FROM "browshare_internal"."bootstrap_state")
		AND NOT EXISTS (
			SELECT 1
			FROM "users" AS "u"
			INNER JOIN "user_roles" AS "ur" ON "ur"."user_id" = "u"."id"
			INNER JOIN "roles" AS "r" ON "r"."id" = "ur"."role_id"
			INNER JOIN "role_permissions" AS "rp" ON "rp"."role_id" = "r"."id"
			INNER JOIN "permissions" AS "p" ON "p"."id" = "rp"."permission_id"
			WHERE "u"."status" = 'ENABLED'
				AND "u"."deleted_at" IS NULL
				AND "r"."deleted_at" IS NULL
				AND "p"."code" = 'system.manage'
		)
	THEN
		RAISE EXCEPTION 'BrowShare requires at least one enabled system manager'
			USING ERRCODE = '23514', CONSTRAINT = 'system_manager_required';
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "browshare_internal"."prevent_bootstrap_state_change"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'BrowShare bootstrap completion cannot be changed or removed'
		USING ERRCODE = '23514', CONSTRAINT = 'bootstrap_state_immutable';
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "bootstrap_state_requires_manager"
AFTER INSERT ON "browshare_internal"."bootstrap_state"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "browshare_internal"."assert_system_manager_exists"();
--> statement-breakpoint
CREATE TRIGGER "bootstrap_state_is_immutable"
BEFORE UPDATE OR DELETE ON "browshare_internal"."bootstrap_state"
FOR EACH ROW EXECUTE FUNCTION "browshare_internal"."prevent_bootstrap_state_change"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "users_keep_system_manager"
AFTER UPDATE OF "status", "deleted_at" OR DELETE ON "users"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "browshare_internal"."assert_system_manager_exists"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "roles_keep_system_manager"
AFTER UPDATE OF "deleted_at" OR DELETE ON "roles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "browshare_internal"."assert_system_manager_exists"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "permissions_keep_system_manager"
AFTER UPDATE OF "code" OR DELETE ON "permissions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "browshare_internal"."assert_system_manager_exists"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "user_roles_keep_system_manager"
AFTER UPDATE OF "user_id", "role_id" OR DELETE ON "user_roles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "browshare_internal"."assert_system_manager_exists"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "role_permissions_keep_system_manager"
AFTER UPDATE OF "role_id", "permission_id" OR DELETE ON "role_permissions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "browshare_internal"."assert_system_manager_exists"();
