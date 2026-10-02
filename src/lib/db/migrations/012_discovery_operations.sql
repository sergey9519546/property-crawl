ALTER TABLE discovery_source_runs ADD COLUMN IF NOT EXISTS discovery_job_id TEXT REFERENCES discovery_jobs(id);
CREATE INDEX IF NOT EXISTS discovery_source_runs_job_idx ON discovery_source_runs(discovery_job_id) WHERE status='running';
CREATE TABLE IF NOT EXISTS discovery_worker_health (
  worker_key TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_loop_status TEXT,
  current_job_id TEXT REFERENCES discovery_jobs(id),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
