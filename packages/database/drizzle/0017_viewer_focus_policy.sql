ALTER TABLE "profiles" ADD COLUMN "viewer_focus_policy" jsonb;
--> statement-breakpoint
INSERT INTO "system_settings" ("key", "value") VALUES (
  'viewer.focus', '{"mode":"WHEN_UNFOCUSED","gracePeriodMs":15000}'::jsonb
);
