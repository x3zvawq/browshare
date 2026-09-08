CREATE TYPE "public"."worker_credential_rotation_status" AS ENUM('ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED');--> statement-breakpoint
ALTER TABLE "worker_credentials" ADD CONSTRAINT "worker_credentials_id_worker_id_unique" UNIQUE("id","worker_id");--> statement-breakpoint
CREATE TABLE "worker_credential_rotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid NOT NULL,
	"replaces_credential_id" uuid NOT NULL,
	"issued_credential_id" uuid,
	"token_digest" varchar(128) NOT NULL,
	"status" "worker_credential_rotation_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" uuid,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"consumed_at" timestamp(3) with time zone,
	"revoked_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_credential_rotations_expiry_check" CHECK ("worker_credential_rotations"."expires_at" > "worker_credential_rotations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "worker_credential_rotations" ADD CONSTRAINT "worker_credential_rotations_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_credential_rotations" ADD CONSTRAINT "worker_credential_rotations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_credential_rotations" ADD CONSTRAINT "worker_credential_rotations_replaces_worker_fk" FOREIGN KEY ("replaces_credential_id","worker_id") REFERENCES "public"."worker_credentials"("id","worker_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_credential_rotations" ADD CONSTRAINT "worker_credential_rotations_issued_worker_fk" FOREIGN KEY ("issued_credential_id","worker_id") REFERENCES "public"."worker_credentials"("id","worker_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_credential_rotations_token_digest_unique" ON "worker_credential_rotations" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "worker_credential_rotations_worker_status_idx" ON "worker_credential_rotations" USING btree ("worker_id","status");--> statement-breakpoint
CREATE INDEX "worker_credential_rotations_status_expires_idx" ON "worker_credential_rotations" USING btree ("status","expires_at");
