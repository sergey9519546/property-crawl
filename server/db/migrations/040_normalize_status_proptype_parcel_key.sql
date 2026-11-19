-- Migration 040: Normalize status & prop_type, add parcel_key column + index, null (0,0) coords, rebuild mv_neighborhood_stats
--
-- Phase 1 data-quality & query parity closeout:
--   1. Add listings.parcel_key + idx_listings_state_parcel_key and backfill from provenance->>'parcelKey'.
--   2. Standardize prop_type onto canonical labels ('Single Family', 'Manufactured', 'Land', 'Condo', 'Multi Family', 'Town House').
--   3. Backfill status from 'unknown' using lifecycle_status, sourceStatus/listingStatus flags, and live federal source defaults.
--   4. Clear Null Island (0, 0) coordinates so repair-live-enrichment can geocode them cleanly.
--   5. Recreate mv_neighborhood_stats to include non-terminal inventory ('active', 'scheduled', 'pending', 'unknown', NULL).

ALTER TABLE listings ADD COLUMN IF NOT EXISTS parcel_key TEXT;

UPDATE listings
   SET parcel_key = nullif(btrim(provenance->>'parcelKey'), '')
 WHERE parcel_key IS NULL
   AND provenance IS NOT NULL
   AND provenance ? 'parcelKey';

CREATE INDEX IF NOT EXISTS idx_listings_state_parcel_key
  ON listings(state, parcel_key)
  WHERE parcel_key IS NOT NULL;

UPDATE listings
   SET prop_type = CASE
     WHEN lower(btrim(coalesce(prop_type, ''))) IN ('', 'unknown', 'n/a', 'none', 'unspecified', '-') THEN NULL
     WHEN lower(btrim(prop_type)) IN ('single family', 'single-family', 'single family home', 'single family residence', 'single-family residence', 'single family residential', 'single-family residential', 'sfr') THEN 'Single Family'
     WHEN lower(btrim(prop_type)) IN ('manufactured', 'manufactured home', 'mobile', 'mobile home', 'modular', 'modular home') THEN 'Manufactured'
     WHEN lower(btrim(prop_type)) IN ('land', 'vacant land', 'vacant lot', 'lot', 'acreage', 'raw land') THEN 'Land'
     WHEN lower(btrim(prop_type)) IN ('condo', 'condominium', 'condo/townhouse') THEN 'Condo'
     WHEN lower(btrim(prop_type)) IN ('multi family', 'multi-family', 'multi family dwelling', 'multi-family dwelling') THEN 'Multi Family'
     WHEN lower(btrim(prop_type)) IN ('town house', 'townhouse', 'town home', 'townhome') THEN 'Town House'
     ELSE btrim(prop_type)
   END
 WHERE prop_type IS NOT NULL;

UPDATE listings
   SET status = CASE
     WHEN lower(coalesce(lifecycle_status, provenance->'sourceFacts'->>'sourceStatus', '')) ~ 'cancel|withdraw|dismiss|settl|discontinu' THEN 'cancelled'
     WHEN lower(coalesce(lifecycle_status, provenance->'sourceFacts'->>'sourceStatus', '')) ~ 'postpon' THEN 'postponed'
     WHEN lower(coalesce(lifecycle_status, provenance->'sourceFacts'->>'sourceStatus', '')) ~ 'adjourn' THEN 'adjourned'
     WHEN lower(coalesce(lifecycle_status, provenance->'sourceFacts'->>'sourceStatus', '')) ~ 'stay|bankruptc' THEN 'stayed'
     WHEN lower(coalesce(lifecycle_status, provenance->'sourceFacts'->>'sourceStatus', '')) ~ 'reverted[[:space:]]+to[[:space:]]+(plaintiff|beneficiary)|(purchased|sold)[[:space:]]*[-:][[:space:]]*(plaintiff|beneficiary)' THEN 'closed'
     WHEN lower(coalesce(lifecycle_status, provenance->'sourceFacts'->>'sourceStatus', '')) ~ '(^|[^a-z])sold([^a-z]|$)' THEN 'sold'
     WHEN lower(coalesce(lifecycle_status, provenance->'sourceFacts'->>'sourceStatus', '')) ~ 'closed|auctioned|post[- ]?auction|outbid|ended' THEN 'closed'
     WHEN (provenance->'sourceFacts'->'listingStatus'->>'isAuctionClosed') = 'true'
       OR (provenance->'sourceFacts'->'listingStatus'->>'isInPostAuction') = 'true' THEN 'closed'
     WHEN lower(coalesce(lifecycle_status, provenance->'sourceFacts'->>'sourceStatus', '')) ~ 'scheduled|coming[[:space:]]*soon|pre[-. ]?auction' THEN 'scheduled'
     WHEN (provenance->'sourceFacts'->'listingStatus'->>'isInPreAuction') = 'true'
       OR (provenance->'sourceFacts'->'listingStatus'->>'isComingSoon') = 'true' THEN 'scheduled'
     WHEN lower(coalesce(lifecycle_status, provenance->'sourceFacts'->>'sourceStatus', '')) ~ 'pending' THEN 'pending'
     WHEN lower(coalesce(lifecycle_status, provenance->'sourceFacts'->>'sourceStatus', '')) ~ '(^|[^a-z])(active|live|open|bidding|available|re-?listed|auction[[:space:]]*event)([^a-z]|$)' THEN 'active'
     WHEN (provenance->'sourceFacts'->'listingStatus'->>'isInAuction') = 'true' THEN 'active'
     WHEN source_key IN ('hud', 'treasury', 'usda', 'irs', 'gsa') AND NOT COALESCE(discovery_terminal, FALSE) THEN 'active'
     ELSE status
   END
 WHERE status = 'unknown';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listings' AND column_name = 'geog'
  ) THEN
    EXECUTE 'UPDATE listings SET latitude = NULL, longitude = NULL, geog = NULL WHERE latitude = 0 AND longitude = 0';
  ELSE
    UPDATE listings SET latitude = NULL, longitude = NULL WHERE latitude = 0 AND longitude = 0;
  END IF;
END $$;

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
  WHERE (status IN ('active', 'scheduled', 'pending', 'unknown') OR status IS NULL)
    AND NOT COALESCE(discovery_terminal, FALSE)
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
SELECT * FROM city_counts;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_neighborhood_stats_key ON mv_neighborhood_stats(kind, key);
CREATE INDEX IF NOT EXISTS idx_mv_neighborhood_stats_state ON mv_neighborhood_stats(state);
CREATE INDEX IF NOT EXISTS idx_mv_neighborhood_stats_count_label ON mv_neighborhood_stats(count DESC, label ASC);
