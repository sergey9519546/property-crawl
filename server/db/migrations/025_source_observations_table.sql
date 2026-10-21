-- Migration 025: Source Observations Table and Triage Priority Persistence
-- Moves observation snapshot history off the 40MB filesystem store into PostgreSQL.
-- Persists triage_priority on listings with index for direct sorting and fast queries.

CREATE TABLE IF NOT EXISTS source_observations (
    id VARCHAR(64) PRIMARY KEY,
    listing_id VARCHAR(64) NOT NULL,
    source_key VARCHAR(32) NOT NULL REFERENCES sources(key) ON DELETE CASCADE,
    record_id VARCHAR(128) NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    opening_bid NUMERIC(14, 2),
    sale_date DATE,
    status VARCHAR(64),
    deposit TEXT,
    address TEXT,
    notice_excerpt TEXT,
    notice_sha256 CHAR(64),
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_observations_listing_observed ON source_observations(listing_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_observations_source_record ON source_observations(source_key, record_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_observations_observed_at ON source_observations(observed_at DESC);

-- Persist computed triage_priority alongside deal_score on listings
ALTER TABLE listings ADD COLUMN IF NOT EXISTS triage_priority INT CHECK (triage_priority BETWEEN 0 AND 99);
CREATE INDEX IF NOT EXISTS idx_listings_triage_priority ON listings(triage_priority DESC NULLS LAST);
