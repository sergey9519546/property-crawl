'use strict';

const defaultDb = require('../db/client');
const { isCompatibleNjSitusAddress, enrichNjListing } = require('./nj-cadastral');
const { parseExecutionAmount, parseDescriptionUpsetMatch } = require('../scrapers/civilview');
const { sourceObservedAddress, resolveCensusCoordinates } = require('../routes/property-image');
const { computeCatchSummary } = require('../intelligence/catch-summary');
const { recomputeTriageForListings } = require('../db/observations-persistence');

const DEFAULT_NJ_LIMIT = 40;
const DEFAULT_GEOCODE_LIMIT = 25;
const DEFAULT_CATCH_LIMIT = 1000;
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
    provider: censusCoords.basis === 'source_observed_address_arcgis_geocode' ? 'ArcGIS World Geocoder' : 'US Census Bureau Geocoder (Public_AR_Current)',
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

const TIGERWEB_COUNTY_ENDPOINT = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query';

async function resolveCensusCountyFromCoords({ lat, lng, fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng) || (nLat === 0 && nLng === 0)) return null;
  if (typeof fetchImpl !== 'function') return null;
  if (process.env.NODE_ENV === 'test' && fetchImpl === globalThis.fetch && !process.env.DISCOVERY_TEST_ALLOW_REMOTE) {
    return null;
  }
  const url = new URL(TIGERWEB_COUNTY_ENDPOINT);
  url.searchParams.set('geometry', `${nLng},${nLat}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'NAME,BASENAME,STATE,COUNTY,GEOID');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'PropertyCrawl/1.0 (Census TIGERweb County Lookup)' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const attrs = json?.features?.[0]?.attributes;
    if (!attrs || typeof attrs !== 'object') return null;
    const rawCounty = attrs.BASENAME || (typeof attrs.NAME === 'string'
      ? attrs.NAME.replace(/\s+(?:County|Parish|Borough|Census Area|Municipality|city and borough)$/i, '')
      : '');
    const county = String(rawCounty || '').replace(/\s+/g, ' ').trim();
    if (!county) return null;
    const geoid = typeof attrs.GEOID === 'string' && /^\d{5}$/.test(attrs.GEOID.trim()) ? attrs.GEOID.trim() : null;
    return { county, countyFips: geoid };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  const resolveArcgisFn = typeof options.resolveArcgisCoordinates === 'function' ? options.resolveArcgisCoordinates : null;
  const njLimit = Number.isInteger(Number(options.njLimit)) && Number(options.njLimit) > 0
    ? Number(options.njLimit)
    : DEFAULT_NJ_LIMIT;
  const geocodeLimit = Number.isInteger(Number(options.geocodeLimit)) && Number(options.geocodeLimit) > 0
    ? Number(options.geocodeLimit)
    : DEFAULT_GEOCODE_LIMIT;
  const countyLimit = Number.isInteger(Number(options.countyLimit)) && Number(options.countyLimit) > 0
    ? Number(options.countyLimit)
    : 40;
  const resolveCountyFn = options.resolveCountyFn || resolveCensusCountyFromCoords;
  const catchLimit = Number.isInteger(Number(options.catchLimit)) && Number(options.catchLimit) > 0
    ? Math.min(4000, Number(options.catchLimit))
    : DEFAULT_CATCH_LIMIT;
  const maxDurationMs = Number.isFinite(Number(options.maxDurationMs)) && Number(options.maxDurationMs) >= 0
    ? Number(options.maxDurationMs)
    : DEFAULT_MAX_DURATION_MS;
  const dryRun = options.dryRun === true;
  const nowMs = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const observedAt = new Date(nowMs).toISOString();
  const wallClock = typeof options.wallClock === 'function' ? options.wallClock : Date.now;
  const startedAt = wallClock();
  const PASS4_RESERVE_MS = 4_000;
  const remainingMs = () => (maxDurationMs > 0 ? Math.max(0, maxDurationMs - (wallClock() - startedAt)) : Infinity);
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
    countyCandidates: 0,
    countyBackfilled: 0,
    catchBackfilled: 0,
    triageBackfilled: 0,
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
                prop_type = NULLIF($6, 'Unknown'),
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
          AND NOT COALESCE(discovery_terminal, FALSE)
          AND address IS NOT NULL
          AND state IS NOT NULL
          AND (
            provenance->'derivedFields'->>'geocodeAttemptedAt' IS NULL
            OR provenance->'derivedFields'->>'arcgisGeocodeAttemptedAt' IS NULL
            OR NOT (provenance->'derivedFields'->>'geocodeAttemptedAt' ~ '^20[0-9]{2}-')
            OR (provenance->'derivedFields'->>'geocodeAttemptedAt')::timestamptz < NOW() - INTERVAL '7 days'
          )
        ORDER BY CASE
          WHEN source_key = 'civilview' THEN 1
          WHEN source_key = 'sheriff' THEN 2
          WHEN source_key = 'gsa' THEN 3
          WHEN source_key = 'usda' THEN 4
          WHEN source_key = 'treasury' THEN 5
          WHEN source_key = 'irs' THEN 6
          ELSE 7
        END, id ASC
        LIMIT $1`,
      [geocodeLimit],
    );
    const missingRows = Array.isArray(missQuery?.rows) ? missQuery.rows : [];
    report.geocodeCandidates = missingRows.length;

    const geocodePassStartedAt = wallClock();
    const geocodePassCapMs = maxDurationMs > 0
      ? Math.max(4_000, Math.floor(maxDurationMs * 0.45))
      : Infinity;
    const geocodePassExpired = () => (
      budgetExpired()
      || (maxDurationMs > 0 && (wallClock() - geocodePassStartedAt) >= geocodePassCapMs)
    );

    await runWithConcurrency(missingRows, DEFAULT_CONCURRENCY, async (row) => {
      if (geocodePassExpired()) {
        if (budgetExpired()) report.timedOut = true;
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
            const resolvedCoords = censusCoords || (resolveArcgisFn
              ? await resolveArcgisFn({
                  fetchImpl: fetchFn,
                  observedAddress,
                  timeoutMs: 4000,
                })
              : null);
            attachCensusCoordinates(candidateListing, resolvedCoords, observedAt);
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
          candidateListing.provenance.derivedFields.arcgisGeocodeAttemptedAt = observedAt;
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

  // Pass 3b: Bounded US Census TIGERweb County Backfill for HUD / Federal rows with valid coords & county IS NULL
  if (options.includeCountyBackfill !== false && !budgetExpired()) {
    try {
      const countyQuery = await pool.query(
        `SELECT id,
                source_key AS "source",
                state,
                county,
                latitude::float8 AS lat,
                longitude::float8 AS lng,
                provenance
           FROM listings
          WHERE discovery_is_live IS TRUE
            AND (county IS NULL OR BTRIM(county) = '')
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
            AND NOT (latitude = 0 AND longitude = 0)
            AND (provenance->'derivedFields'->>'countyLookupAttemptedAt') IS NULL
          ORDER BY CASE WHEN source_key = 'hud' THEN 0 ELSE 1 END,
                   source_observed_at DESC NULLS LAST
          LIMIT $1`,
        [countyLimit],
      );
      const countyRows = Array.isArray(countyQuery?.rows) ? countyQuery.rows : [];
      report.countyCandidates = countyRows.length;

      await runWithConcurrency(countyRows, DEFAULT_CONCURRENCY, async (row) => {
        if (budgetExpired()) {
          report.timedOut = true;
          return;
        }
        try {
          const hit = await resolveCountyFn({
            lat: Number(row.lat),
            lng: Number(row.lng),
            fetchImpl: fetchFn,
            timeoutMs: 4000,
          });
          const nextProvenance = cloneJson(row.provenance);
          nextProvenance.derivedFields = nextProvenance.derivedFields && typeof nextProvenance.derivedFields === 'object'
            ? nextProvenance.derivedFields
            : {};
          nextProvenance.derivedFields.countyLookupAttemptedAt = observedAt;
          if (hit?.county) {
            if (hit.countyFips) nextProvenance.derivedFields.countyFips = hit.countyFips;
            nextProvenance.derivedFields.countySource = 'census-tigerweb-state-county';
            nextProvenance.derivedFields.countyBackfilledAt = observedAt;
            if (!dryRun) {
              await pool.query(
                `UPDATE listings
                    SET county = $2,
                        provenance = $3::jsonb
                  WHERE id = $1`,
                [row.id, hit.county, JSON.stringify(nextProvenance)],
              );
            }
            report.countyBackfilled += 1;
          } else if (!dryRun) {
            await pool.query(
              `UPDATE listings
                  SET provenance = $2::jsonb
                WHERE id = $1`,
              [row.id, JSON.stringify(nextProvenance)],
            );
          }
        } catch (err) {
          report.errors.push(`countyBackfill(${row.id}): ${err?.message || err}`);
        }
      });
    } catch (err) {
      report.errors.push(`countyBackfill: ${err?.message || err}`);
    }
  }

  // Pass 3c: Bounded Enrolled County & Statewide ArcGIS Assessor Backfill (before Pass 4, leaving >= 4s reserve)
  if (!dryRun && options.includeAssessorBackfill !== false && !budgetExpired()
      && typeof database?.getListings === 'function' && typeof database?.createListing === 'function') {
    const remainingBeforeAssessor = remainingMs();
    if (maxDurationMs === 0 || remainingBeforeAssessor > PASS4_RESERVE_MS) {
      try {
        const backfillAssessorFn = typeof options.backfillAssessorRolls === 'function'
          ? options.backfillAssessorRolls
          : require('./assessor-backfill').backfillAssessorRolls;
        const assessorLimit = Math.min(100, Math.max(1, Number(options.assessorLimit) || 60));
        const assessorBudgetMs = maxDurationMs > 0
          ? Math.max(1, remainingBeforeAssessor - PASS4_RESERVE_MS)
          : undefined;
        report.assessorBackfill = await backfillAssessorFn({
          db: database,
          limit: assessorLimit,
          fetchFn,
          now: nowMs,
          ...(assessorBudgetMs ? { maxDurationMs: assessorBudgetMs, wallClock } : {}),
        });
      } catch (err) {
        report.errors.push(`assessorBackfill: ${err?.message || err}`);
      }
    }
  }

  // Pass 4: Fast Local Deterministic Catch Summary Backfill ($0, runs after assessor backfill with >= 4s reserve)
  if (!dryRun && options.includeCatchBackfill !== false && !budgetExpired()) {
    try {
      const { arbitrateTitleRisk } = require('../intelligence/title-risk-engine');
      const catchQuery = await pool.query(
        `SELECT id,
                source_key AS "source",
                state,
                county,
                city,
                zip,
                beds,
                prop_type AS "propType",
                assessed_value::float8 AS "assessed",
                year_built AS "year",
                plaintiff,
                defendant,
                raw_notice AS "raw",
                opening_bid::float8 AS "openingBid",
                est_low::float8 AS "estLow",
                est_high::float8 AS "estHigh",
                redemption_days AS "redemptionDays",
                senior_lien_risk AS "seniorLienRisk",
                occupancy,
                sale_date AS "saleDate",
                deposit_terms AS "deposit",
                judgment_amount::float8 AS "judgment",
                provenance
           FROM listings
          WHERE (
            catch_summary IS NULL
            AND (
              est_low IS NULL
              OR est_high IS NULL
              OR opening_bid IS NULL OR opening_bid <= 0
              OR sale_date IS NULL
              OR occupancy IS NULL
              OR deposit_terms IS NULL
              OR COALESCE(redemption_days, 0) > 0
              OR NULLIF(TRIM(COALESCE(senior_lien_risk, '')), '') IS NOT NULL
              OR (provenance ? 'titleWarnings')
            )
          ) OR (
            source_key IN ('hud', 'gsa', 'usda', 'fannie', 'freddie', 'fdic')
            AND (catch_summary LIKE '%until sale day%' OR catch_summary LIKE '%no sale date is published%')
          )
          ORDER BY id ASC
          LIMIT $1`,
        [catchLimit],
      );
      const catchRows = Array.isArray(catchQuery?.rows) ? catchQuery.rows : [];
      await runWithConcurrency(catchRows, 20, async (row) => {
        if (budgetExpired()) {
          report.timedOut = true;
          return;
        }
        let persistedTitleWarnings = Array.isArray(row?.provenance?.derivedFields?.catchWarnings)
          ? row.provenance.derivedFields.catchWarnings
          : (Array.isArray(row?.provenance?.titleWarnings) ? row.provenance.titleWarnings : []);
        let persistedRiskLevel = row?.provenance?.derivedFields?.titleRiskLevel || row?.provenance?.riskLevel || null;
        if (persistedTitleWarnings.length === 0) {
          try {
            const tr = arbitrateTitleRisk(row);
            if (Array.isArray(tr?.titleWarnings) && tr.titleWarnings.length > 0) {
              persistedTitleWarnings = tr.titleWarnings;
            }
            if (!persistedRiskLevel && tr?.riskLevel) {
              persistedRiskLevel = tr.riskLevel;
            }
          } catch {
            // Keep existing signals
          }
        }
        const summary = computeCatchSummary(row, persistedTitleWarnings, persistedRiskLevel);
        if (!summary) return;
        await pool.query(
          `UPDATE listings
              SET catch_summary = $2
            WHERE id = $1`,
          [row.id, summary],
        );
        report.catchBackfilled += 1;
      });
    } catch (err) {
      report.errors.push(`catchBackfill: ${err?.message || err}`);
    }
  }

  // Pass 5: Triage Priority Backfill (re-evaluates NULL or agency REO triage scores)
  if (!dryRun && options.includeTriageBackfill !== false && !budgetExpired()) {
    try {
      const triageLimit = Math.min(1000, Math.max(1, Number(options.triageLimit) || 300));
      const triageQuery = await pool.query(
        `SELECT id,
                source_key AS "source",
                state, county, city, zip, address,
                beds,
                baths::float8 AS "baths",
                sqft,
                year_built AS "year",
                prop_type AS "propType",
                opening_bid::float8 AS "openingBid",
                est_low::float8 AS "estLow",
                est_high::float8 AS "estHigh",
                assessed_value::float8 AS "assessed",
                sale_date::text AS "saleDate",
                status,
                redemption_days AS "redemptionDays",
                senior_lien_risk AS "seniorLienRisk",
                occupancy,
                deposit_terms AS "deposit",
                judgment_amount::float8 AS "judgment",
                source_url AS "sourceUrl",
                source_observed_at::text AS "sourceObservedAt",
                fetched_at::text AS "fetchedAt",
                provenance
           FROM listings
          WHERE triage_priority IS NULL
             OR triage_priority_refreshed_at IS NULL
             OR source_key IN ('hud', 'gsa', 'usda', 'fannie', 'freddie', 'fdic')
          ORDER BY (triage_priority IS NULL) DESC, triage_priority_refreshed_at ASC NULLS FIRST, id ASC
          LIMIT $1`,
        [triageLimit],
      );
      const triageRows = Array.isArray(triageQuery?.rows) ? triageQuery.rows : [];
      if (triageRows.length > 0) {
        const res = await recomputeTriageForListings(pool, triageRows, { now: nowMs, limit: triageLimit });
        report.triageBackfilled += Number(res?.updated || 0);
      }
    } catch (err) {
      report.errors.push(`triageBackfill: ${err?.message || err}`);
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
