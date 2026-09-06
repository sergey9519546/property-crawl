CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE listings ADD COLUMN IF NOT EXISTS auction_program TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS lifecycle_status TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS transaction_outcome TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS has_documents BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS discovery_source_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), source_key VARCHAR(32) NOT NULL REFERENCES sources(key),
  trigger TEXT NOT NULL, scope JSONB NOT NULL DEFAULT '{}'::jsonb, scope_hash CHAR(64) NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','complete','partial','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ,
  discovered_count INT NOT NULL DEFAULT 0, accepted_count INT NOT NULL DEFAULT 0,
  rejected_count INT NOT NULL DEFAULT 0, error_message TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_runs_idempotency ON discovery_source_runs(source_key,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS discovery_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), run_id UUID NOT NULL REFERENCES discovery_source_runs(id),
  source_key VARCHAR(32) NOT NULL REFERENCES sources(key), source_record_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL, payload_sha256 CHAR(64) NOT NULL, raw_payload JSONB NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(source_key, source_record_id, observed_at, payload_sha256)
);
CREATE TABLE IF NOT EXISTS discovery_observations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), snapshot_id UUID NOT NULL REFERENCES discovery_snapshots(id),
  field_name TEXT NOT NULL, value JSONB, evidence_class TEXT NOT NULL,
  UNIQUE(snapshot_id, field_name)
);
CREATE TABLE IF NOT EXISTS discovery_checkpoints (
  source_key VARCHAR(32) PRIMARY KEY REFERENCES sources(key), cursor JSONB NOT NULL DEFAULT '{}'::jsonb,
  scope_hash CHAR(64), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS discovery_jobs (
  id VARCHAR(28) PRIMARY KEY CHECK(id ~ '^job_[a-f0-9]{24}$'), idempotency_key TEXT UNIQUE,
  kind TEXT NOT NULL, trigger TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL,
  source_keys TEXT[] NOT NULL DEFAULT '{}', payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  stages JSONB NOT NULL DEFAULT '{}'::jsonb, errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  revision INT NOT NULL DEFAULT 1, result JSONB, error_message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS discovery_leases (
  lease_key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS discovery_source_rollouts (
  source_key VARCHAR(32) PRIMARY KEY REFERENCES sources(key), state TEXT NOT NULL DEFAULT 'candidate'
    CHECK(state IN ('candidate','canary','promoted','paused')),
  clean_canary_runs INT NOT NULL DEFAULT 0, configured_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  promoted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS discovery_hunts (
  id VARCHAR(29) PRIMARY KEY CHECK(id ~ '^hunt_[a-f0-9]{24}$'), name TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version INT NOT NULL DEFAULT 1, criteria JSONB NOT NULL, criteria_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS discovery_hunt_baselines (
  hunt_id VARCHAR(29) NOT NULL REFERENCES discovery_hunts(id) ON DELETE CASCADE, identity_key CHAR(64) NOT NULL,
  hunt_version INT NOT NULL, source_key VARCHAR(32) NOT NULL, source_record_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL, evaluation JSONB NOT NULL, PRIMARY KEY(hunt_id,identity_key)
);
CREATE TABLE IF NOT EXISTS discovery_hunt_events (
  id VARCHAR(29) PRIMARY KEY CHECK(id ~ '^hevt_[a-f0-9]{24}$'), hunt_id VARCHAR(29) NOT NULL REFERENCES discovery_hunts(id) ON DELETE CASCADE,
  identity_key CHAR(64) NOT NULL, event_type TEXT NOT NULL, evidence JSONB NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(hunt_id,identity_key,event_type,detected_at)
);
CREATE INDEX IF NOT EXISTS idx_discovery_snapshots_identity ON discovery_snapshots(source_key, source_record_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_source_started ON discovery_source_runs(source_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_discovery_facets ON listings(state, source_key, prop_type, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_listings_discovery_search ON listings USING GIN ((coalesce(address,'') || ' ' || coalesce(city,'') || ' ' || coalesce(county,'')) gin_trgm_ops);
