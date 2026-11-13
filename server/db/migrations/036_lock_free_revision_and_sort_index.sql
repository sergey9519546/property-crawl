-- Migration 036: Lock-free discovery revision sequence + state/bid/county expression indexes
--
-- 1. Eliminates cross-transaction singleton row lock contention on discovery_listing_revision
--    during concurrent scraper/backfill writes by assigning revisions from a lock-free sequence
--    and updating the singleton row only when pg_try_advisory_xact_lock succeeds.
-- 2. Adds expression indexes matching query.js filters/sorts (lower(state), lower(county), opening_bid)
--    so common state+bid and state+county queries avoid full sequential scans.

CREATE SEQUENCE IF NOT EXISTS discovery_listing_revision_seq START WITH 1;

SELECT setval(
  'discovery_listing_revision_seq',
  GREATEST(1, COALESCE((SELECT revision FROM discovery_listing_revision WHERE singleton = TRUE), 1)),
  TRUE
);

CREATE OR REPLACE FUNCTION bump_discovery_listing_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_rev BIGINT;
BEGIN
  next_rev := nextval('discovery_listing_revision_seq');
  IF pg_try_advisory_xact_lock(909001) THEN
    UPDATE discovery_listing_revision
    SET revision = GREATEST(revision + 1, next_rev)
    WHERE singleton = TRUE;
  END IF;
  RETURN NULL;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_listings_lower_state_bid
  ON listings (lower(state), opening_bid ASC NULLS LAST, id ASC);

CREATE INDEX IF NOT EXISTS idx_listings_lower_state_county
  ON listings (lower(state), lower(county));
