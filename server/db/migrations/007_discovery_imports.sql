-- Attachment evidence remains distinct from live publisher observations.
CREATE TABLE IF NOT EXISTS discovery_imports (
  dataset_sha256 text PRIMARY KEY,
  manifest jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS discovery_media_references (
  reference_key text PRIMARY KEY,
  source_key text NOT NULL,
  source_record_id text NOT NULL,
  source_url text NOT NULL,
  media_index integer NOT NULL,
  observed_at timestamptz NOT NULL,
  dataset_sha256 text NOT NULL,
  UNIQUE(source_key, source_record_id, source_url, dataset_sha256)
);
CREATE INDEX IF NOT EXISTS discovery_media_record_idx ON discovery_media_references(source_key, source_record_id);
CREATE TABLE IF NOT EXISTS discovery_media_assets (
  sha256 text PRIMARY KEY,
  bytes bigint NOT NULL,
  local_path text,
  integrity text NOT NULL,
  display_status text NOT NULL DEFAULT 'policy_review_required',
  rights text NOT NULL DEFAULT 'not_established'
);
CREATE TABLE IF NOT EXISTS discovery_media_links (
  source_key text NOT NULL,
  source_record_id text NOT NULL,
  sha256 text NOT NULL REFERENCES discovery_media_assets(sha256),
  source_url text NOT NULL,
  dataset_sha256 text NOT NULL,
  PRIMARY KEY(source_key,source_record_id,sha256,dataset_sha256)
);
CREATE TABLE IF NOT EXISTS discovery_atlas_sources (
  id text PRIMARY KEY,
  atlas_id integer NOT NULL UNIQUE,
  record jsonb NOT NULL,
  dataset_sha256 text NOT NULL,
  automation_status text NOT NULL DEFAULT 'backlog',
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS discovery_atlas_ledger (
  entry_key text PRIMARY KEY,
  record jsonb NOT NULL,
  dataset_sha256 text NOT NULL
);
CREATE TABLE IF NOT EXISTS discovery_legacy_imports (
  content_sha256 text NOT NULL,
  kind text NOT NULL,
  original_path text NOT NULL,
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(content_sha256,kind)
);
