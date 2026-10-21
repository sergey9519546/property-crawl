-- Migration 024: Materialized Views and Spatial Acceleration
-- Precomputes ZIP-level and City-level aggregation metrics for sub-millisecond retrieval.
-- Enables concurrent refresh without read locks.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_neighborhood_stats AS
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
    prop_type,
    source_observed_at
  FROM listings
  WHERE (status IS NULL OR status NOT IN ('sold', 'cancelled', 'withdrawn', 'closed'))
),
zip_counts AS (
  SELECT
    'zip'::text AS kind,
    zip::text AS key,
    zip::text AS label,
    state::text AS state,
    COUNT(*)::int AS count,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY opening_bid)::float8 AS "medianOpeningBid",
    AVG(opening_bid)::float8 AS "meanOpeningBid",
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sqft)::float8 AS "medianSqft",
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY deal_score)::float8 AS "medianDealScore",
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY CASE WHEN est_low > 0 AND est_high >= est_low AND opening_bid > 0
        THEN (1.0 - (opening_bid / ((est_low + est_high) / 2.0)))
        ELSE NULL END
    )::float8 AS "medianDiscount",
    jsonb_object_agg(source_key, src_count) FILTER (WHERE source_key IS NOT NULL) AS sources,
    jsonb_object_agg(prop_type, pt_count) FILTER (WHERE prop_type IS NOT NULL) AS prop_types
  FROM (
    SELECT
      b.*,
      COUNT(*) OVER (PARTITION BY zip, source_key) AS src_count,
      COUNT(*) OVER (PARTITION BY zip, prop_type) AS pt_count
    FROM base b
    WHERE zip IS NOT NULL AND zip != ''
  ) s
  GROUP BY zip, state
),
city_counts AS (
  SELECT
    'city'::text AS kind,
    (state || '::' || lower(city))::text AS key,
    (city || ', ' || state)::text AS label,
    state::text AS state,
    COUNT(*)::int AS count,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY opening_bid)::float8 AS "medianOpeningBid",
    AVG(opening_bid)::float8 AS "meanOpeningBid",
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sqft)::float8 AS "medianSqft",
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY deal_score)::float8 AS "medianDealScore",
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY CASE WHEN est_low > 0 AND est_high >= est_low AND opening_bid > 0
        THEN (1.0 - (opening_bid / ((est_low + est_high) / 2.0)))
        ELSE NULL END
    )::float8 AS "medianDiscount",
    jsonb_object_agg(source_key, src_count) FILTER (WHERE source_key IS NOT NULL) AS sources,
    jsonb_object_agg(prop_type, pt_count) FILTER (WHERE prop_type IS NOT NULL) AS prop_types
  FROM (
    SELECT
      b.*,
      COUNT(*) OVER (PARTITION BY state, lower(city), source_key) AS src_count,
      COUNT(*) OVER (PARTITION BY state, lower(city), prop_type) AS pt_count
    FROM base b
    WHERE city IS NOT NULL AND city != '' AND state IS NOT NULL AND state != ''
  ) c
  GROUP BY state, lower(city), city
)
SELECT * FROM zip_counts
UNION ALL
SELECT * FROM city_counts;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_neighborhood_stats_key ON mv_neighborhood_stats(kind, key);
CREATE INDEX IF NOT EXISTS idx_mv_neighborhood_stats_state ON mv_neighborhood_stats(state);
CREATE INDEX IF NOT EXISTS idx_mv_neighborhood_stats_count ON mv_neighborhood_stats(count DESC);
