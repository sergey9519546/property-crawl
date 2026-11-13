-- Migration 034: Short-lock metadata DDL for precomputed zero-TOAST discovery columns
--
-- Split deliberately from Migration 035 (backfill + GIN index build) so Postgres
-- never holds ACCESS EXCLUSIVE across a full-table JSONB backfill or trigram
-- index build during a rolling deploy. ADD COLUMN with constant DEFAULT is an
-- O(1) metadata-only change in PG 11+ and commits immediately.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS discovery_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS discovery_action_tier SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discovery_is_live BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS discovery_program TEXT,
  ADD COLUMN IF NOT EXISTS discovery_search_text TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_listings_discovery_full_search;
