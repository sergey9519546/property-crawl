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

const path = require('node:path');
const os = require('node:os');
const { harvestAssessorRolls, loadCache, saveCache, cacheKeyFor, DEFAULT_CACHE_PATH, DEFAULT_CACHE_TTL_MS, DEFAULT_MISS_TTL_MS } = require('./assessor-harvest');

const ASSESSOR_BACKFILL_RULE_VERSION = '2026-11-prop-loc-v2';
const DB_MISS_COOLDOWN_MS = 7 * 24 * 3600 * 1000;

function resolveAssessorCachePath(cachePath) {
  if (cachePath) return cachePath;
  if (process.env.PROPERTY_ASSESSOR_CACHE_PATH) return process.env.PROPERTY_ASSESSOR_CACHE_PATH;
  if (process.env.VERCEL === '1' || process.env.NOW_REGION) {
    return path.join(os.tmpdir(), 'property-crawl-cache', 'assessor-roll.json');
  }
  return DEFAULT_CACHE_PATH;
}

function hasRecentDbAssessorMiss(listing, nowMs = Date.now()) {
  const stamped = listing?.provenance?.derivedFields?.assessorAttempted;
  if (!stamped || typeof stamped !== 'object') return false;
  if (stamped.ruleVersion !== ASSESSOR_BACKFILL_RULE_VERSION || stamped.found !== false) return false;
  const ts = Date.parse(String(stamped.at || ''));
  return Number.isFinite(ts) && (nowMs - ts) < DB_MISS_COOLDOWN_MS;
}

async function persistAssessorAttemptMiss(db, listingId, nowMs) {
  if (!db?.isPg || !db?.pool || typeof db.pool.query !== 'function' || !listingId) return;
  try {
    const stamp = JSON.stringify({
      at: new Date(nowMs).toISOString(),
      ruleVersion: ASSESSOR_BACKFILL_RULE_VERSION,
      found: false,
    });
    await db.pool.query(
      `UPDATE listings
          SET provenance = jsonb_set(
                jsonb_set(COALESCE(provenance, '{}'::jsonb), '{derivedFields}', COALESCE(provenance->'derivedFields', '{}'::jsonb), true),
                '{derivedFields,assessorAttempted}',
                $2::jsonb,
                true
              )
        WHERE id = $1`,
      [listingId, stamp],
    );
  } catch {
    // Non-fatal: miss durability must never break enrichment backfill.
  }
}
const { extractRawApn, normalizeApn, buildParcelKey } = require('../scrapers/normalization');
const { MARKET_CONVERSION } = require('./assessor-reading');
const { resolveCountyKey, resolveCountyEndpoint, COUNTY_ARCGIS_REGISTRY } = require('./arcgis-parcels');
const { enrichNjListing, extractNjGeocodeQuery, applyNjCadastralData } = require('./nj-cadastral');

// States whose counties carry verified market conversions in this registry.
// FL is included: its conversions resolve through the statewide fallback.
const CONVERTED_STATES = Object.freeze(
  [...new Set(Object.keys(MARKET_CONVERSION).map((key) => String(key).split('-')[0]))]
    .filter((state) => /^[A-Z]{2}$/.test(state))
);

function countyEnrolled(state, county) {
  if (!state) return false;
  const endpoint = resolveCountyEndpoint(state, county);
  if (endpoint) return true;
  return Boolean(resolveCountyKey(state, county)) && String(state).toUpperCase() === 'FL';
}

