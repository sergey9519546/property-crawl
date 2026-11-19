'use strict';

const defaultDb = require('../db/client');
const { isCompatibleNjSitusAddress, enrichNjListing } = require('./nj-cadastral');
const { parseExecutionAmount, parseDescriptionUpsetMatch } = require('../scrapers/civilview');
const { sourceObservedAddress, resolveCensusCoordinates } = require('../routes/property-image');

const DEFAULT_NJ_LIMIT = 40;
const DEFAULT_GEOCODE_LIMIT = 60;
const DEFAULT_MAX_DURATION_MS = 20_000;
const DEFAULT_CONCURRENCY = 5;

function cloneJson(value) {
  if (!value || typeof value !== 'object') return {};
  return JSON.parse(JSON.stringify(value));
}

function parseMoneyNumber(raw) {
  if (raw == null || raw === '') return 0;
  const parsed = Number(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function buildCivilViewCombinedText(row) {
  const sf = row?.provenance?.sourceFields && typeof row.provenance.sourceFields === 'object'
    ? row.provenance.sourceFields
    : {};
  return [
    row?.raw || '',
    sf.description || '',
    sf['property note'] || '',
    sf['approx. upset*'] || '',
    sf['approx. upset'] || '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildClearedNjListing(row) {
  const cleanProvenance = cloneJson(row.provenance);
  delete cleanProvenance.coordinates;
  delete cleanProvenance.parcelKey;
  if (cleanProvenance.derivedFields && typeof cleanProvenance.derivedFields === 'object') {
    delete cleanProvenance.derivedFields.assessorRoll;
    delete cleanProvenance.derivedFields.parcelKey;
  }
  return {
    id: row.id,
    source: row.source || 'civilview',
    state: row.state || 'NJ',
    county: row.county || null,
    city: row.city || null,
    zip: row.zip || null,
    address: row.address || null,
    sourceUrl: row.sourceUrl || null,
    lat: null,
    lng: null,
    assessed: null,
    year: null,
    propType: 'Unknown',
    assessorParcel: null,
    parcelKey: null,
    apn: row.apn || cleanProvenance.parcelNumber || null,
    sourceObservedAt: row.sourceObservedAt || null,
    provenance: cleanProvenance,
  };
}

function attachCensusCoordinates(listing, censusCoords, observedAt) {
  if (!censusCoords || !Number.isFinite(censusCoords.lat) || !Number.isFinite(censusCoords.lng)) {
    return false;
  }
  const lat = Number(Number(censusCoords.lat).toFixed(6));
  const lng = Number(Number(censusCoords.lng).toFixed(6));
  listing.lat = lat;
  listing.lng = lng;
  listing.provenance = listing.provenance && typeof listing.provenance === 'object' ? listing.provenance : {};
  listing.provenance.coordinates = {
    origin: 'geocoder',
    provider: 'US Census Bureau Geocoder (Public_AR_Current)',
    verification: 'exact_address_match',
    precision: 'parcel',
    sourceRecordUrl: listing.sourceUrl || null,
    observedAt,
    lat,
    lng,
    matchedAddress: {
      address: listing.address || '',
      city: listing.city || '',
      state: listing.state || '',
      zip: listing.zip || '',
    },
  };
  return true;
}

async function runWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Math.floor(Number(concurrency) || DEFAULT_CONCURRENCY));
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  }
  const count = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: count }, () => runner()));
}

