-- Migration 042: Add catch_summary column for deterministic "Here's the Catch" single-line flag
-- Zero-fabrication invariant: computed at ingest from publisher fields + title-risk engine,
-- never from LLM or unverified synthesis.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS catch_summary TEXT;

-- Index to quickly find cards that still need a catch computed (back-fill)
CREATE INDEX IF NOT EXISTS idx_listings_catch_summary_null
  ON listings (id)
  WHERE catch_summary IS NULL;
