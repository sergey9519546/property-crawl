-- Migration 043: Expand discovery_terminal trigger and backfill parity to full TERMINAL_LIFECYCLE_RE
--
-- Keeps sync_listings_discovery_columns() aligned with server/discovery/query.js
-- terminal predicates so PostgreSQL discovery_terminal matches in-memory
-- isTerminalForRanking() and action=prune filters across all lifecycle statuses.

CREATE OR REPLACE FUNCTION sync_listings_discovery_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.discovery_terminal := coalesce(
    lower(coalesce(NEW.status, '')) IN ('sold', 'closed', 'cancelled', 'canceled', 'ended', 'completed', 'retired', 'withdrawn', 'redeemed', 'dismissed', 'settled', 'discontinued', 'vacated', 'writ expired', 'expired')
    OR lower(coalesce(NEW.lifecycle_status, '')) ~ '(reverted[[:space:]]+to[[:space:]]+(plaintiff|beneficiary)|(purchased|sold)[[:space:]]*[-:][[:space:]]*(3rd|third)[- [:space:]]*party|(purchased|sold)[[:space:]]*[-:][[:space:]]*(plaintiff|beneficiary)|(^|[^a-z0-9])(closed|sold)($|[^a-z0-9])|dismiss|settl|cancel|writ[[:space:]]+expired|(^|[^a-z0-9])expired($|[^a-z0-9])|withdraw|discontinu|redeem|vacat)'
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
  NEW.discovery_is_live := coalesce((NEW.provenance->>'origin') IN ('live', 'email_notice'), FALSE);
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

UPDATE listings
   SET discovery_terminal = TRUE
 WHERE discovery_terminal IS NOT TRUE
   AND (
     lower(coalesce(status, '')) IN ('sold', 'closed', 'cancelled', 'canceled', 'ended', 'completed', 'retired', 'withdrawn', 'redeemed', 'dismissed', 'settled', 'discontinued', 'vacated', 'writ expired', 'expired')
     OR lower(coalesce(lifecycle_status, '')) ~ '(reverted[[:space:]]+to[[:space:]]+(plaintiff|beneficiary)|(purchased|sold)[[:space:]]*[-:][[:space:]]*(3rd|third)[- [:space:]]*party|(purchased|sold)[[:space:]]*[-:][[:space:]]*(plaintiff|beneficiary)|(^|[^a-z0-9])(closed|sold)($|[^a-z0-9])|dismiss|settl|cancel|writ[[:space:]]+expired|(^|[^a-z0-9])expired($|[^a-z0-9])|withdraw|discontinu|redeem|vacat)'
     OR nullif(coalesce(nullif(transaction_outcome, ''), provenance->'sourceFacts'->>'transactionOutcome', ''), '') IS NOT NULL
     OR (provenance IS NOT NULL AND (provenance ? 'publisherAbsence'))
     OR (provenance IS NOT NULL AND (provenance ? 'supersededBy'))
   );
