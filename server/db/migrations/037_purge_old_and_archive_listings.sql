-- Migration 037: Fast bounded startup purge + FK/cascade indexes.
-- Removes archive, static seed, concluded, past-sale, and stale ServiceLink bulk
-- listings in a bounded startup batch (up to 3,000 rows so rolling deploys bind
-- HTTP ports quickly). Any remaining rows and observation/snapshot bloat are
-- drained immediately post-listen via DatabaseClient.purgeStaleListings().

-- 1. Prevent cascading FK deletes on saved_deals and discovery_observations
--    from triggering full sequential table scans.
DO $$
BEGIN
  IF to_regclass('public.saved_deals') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_saved_deals_listing ON saved_deals(listing_id)';
  END IF;
  IF to_regclass('public.discovery_observations') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_discovery_observations_snapshot ON discovery_observations(snapshot_id)';
  END IF;
  IF to_regclass('public.source_observations') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_source_observations_source_observed ON source_observations(source_key, observed_at DESC)';
  END IF;
END $$;

-- 2. Bounded purge of old, archive, seed, concluded, and unrefreshed ServiceLink rows.
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
    ORDER BY id
    LIMIT 250
 );

-- 3. Advance listing revision sequence and refresh planner statistics.
DO $$
BEGIN
  IF to_regclass('public.discovery_listing_revision_seq') IS NOT NULL THEN
    PERFORM setval('discovery_listing_revision_seq', nextval('discovery_listing_revision_seq'), true);
  END IF;
END $$;

ANALYZE listings;
