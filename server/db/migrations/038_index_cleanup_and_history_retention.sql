-- Migration 038: Drop superseded indexes, prune listing_history, speed up cascade deletes.
--
-- Background:
--   • idx_listings_discovery_search (GIN trgm, migration 006) is superseded by
--     idx_listings_discovery_search_text_trgm (migration 035) on the computed
--     discovery_search_text column.  The old index wastes ~35 MB and is never chosen.
--   • listing_history grows unboundedly; rows >21 days old are never read.
--   • idx_listing_history_listing (listing_id, source_observed_at DESC) supports
--     ordered history reads but is too wide for the cascade-delete path; a simple
--     single-column index on listing_id alone is chosen first for ANY(...) deletes.
--
-- All DDL is wrapped in SKIP LOCKED / lock_timeout guards so a contended rolling
-- deploy never blocks startup migrations past the platform health deadline.

BEGIN;
SET LOCAL lock_timeout    = '5000';
SET LOCAL statement_timeout = '30000';

-- 1. Drop superseded GIN text trigram index from migration 006.
--    idx_listings_discovery_search_text_trgm (migration 035) covers all the same
--    queries using the pre-computed discovery_search_text column, faster.
DO $$
BEGIN
  IF to_regclass('public.idx_listings_discovery_search') IS NOT NULL THEN
    BEGIN
      DROP INDEX IF EXISTS idx_listings_discovery_search;
    EXCEPTION
      WHEN lock_not_available OR query_canceled THEN
        RAISE NOTICE 'Skipping idx_listings_discovery_search drop (lock contention) - will retry on next deploy';
    END;
  END IF;
END $$;

-- 2. Add lightweight single-column index on listing_history(listing_id) so that
--    DELETE ... WHERE listing_id = ANY($1::text[]) uses an index-only scan.
--    The existing idx_listing_history_listing covers (listing_id, source_observed_at DESC)
--    and is chosen for ordered reads but NOT for unordered ANY() batches on Nano CPU.
DO $$
BEGIN
  IF to_regclass('public.listing_history') IS NOT NULL
     AND to_regclass('public.idx_listing_history_listing_id_only') IS NULL THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_listing_history_listing_id_only
        ON listing_history(listing_id);
    EXCEPTION
      WHEN lock_not_available OR query_canceled THEN
        RAISE NOTICE 'Skipping idx_listing_history_listing_id_only (lock contention)';
    END;
  END IF;
END $$;

-- 3. Prune listing_history older than 21 days (read window is 7 days in UI).
--    Runs inside the same transaction with bounded statement_timeout.
DO $$
BEGIN
  IF to_regclass('public.listing_history') IS NOT NULL THEN
    BEGIN
      DELETE FROM listing_history
       WHERE recorded_at < NOW() - INTERVAL '21 days';
    EXCEPTION
      WHEN query_canceled THEN
        RAISE NOTICE 'listing_history prune timed out - purgeStaleListings will continue draining';
    END;
  END IF;
END $$;

-- 4. Advance revision and refresh planner statistics.
DO $$
BEGIN
  IF to_regclass('public.discovery_listing_revision_seq') IS NOT NULL THEN
    PERFORM setval('discovery_listing_revision_seq', nextval('discovery_listing_revision_seq'), true);
  END IF;
  BEGIN
    ANALYZE listings;
  EXCEPTION
    WHEN lock_not_available OR query_canceled THEN NULL;
  END;
END $$;

COMMIT;
