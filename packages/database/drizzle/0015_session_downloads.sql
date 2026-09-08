CREATE TABLE "session_downloads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"size" bigint NOT NULL,
	"status" varchar(16) NOT NULL,
	"completed_at" timestamp(3) with time zone NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"session_ended_at" timestamp(3) with time zone,
	"claimed_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_downloads_size_check" CHECK ("session_downloads"."size" >= 0 and "session_downloads"."size" <= 9007199254740991),
	CONSTRAINT "session_downloads_status_check" CHECK ("session_downloads"."status" in ('AVAILABLE', 'CLAIMED', 'EXPIRED')),
	CONSTRAINT "session_downloads_claimed_check" CHECK (("session_downloads"."status" = 'CLAIMED') = ("session_downloads"."claimed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "session_downloads" ADD CONSTRAINT "session_downloads_session_scope_fk" FOREIGN KEY ("session_id","user_id","profile_id","worker_id") REFERENCES "public"."tab_sessions"("id","user_id","profile_id","worker_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_downloads_user_session_idx" ON "session_downloads" USING btree ("user_id","session_id","completed_at");--> statement-breakpoint
CREATE INDEX "session_downloads_worker_status_idx" ON "session_downloads" USING btree ("worker_id","status");