CREATE TYPE "public"."audit_result" AS ENUM('SUCCEEDED', 'FAILED', 'DENIED');--> statement-breakpoint
CREATE TYPE "public"."enabled_status" AS ENUM('ENABLED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."navigation_action" AS ENUM('ALLOW_REMOTE', 'DENY', 'REDIRECT_REMOTE', 'PROMPT_REMOTE', 'OPEN_LOCAL_PROMPT');--> statement-breakpoint
CREATE TYPE "public"."page_script_scope" AS ENUM('NORMAL', 'MAINTENANCE', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."profile_runtime_mode" AS ENUM('ALWAYS_ON', 'ON_DEMAND', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."profile_runtime_state" AS ENUM('STOPPED', 'STARTING', 'RUNNING', 'MAINTAINING', 'STOPPING', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."profile_visibility" AS ENUM('RESTRICTED', 'ALL_ENABLED_USERS');--> statement-breakpoint
CREATE TYPE "public"."proxy_health_status" AS ENUM('UNKNOWN', 'HEALTHY', 'UNHEALTHY');--> statement-breakpoint
CREATE TYPE "public"."proxy_type" AS ENUM('DIRECT', 'HTTP', 'HTTPS', 'SOCKS5');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."session_policy_scope" AS ENUM('GLOBAL', 'USER_PROFILE', 'USER_PROFILE_GROUP');--> statement-breakpoint
CREATE TYPE "public"."tab_session_status" AS ENUM('RESERVED', 'CREATING', 'READY', 'CONNECTED', 'SUSPENDED', 'DISCONNECTED', 'CLOSING', 'CLOSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."version_state" AS ENUM('DRAFT', 'PUBLISHED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."viewer_ticket_purpose" AS ENUM('CONNECT', 'TAKEOVER');--> statement-breakpoint
CREATE TYPE "public"."viewer_ticket_status" AS ENUM('ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."worker_credential_status" AS ENUM('ACTIVE', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."worker_enrollment_status" AS ENUM('ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."worker_status" AS ENUM('PENDING', 'ONLINE', 'DRAINING', 'OFFLINE', 'DISABLED');--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_digest" varchar(128) NOT NULL,
	"device_name" varchar(128),
	"user_agent_summary" varchar(512),
	"ip_hash" varchar(128),
	"expires_at" timestamp(3) with time zone NOT NULL,
	"last_seen_at" timestamp(3) with time zone NOT NULL,
	"revoked_at" timestamp(3) with time zone,
	"revoke_reason" varchar(96),
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_expiry_check" CHECK ("auth_sessions"."expires_at" > "auth_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(96) NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_code_format_check" CHECK ("permissions"."code" ~ '^[a-z][a-z0-9_.:-]*$')
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"granted_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_format_check" CHECK ("roles"."code" ~ '^[a-z][a-z0-9_.:-]*$')
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"assigned_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(128) NOT NULL,
	"password_hash" text NOT NULL,
	"status" "enabled_status" DEFAULT 'ENABLED' NOT NULL,
	"max_active_sessions" integer,
	"email_verified_at" timestamp(3) with time zone,
	"deleted_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_normalized_check" CHECK ("users"."email" = lower(btrim("users"."email"))),
	CONSTRAINT "users_max_active_sessions_check" CHECK ("users"."max_active_sessions" is null or "users"."max_active_sessions" >= 0)
);
--> statement-breakpoint
CREATE TABLE "proxies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" "proxy_type" NOT NULL,
	"host" varchar(255),
	"port" integer,
	"username" text,
	"password" text,
	"healthcheck_url" text,
	"health_status" "proxy_health_status" DEFAULT 'UNKNOWN' NOT NULL,
	"last_checked_at" timestamp(3) with time zone,
	"last_succeeded_at" timestamp(3) with time zone,
	"last_error_summary" text,
	"deleted_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proxies_endpoint_check" CHECK ((
        "proxies"."type" = 'DIRECT'
        and "proxies"."host" is null
        and "proxies"."port" is null
        and "proxies"."username" is null
        and "proxies"."password" is null
      ) or (
        "proxies"."type" <> 'DIRECT'
        and "proxies"."host" is not null
        and "proxies"."port" between 1 and 65535
      ))
);
--> statement-breakpoint
CREATE TABLE "worker_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid NOT NULL,
	"status" "worker_credential_status" DEFAULT 'ACTIVE' NOT NULL,
	"certificate_serial" varchar(128) NOT NULL,
	"certificate_pem" text NOT NULL,
	"public_key_pem" text NOT NULL,
	"fingerprint_sha256" varchar(95) NOT NULL,
	"not_before" timestamp(3) with time zone NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"revoked_at" timestamp(3) with time zone,
	"revoke_reason" varchar(128),
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_credentials_validity_check" CHECK ("worker_credentials"."expires_at" > "worker_credentials"."not_before")
);
--> statement-breakpoint
CREATE TABLE "worker_enrollments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_digest" varchar(128) NOT NULL,
	"status" "worker_enrollment_status" DEFAULT 'ACTIVE' NOT NULL,
	"display_name" varchar(128),
	"created_by_user_id" uuid,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"consumed_at" timestamp(3) with time zone,
	"consumed_by_worker_id" uuid,
	"revoked_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_enrollments_expiry_check" CHECK ("worker_enrollments"."expires_at" > "worker_enrollments"."created_at")
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"status" "worker_status" DEFAULT 'PENDING' NOT NULL,
	"max_active_tabs" integer DEFAULT 4,
	"last_seen_at" timestamp(3) with time zone,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_probe_error_code" varchar(128),
	"last_probe_error_summary" text,
	"disabled_at" timestamp(3) with time zone,
	"deleted_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workers_max_active_tabs_check" CHECK ("workers"."max_active_tabs" is null or "workers"."max_active_tabs" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(128) NOT NULL,
	"target_type" varchar(96) NOT NULL,
	"target_id" text,
	"result" "audit_result" NOT NULL,
	"request_id" varchar(128),
	"source_ip_hash" varchar(128),
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_action_format_check" CHECK ("audit_events"."action" ~ '^[a-z][a-z0-9_.:-]*$'),
	CONSTRAINT "audit_events_target_type_format_check" CHECK ("audit_events"."target_type" ~ '^[a-z][a-z0-9_.:-]*$'),
	CONSTRAINT "audit_events_changes_object_check" CHECK (jsonb_typeof("audit_events"."changes") = 'object'),
	CONSTRAINT "audit_events_metadata_object_check" CHECK (jsonb_typeof("audit_events"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_key_format_check" CHECK ("system_settings"."key" ~ '^[a-z][a-z0-9_.:-]*$'),
	CONSTRAINT "system_settings_revision_check" CHECK ("system_settings"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "navigation_policy_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"state" "version_state" DEFAULT 'DRAFT' NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_script" text,
	"default_action" "navigation_action" DEFAULT 'DENY' NOT NULL,
	"change_summary" varchar(512),
	"created_by_user_id" uuid,
	"published_at" timestamp(3) with time zone,
	"disabled_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "navigation_policy_versions_profile_id_id_unique" UNIQUE("profile_id","id"),
	CONSTRAINT "navigation_policy_versions_version_check" CHECK ("navigation_policy_versions"."version" >= 1),
	CONSTRAINT "navigation_policy_versions_rules_array_check" CHECK (jsonb_typeof("navigation_policy_versions"."rules") = 'array')
);
--> statement-breakpoint
CREATE TABLE "page_script_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"state" "version_state" DEFAULT 'DRAFT' NOT NULL,
	"applies_to" "page_script_scope" DEFAULT 'NORMAL' NOT NULL,
	"source_code" text NOT NULL,
	"change_summary" varchar(512),
	"created_by_user_id" uuid,
	"published_at" timestamp(3) with time zone,
	"disabled_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_script_versions_profile_id_id_unique" UNIQUE("profile_id","id"),
	CONSTRAINT "page_script_versions_version_check" CHECK ("page_script_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "profile_publications" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"page_script_version_id" uuid,
	"navigation_policy_version_id" uuid,
	"updated_by_user_id" uuid,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" "session_policy_scope" NOT NULL,
	"user_id" uuid,
	"profile_id" uuid,
	"profile_group_id" uuid,
	"recycle_disabled" boolean DEFAULT false NOT NULL,
	"viewer_disconnect_timeout_seconds" integer DEFAULT 300,
	"no_input_timeout_seconds" integer,
	"no_frame_change_timeout_seconds" integer,
	"max_duration_seconds" integer,
	"proxy_failure_timeout_seconds" integer,
	"countdown_seconds" integer DEFAULT 60 NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_policies_scope_columns_check" CHECK ((
        "session_policies"."scope" = 'GLOBAL'
        and "session_policies"."user_id" is null
        and "session_policies"."profile_id" is null
        and "session_policies"."profile_group_id" is null
      ) or (
        "session_policies"."scope" = 'USER_PROFILE'
        and "session_policies"."user_id" is not null
        and "session_policies"."profile_id" is not null
        and "session_policies"."profile_group_id" is null
      ) or (
        "session_policies"."scope" = 'USER_PROFILE_GROUP'
        and "session_policies"."user_id" is not null
        and "session_policies"."profile_id" is null
        and "session_policies"."profile_group_id" is not null
      )),
	CONSTRAINT "session_policies_timeouts_check" CHECK ((
        ("session_policies"."viewer_disconnect_timeout_seconds" is null or "session_policies"."viewer_disconnect_timeout_seconds" > 0)
        and ("session_policies"."no_input_timeout_seconds" is null or "session_policies"."no_input_timeout_seconds" > 0)
        and ("session_policies"."no_frame_change_timeout_seconds" is null or "session_policies"."no_frame_change_timeout_seconds" > 0)
        and ("session_policies"."max_duration_seconds" is null or "session_policies"."max_duration_seconds" > 0)
        and ("session_policies"."proxy_failure_timeout_seconds" is null or "session_policies"."proxy_failure_timeout_seconds" > 0)
        and "session_policies"."countdown_seconds" >= 0
      ))
);
--> statement-breakpoint
CREATE TABLE "profile_group_members" (
	"profile_id" uuid NOT NULL,
	"profile_group_id" uuid NOT NULL,
	"added_by_user_id" uuid,
	"added_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_group_members_pk" PRIMARY KEY("profile_id","profile_group_id")
);
--> statement-breakpoint
CREATE TABLE "profile_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"status" "enabled_status" DEFAULT 'ENABLED' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"worker_id" uuid NOT NULL,
	"proxy_id" uuid,
	"visibility" "profile_visibility" DEFAULT 'RESTRICTED' NOT NULL,
	"business_status" "enabled_status" DEFAULT 'ENABLED' NOT NULL,
	"runtime_state" "profile_runtime_state" DEFAULT 'STOPPED' NOT NULL,
	"runtime_mode" "profile_runtime_mode" DEFAULT 'ON_DEMAND' NOT NULL,
	"runtime_generation" integer DEFAULT 0 NOT NULL,
	"runtime_error_code" varchar(128),
	"runtime_error_summary" text,
	"max_normal_sessions" integer DEFAULT 4,
	"tab_audio_enabled" boolean DEFAULT true NOT NULL,
	"quality_policy" jsonb DEFAULT '{"maxWidth":1920,"maxHeight":1080,"maxFps":60,"maxBitrateKbps":null}'::jsonb NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"delete_requested_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_id_worker_id_unique" UNIQUE("id","worker_id"),
	CONSTRAINT "profiles_runtime_generation_check" CHECK ("profiles"."runtime_generation" >= 0),
	CONSTRAINT "profiles_max_normal_sessions_check" CHECK ("profiles"."max_normal_sessions" is null or "profiles"."max_normal_sessions" >= 0),
	CONSTRAINT "profiles_quality_policy_object_check" CHECK (jsonb_typeof("profiles"."quality_policy") = 'object')
);
--> statement-breakpoint
CREATE TABLE "user_profile_contexts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_contexts_variables_object_check" CHECK (jsonb_typeof("user_profile_contexts"."variables") = 'object')
);
--> statement-breakpoint
CREATE TABLE "user_profile_grants" (
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"granted_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_grants_pk" PRIMARY KEY("user_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "user_profile_groups" (
	"user_id" uuid NOT NULL,
	"profile_group_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"granted_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_groups_pk" PRIMARY KEY("user_id","profile_group_id")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"status" "reservation_status" DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"consumed_at" timestamp(3) with time zone,
	"released_at" timestamp(3) with time zone,
	"release_reason" varchar(128),
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_expiry_check" CHECK ("reservations"."expires_at" > "reservations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_events_sequence_check" CHECK ("session_events"."sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tab_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"status" "tab_session_status" DEFAULT 'RESERVED' NOT NULL,
	"display_name" varchar(256),
	"has_custom_display_name" boolean DEFAULT false NOT NULL,
	"remote_title" text,
	"tab_id" integer,
	"target_id" varchar(256),
	"gateway_id" uuid,
	"policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"page_script_version_id" uuid,
	"navigation_policy_version_id" uuid,
	"viewer_generation" integer DEFAULT 0 NOT NULL,
	"active_viewer_client_id" varchar(256),
	"lease_expires_at" timestamp(3) with time zone,
	"last_input_at" timestamp(3) with time zone,
	"last_frame_changed_at" timestamp(3) with time zone,
	"viewer_connected_at" timestamp(3) with time zone,
	"viewer_disconnected_at" timestamp(3) with time zone,
	"closing_at" timestamp(3) with time zone,
	"closed_at" timestamp(3) with time zone,
	"close_reason" varchar(128),
	"failure_code" varchar(128),
	"failure_summary" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tab_sessions_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "tab_sessions_id_scope_unique" UNIQUE("id","user_id","profile_id","worker_id"),
	CONSTRAINT "tab_sessions_viewer_generation_check" CHECK ("tab_sessions"."viewer_generation" >= 0)
);
--> statement-breakpoint
CREATE TABLE "viewer_tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"token_digest" varchar(128) NOT NULL,
	"purpose" "viewer_ticket_purpose" DEFAULT 'CONNECT' NOT NULL,
	"status" "viewer_ticket_status" DEFAULT 'ACTIVE' NOT NULL,
	"generation" integer NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"consumed_at" timestamp(3) with time zone,
	"revoked_at" timestamp(3) with time zone,
	"revoke_reason" varchar(128),
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viewer_tickets_generation_check" CHECK ("viewer_tickets"."generation" >= 0),
	CONSTRAINT "viewer_tickets_expiry_check" CHECK ("viewer_tickets"."expires_at" > "viewer_tickets"."created_at")
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_credentials" ADD CONSTRAINT "worker_credentials_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_enrollments" ADD CONSTRAINT "worker_enrollments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_enrollments" ADD CONSTRAINT "worker_enrollments_consumed_by_worker_id_workers_id_fk" FOREIGN KEY ("consumed_by_worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "navigation_policy_versions" ADD CONSTRAINT "navigation_policy_versions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "navigation_policy_versions" ADD CONSTRAINT "navigation_policy_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_script_versions" ADD CONSTRAINT "page_script_versions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_script_versions" ADD CONSTRAINT "page_script_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_publications" ADD CONSTRAINT "profile_publications_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_publications" ADD CONSTRAINT "profile_publications_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_publications" ADD CONSTRAINT "profile_publications_page_script_version_fk" FOREIGN KEY ("profile_id","page_script_version_id") REFERENCES "public"."page_script_versions"("profile_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_publications" ADD CONSTRAINT "profile_publications_navigation_policy_version_fk" FOREIGN KEY ("profile_id","navigation_policy_version_id") REFERENCES "public"."navigation_policy_versions"("profile_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_policies" ADD CONSTRAINT "session_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_policies" ADD CONSTRAINT "session_policies_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_policies" ADD CONSTRAINT "session_policies_profile_group_id_profile_groups_id_fk" FOREIGN KEY ("profile_group_id") REFERENCES "public"."profile_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_policies" ADD CONSTRAINT "session_policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_policies" ADD CONSTRAINT "session_policies_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_group_members" ADD CONSTRAINT "profile_group_members_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_group_members" ADD CONSTRAINT "profile_group_members_profile_group_id_profile_groups_id_fk" FOREIGN KEY ("profile_group_id") REFERENCES "public"."profile_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_group_members" ADD CONSTRAINT "profile_group_members_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_proxy_id_proxies_id_fk" FOREIGN KEY ("proxy_id") REFERENCES "public"."proxies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile_contexts" ADD CONSTRAINT "user_profile_contexts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile_contexts" ADD CONSTRAINT "user_profile_contexts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile_contexts" ADD CONSTRAINT "user_profile_contexts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile_grants" ADD CONSTRAINT "user_profile_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile_grants" ADD CONSTRAINT "user_profile_grants_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile_grants" ADD CONSTRAINT "user_profile_grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile_groups" ADD CONSTRAINT "user_profile_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile_groups" ADD CONSTRAINT "user_profile_groups_profile_group_id_profile_groups_id_fk" FOREIGN KEY ("profile_group_id") REFERENCES "public"."profile_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile_groups" ADD CONSTRAINT "user_profile_groups_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_session_scope_fk" FOREIGN KEY ("session_id","user_id","profile_id","worker_id") REFERENCES "public"."tab_sessions"("id","user_id","profile_id","worker_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_tab_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tab_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_sessions" ADD CONSTRAINT "tab_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_sessions" ADD CONSTRAINT "tab_sessions_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_sessions" ADD CONSTRAINT "tab_sessions_profile_worker_fk" FOREIGN KEY ("profile_id","worker_id") REFERENCES "public"."profiles"("id","worker_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_sessions" ADD CONSTRAINT "tab_sessions_page_script_version_fk" FOREIGN KEY ("profile_id","page_script_version_id") REFERENCES "public"."page_script_versions"("profile_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_sessions" ADD CONSTRAINT "tab_sessions_navigation_policy_version_fk" FOREIGN KEY ("profile_id","navigation_policy_version_id") REFERENCES "public"."navigation_policy_versions"("profile_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_tickets" ADD CONSTRAINT "viewer_tickets_session_user_fk" FOREIGN KEY ("session_id","user_id") REFERENCES "public"."tab_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_digest_unique" ON "auth_sessions" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_code_unique" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_code_unique" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE INDEX "user_roles_role_id_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "proxies_name_active_unique" ON "proxies" USING btree ("name") WHERE "proxies"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "proxies_health_status_idx" ON "proxies" USING btree ("health_status");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_credentials_certificate_serial_unique" ON "worker_credentials" USING btree ("certificate_serial");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_credentials_fingerprint_unique" ON "worker_credentials" USING btree ("fingerprint_sha256");--> statement-breakpoint
CREATE INDEX "worker_credentials_worker_status_idx" ON "worker_credentials" USING btree ("worker_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_enrollments_token_digest_unique" ON "worker_enrollments" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "worker_enrollments_status_expires_idx" ON "worker_enrollments" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workers_name_active_unique" ON "workers" USING btree ("name") WHERE "workers"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "workers_status_idx" ON "workers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_occurred_at_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_occurred_at_idx" ON "audit_events" USING btree ("target_type","target_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_action_occurred_at_idx" ON "audit_events" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "navigation_policy_versions_profile_version_unique" ON "navigation_policy_versions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE INDEX "navigation_policy_versions_profile_state_idx" ON "navigation_policy_versions" USING btree ("profile_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "page_script_versions_profile_version_unique" ON "page_script_versions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE INDEX "page_script_versions_profile_state_idx" ON "page_script_versions" USING btree ("profile_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "session_policies_global_unique" ON "session_policies" USING btree ("scope") WHERE "session_policies"."scope" = 'GLOBAL';--> statement-breakpoint
CREATE UNIQUE INDEX "session_policies_user_profile_unique" ON "session_policies" USING btree ("user_id","profile_id") WHERE "session_policies"."scope" = 'USER_PROFILE';--> statement-breakpoint
CREATE UNIQUE INDEX "session_policies_user_group_unique" ON "session_policies" USING btree ("user_id","profile_group_id") WHERE "session_policies"."scope" = 'USER_PROFILE_GROUP';--> statement-breakpoint
CREATE INDEX "session_policies_profile_id_idx" ON "session_policies" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "session_policies_profile_group_id_idx" ON "session_policies" USING btree ("profile_group_id");--> statement-breakpoint
CREATE INDEX "profile_group_members_group_id_idx" ON "profile_group_members" USING btree ("profile_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_groups_name_active_unique" ON "profile_groups" USING btree ("name") WHERE "profile_groups"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "profile_groups_status_priority_idx" ON "profile_groups" USING btree ("status","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_name_active_unique" ON "profiles" USING btree ("name") WHERE "profiles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "profiles_worker_id_idx" ON "profiles" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "profiles_proxy_id_idx" ON "profiles" USING btree ("proxy_id");--> statement-breakpoint
CREATE INDEX "profiles_business_runtime_idx" ON "profiles" USING btree ("business_status","runtime_state");--> statement-breakpoint
CREATE UNIQUE INDEX "user_profile_contexts_user_profile_unique" ON "user_profile_contexts" USING btree ("user_id","profile_id");--> statement-breakpoint
CREATE INDEX "user_profile_contexts_profile_id_idx" ON "user_profile_contexts" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "user_profile_grants_profile_id_idx" ON "user_profile_grants" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "user_profile_groups_group_id_idx" ON "user_profile_groups" USING btree ("profile_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_session_id_unique" ON "reservations" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_message_id_unique" ON "reservations" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "reservations_active_expiry_idx" ON "reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_session_sequence_unique" ON "session_events" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "session_events_occurred_at_idx" ON "session_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "tab_sessions_user_status_idx" ON "tab_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "tab_sessions_profile_status_idx" ON "tab_sessions" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "tab_sessions_worker_status_idx" ON "tab_sessions" USING btree ("worker_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tab_sessions_active_worker_tab_unique" ON "tab_sessions" USING btree ("worker_id","tab_id") WHERE "tab_sessions"."tab_id" is not null and "tab_sessions"."status" not in ('CLOSED', 'FAILED');--> statement-breakpoint
CREATE UNIQUE INDEX "tab_sessions_active_worker_target_unique" ON "tab_sessions" USING btree ("worker_id","target_id") WHERE "tab_sessions"."target_id" is not null and "tab_sessions"."status" not in ('CLOSED', 'FAILED');--> statement-breakpoint
CREATE UNIQUE INDEX "viewer_tickets_token_digest_unique" ON "viewer_tickets" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "viewer_tickets_session_status_idx" ON "viewer_tickets" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "viewer_tickets_expiry_idx" ON "viewer_tickets" USING btree ("expires_at");