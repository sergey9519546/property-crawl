// server/intelligence/watchlist-comps.js
//
// "Comps" engine for saved watchlist listings. When a user bookmarks a
// property they want to see what else is on the market near it that
// might compare to it: similar size, similar distress type, similar
// price band. This module is the read-only analytics layer that drives
// GET /api/watchlist/:listingId/comps.
//
// Design choices:
//   - Pure function with no I/O. Callers pass in the candidate pool
//     (already filtered to "active live listings") so the engine can be
//     unit-tested without spinning up Postgres or the in-memory cache.
//   - Distance filtering is two-tiered: when both target and candidate
//     have lat/lng, use haversine. Otherwise fall back to zip-code match
//     so candidates with missing geocoding can still surface.
//   - Sqft band is "target ± 30%" by default; if target has no sqft the
//     band is dropped so a missing field doesn't eliminate all comps.
//   - PropType match is preferred but loose: null/undefined on the
//     target side means "any propType".
//   - Scoring is a weighted blend of (a) proximity, (b) size similarity,
//     (c) price-band similarity, (d) opening-bid distance in log space
//     (so a $50k vs $200k pair isn't over-penalized). All scores are
//     clamped to [0, 1].
//
// The function returns the target's comps plus aggregate stats the UI
// uses to show "median price in this comp set" or "median sqft".

'use strict';

const DEFAULT_SQFT_BAND = 0.30;     // ±30% sqft band
const DEFAULT_RADIUS_KM = 8;        // ~5 miles, walking-comp distance
const DEFAULT_MAX_AGE_DAYS = 365;   // ignore candidates > 1 year stale
const PRICE_BAND_TOLERANCE = 0.40;  // ±40% opening-bid band
const PRICE_LOG_EPSILON = 0.15;     // log-space floor to avoid /0

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371.0088;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const startLat = toRad(lat1);
  const endLat = toRad(lat2);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizedZip(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 5);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function safeBandPct(value, tolerance) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(0, 1 - Math.abs(Math.log((value + PRICE_LOG_EPSILON) / (1 + PRICE_LOG_EPSILON))) / Math.log(1 + tolerance));
}

function proximityScore(distanceKm) {
  if (distanceKm === null) return 0.5; // no coords → neutral
  if (distanceKm <= 0.5) return 1;
  if (distanceKm >= DEFAULT_RADIUS_KM * 4) return 0;
  // Linear from 1.0 at 0.5km to 0.0 at 4x radius
  return 1 - (distanceKm - 0.5) / (DEFAULT_RADIUS_KM * 4 - 0.5);
}

function sizeScore(targetSqft, candidateSqft) {
  if (!Number.isFinite(targetSqft) || targetSqft <= 0) return 0.5;
  if (!Number.isFinite(candidateSqft) || candidateSqft <= 0) return 0.5;
  const ratio = candidateSqft / targetSqft;
  if (ratio <= 0.5 || ratio >= 2) return 0;
  // 1.0 at exact match, 0.0 at 50% or 200%, linear in between
  return 1 - Math.abs(Math.log(ratio)) / Math.log(2);
}

function withinSqftBand(targetSqft, candidateSqft, tolerance = DEFAULT_SQFT_BAND) {
  if (!Number.isFinite(targetSqft) || targetSqft <= 0) return true;
  if (!Number.isFinite(candidateSqft) || candidateSqft <= 0) return true;
  const lower = targetSqft * (1 - tolerance);
  const upper = targetSqft * (1 + tolerance);
  return candidateSqft >= lower && candidateSqft <= upper;
}

function withinPriceBand(targetBid, candidateBid, tolerance = PRICE_BAND_TOLERANCE) {
  if (!Number.isFinite(targetBid) || targetBid <= 0) return true;
  if (!Number.isFinite(candidateBid) || candidateBid <= 0) return true;
  const lower = targetBid * (1 - tolerance);
  const upper = targetBid * (1 + tolerance);
  return candidateBid >= lower && candidateBid <= upper;
}

function isWithinLastYear(observedAt, nowMs, maxAgeMs) {
  if (!observedAt) return false;
  const t = Date.parse(String(observedAt));
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= maxAgeMs;
}

// Score a single candidate against the target. Higher = better comp.
// Weights sum to 1.0; bumping any single weight will reshape ranking.
const WEIGHT_PROXIMITY = 0.40;
const WEIGHT_SIZE = 0.25;
const WEIGHT_PRICE = 0.25;
const WEIGHT_TYPE = 0.10;

function scoreCandidate(target, candidate, distanceKm) {
  const prox = proximityScore(distanceKm);
  const size = sizeScore(target.sqft, candidate.sqft);
  const price = safeBandPct(target.openingBid, PRICE_BAND_TOLERANCE)
    * safeBandPct(candidate.openingBid, PRICE_BAND_TOLERANCE);
  const type = target.propType && candidate.propType && target.propType === candidate.propType ? 1 : 0;
  return prox * WEIGHT_PROXIMITY
    + size * WEIGHT_SIZE
    + price * WEIGHT_PRICE
    + type * WEIGHT_TYPE;
}

