'use strict';

// Assessor-roll harvest at ingestion.
//
// The evaluator's bid-to-value component (30% of triage priority) stays dark
// without a valuation band: 0 of 10,285 live records carry estLow/estHigh, and
// the FHFA fallback needs an assessed value plus its year, which no scraper
// currently captures. Enrolled county assessor rolls are the honest source:
// interpretAssessorParcel applies each county's statutory market conversion
// (see server/enrichment/assessor-reading.js).
//
// This module attaches the harvested parcel to run listings at ingest:
//   - top-level `assessorParcel` for the live store and the evaluator,
//   - `provenance.derivedFields.assessorRoll` for durable, provenance-labeled
//     persistence (the derivedFields pattern seniorLienRisk already uses).
//
// Hard bounds: enrolled counties only, a per-run fetch limit, a disk cache
// with a TTL, and fail-open on every error. A harvest failure must never
// delay or fail a collection run.

const fs = require('node:fs');
const path = require('node:path');
const { queryArcgisParcel, resolveCountyKey } = require('./arcgis-parcels');
const { extractRawApn, normalizeApn } = require('../scrapers/normalization');

const DEFAULT_CACHE_PATH = path.resolve(__dirname, '../../.cache/assessor-roll.json');
const DEFAULT_CACHE_LIMIT = 5000;
const DEFAULT_CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
// Per-run fetch budget. With 12 enrolled counties the default 25 left whole
// runs unharvested; the env knob lets a deployment raise it without a code
// change. Clamped so a bad value cannot turn the harvest into an unbounded
// loop against county endpoints.
function resolveHarvestLimit(overrides = {}) {
  if (Number.isInteger(overrides.limit) && overrides.limit > 0) return overrides.limit;
  const fromEnv = Number.parseInt(process.env.PROPERTY_ASSESSOR_HARVEST_LIMIT, 10);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return Math.min(fromEnv, 500);
  return DEFAULT_HARVEST_LIMIT;
}
const DEFAULT_HARVEST_LIMIT = 100;

// Assessor rolls name the roll year inconsistently. These are the common
// ArcGIS attribute spellings plus the Florida DOR NAL roll (ASMNT_YR); anything
// outside 1900-2100 is rejected.
const TAX_YEAR_FIELDS = ['taxYear', 'TAX_YEAR', 'tax_yr', 'TAX_YR', 'assessYr', 'ASSESS_YR', 'rollYear', 'ROLL_YEAR', 'assessmentYear', 'YEAR_ASSESSED', 'ASMNT_YR'];

function cacheKeyFor(countyKey, lat, lng, cleanApn) {
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${countyKey}:${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
  }
  if (cleanApn) {
    return `${countyKey}:apn:${cleanApn}`;
  }
  return `${countyKey}:unknown`;
}

function loadCache(cachePath) {
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (_) {
    return {};
  }
}

