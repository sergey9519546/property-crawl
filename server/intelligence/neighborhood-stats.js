// server/intelligence/neighborhood-stats.js
//
// Read-only analytics layer that aggregates live listings into
// "neighborhood" statistics. The unit of aggregation is the narrowest
// location key we have for a listing:
//
//   1. ZIP code (5-digit) — strongest signal, present for most listings
//   2. City + State      — fallback when ZIP is missing
//
// For each unit, the engine returns:
//
//   - count of active listings
//   - median / mean opening bid
//   - median / mean sqft
//   - median deal score
//   - median discount (1 - openingBid/mid when both exist)
//   - per-source counts
//   - top prop types
//
// The function is pure: callers pass in the live listing pool. This
// matches the pattern of every other module in server/intelligence/* —
// no I/O inside the analytics layer.

'use strict';

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizedZip(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 5);
}

function normalizedCity(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function normalizedState(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed || null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function unitKey(listing) {
  const zip = normalizedZip(listing?.zip);
  if (zip) return { kind: 'zip', key: zip, label: zip };
  const city = normalizedCity(listing?.city);
  const state = normalizedState(listing?.state);
  if (city && state) return { kind: 'city', key: `${state}::${city}`, label: `${city}, ${state}` };
  return null;
}

function isWithinWindow(observedAt, nowMs, maxAgeMs) {
  if (!observedAt) return false;
  const t = Date.parse(String(observedAt));
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= maxAgeMs;
}

function discount(listing) {
  const opening = finiteOrNull(listing.openingBid);
  const mid = finiteOrNull(listing.mid);
  if (!Number.isFinite(opening) || !Number.isFinite(mid) || mid <= 0 || opening <= 0) return null;
  return 1 - (opening / mid);
}

// Group listings into neighborhood buckets and compute stats. Returns
// an array sorted by count (desc) then label (asc). Each entry:
//
//   { kind, key, label, count, medianOpeningBid, meanOpeningBid,
//     medianSqft, medianDealScore, medianDiscount, sources: {s:n},
//     propTypes: {t:n} }
function computeNeighborhoodStats(pool, options = {}) {
  if (!Array.isArray(pool)) pool = [];
  const maxAgeMs = (Number.isFinite(options.maxAgeDays) ? options.maxAgeDays : 365) * 86_400_000;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const includeKeys = new Set((options.includeKeys || []).map(String));

  const buckets = new Map();
  for (const listing of pool) {
    const observedAt = listing?.sourceObservedAt || listing?.fetchedAt;
    if (!isWithinWindow(observedAt, nowMs, maxAgeMs)) continue;
    const unit = unitKey(listing);
    if (!unit) continue;
    if (includeKeys.size && !includeKeys.has(`${unit.kind}:${unit.key}`)) continue;

    if (!buckets.has(unit.key)) {
      buckets.set(unit.key, {
        kind: unit.kind,
        key: unit.key,
        label: unit.label,
        listings: []
      });
    }
    buckets.get(unit.key).listings.push(listing);
  }

  const out = [];
  for (const bucket of buckets.values()) {
    const openings = bucket.listings.map((l) => finiteOrNull(l.openingBid)).filter(Number.isFinite);
    const sqfts = bucket.listings.map((l) => finiteOrNull(l.sqft)).filter((n) => Number.isFinite(n) && n > 0);
    const scores = bucket.listings.map((l) => finiteOrNull(l.dealScore)).filter(Number.isFinite);
    const discounts = bucket.listings.map(discount).filter(Number.isFinite);
    const sources = {};
    const propTypes = {};
    for (const listing of bucket.listings) {
      const src = typeof listing.source === 'string' ? listing.source : 'unknown';
      sources[src] = (sources[src] || 0) + 1;
      const t = typeof listing.propType === 'string' ? listing.propType : 'unknown';
      propTypes[t] = (propTypes[t] || 0) + 1;
    }
    out.push({
      kind: bucket.kind,
      key: bucket.key,
      label: bucket.label,
      count: bucket.listings.length,
      medianOpeningBid: median(openings),
      meanOpeningBid: openings.length ? Number(mean(openings).toFixed(2)) : null,
      medianSqft: median(sqfts),
      medianDealScore: median(scores),
      medianDiscount: discounts.length ? Number(median(discounts).toFixed(4)) : null,
      sources,
      propTypes
    });
  }
  out.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  });
  return out;
}

// Single-bucket lookup: returns the stats object for one neighborhood
// (zip OR city,state) or null if there are no listings in it. This is
// what /api/neighborhoods/:key surfaces.
function getNeighborhoodStats(key, pool, options = {}) {
  const all = computeNeighborhoodStats(pool, { ...options, includeKeys: [key] });
  return all[0] || null;
}

module.exports = {
  computeNeighborhoodStats,
  getNeighborhoodStats,
  unitKey,
  // Internal helpers exposed for tests
  _internals: { median, mean, discount }
};