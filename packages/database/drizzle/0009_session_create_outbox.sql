CREATE TABLE "session_create_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"command" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_create_outbox_session_unique" UNIQUE("session_id")
);
--> statement-breakpoint
ALTER TABLE "session_create_outbox" ADD CONSTRAINT "session_create_outbox_session_id_tab_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tab_sessions"("id") ON DELETE cascade ON UPDATE no action;