function saveCache(cachePath, cache, { limit = DEFAULT_CACHE_LIMIT } = {}) {
  const entries = Object.entries(cache);
  if (entries.length > limit) {
    entries
      .sort((a, b) => Date.parse(a[1].observedAt || 0) - Date.parse(b[1].observedAt || 0))
      .slice(0, entries.length - limit)
      .forEach(([key]) => { delete cache[key]; });
  }
  const temporary = `${cachePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(cache));
  fs.renameSync(temporary, cachePath);
}

function taxYearFromRawAttributes(rawAttributes) {
  if (!rawAttributes || typeof rawAttributes !== 'object') return null;
  for (const field of TAX_YEAR_FIELDS) {
    const value = Number(rawAttributes[field]);
    if (Number.isInteger(value) && value >= 1900 && value <= 2100) return value;
  }
  return null;
}

function candidateListing(listing) {
  if (!listing || typeof listing !== 'object') return null;
  if (!listing.provenance || listing.provenance.origin !== 'live') return null;
  if (listing.assessorParcel || listing.provenance.derivedFields?.assessorRoll) return null;

  const hasCoords = typeof listing.lat === 'number' && typeof listing.lng === 'number' && Number.isFinite(listing.lat) && Number.isFinite(listing.lng) && !(listing.lat === 0 && listing.lng === 0);
  const rawApn = extractRawApn(listing);
  const cleanApn = normalizeApn(rawApn);

  if (!hasCoords && !cleanApn) return null;

  const countyKey = resolveCountyKey(listing.state, listing.county);
  if (!countyKey) return null;

  return {
    listing,
    lat: hasCoords ? listing.lat : undefined,
    lng: hasCoords ? listing.lng : undefined,
    apn: rawApn || undefined,
    cleanApn: cleanApn || null,
    countyKey,
  };
}

function applyHarvest(candidate, parcel, observedAt) {
  const { listing } = candidate;
  listing.assessorParcel = parcel;
  listing.provenance.derivedFields = listing.provenance.derivedFields || {};
  const assessmentYear = taxYearFromRawAttributes(parcel.rawAttributes) || (Number.isInteger(Number(parcel.taxYear)) && Number(parcel.taxYear) >= 1900 && Number(parcel.taxYear) <= 2100 ? Number(parcel.taxYear) : null);
  // Durable copy for the provenance JSONB: everything the evaluator and the
  // county conversion need, without rawAttributes (large, and only the tax
  // year was read from it — captured explicitly below).
  const durableParcel = {
    source: parcel.source,
    countyFips: parcel.countyFips,
    countyName: parcel.countyName,
    rawApn: parcel.rawApn,
    canonicalApn: parcel.canonicalApn,
    landUse: parcel.landUse,
    legalDescription: parcel.legalDescription,
    assessedValue: parcel.assessedValue || {
      total: parcel.assessedTotal ?? null,
      land: parcel.assessedLand ?? null,
      improvements: parcel.assessedImprv ?? null,
    },
  };
  listing.provenance.derivedFields.assessorRoll = {
    parcel: durableParcel,
    countyKey: candidate.countyKey,
    apn: parcel.canonicalApn || candidate.cleanApn || null,
    observedAt,
    basis: parcel.source === 'local_cadastral_offline_index' ? 'LOCAL_CADASTRAL_OFFLINE' : 'ARCGIS_REST_PARCEL',
    assessmentYear,
    note: 'County assessor roll figure harvested at ingest; the market comparison applies the county conversion rule, never the raw figure where none is configured.',
  };
  if (parcel.canonicalApn && !listing.parcelKey) {
    listing.parcelKey = parcel.countyFips ? `${parcel.countyFips}-${parcel.canonicalApn}` : parcel.canonicalApn;
    listing.provenance.derivedFields.parcelKey = true;
  }
  const total = Number(parcel.assessedValue?.total ?? parcel.assessedTotal);
  if (Number.isFinite(total) && total > 0) {
    if (!(Number(listing.assessed) > 0)) listing.assessed = total;
    if (assessmentYear && !listing.assessmentYear) listing.assessmentYear = assessmentYear;
  }
}

async function harvestAssessorRolls(listings, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const queryFn = options.queryFn || queryArcgisParcel;
  const limit = resolveHarvestLimit(options);
  const cachePath = options.cachePath || DEFAULT_CACHE_PATH;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? options.cacheTtlMs : DEFAULT_CACHE_TTL_MS;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const candidates = (Array.isArray(listings) ? listings : [])
    .map(candidateListing)
    .filter(Boolean);
  const results = { considered: 0, harvested: 0, cacheHits: 0, fetched: 0, failed: 0, notFound: 0 };
  if (!candidates.length) return results;

  let cache = {};
  let cacheLoaded = false;
  let cacheDirty = false;
  for (const candidate of candidates) {
    if (results.considered >= limit) break;
    results.considered += 1;
    const key = cacheKeyFor(candidate.countyKey, candidate.lat, candidate.lng, candidate.cleanApn);
    if (!cacheLoaded) {
      cache = loadCache(cachePath);
      cacheLoaded = true;
    }
    const cached = cache[key];
    if (cached && Number.isFinite(Date.parse(cached.observedAt)) && now - Date.parse(cached.observedAt) < cacheTtlMs) {
      applyHarvest(candidate, cached.parcel, cached.observedAt);
      results.cacheHits += 1;
      results.harvested += 1;
      continue;
    }
    let parcel = null;
    try {
      parcel = await queryFn({
        lat: candidate.lat,
        lng: candidate.lng,
        apn: candidate.apn,
        state: candidate.listing.state,
        county: candidate.listing.county,
        fetchFn,
      });
    } catch (_) {
      results.failed += 1;
      continue;
    }
    if (!parcel) {
      results.notFound += 1;
      continue;
    }
    results.fetched += 1;
    const observedAt = new Date(now).toISOString();
    cache[key] = { parcel, observedAt };
    cacheDirty = true;
    applyHarvest(candidate, parcel, observedAt);
    results.harvested += 1;
  }
  if (cacheDirty) {
    try { saveCache(cachePath, cache); } catch (_) { /* cache write is best-effort */ }
  }
  return results;
}

module.exports = {
  DEFAULT_CACHE_PATH,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_HARVEST_LIMIT,
  cacheKeyFor,
  candidateListing,
  harvestAssessorRolls,
  resolveHarvestLimit,
  taxYearFromRawAttributes,
};
