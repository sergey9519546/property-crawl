-- Migration 037: Fast bounded startup purge + FK/cascade indexes.
-- Removes archive, static seed, concluded, past-sale, and stale ServiceLink bulk
-- listings in a small lock-skipping startup batch so rolling deploys bind HTTP
-- ports quickly. Any remaining rows and observation/snapshot bloat are drained
-- post-listen via DatabaseClient.purgeStaleListings().

-- Bound lock waits and overall runtime so an outgoing rolling-deploy container
-- never blocks startup migrations past the platform health deadline.
SET LOCAL lock_timeout = '3000';
SET LOCAL statement_timeout = '15000';

-- 1. Prevent cascading FK deletes on saved_deals and discovery_observations
--    from triggering sequential scans. Check to_regclass() first because
--    CREATE INDEX IF NOT EXISTS still takes a SHARE lock before checking catalog
--    existence, and swallow lock_timeout so contended rolling deploys skip fast.
DO $$
BEGIN
  IF to_regclass('public.saved_deals') IS NOT NULL
     AND to_regclass('public.idx_saved_deals_listing') IS NULL THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_saved_deals_listing ON saved_deals(listing_id)';
    EXCEPTION
      WHEN lock_not_available OR query_canceled THEN
        RAISE NOTICE 'Skipping idx_saved_deals_listing during contended migration window';
    END;
  END IF;
  IF to_regclass('public.discovery_observations') IS NOT NULL
     AND to_regclass('public.idx_discovery_observations_snapshot') IS NULL THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_discovery_observations_snapshot ON discovery_observations(snapshot_id)';
    EXCEPTION
      WHEN lock_not_available OR query_canceled THEN
        RAISE NOTICE 'Skipping idx_discovery_observations_snapshot during contended migration window';
    END;
  END IF;
END $$;

-- 2. Bounded non-blocking purge of old, archive, seed, concluded, and unrefreshed ServiceLink rows.
--    Uses FOR UPDATE SKIP LOCKED and omits ORDER BY id so it never scans the whole
--    table or stalls on row locks held by concurrent scrapers.
DO $$
BEGIN
  DELETE FROM listings
   WHERE id IN (
     SELECT id
       FROM listings
      WHERE COALESCE(provenance->>'origin', '') NOT IN ('live', 'email_notice')
         OR provenance->>'recordKind' = 'archive_record'
         OR (
           (
             discovery_terminal IS TRUE
             OR LOWER(COALESCE(lifecycle_status, '')) IN ('sold', 'closed', 'ended', 'completed', 'cancelled', 'retired', 'withdrawn')
             OR LOWER(COALESCE(status, '')) IN ('sold', 'closed', 'ended', 'completed', 'cancelled', 'retired', 'withdrawn')
             OR provenance ? 'publisherAbsence'
             OR provenance ? 'supersededBy'
           )
           AND (
             source_key = 'servicelink'
             OR sale_date IS NOT NULL
             OR COALESCE(source_observed_at, updated_at) < NOW() - INTERVAL '10 minutes'
           )
         )
         OR (
           sale_date IS NOT NULL
           AND sale_date < CURRENT_DATE - INTERVAL '14 days'
           AND LOWER(COALESCE(status, '')) NOT IN ('postponed', 'adjourned', 'stayed')
           AND LOWER(COALESCE(lifecycle_status, '')) NOT IN ('postponed', 'adjourned', 'stayed')
         )
         OR (
           sale_date IS NOT NULL
           AND sale_date < CURRENT_DATE - INTERVAL '45 days'
         )
         OR (
           source_key = 'servicelink'
           AND COALESCE(source_observed_at, updated_at) < NOW() - INTERVAL '3 days'
         )
         OR COALESCE(source_observed_at, updated_at) < NOW() - INTERVAL '30 days'
      LIMIT 100
      FOR UPDATE SKIP LOCKED
   );
EXCEPTION
  WHEN lock_not_available OR query_canceled THEN
    RAISE NOTICE 'Deferring remaining startup purge rows to post-listen bootMaintenance';
END $$;

-- 3. Advance listing revision sequence and refresh planner statistics cleanly.
DO $$
BEGIN
  IF to_regclass('public.discovery_listing_revision_seq') IS NOT NULL THEN
    PERFORM setval('discovery_listing_revision_seq', nextval('discovery_listing_revision_seq'), true);
  END IF;
  BEGIN
    ANALYZE listings;
  EXCEPTION
    WHEN lock_not_available OR query_canceled THEN
      NULL;
  END;
END $$;