function candidateReady(listing, nowMs = Date.now()) {
  if (!listing || typeof listing !== 'object') return false;
  // The roll marker is the authority — rows carrying a publisher assessed figure without an attached assessorRoll remain eligible for parcel-roll harvest.
  // an assessed figure from another enrichment path) is not a backfill target.
  if (listing.assessorParcel || listing.provenance?.derivedFields?.assessorRoll) return false;
  if (hasRecentDbAssessorMiss(listing, nowMs)) return false;
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

function prioritizeHudMissingSpecs(rows = []) {
  return [...rows].sort((a, b) => {
    const aHudMissing = a?.source === 'hud' && (!(Number(a.assessed) > 0) || !(Number(a.sqft) > 0) || !(Number(a.year) > 0)) ? 0 : 1;
    const bHudMissing = b?.source === 'hud' && (!(Number(b.assessed) > 0) || !(Number(b.sqft) > 0) || !(Number(b.year) > 0)) ? 0 : 1;
    return aHudMissing - bHudMissing;
  });
}

async function resolveNjCadastralBatch({ db, fetchFn, now, limit = 15, perStateLimit = 60, cachePath, logger = null, maxDurationMs, wallClock } = {}) {
  const out = { considered: 0, njEnriched: 0, persisted: 0, failed: 0, notFound: 0 };
  if (!db || typeof db.getListings !== 'function' || typeof db.createListing !== 'function' || limit <= 0) {
    return out;
  }
  const effectiveCachePath = resolveAssessorCachePath(cachePath);
  const cache = loadCache(effectiveCachePath);
  const cacheTtlMs = DEFAULT_CACHE_TTL_MS;
  const missTtlMs = DEFAULT_MISS_TTL_MS;
  const clock = typeof wallClock === 'function' ? wallClock : Date.now;
  const startedAt = clock();
  const budgetMs = Number.isFinite(Number(maxDurationMs)) && Number(maxDurationMs) > 0 ? Number(maxDurationMs) : 0;
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const budgetExpired = () => budgetMs > 0 && (clock() - startedAt) >= budgetMs;
  let page = { listings: [] };
  try {
    page = await db.getListings({ state: 'NJ', missingAssessorRoll: true, limit: perStateLimit });
  } catch (error) {
    if (logger?.warn) logger.warn(`[NjCadastralBackfill] NJ query failed (non-fatal): ${error.message}`);
    return out;
  }
  const candidates = [];
  for (const row of prioritizeHudMissingSpecs(page.listings || [])) {
    if (!row || typeof row !== 'object' || !row.id || String(row.state || '').toUpperCase() !== 'NJ') continue;
    if (row.assessorParcel || row.provenance?.derivedFields?.assessorRoll) continue;
    if (hasRecentDbAssessorMiss(row, nowMs)) continue;
    const queryLine = extractNjGeocodeQuery(row);
    if (!queryLine) continue;
    const key = `NJ-GEO|${queryLine.toUpperCase()}`;
    const entry = cache[key];
    if (entry && Number.isFinite(Date.parse(entry.observedAt))) {
      const age = nowMs - Date.parse(entry.observedAt);
      if (entry.hit ? age < cacheTtlMs : age < missTtlMs) continue;
    }
    candidates.push({ row, key });
    if (candidates.length >= limit) break;
  }
  if (!candidates.length) return out;

  let cacheDirty = false;
  for (const { row, key } of candidates) {
    if (budgetExpired()) break;
    out.considered += 1;
    try {
      const res = await enrichNjListing(row, { fetchFn, now: nowMs });
      if (res.found) {
        out.njEnriched += 1;
        cache[key] = { observedAt: new Date(nowMs).toISOString(), hit: true };
        cacheDirty = true;
        try {
          await db.createListing(row);
          out.persisted += 1;
        } catch (persistErr) {
          if (logger?.warn) logger.warn(`[NjCadastralBackfill] persist failed (non-fatal): ${persistErr.message}`);
        }
      } else {
        out.notFound += 1;
        cache[key] = { observedAt: new Date(nowMs).toISOString(), hit: false };
        cacheDirty = true;
        await persistAssessorAttemptMiss(db, row.id, nowMs);
      }
    } catch (err) {
      out.failed += 1;
      if (logger?.warn) logger.warn(`[NjCadastralBackfill] enrich failed (non-fatal): ${err.message}`);
    }
  }
  if (cacheDirty && typeof saveCache === 'function') {
    try { saveCache(effectiveCachePath, cache); } catch { /* best effort cache persistence */ }
  }
  return out;
}

async function backfillAssessorRolls({ db, fetchFn, now, limit = 30, perStateLimit = 60, cachePath, logger = null, maxDurationMs, wallClock } = {}) {
  const result = { considered: 0, harvested: 0, njEnriched: 0, persisted: 0, failed: 0, notFound: 0, skipped: null };
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
  const effectiveCachePath = resolveAssessorCachePath(cachePath);
  const cache = loadCache(effectiveCachePath);
  const cacheTtlMs = DEFAULT_CACHE_TTL_MS;
  const missTtlMs = DEFAULT_MISS_TTL_MS;
  const clock = typeof wallClock === 'function' ? wallClock : Date.now;
  const startedAt = clock();
  const budgetMs = Number.isFinite(Number(maxDurationMs)) && Number(maxDurationMs) > 0 ? Number(maxDurationMs) : 0;
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const budgetExpired = () => budgetMs > 0 && (clock() - startedAt) >= budgetMs;
  const seen = new Set();
  const candidates = [];
  try {
    const hudPage = await db.getListings({ source: 'hud', missingAssessorRoll: true, limit: Math.min(limit, 30) });
    for (const row of prioritizeHudMissingSpecs(hudPage?.listings || [])) {
      if (!row || typeof row !== 'object' || !row.id || seen.has(row.id)) continue;
      if (!candidateReady(row, nowMs)) continue;
      const countyKey = resolveCountyKey(row.state, row.county);
      const cleanApn = normalizeApn(extractRawApn(row));
      const key = cacheKeyFor(countyKey, Number(row.lat), Number(row.lng), cleanApn);
      const entry = cache[key];
      if (entry && Number.isFinite(Date.parse(entry.observedAt))) {
        const age = nowMs - Date.parse(entry.observedAt);
        if (entry.parcel ? age < cacheTtlMs : age < missTtlMs) continue;
      }
      seen.add(row.id);
      candidates.push(row);
      if (candidates.length >= limit) break;
    }
  } catch (error) {
    if (logger?.warn) logger.warn(`[AssessorBackfill] HUD priority query failed (non-fatal): ${error.message}`);
  }
  const stateBuckets = [];
  if (candidates.length < limit && !budgetExpired()) {
    for (let i = 0; i < CONVERTED_STATES.length; i += 4) {
      if (budgetExpired()) break;
      const batch = CONVERTED_STATES.slice(i, i + 4);
      const batchResults = await Promise.all(batch.map(async (state) => {
        try {
          const page = await db.getListings({ state, missingAssessorRoll: true, limit: perStateLimit });
          return { state, page };
        } catch (error) {
          if (logger?.warn) logger.warn(`[AssessorBackfill] ${state} query failed (non-fatal): ${error.message}`);
          return { state, page: null };
        }
      }));
      for (const { page } of batchResults) {
        if (!page) continue;
        const bucket = [];
        for (const row of prioritizeHudMissingSpecs(page.listings || [])) {
          if (!row || typeof row !== 'object' || !row.id || seen.has(row.id)) continue;
          if (!candidateReady(row, nowMs)) continue;
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
    }
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
  if (candidates.length) {
  result.considered = candidates.length;

  // onHarvested persists each roll the moment it attaches (see the harvest
  // module): an interrupted run keeps the rolls it already earned.
  try {
    const harvest = await harvestAssessorRolls(candidates, {
      fetchFn,
      now,
      cachePath: effectiveCachePath,
      ...(budgetMs > 0 ? { maxDurationMs: Math.max(1, budgetMs - (clock() - startedAt)), wallClock: clock } : {}),
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
    if (result.notFound > 0 && db?.isPg && db?.pool) {
      const postCache = loadCache(effectiveCachePath);
      const expectedObservedAt = new Date(nowMs).toISOString();
      for (const cand of candidates) {
        if (cand?.provenance?.derivedFields?.assessorRoll) continue;
        const countyKey = resolveCountyKey(cand.state, cand.county);
        const cleanApn = normalizeApn(extractRawApn(cand));
        const key = cacheKeyFor(countyKey, Number(cand.lat), Number(cand.lng), cleanApn);
        const entry = postCache[key];
        if (entry && !entry.parcel && entry.observedAt === expectedObservedAt) {
          await persistAssessorAttemptMiss(db, cand.id, nowMs);
        }
      }
    }
  } catch (error) {
    if (logger?.warn) logger.warn(`[AssessorBackfill] harvest failed (non-fatal): ${error.message}`);
  }
  }

  const remainingForNj = Math.max(0, limit - result.considered);
  if (remainingForNj > 0 && !budgetExpired()) {
    const njOut = await resolveNjCadastralBatch({
      db,
      fetchFn,
      now,
      limit: remainingForNj,
      perStateLimit,
      cachePath,
      ...(budgetMs > 0 ? { maxDurationMs: Math.max(1, budgetMs - (clock() - startedAt)), wallClock: clock } : {}),
      logger,
    });
    result.njEnriched = njOut.njEnriched;
    result.considered += njOut.considered;
    result.persisted += njOut.persisted;
    result.failed += njOut.failed;
    result.notFound += njOut.notFound;
  }
  return result;
}

module.exports = {
  backfillAssessorRolls,
  resolveNjCadastralBatch,
  resolveAssessorCachePath,
  hasRecentDbAssessorMiss,
  ASSESSOR_BACKFILL_RULE_VERSION,
  CONVERTED_STATES,
  candidateReady,
  countyEnrolled,
};