// Public API. `pool` is any iterable of listing records with the same
// shape returned by `db.getListings({...}).listings`:
//
//   { id, source, state, city, zip, address, sqft, year,
//     openingBid, estLow, estHigh, mid, dealScore, propType, lat, lng,
//     sourceObservedAt, ... }
//
// Returns:
//   { target: <listing>, comps: [...], stats: { count, medianOpeningBid,
//     medianSqft, medianDealScore, sources: {source: count} }, reason? }
//
// `reason` is set when there are zero comps so the UI can show a real
// explanation instead of an empty list.
function findWatchlistComps(target, pool, options = {}) {
  if (!target || typeof target !== 'object') {
    return { target: null, comps: [], stats: emptyStats(), reason: 'target_missing' };
  }
  if (!Array.isArray(pool)) pool = [];

  const targetLat = finiteOrNull(target.lat);
  const targetLng = finiteOrNull(target.lng);
  const targetZip = normalizedZip(target.zip);
  const targetState = typeof target.state === 'string' ? target.state.trim().toUpperCase() : '';
  const sqftBand = Number.isFinite(options.sqftBand) ? Math.max(0.05, Math.min(1, options.sqftBand)) : DEFAULT_SQFT_BAND;
  const radiusKm = Number.isFinite(options.radiusKm) ? Math.max(0.5, options.radiusKm) : DEFAULT_RADIUS_KM;
  const maxAgeMs = (Number.isFinite(options.maxAgeDays) ? options.maxAgeDays : DEFAULT_MAX_AGE_DAYS) * 86_400_000;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(50, options.limit)) : 8;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

  const candidates = [];
  for (const candidate of pool) {
    if (!candidate || candidate.id === target.id) continue;
    if (typeof candidate.state !== 'string') continue;
    if (candidate.state.trim().toUpperCase() !== targetState) continue;

    // Recency: a comp from 3 years ago is stale and unhelpful
    const observedAt = candidate.sourceObservedAt || candidate.fetchedAt;
    if (!isWithinLastYear(observedAt, nowMs, maxAgeMs)) continue;

    const candidateLat = finiteOrNull(candidate.lat);
    const candidateLng = finiteOrNull(candidate.lng);
    const candidateZip = normalizedZip(candidate.zip);

    let distanceKm = null;
    let passesGeo = false;
    if (targetLat !== null && targetLng !== null && candidateLat !== null && candidateLng !== null) {
      distanceKm = haversineKm(targetLat, targetLng, candidateLat, candidateLng);
      passesGeo = distanceKm <= radiusKm;
    } else if (targetZip && candidateZip && targetZip === candidateZip) {
      passesGeo = true;
    } else {
      // Neither side has usable geo. Same state + matching city is a weak
      // proxy; otherwise skip rather than fabricate proximity.
      const targetCity = typeof target.city === 'string' ? target.city.trim().toLowerCase() : '';
      const candidateCity = typeof candidate.city === 'string' ? candidate.city.trim().toLowerCase() : '';
      passesGeo = Boolean(targetCity) && targetCity === candidateCity;
    }
    if (!passesGeo) continue;

    if (!withinSqftBand(target.sqft, candidate.sqft, sqftBand)) continue;
    if (!withinPriceBand(target.openingBid, candidate.openingBid, PRICE_BAND_TOLERANCE)) continue;

    const score = scoreCandidate(target, candidate, distanceKm);
    candidates.push({
      listing: candidate,
      distanceKm,
      score: Number(score.toFixed(4))
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const comps = candidates.slice(0, limit);
  const stats = computeStats(comps.map((c) => c.listing));

  if (comps.length === 0) {
    let reason = 'no_candidates_in_pool';
    if (targetLat === null && !targetZip) reason = 'target_geocode_missing';
    return { target, comps, stats, reason };
  }
  return { target, comps, stats };
}

function emptyStats() {
  return { count: 0, medianOpeningBid: null, medianSqft: null, medianDealScore: null, sources: {} };
}

function computeStats(listings) {
  if (!listings.length) return emptyStats();
  const openings = listings.map((l) => finiteOrNull(l.openingBid)).filter(Number.isFinite);
  const sqfts = listings.map((l) => finiteOrNull(l.sqft)).filter((n) => Number.isFinite(n) && n > 0);
  const scores = listings.map((l) => finiteOrNull(l.dealScore)).filter(Number.isFinite);
  const sources = {};
  for (const listing of listings) {
    const src = typeof listing.source === 'string' ? listing.source : 'unknown';
    sources[src] = (sources[src] || 0) + 1;
  }
  return {
    count: listings.length,
    medianOpeningBid: median(openings),
    medianSqft: median(sqfts),
    medianDealScore: median(scores),
    sources
  };
}

module.exports = {
  findWatchlistComps,
  haversineKm,
  withinSqftBand,
  withinPriceBand,
  median,
  // Internal helpers exposed for tests
  _internals: { scoreCandidate, proximityScore, sizeScore, normalizedZip }
};