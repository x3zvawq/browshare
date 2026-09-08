-- Finish old START deliveries before upgrading: they do not carry the data contract.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM profile_runtime_outbox WHERE command->'payload'->>'action' = 'START') THEN
    RAISE EXCEPTION 'Drain pending Profile START operations before the data initialization migration';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "data_initialized" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Old versions did not retain initialization history. An attempted start may have
-- written data even when its result was lost, so require recovery rather than reset it.
UPDATE profiles SET data_initialized = true WHERE runtime_generation > 0;
