-- Purge old/archive/seed/concluded listings and stale ServiceLink bulk
-- so only current auto-scraped live records remain in active inventory.

-- 1. Remove historical archive, seed/snapshot, concluded, past-sale, and
-- stale (>3d unrefreshed) ServiceLink bulk listings. Dependent tables
-- (saved_deals, listing_history, alert_matches) cascade cleanly via FKs.
DELETE FROM listings
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
    OR COALESCE(source_observed_at, updated_at) < NOW() - INTERVAL '30 days';

-- 2. Purge orphaned and stale observation/snapshot/checkpoint bloat when those tables exist.
DO $$
BEGIN
  IF to_regclass('public.source_observations') IS NOT NULL THEN
    DELETE FROM source_observations so
     WHERE (so.listing_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.id = so.listing_id))
        OR (so.source_key = 'servicelink' AND so.observed_at < NOW() - INTERVAL '3 days')
        OR so.observed_at < NOW() - INTERVAL '30 days';
  END IF;

  IF to_regclass('public.discovery_observations') IS NOT NULL AND to_regclass('public.discovery_snapshots') IS NOT NULL THEN
    DELETE FROM discovery_observations obs
     USING discovery_snapshots snap
     WHERE obs.snapshot_id = snap.id
       AND (
         COALESCE(snap.provenance->>'origin', '') NOT IN ('live', 'email_notice')
         OR snap.provenance->>'recordKind' = 'archive_record'
         OR (snap.source_key = 'servicelink' AND snap.observed_at < NOW() - INTERVAL '3 days')
         OR snap.observed_at < NOW() - INTERVAL '30 days'
       );
  END IF;

  IF to_regclass('public.discovery_snapshots') IS NOT NULL THEN
    DELETE FROM discovery_snapshots snap
     WHERE COALESCE(snap.provenance->>'origin', '') NOT IN ('live', 'email_notice')
        OR snap.provenance->>'recordKind' = 'archive_record'
        OR (snap.source_key = 'servicelink' AND snap.observed_at < NOW() - INTERVAL '3 days')
        OR snap.observed_at < NOW() - INTERVAL '30 days';
  END IF;

  IF to_regclass('public.discovery_checkpoints') IS NOT NULL THEN
    DELETE FROM discovery_checkpoints
     WHERE source_key = 'servicelink'
       AND updated_at < NOW() - INTERVAL '2 days';
  END IF;
END $$;

-- 3. Advance listing revision sequence and refresh planner statistics.
DO $$
BEGIN
  IF to_regclass('public.discovery_listing_revision_seq') IS NOT NULL THEN
    PERFORM setval('discovery_listing_revision_seq', nextval('discovery_listing_revision_seq'), true);
  END IF;
END $$;

ANALYZE listings;
