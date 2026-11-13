-- Migration 035: Backfill discovery_* columns, attach trigger, and build trigram GIN index
--
-- Runs in its own transaction after Migration 034 released ACCESS EXCLUSIVE:
--   1. Bulk-backfills rows without double-executing the BEFORE UPDATE trigger
--      and without blocking concurrent SELECT queries.
--   2. Installs sync_listings_discovery_columns trigger and performs a tiny
--      catch-up pass for any row inserted/updated concurrently during step 1.
--   3. Builds idx_listings_discovery_search_text_trgm in a single bulk pass and
--      ANALYZEs listings. Client.hasAcceleratedDiscovery waits for this index.

CREATE OR REPLACE FUNCTION sync_listings_discovery_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.discovery_terminal := coalesce(
    lower(coalesce(NEW.status, '')) IN ('sold', 'closed', 'cancelled')
    OR lower(coalesce(NEW.lifecycle_status, '')) ~ '(reverted[[:space:]]+to[[:space:]]+(plaintiff|beneficiary)|(purchased|sold)[[:space:]]*[-:][[:space:]]*(3rd|third)[- [:space:]]*party|(purchased|sold)[[:space:]]*[-:][[:space:]]*(plaintiff|beneficiary)|(^|[^a-z0-9])(closed|sold)($|[^a-z0-9])|dismiss|settl|cancel)'
    OR nullif(coalesce(nullif(NEW.transaction_outcome, ''), NEW.provenance->'sourceFacts'->>'transactionOutcome', ''), '') IS NOT NULL
    OR (NEW.provenance IS NOT NULL AND (NEW.provenance ? 'publisherAbsence'))
    OR (NEW.provenance IS NOT NULL AND (NEW.provenance ? 'supersededBy')),
    FALSE
  );
  NEW.discovery_action_tier := (
    (CASE WHEN coalesce(NEW.opening_bid, 0) > 0
      OR (CASE WHEN (NEW.provenance->'sourceFacts'->>'upsetPrice') ~ '^[0-9]+([.][0-9]+)?$' THEN (NEW.provenance->'sourceFacts'->>'upsetPrice')::numeric ELSE 0 END) > 0
      OR (CASE WHEN (NEW.provenance->'sourceFacts'->'approximateUpsetPrice'->>'amount') ~ '^[0-9]+([.][0-9]+)?$' THEN (NEW.provenance->'sourceFacts'->'approximateUpsetPrice'->>'amount')::numeric ELSE 0 END) > 0
      OR (NEW.provenance->'derivedFields'->'assessorRoll'->'parcel') IS NOT NULL
      THEN 2 ELSE 0 END)
    + (CASE WHEN NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN 1 ELSE 0 END)
  )::smallint;
  NEW.discovery_is_live := coalesce(NEW.provenance->>'origin' = 'live', FALSE);
  NEW.discovery_program := nullif(coalesce(NEW.auction_program, NEW.provenance->'sourceFacts'->>'auctionProgram'), '');
  NEW.discovery_search_text := (
    coalesce(NEW.id, '') || ' ' ||
    coalesce(NEW.address, '') || ' ' ||
    coalesce(NEW.city, '') || ' ' ||
    coalesce(NEW.county, '') || ' ' ||
    coalesce(NEW.source_key, '') || ' ' ||
    coalesce(NEW.auction_program, NEW.provenance->'sourceFacts'->>'auctionProgram', '') || ' ' ||
    coalesce(NEW.provenance->>'recordId', '')
  );
  RETURN NEW;
END;
$$;

UPDATE listings SET
  discovery_terminal = coalesce(
    lower(coalesce(status, '')) IN ('sold', 'closed', 'cancelled')
    OR lower(coalesce(lifecycle_status, '')) ~ '(reverted[[:space:]]+to[[:space:]]+(plaintiff|beneficiary)|(purchased|sold)[[:space:]]*[-:][[:space:]]*(3rd|third)[- [:space:]]*party|(purchased|sold)[[:space:]]*[-:][[:space:]]*(plaintiff|beneficiary)|(^|[^a-z0-9])(closed|sold)($|[^a-z0-9])|dismiss|settl|cancel)'
    OR nullif(coalesce(nullif(transaction_outcome, ''), provenance->'sourceFacts'->>'transactionOutcome', ''), '') IS NOT NULL
    OR (provenance IS NOT NULL AND (provenance ? 'publisherAbsence'))
    OR (provenance IS NOT NULL AND (provenance ? 'supersededBy')),
    FALSE
  ),
  discovery_action_tier = (
    (CASE WHEN coalesce(opening_bid, 0) > 0
      OR (CASE WHEN (provenance->'sourceFacts'->>'upsetPrice') ~ '^[0-9]+([.][0-9]+)?$' THEN (provenance->'sourceFacts'->>'upsetPrice')::numeric ELSE 0 END) > 0
      OR (CASE WHEN (provenance->'sourceFacts'->'approximateUpsetPrice'->>'amount') ~ '^[0-9]+([.][0-9]+)?$' THEN (provenance->'sourceFacts'->'approximateUpsetPrice'->>'amount')::numeric ELSE 0 END) > 0
      OR (provenance->'derivedFields'->'assessorRoll'->'parcel') IS NOT NULL
      THEN 2 ELSE 0 END)
    + (CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END)
  )::smallint,
  discovery_is_live = coalesce(provenance->>'origin' = 'live', FALSE),
  discovery_program = nullif(coalesce(auction_program, provenance->'sourceFacts'->>'auctionProgram'), ''),
  discovery_search_text = (
    coalesce(id, '') || ' ' ||
    coalesce(address, '') || ' ' ||
    coalesce(city, '') || ' ' ||
    coalesce(county, '') || ' ' ||
    coalesce(source_key, '') || ' ' ||
    coalesce(auction_program, provenance->'sourceFacts'->>'auctionProgram', '') || ' ' ||
    coalesce(provenance->>'recordId', '')
  )
WHERE discovery_search_text = '' OR discovery_search_text IS NULL;

DROP TRIGGER IF EXISTS listings_sync_discovery_columns ON listings;
CREATE TRIGGER listings_sync_discovery_columns
BEFORE INSERT OR UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION sync_listings_discovery_columns();

-- Catch any row inserted/updated concurrently while the initial UPDATE ran
-- without the trigger attached yet (no-op when zero rows remain empty).
UPDATE listings
   SET updated_at = updated_at
 WHERE discovery_search_text = '' OR discovery_search_text IS NULL;

CREATE INDEX IF NOT EXISTS idx_listings_discovery_search_text_trgm
  ON listings USING GIN (discovery_search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_listings_discovery_source_key_bid
  ON listings(source_key, opening_bid) WHERE opening_bid IS NOT NULL;

ANALYZE listings;
