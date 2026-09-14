ALTER TABLE discovery_source_runs
  ADD COLUMN IF NOT EXISTS coverage JSONB NOT NULL DEFAULT '{}'::jsonb;
