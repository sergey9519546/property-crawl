'use strict';

// Pure SQL column lists, conflict/provenance expressions, and query builders
// shared across server/db/client.js and downstream PostgreSQL callers.

// Canonical camelCase projection for listings. The in-memory provider emits
// camelCase (dealScore, openingBid, propType, ...) and the UUID-style record
// shape is what the API + Next.js UI consume. The Postgres schema stores
// snake_case (deal_score, opening_bid, prop_type) with NUMERIC columns that
// node-pg returns as strings — so every PG read must alias + cast back to the
// exact same contract or the UI silently breaks only in production.
const LISTING_SELECT = `
  id,
  source_key AS "source",
  state, county, city, zip, address,
  latitude::float8   AS "lat",
  longitude::float8  AS "lng",
  beds,
  baths::float8     AS "baths",
  sqft,
  year_built         AS "year",
  prop_type          AS "propType",
  opening_bid::float8 AS "openingBid",
  initial_opening_bid::float8 AS "initialOpeningBid",
  peak_opening_bid::float8 AS "peakOpeningBid",
  est_low::float8     AS "estLow",
  est_high::float8    AS "estHigh",
  assessed_value::float8 AS "assessed",
  CASE WHEN est_low > 0 AND est_high >= est_low
       THEN ((est_low + est_high) / 2.0)::float8
       ELSE NULL END   AS "mid",
  CASE WHEN opening_bid > 0 AND est_low > 0 AND est_high >= est_low
       THEN (opening_bid / ((est_low + est_high) / 2.0))::float8
       ELSE NULL END    AS "ratio",
  CASE WHEN opening_bid > 0 AND est_low > 0 AND est_high >= est_low
       THEN GREATEST(0, ((est_low + est_high) / 2.0) - opening_bid)::float8
       ELSE NULL END    AS "equity",
  equity_spread::float8 AS "bidSpread",
  CASE WHEN opening_bid > 0 AND est_low > 0 AND est_high >= est_low
       THEN deal_score
       ELSE NULL END    AS "dealScore",
  sale_date::text     AS "saleDate",
  plaintiff, defendant,
  judgment_amount::float8 AS "judgment",
  attorney, occupancy,
  deposit_terms       AS "deposit",
  photo_url           AS "photo",
  images              AS "images",
  source_url          AS "sourceUrl",
  raw_notice          AS "raw",
  provenance,
  source_observed_at::text AS "sourceObservedAt",
  fetched_at::text     AS "fetchedAt",
  price::float8       AS "price",
  listing_date::text  AS "listingDate",
  redemption_days     AS "redemptionDays",
  redemption_warning  AS "redemptionWarning",
  senior_lien_risk    AS "seniorLienRisk",
  senior_lien_warning AS "seniorLienWarning",
  cash_to_close::float8 AS "cashToClose",
  cash_to_close_details AS "cashToCloseDetails",
  status,
  auction_program AS "auctionProgram",
  lifecycle_status AS "lifecycleStatus",
  transaction_outcome AS "transactionOutcome",
  has_documents AS "hasDocuments",
  triage_priority::int AS "triagePriority",
  triage_priority_refreshed_at::text AS "triagePriorityRefreshedAt",
  catch_summary        AS "catchSummary"
`;

const SUMMARY_LISTING_SELECT = `
  id,
  source_key AS "source",
  state, county, city, zip, address,
  latitude::float8   AS "lat",
  longitude::float8  AS "lng",
  beds,
  baths::float8     AS "baths",
  sqft,
  year_built         AS "year",
  prop_type          AS "propType",
  opening_bid::float8 AS "openingBid",
  initial_opening_bid::float8 AS "initialOpeningBid",
  peak_opening_bid::float8 AS "peakOpeningBid",
  est_low::float8     AS "estLow",
  est_high::float8    AS "estHigh",
  assessed_value::float8 AS "assessed",
  CASE WHEN est_low > 0 AND est_high >= est_low
       THEN ((est_low + est_high) / 2.0)::float8
       ELSE NULL END   AS "mid",
  CASE WHEN opening_bid > 0 AND est_low > 0 AND est_high >= est_low
       THEN (opening_bid / ((est_low + est_high) / 2.0))::float8
       ELSE NULL END    AS "ratio",
  CASE WHEN opening_bid > 0 AND est_low > 0 AND est_high >= est_low
       THEN GREATEST(0, ((est_low + est_high) / 2.0) - opening_bid)::float8
       ELSE NULL END    AS "equity",
  equity_spread::float8 AS "bidSpread",
  CASE WHEN opening_bid > 0 AND est_low > 0 AND est_high >= est_low
       THEN deal_score
       ELSE NULL END    AS "dealScore",
  sale_date::text     AS "saleDate",
  occupancy,
  source_observed_at::text AS "sourceObservedAt",
  fetched_at::text     AS "fetchedAt",
  status,
  triage_priority::int AS "triagePriority",
  triage_priority_refreshed_at::text AS "triagePriorityRefreshedAt",
  catch_summary        AS "catchSummary"
`;

// Shared ON CONFLICT provenance merge across createListing and createListingsBulk:
// preserves accumulated derivedFields and authoritative cadastral parcelKey when
// a subsequent raw scraper sweep refreshes the same record.
const NORMALIZE_ADDR_SQL = (col) => `upper(btrim(regexp_replace(coalesce(${col}, ''), '[^A-Za-z0-9]+', ' ', 'g')))`;
const SAME_ADDRESS_ON_CONFLICT_SQL = `(btrim(coalesce(EXCLUDED.address, '')) <> '' AND ${NORMALIZE_ADDR_SQL('EXCLUDED.address')} = ${NORMALIZE_ADDR_SQL('listings.address')} AND upper(btrim(coalesce(EXCLUDED.state, ''))) = upper(btrim(coalesce(listings.state, ''))))`;

