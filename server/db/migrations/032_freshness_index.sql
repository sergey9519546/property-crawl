-- Migration 032: Optimize source freshness and observation aggregation scans
-- Accelerates per-source grouping on listings by indexing source_key with source_observed_at.

CREATE INDEX IF NOT EXISTS idx_listings_source_key_observed ON listings(source_key, source_observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source_key);
