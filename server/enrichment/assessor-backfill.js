// Backfills stored, roll-less listings in states with verified assessor
// conversions. The ingest-time harvest only sees the listings a source run
// observes, so records ingested before a county's enrollment (the majority of
// the inventory) stay dark until a full sweep re-observes them — on a host
// that runs incremental cycles, that can take weeks. This module pulls a
// bounded batch of roll-less listings straight from the store and runs the
// same fail-open, cache-backed harvest over them, then persists the results.
//
// Hard bounds: one page per converted state per call, a candidate cap, the
// harvest's own per-run limit and disk cache, and fail-open on every error.
// A backfill failure must never affect ingest or serving.

const { harvestAssessorRolls, loadCache, cacheKeyFor, DEFAULT_CACHE_PATH, DEFAULT_CACHE_TTL_MS, DEFAULT_MISS_TTL_MS } = require('./assessor-harvest');
const { extractRawApn, normalizeApn, buildParcelKey } = require('../scrapers/normalization');
const { MARKET_CONVERSION } = require('./assessor-reading');
const { resolveCountyKey, COUNTY_ARCGIS_REGISTRY } = require('./arcgis-parcels');

// States whose counties carry verified market conversions in this registry.
// FL is included: its conversions resolve through the statewide fallback.
const CONVERTED_STATES = Object.freeze(
  [...new Set(Object.keys(MARKET_CONVERSION).map((key) => String(key).split('-')[0]))]
    .filter((state) => /^[A-Z]{2}$/.test(state))
);

function countyEnrolled(state, county) {
  if (!state || !county) return false;
  const key = resolveCountyKey(state, county);
  if (!key) return false;
  // Florida conversions resolve through the statewide fallback registry, not
  // a per-county entry, so every Florida listing is a valid candidate.
  return Boolean(COUNTY_ARCGIS_REGISTRY[key]) || String(state).toUpperCase() === 'FL';
}

function candidateReady(listing) {
  if (!listing || typeof listing !== 'object') return false;
  // The roll marker is the authority — a row that already carries a roll (or
  // an assessed figure from another enrichment path) is not a backfill target.
  if (listing.assessorParcel || listing.provenance?.derivedFields?.assessorRoll || Number(listing.assessed) > 0) return false;
  const lat = Number(listing.lat);
  const lng = Number(listing.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  const hasApn = Boolean(
    listing.apn
    || listing.parcelNumber
    || listing.parcelId
    || listing.provenance?.sourceFacts?.parcelNumber
    || listing.provenance?.sourceFacts?.parcelId
  );
  if (!hasCoords && !hasApn) return false;
  // The per-state page mixes enrolled and unenrolled counties; without this
  // check the candidate cap fills with rows the harvest can only answer
  // "not found" for (verified in production: the AZ page is ~40% unenrolled).
  return countyEnrolled(listing.state, listing.county);
}

async function backfillAssessorRolls({ db, fetchFn, now, limit = 30, perStateLimit = 60, cachePath, logger = null } = {}) {
  const result = { considered: 0, harvested: 0, persisted: 0, failed: 0, notFound: 0, skipped: null };
  if (!db || typeof db.getListings !== 'function' || typeof db.createListing !== 'function') {
    result.skipped = 'db-unavailable';
    return result;
  }

  // The per-state pages can overlap (a listing sits in exactly one state, but
  // defensive dedup keeps one row = one candidate even if a caller reuses a
  // store that ignores filters). Candidates with a fresh cache entry — a hit
  // (already rolled) or a recent miss — are skipped so the candidate cap is
  // spent on rows that can still learn something; without this, a state whose
  // first-page rows persistently miss consumes the cap every run and starves
  // every state behind it.
  const cache = loadCache(cachePath || DEFAULT_CACHE_PATH);
  const cacheTtlMs = DEFAULT_CACHE_TTL_MS;
  const missTtlMs = DEFAULT_MISS_TTL_MS;
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const seen = new Set();
  const candidates = [];
  const stateBuckets = [];
  for (const state of CONVERTED_STATES) {
    let page = { listings: [] };
    try {
      page = await db.getListings({ state, missingAssessorRoll: true, limit: perStateLimit });
    } catch (error) {
      if (logger?.warn) logger.warn(`[AssessorBackfill] ${state} query failed (non-fatal): ${error.message}`);
      continue;
    }
    const bucket = [];
    for (const row of page.listings || []) {
      if (!row || typeof row !== 'object' || !row.id || seen.has(row.id)) continue;
      if (!candidateReady(row)) continue;
      const countyKey = resolveCountyKey(row.state, row.county);
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      const cleanApn = normalizeApn(extractRawApn(row));
      const key = cacheKeyFor(countyKey, lat, lng, cleanApn);
      const entry = cache[key];
      if (entry && Number.isFinite(Date.parse(entry.observedAt))) {
        const age = nowMs - Date.parse(entry.observedAt);
        if (entry.parcel ? age < cacheTtlMs : age < missTtlMs) continue;
      }
      seen.add(row.id);
      bucket.push(row);
    }
    if (bucket.length) stateBuckets.push(bucket);
  }
  // Fair round-robin interleave across states so no single state starves the others:
  let idx = 0;
  while (candidates.length < limit && stateBuckets.some(b => idx < b.length)) {
    for (const bucket of stateBuckets) {
      if (candidates.length >= limit) break;
      if (idx < bucket.length) {
        candidates.push(bucket[idx]);
      }
    }
    idx++;
  }
  if (!candidates.length) return result;
  result.considered = candidates.length;

  // onHarvested persists each roll the moment it attaches (see the harvest
  // module): an interrupted run keeps the rolls it already earned.
  try {
    const harvest = await harvestAssessorRolls(candidates, {
      fetchFn,
      now,
      cachePath,
      onHarvested: async (listing) => {
        const derivedFields = listing?.provenance?.derivedFields;
        const roll = derivedFields?.assessorRoll;
        if (!roll) return;
        const apn = roll.parcel?.apn || roll.parcel?.canonicalApn || roll.apn;
        if (!listing.parcelKey && apn) {
          const derivedParcelKey = buildParcelKey({
            apn: roll.parcel?.apn || apn,
            countyFips: roll.parcel?.countyFips || listing.countyFips,
          });
          if (derivedParcelKey) {
            listing.parcelKey = derivedParcelKey;
            derivedFields.parcelKey = true;
          }
        }
        try {
          await db.createListing(listing);
          result.persisted += 1;
        } catch (error) {
          if (logger?.warn) logger.warn(`[AssessorBackfill] persist failed (non-fatal): ${error.message}`);
        }
      },
    });
    result.harvested = harvest.harvested;
    result.failed = harvest.failed;
    result.notFound = harvest.notFound;
  } catch (error) {
    if (logger?.warn) logger.warn(`[AssessorBackfill] harvest failed (non-fatal): ${error.message}`);
  }
  return result;
}

module.exports = { backfillAssessorRolls, CONVERTED_STATES, candidateReady, countyEnrolled };
