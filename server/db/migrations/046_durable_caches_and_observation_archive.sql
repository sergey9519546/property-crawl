-- Migration 046: Durable PG caches, AI spend ledger, source intake records,
-- 180-day observation archive, sticky bid history, and portfolio Kanban stage.

-- C9: Sticky opening bid baseline & peak on listings
DO $$
BEGIN
  IF to_regclass('public.listings') IS NOT NULL THEN
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS initial_opening_bid NUMERIC(14, 2);
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS peak_opening_bid NUMERIC(14, 2);
    UPDATE listings
       SET initial_opening_bid = opening_bid,
           peak_opening_bid = opening_bid
     WHERE opening_bid IS NOT NULL
       AND (initial_opening_bid IS NULL OR peak_opening_bid IS NULL);
  END IF;
END $$;

-- C9: Compacted 180-day archive for aged/orphaned source_observations (no FK to listings)
CREATE TABLE IF NOT EXISTS source_observations_archive (
    id VARCHAR(64) PRIMARY KEY,
    listing_id TEXT NOT NULL,
    source_key VARCHAR(32) NOT NULL,
    record_id TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    opening_bid NUMERIC(14, 2),
    sale_date DATE,
    status VARCHAR(64),
    deposit TEXT,
    notice_sha256 CHAR(64),
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_observations_archive_listing_obs
    ON source_observations_archive(listing_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_observations_archive_archived_at
    ON source_observations_archive(archived_at);

-- I13: Server-side Portfolio Kanban stage per saved deal
DO $$
BEGIN
  IF to_regclass('public.saved_deals') IS NOT NULL THEN
    ALTER TABLE saved_deals ADD COLUMN IF NOT EXISTS pipeline_stage VARCHAR(32) NOT NULL DEFAULT 'triage';
  END IF;
END $$;

-- I1: Durable PG KV cache replacing Vercel /tmp JSON caches
CREATE TABLE IF NOT EXISTS durable_kv_cache (
    namespace VARCHAR(64) NOT NULL,
    cache_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (namespace, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_durable_kv_cache_expires
    ON durable_kv_cache(expires_at);

-- I1: Durable AI spend ledger replacing in-memory-only CostTracker budget checks
CREATE TABLE IF NOT EXISTS ai_spend_ledger (
    id BIGSERIAL PRIMARY KEY,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,
    route VARCHAR(64),
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_spend_ledger_recorded_at
    ON ai_spend_ledger(recorded_at DESC);

-- I1: Durable source intake records replacing .cache/source-intake.json
CREATE TABLE IF NOT EXISTS source_intake_records (
    id VARCHAR(64) PRIMARY KEY,
    source_id VARCHAR(64) NOT NULL,
    source_url TEXT NOT NULL,
    kind VARCHAR(16) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'needs_review',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    record_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_intake_records_source_submitted
    ON source_intake_records(source_id, submitted_at DESC);