const PROVENANCE_UPSERT_SQL = `CASE
          WHEN EXCLUDED.provenance IS NULL THEN
            CASE
              WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN listings.provenance
              WHEN listings.provenance IS NULL THEN NULL
              WHEN jsonb_typeof(listings.provenance->'derivedFields') = 'object' THEN
                jsonb_set(listings.provenance - 'coordinates', '{derivedFields}', (listings.provenance->'derivedFields') - 'geocode', true)
              ELSE listings.provenance - 'coordinates'
            END
          WHEN listings.provenance IS NULL THEN EXCLUDED.provenance
          ELSE (
            CASE
              WHEN jsonb_typeof(listings.provenance->'derivedFields') = 'object'
               AND jsonb_typeof(EXCLUDED.provenance->'derivedFields') = 'object' THEN
                jsonb_set(
                  ((CASE WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN listings.provenance ELSE (listings.provenance - 'coordinates') END) - 'publisherAbsence') || EXCLUDED.provenance,
                  '{derivedFields}',
                  (CASE WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN (listings.provenance->'derivedFields') ELSE ((listings.provenance->'derivedFields') - 'geocode') END) || (EXCLUDED.provenance->'derivedFields'),
                  true
                )
              WHEN jsonb_typeof(listings.provenance->'derivedFields') = 'object' THEN
                jsonb_set(
                  ((CASE WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN listings.provenance ELSE (listings.provenance - 'coordinates') END) - 'publisherAbsence') || EXCLUDED.provenance,
                  '{derivedFields}',
                  (CASE WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN (listings.provenance->'derivedFields') ELSE ((listings.provenance->'derivedFields') - 'geocode') END),
                  true
                )
              ELSE ((CASE WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN listings.provenance ELSE (listings.provenance - 'coordinates') END) - 'publisherAbsence') || EXCLUDED.provenance
            END
          ) || CASE
            WHEN listings.provenance->'derivedFields'->>'parcelKey' = 'true'
             AND NULLIF(listings.provenance->>'parcelKey', '') IS NOT NULL
             AND EXCLUDED.provenance->'derivedFields'->>'parcelKey' IS DISTINCT FROM 'true'
            THEN jsonb_build_object('parcelKey', listings.provenance->>'parcelKey')
            ELSE '{}'::jsonb
          END || CASE
            WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL}
             AND jsonb_typeof(listings.provenance->'coordinates') = 'object'
             AND jsonb_typeof(EXCLUDED.provenance->'coordinates') IS DISTINCT FROM 'object'
             AND (EXCLUDED.geog IS NULL OR (EXCLUDED.latitude IS NOT DISTINCT FROM listings.latitude AND EXCLUDED.longitude IS NOT DISTINCT FROM listings.longitude))
            THEN jsonb_build_object('coordinates', listings.provenance->'coordinates')
            ELSE '{}'::jsonb
          END
        END`;

// How long a persisted triage_priority ranking may drive sort=triage. The
// score is time-dependent (a confirmed sale date passes; observations
// accumulate), so sorting consumers must treat an older value as unknown
// rather than as a fresh ranking (migration 026 contract). Applied in the
// ORDER BY itself: stale or never-refreshed rows rank last via NULLS LAST,
// never as fresh.
const TRIAGE_PRIORITY_STALE_DAYS = 7;

const ACCELERATED_LISTINGS_COLUMNS = [
  'discovery_terminal',
  'discovery_action_tier',
  'discovery_is_live',
  'discovery_program',
  'discovery_search_text',
];

function buildCompsCandidatesSql({ idCondition = '' } = {}) {
  // Split geog ST_DWithin from the geog IS NULL lat/lng fallback via UNION ALL so
  // PostgreSQL plans the geog branch with idx_listings_geog (GIST) instead of
  // falling back to a Seq Scan caused by OR-ing a non-GIST predicate.
  return `
    WITH geog_matches AS (
      SELECT ${SUMMARY_LISTING_SELECT},
        ST_Distance(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS "distanceMeters"
      FROM listings
      WHERE (status IN ('active', 'scheduled', 'pending', 'unknown') OR status IS NULL)
        AND geog IS NOT NULL
        AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
        ${idCondition}
      ORDER BY ST_Distance(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) ASC, id ASC
      LIMIT 200
    ),
    latlng_fallback AS (
      SELECT ${SUMMARY_LISTING_SELECT},
        NULL::double precision AS "distanceMeters"
      FROM listings
      WHERE (status IN ('active', 'scheduled', 'pending', 'unknown') OR status IS NULL)
        AND geog IS NULL
        AND latitude BETWEEN $4 AND $5
        AND longitude BETWEEN $6 AND $7
        ${idCondition}
      ORDER BY id ASC
      LIMIT 200
    )
    SELECT * FROM (
      SELECT * FROM geog_matches
      UNION ALL
      SELECT * FROM latlng_fallback
    ) combined
    ORDER BY COALESCE("distanceMeters", 99999999) ASC, id ASC
    LIMIT 200;
  `;
}

module.exports = {
  LISTING_SELECT,
  SUMMARY_LISTING_SELECT,
  NORMALIZE_ADDR_SQL,
  SAME_ADDRESS_ON_CONFLICT_SQL,
  PROVENANCE_UPSERT_SQL,
  TRIAGE_PRIORITY_STALE_DAYS,
  ACCELERATED_LISTINGS_COLUMNS,
  buildCompsCandidatesSql,
};
