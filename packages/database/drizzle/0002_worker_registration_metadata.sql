ALTER TABLE "workers" ADD COLUMN "reported_hostname" varchar(255);--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "platform" varchar(32);--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "architecture" varchar(32);