async function repairLiveEnrichment(options = {}) {
  const database = options.db || defaultDb;
  const pool = options.pool || database?.pool;
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('PostgreSQL pool is required for live enrichment repair');
  }

  const fetchFn = options.fetchFn || globalThis.fetch;
  const enrichNjFn = options.enrichNjListing || enrichNjListing;
  const resolveCensusFn = options.resolveCensusCoordinates || resolveCensusCoordinates;
  const njLimit = Number.isInteger(Number(options.njLimit)) && Number(options.njLimit) > 0
    ? Number(options.njLimit)
    : DEFAULT_NJ_LIMIT;
  const geocodeLimit = Number.isInteger(Number(options.geocodeLimit)) && Number(options.geocodeLimit) > 0
    ? Number(options.geocodeLimit)
    : DEFAULT_GEOCODE_LIMIT;
  const maxDurationMs = Number.isFinite(Number(options.maxDurationMs)) && Number(options.maxDurationMs) >= 0
    ? Number(options.maxDurationMs)
    : DEFAULT_MAX_DURATION_MS;
  const dryRun = options.dryRun === true;
  const nowMs = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const observedAt = new Date(nowMs).toISOString();
  const wallClock = typeof options.wallClock === 'function' ? options.wallClock : Date.now;
  const startedAt = wallClock();
  const budgetExpired = () => maxDurationMs > 0 && (wallClock() - startedAt) >= maxDurationMs;

  const report = {
    dryRun,
    njScanned: 0,
    njMismatchedFound: 0,
    njMismatchedCleared: 0,
    njReEnrichAttempted: 0,
    njReEnriched: 0,
    civilviewScanned: 0,
    civilviewUpdated: 0,
    geocodeCandidates: 0,
    geocodedCount: 0,
    timedOut: false,
    mismatchedSample: [],
    errors: [],
  };

  // Pass 1: NJ Cadastral Situs-Address Corroboration & Repair
  const njQuery = await pool.query(`
    SELECT id, source_key AS "source", state, county, city, zip, address,
           source_url AS "sourceUrl",
           latitude::float8 AS "lat", longitude::float8 AS "lng",
           assessed_value::float8 AS "assessed", year_built AS "year",
           prop_type AS "propType", provenance,
           source_observed_at::text AS "sourceObservedAt"
      FROM listings
     WHERE state = 'NJ'
       AND provenance->'derivedFields'->'assessorRoll'->'parcel' IS NOT NULL
     ORDER BY id ASC
  `);
  const njRows = Array.isArray(njQuery?.rows) ? njQuery.rows : [];
  report.njScanned = njRows.length;

  const mismatchedNj = [];
  for (const row of njRows) {
    const situs = row?.provenance?.derivedFields?.assessorRoll?.parcel?.situsAddress;
    if (situs && !isCompatibleNjSitusAddress(row.address, situs)) {
      mismatchedNj.push({ row, situs });
      if (report.mismatchedSample.length < 15) {
        report.mismatchedSample.push({ id: row.id, address: row.address, situsAddress: situs });
      }
    }
  }
  report.njMismatchedFound = mismatchedNj.length;

  for (const { row } of mismatchedNj) {
    const cleaned = buildClearedNjListing(row);
    if (report.njReEnrichAttempted < njLimit && !budgetExpired()) {
      report.njReEnrichAttempted += 1;
      try {
        await enrichNjFn(cleaned, { fetchFn, now: nowMs });
      } catch (err) {
        report.errors.push(`nj_reenrich(${row.id}): ${err?.message || err}`);
      }
      if ((cleaned.lat == null || cleaned.lng == null) && !budgetExpired()) {
        try {
          const observedAddress = sourceObservedAddress(cleaned);
          if (observedAddress) {
            const censusCoords = await resolveCensusFn({
              fetchImpl: fetchFn,
              observedAddress,
              timeoutMs: 4000,
            });
            attachCensusCoordinates(cleaned, censusCoords, observedAt);
          }
        } catch (err) {
          report.errors.push(`nj_census(${row.id}): ${err?.message || err}`);
        }
      }
      if (cleaned.lat != null || cleaned.assessed != null || cleaned.parcelKey != null) {
        report.njReEnriched += 1;
      }
    }

    if (!dryRun) {
      await pool.query(
        `UPDATE listings
            SET latitude = $2,
                longitude = $3,
                geog = CASE WHEN $2::float8 IS NOT NULL AND $3::float8 IS NOT NULL
                            THEN ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography
                            ELSE NULL END,
                assessed_value = $4,
                year_built = $5,
                prop_type = $6,
                provenance = $7::jsonb
          WHERE id = $1`,
        [
          row.id,
          cleaned.lat ?? null,
          cleaned.lng ?? null,
          cleaned.assessed ?? null,
          cleaned.year ?? null,
          cleaned.propType || 'Unknown',
          JSON.stringify(cleaned.provenance),
        ],
      );
    }
    report.njMismatchedCleared += 1;
  }

  // Pass 2: CivilView Upset & Execution Judgment Backfill (Zero-Fabrication: never touch opening_bid)
  const civQuery = await pool.query(`
    SELECT id, raw_notice AS "raw", opening_bid::float8 AS "openingBid",
           judgment_amount::float8 AS "judgment", provenance
      FROM listings
     WHERE source_key = 'civilview'
     ORDER BY id ASC
  `);
  const civRows = Array.isArray(civQuery?.rows) ? civQuery.rows : [];
  report.civilviewScanned = civRows.length;

  for (const row of civRows) {
    const combinedText = buildCivilViewCombinedText(row);
    if (!combinedText) continue;
    const upsetMatch = parseDescriptionUpsetMatch(combinedText);
    const upsetAmount = upsetMatch ? parseMoneyNumber(upsetMatch.raw) : 0;
    const execAmount = parseExecutionAmount(combinedText);

    const existingUpset = Number(row?.provenance?.approximateUpsetPrice?.amount);
    const needsUpset = !(Number.isFinite(existingUpset) && existingUpset > 0) && upsetAmount > 0;
    const existingJudgment = Number(row?.judgment);
    const needsJudgment = !(Number.isFinite(existingJudgment) && existingJudgment > 0) && execAmount > 0;

    if (!needsUpset && !needsJudgment) continue;

    const nextProvenance = cloneJson(row.provenance);
    if (needsUpset) {
      const approxUpset = {
        raw: upsetMatch.raw,
        amount: upsetAmount,
        qualifier: 'approximate',
        source: upsetMatch.source,
      };
      nextProvenance.approximateUpsetPrice = approxUpset;
      nextProvenance.sourceFacts = {
        ...(nextProvenance.sourceFacts && typeof nextProvenance.sourceFacts === 'object' ? nextProvenance.sourceFacts : {}),
        upsetPrice: upsetAmount,
        approximateUpsetPrice: approxUpset,
      };
    }

    if (!dryRun) {
      await pool.query(
        `UPDATE listings
            SET judgment_amount = COALESCE(judgment_amount, $2),
                provenance = $3::jsonb
          WHERE id = $1`,
        [
          row.id,
          needsJudgment ? execAmount : null,
          JSON.stringify(nextProvenance),
        ],
      );
    }
    report.civilviewUpdated += 1;
  }

  // Pass 3: Zero-Cost US Census + NJGIN Geocoding for Missing Coordinates
  if (!budgetExpired()) {
    const missQuery = await pool.query(
      `SELECT id, source_key AS "source", state, county, city, zip, address,
              source_url AS "sourceUrl",
              latitude::float8 AS "lat", longitude::float8 AS "lng",
              assessed_value::float8 AS "assessed", year_built AS "year",
              prop_type AS "propType", provenance,
              source_observed_at::text AS "sourceObservedAt"
         FROM listings
        WHERE (latitude IS NULL OR longitude IS NULL OR (latitude = 0 AND longitude = 0))
          AND address IS NOT NULL
          AND state IS NOT NULL
          AND (
            provenance->'derivedFields'->>'geocodeAttemptedAt' IS NULL
            OR NOT (provenance->'derivedFields'->>'geocodeAttemptedAt' ~ '^20[0-9]{2}-')
            OR (provenance->'derivedFields'->>'geocodeAttemptedAt')::timestamptz < NOW() - INTERVAL '7 days'
          )
        ORDER BY CASE
          WHEN source_key = 'civilview' THEN 1
          WHEN source_key = 'gsa' THEN 2
          WHEN source_key = 'usda' THEN 3
          WHEN source_key = 'treasury' THEN 4
          WHEN source_key = 'irs' THEN 5
          ELSE 6
        END, id ASC
        LIMIT $1`,
      [geocodeLimit],
    );
    const missingRows = Array.isArray(missQuery?.rows) ? missQuery.rows : [];
    report.geocodeCandidates = missingRows.length;

    await runWithConcurrency(missingRows, DEFAULT_CONCURRENCY, async (row) => {
      if (budgetExpired()) {
        report.timedOut = true;
        return;
      }
      const candidateListing = {
        ...row,
        lat: (row.lat === 0 && row.lng === 0) ? null : row.lat,
        lng: (row.lat === 0 && row.lng === 0) ? null : row.lng,
        provenance: cloneJson(row.provenance),
      };

      try {
        if (String(candidateListing.state || '').toUpperCase() === 'NJ') {
          await enrichNjFn(candidateListing, { fetchFn, now: nowMs });
        }
        if (candidateListing.lat == null || candidateListing.lng == null) {
          const observedAddress = sourceObservedAddress(candidateListing);
          if (observedAddress) {
            const censusCoords = await resolveCensusFn({
              fetchImpl: fetchFn,
              observedAddress,
              timeoutMs: 4000,
            });
            attachCensusCoordinates(candidateListing, censusCoords, observedAt);
          }
        }
        const resolvedLat = Number(candidateListing.lat);
        const resolvedLng = Number(candidateListing.lng);
        if (Number.isFinite(resolvedLat) && Number.isFinite(resolvedLng) && !(resolvedLat === 0 && resolvedLng === 0)) {
          if (!dryRun) {
            await pool.query(
              `UPDATE listings
                  SET latitude = $2,
                      longitude = $3,
                      geog = ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography,
                      assessed_value = COALESCE($4, assessed_value),
                      year_built = COALESCE($5, year_built),
                      prop_type = COALESCE(NULLIF($6, 'Unknown'), prop_type),
                      provenance = $7::jsonb
                WHERE id = $1`,
              [
                row.id,
                resolvedLat,
                resolvedLng,
                candidateListing.assessed ?? null,
                candidateListing.year ?? null,
                candidateListing.propType || 'Unknown',
                JSON.stringify(candidateListing.provenance),
              ],
            );
          }
          report.geocodedCount += 1;
        } else if (!dryRun) {
          candidateListing.provenance.derivedFields = candidateListing.provenance.derivedFields && typeof candidateListing.provenance.derivedFields === 'object'
            ? candidateListing.provenance.derivedFields
            : {};
          candidateListing.provenance.derivedFields.geocodeAttemptedAt = observedAt;
          await pool.query(
            `UPDATE listings
                SET latitude = NULL,
                    longitude = NULL,
                    geog = NULL,
                    provenance = $2::jsonb
              WHERE id = $1`,
            [row.id, JSON.stringify(candidateListing.provenance)],
          );
        }
      } catch (err) {
        report.errors.push(`geocode(${row.id}): ${err?.message || err}`);
      }
    });
  } else {
    report.timedOut = true;
  }

  // Pass 4: Bounded Enrolled County & Statewide ArcGIS Assessor Backfill
  if (!dryRun && options.includeAssessorBackfill !== false && !budgetExpired()
      && typeof database?.getListings === 'function' && typeof database?.createListing === 'function') {
    try {
      const { backfillAssessorRolls } = require('./assessor-backfill');
      const assessorLimit = Math.min(25, Math.max(1, Number(options.assessorLimit) || 25));
      report.assessorBackfill = await backfillAssessorRolls({
        db: database,
        limit: assessorLimit,
        fetchFn,
        now: nowMs,
      });
    } catch (err) {
      report.errors.push(`assessorBackfill: ${err?.message || err}`);
    }
  }

  return report;
}

module.exports = {
  repairLiveEnrichment,
  buildCivilViewCombinedText,
  buildClearedNjListing,
  attachCensusCoordinates,
};
