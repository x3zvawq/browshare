INSERT INTO "system_settings" ("key", "value") VALUES (
  'session.transfers',
  '{"uploadEnabled":true,"downloadEnabled":true,"clipboardTextEnabled":true,"clipboardImageEnabled":true,"maxFileBytes":52428800,"maxFiles":10,"maxTemporaryBytes":209715200,"allowedExtensions":[]}'::jsonb
) ON CONFLICT ("key") DO NOTHING;
