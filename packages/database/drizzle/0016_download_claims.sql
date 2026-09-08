CREATE TABLE "download_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"download_id" uuid NOT NULL,
	"auth_session_id" uuid NOT NULL,
	"token_digest" varchar(64) NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"consumed_at" timestamp(3) with time zone,
	"worker_instance_id" uuid,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "download_claims_consumed_check" CHECK (("download_claims"."consumed_at" is null) = ("download_claims"."worker_instance_id" is null)),
	CONSTRAINT "download_claims_expiry_check" CHECK ("download_claims"."expires_at" > "download_claims"."created_at")
);
--> statement-breakpoint
ALTER TABLE "download_claims" ADD CONSTRAINT "download_claims_download_id_session_downloads_id_fk" FOREIGN KEY ("download_id") REFERENCES "public"."session_downloads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_claims" ADD CONSTRAINT "download_claims_auth_session_id_auth_sessions_id_fk" FOREIGN KEY ("auth_session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "download_claims_token_digest_unique" ON "download_claims" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "download_claims_download_idx" ON "download_claims" USING btree ("download_id");