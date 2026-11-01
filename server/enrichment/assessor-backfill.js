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

const { harvestAssessorRolls } = require('./assessor-harvest');
const { MARKET_CONVERSION } = require('./assessor-reading');

// States whose counties carry verified market conversions in this registry.
// FL is included: its conversions resolve through the statewide fallback.
const CONVERTED_STATES = Object.freeze(
  [...new Set(Object.keys(MARKET_CONVERSION).map((key) => String(key).split('-')[0]))]
    .filter((state) => /^[A-Z]{2}$/.test(state))
);

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
  return hasCoords || hasApn;
}

async function backfillAssessorRolls({ db, fetchFn, now, limit = 30, perStateLimit = 60, logger = null } = {}) {
  const result = { considered: 0, harvested: 0, persisted: 0, failed: 0, notFound: 0, skipped: null };
  if (!db || typeof db.getListings !== 'function' || typeof db.createListing !== 'function') {
    result.skipped = 'db-unavailable';
    return result;
  }

  // The per-state pages can overlap (a listing sits in exactly one state, but
  // defensive dedup keeps one row = one candidate even if a caller reuses a
  // store that ignores filters).
  const seen = new Set();
  const candidates = [];
  for (const state of CONVERTED_STATES) {
    if (candidates.length >= limit) break;
    let page = { listings: [] };
    try {
      page = await db.getListings({ state, missingAssessorRoll: true, limit: perStateLimit });
    } catch (error) {
      if (logger?.warn) logger.warn(`[AssessorBackfill] ${state} query failed (non-fatal): ${error.message}`);
      continue;
    }
    for (const row of page.listings || []) {
      if (candidates.length >= limit) break;
      if (!row || typeof row !== 'object' || !row.id || seen.has(row.id)) continue;
      if (!candidateReady(row)) continue;
      seen.add(row.id);
      candidates.push(row);
    }
  }
  if (!candidates.length) return result;
  result.considered = candidates.length;

  try {
    const harvest = await harvestAssessorRolls(candidates, { fetchFn, now });
    result.harvested = harvest.harvested;
    result.failed = harvest.failed;
    result.notFound = harvest.notFound;
  } catch (error) {
    if (logger?.warn) logger.warn(`[AssessorBackfill] harvest failed (non-fatal): ${error.message}`);
    return result;
  }

  for (const listing of candidates) {
    if (!listing?.provenance?.derivedFields?.assessorRoll) continue;
    try {
      await db.createListing(listing);
      result.persisted += 1;
    } catch (error) {
      if (logger?.warn) logger.warn(`[AssessorBackfill] persist failed (non-fatal): ${error.message}`);
    }
  }
  return result;
}

module.exports = { backfillAssessorRolls, CONVERTED_STATES, candidateReady };
