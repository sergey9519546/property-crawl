-- Migration 039: Treat email_notice origin as live in discovery trigger + match live CTE filters in mv_neighborhood_stats
--
-- Fixes two PostgreSQL / discovery fidelity gaps:
--   1. sync_listings_discovery_columns() previously set discovery_is_live only when
--      provenance->>'origin' = 'live', causing email_notice ingest records to default to FALSE
--      and become eligible for Pass B purging. Treat 'live' and 'email_notice' consistently.
--   2. mv_neighborhood_stats previously omitted opening_bid > 0, sqft > 0, and
--      valued-record deal_score filters and dropped rows with NULL prop_type from prop_types.
--      Recreate mv_neighborhood_stats to match getNeighborhoodStatsNative()'s live CTE filters.

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
   SET discovery_is_live = TRUE
 WHERE provenance->>'origin' = 'email_notice'
   AND discovery_is_live IS DISTINCT FROM TRUE;

DROP MATERIALIZED VIEW IF EXISTS mv_neighborhood_stats;

CREATE MATERIALIZED VIEW mv_neighborhood_stats AS
WITH base AS (
  SELECT
    zip,
    state,
    city,
    opening_bid,
    est_low,
    est_high,
    sqft,
    deal_score,
    source_key,
    coalesce(prop_type, 'Unknown') AS prop_type,
    source_observed_at
  FROM listings
  WHERE (status = 'active' OR status IS NULL)
    AND source_observed_at IS NOT NULL
    AND source_observed_at >= (NOW() - INTERVAL '365 days')
),
zip_counts AS (
  SELECT
    'zip'::text AS kind,
    SUBSTRING(TRIM(zip) FROM 1 FOR 5)::text AS key,
    SUBSTRING(TRIM(zip) FROM 1 FOR 5)::text AS label,
    MAX(state)::text AS state,
    COUNT(*)::int AS count,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY opening_bid) FILTER (WHERE opening_bid > 0)::float8 AS "medianOpeningBid",
    AVG(opening_bid) FILTER (WHERE opening_bid > 0)::float8 AS "meanOpeningBid",
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sqft) FILTER (WHERE sqft > 0)::float8 AS "medianSqft",
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY deal_score) FILTER (WHERE opening_bid > 0 AND est_low > 0 AND est_high >= est_low AND deal_score IS NOT NULL)::float8 AS "medianDealScore",
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY (1.0 - (opening_bid / ((est_low + est_high) / 2.0)))
    ) FILTER (WHERE est_low > 0 AND est_high >= est_low AND opening_bid > 0)::float8 AS "medianDiscount",
    jsonb_object_agg(source_key, src_count) FILTER (WHERE source_key IS NOT NULL) AS sources,
    jsonb_object_agg(prop_type, pt_count) AS prop_types
  FROM (
    SELECT
      b.*,
      COUNT(*) OVER (PARTITION BY SUBSTRING(TRIM(zip) FROM 1 FOR 5), source_key) AS src_count,
      COUNT(*) OVER (PARTITION BY SUBSTRING(TRIM(zip) FROM 1 FOR 5), prop_type) AS pt_count
    FROM base b
    WHERE zip IS NOT NULL AND TRIM(zip) != ''
  ) s
  GROUP BY SUBSTRING(TRIM(zip) FROM 1 FOR 5)
),
city_counts AS (
  SELECT
    'city'::text AS kind,
    (UPPER(TRIM(state)) || '::' || LOWER(TRIM(city)))::text AS key,
    (LOWER(TRIM(city)) || ', ' || UPPER(TRIM(state)))::text AS label,
    UPPER(TRIM(state))::text AS state,
    COUNT(*)::int AS count,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY opening_bid) FILTER (WHERE opening_bid > 0)::float8 AS "medianOpeningBid",
    AVG(opening_bid) FILTER (WHERE opening_bid > 0)::float8 AS "meanOpeningBid",
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sqft) FILTER (WHERE sqft > 0)::float8 AS "medianSqft",
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY deal_score) FILTER (WHERE opening_bid > 0 AND est_low > 0 AND est_high >= est_low AND deal_score IS NOT NULL)::float8 AS "medianDealScore",
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY (1.0 - (opening_bid / ((est_low + est_high) / 2.0)))
    ) FILTER (WHERE est_low > 0 AND est_high >= est_low AND opening_bid > 0)::float8 AS "medianDiscount",
    jsonb_object_agg(source_key, src_count) FILTER (WHERE source_key IS NOT NULL) AS sources,
    jsonb_object_agg(prop_type, pt_count) AS prop_types
  FROM (
    SELECT
      b.*,
      COUNT(*) OVER (PARTITION BY UPPER(TRIM(state)), LOWER(TRIM(city)), source_key) AS src_count,
      COUNT(*) OVER (PARTITION BY UPPER(TRIM(state)), LOWER(TRIM(city)), prop_type) AS pt_count
    FROM base b
    WHERE (zip IS NULL OR TRIM(zip) = '')
      AND city IS NOT NULL AND TRIM(city) != ''
      AND state IS NOT NULL AND TRIM(state) != ''
  ) c
  GROUP BY UPPER(TRIM(state)), LOWER(TRIM(city))
)
SELECT * FROM zip_counts
UNION ALL
SELECT * FROM city_counts
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_neighborhood_stats_key ON mv_neighborhood_stats(kind, key);
CREATE INDEX IF NOT EXISTS idx_mv_neighborhood_stats_state ON mv_neighborhood_stats(state);
CREATE INDEX IF NOT EXISTS idx_mv_neighborhood_stats_count_label ON mv_neighborhood_stats(count DESC, label ASC);
