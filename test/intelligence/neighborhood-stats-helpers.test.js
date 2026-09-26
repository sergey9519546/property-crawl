'use strict';

// test/intelligence/neighborhood-stats-helpers.test.js
//
// Direct unit coverage for server/intelligence/neighborhood-stats.js.
// The neighborhood analytics tab is driven entirely by this module:
// per-ZIP / per-city buckets, median / mean opening bid, median sqft /
// dealScore / discount, source and propType counts. Silent drift in the
// median math or bucket sort order would silently re-rank every
// neighborhood on the map without surfacing the change.
//
//   - median: odd-length, even-length, single-element, empty array
//   - mean: empty array, single element, multi-element
//   - unitKey: zip precedence, city/state fallback, null when both fail
//   - isWithinWindow: missing / unparseable / outside-window gating
//   - discount: positive / zero / null
//   - computeNeighborhoodStats: sort by count then label, includes stats
//   - getNeighborhoodStats: includeKeys filtering, null when missing

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  computeNeighborhoodStats,
  getNeighborhoodStats,
  unitKey,
  _internals: { median, mean, discount },
} = require('../../server/intelligence/neighborhood-stats');

// --- median -----------------------------------------------------------

test('median: empty array -> null', () => {
  assert.equal(median([]), null);
});

test('median: odd-length picks the middle value after sort', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([5, 5, 5, 1, 2]), 5);
});

test('median: even-length averages the two middle values', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([10, 20]), 15);
});

test('median: single-element array', () => {
  assert.equal(median([42]), 42);
});

// --- mean -------------------------------------------------------------

test('mean: empty array -> null', () => {
  assert.equal(mean([]), null);
});

test('mean: arithmetic average', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(mean([100]), 100);
});

// --- unitKey ----------------------------------------------------------

test('unitKey: zip takes precedence over city/state', () => {
  assert.deepEqual(unitKey({ zip: '44113', city: 'Cleveland', state: 'OH' }),
    { kind: 'zip', key: '44113', label: '44113' });
});

test('unitKey: zip trims and truncates to 5 chars', () => {
  assert.deepEqual(unitKey({ zip: '  44113-1234  ' }),
    { kind: 'zip', key: '44113', label: '44113' });
});

test('unitKey: city/state fallback when zip missing', () => {
  assert.deepEqual(unitKey({ city: 'Cleveland', state: 'OH' }),
    { kind: 'city', key: 'OH::cleveland', label: 'cleveland, OH' });
});

test('unitKey: state is uppercased, city lowercased', () => {
  assert.deepEqual(unitKey({ city: '  Cleveland  ', state: 'oh' }),
    { kind: 'city', key: 'OH::cleveland', label: 'cleveland, OH' });
});

test('unitKey: null when zip, city, and state all missing', () => {
  assert.equal(unitKey({}), null);
  assert.equal(unitKey(null), null);
});

test('unitKey: null when only city present (no state)', () => {
  assert.equal(unitKey({ city: 'Cleveland' }), null);
});

test('unitKey: empty zip -> falls through to city/state', () => {
  assert.deepEqual(unitKey({ zip: '', city: 'Cleveland', state: 'OH' }),
    { kind: 'city', key: 'OH::cleveland', label: 'cleveland, OH' });
});

// --- discount ---------------------------------------------------------

test('discount: positive when bid below mid', () => {
  assert.ok(Math.abs(discount({ openingBid: 100000, mid: 200000 }) - 0.5) < 1e-9);
});

test('discount: zero when bid equals mid', () => {
  assert.equal(discount({ openingBid: 100000, mid: 100000 }), 0);
});

test('discount: null when bid or mid missing or non-positive', () => {
  assert.equal(discount({ openingBid: 100000 }), null);
  assert.equal(discount({ mid: 100000 }), null);
  assert.equal(discount({ openingBid: 0, mid: 100000 }), null);
  assert.equal(discount({ openingBid: 100000, mid: 0 }), null);
});

// --- computeNeighborhoodStats -----------------------------------------

test('computeNeighborhoodStats: empty pool -> empty result', () => {
  const result = computeNeighborhoodStats([], { nowMs: Date.UTC(2026, 0, 1) });
  assert.deepEqual(result, []);
});

test('computeNeighborhoodStats: non-array pool -> empty result', () => {
  const result = computeNeighborhoodStats(null, { nowMs: Date.UTC(2026, 0, 1) });
  assert.deepEqual(result, []);
});

test('computeNeighborhoodStats: buckets by ZIP and reports medians', () => {
  const now = Date.UTC(2026, 0, 15);
  const listings = [
    { id: 'L1', zip: '44113', openingBid: 100000, sqft: 1500, dealScore: 80, propType: 'single-family', source: 'sheriff', sourceObservedAt: '2026-01-10T00:00:00Z' },
    { id: 'L2', zip: '44113', openingBid: 200000, sqft: 1800, dealScore: 60, propType: 'condo', source: 'sheriff', sourceObservedAt: '2026-01-12T00:00:00Z' },
    { id: 'L3', zip: '44113', openingBid: 150000, sqft: 1200, dealScore: 70, propType: 'single-family', source: 'trustee', sourceObservedAt: '2026-01-11T00:00:00Z' },
  ];
  const result = computeNeighborhoodStats(listings, { nowMs: now });
  assert.equal(result.length, 1);
  const bucket = result[0];
  assert.equal(bucket.kind, 'zip');
  assert.equal(bucket.key, '44113');
  assert.equal(bucket.label, '44113');
  assert.equal(bucket.count, 3);
  assert.equal(bucket.medianOpeningBid, 150000);
  assert.equal(bucket.medianSqft, 1500);
  assert.equal(bucket.medianDealScore, 70);
  assert.deepEqual(bucket.sources, { sheriff: 2, trustee: 1 });
  assert.deepEqual(bucket.propTypes, { 'single-family': 2, condo: 1 });
});

test('computeNeighborhoodStats: sort order is count desc, then label asc', () => {
  const now = Date.UTC(2026, 0, 15);
  const listings = [
    { id: 'L1', zip: '44113', openingBid: 100000, sourceObservedAt: '2026-01-10T00:00:00Z' },
    { id: 'L2', zip: '44114', openingBid: 100000, sourceObservedAt: '2026-01-10T00:00:00Z' },
    { id: 'L3', zip: '44114', openingBid: 200000, sourceObservedAt: '2026-01-10T00:00:00Z' },
    { id: 'L4', zip: '44115', openingBid: 100000, sourceObservedAt: '2026-01-10T00:00:00Z' },
  ];
  const result = computeNeighborhoodStats(listings, { nowMs: now });
  // 44114 has 2 listings, 44113 and 44115 have 1 each. Ties broken by label asc.
  assert.equal(result[0].key, '44114');
  assert.equal(result[1].key, '44113');
  assert.equal(result[2].key, '44115');
});

test('computeNeighborhoodStats: filters out listings outside maxAgeDays', () => {
  const now = Date.UTC(2026, 0, 15);
  const listings = [
    { id: 'fresh', zip: '44113', sourceObservedAt: '2026-01-10T00:00:00Z' },
    { id: 'stale', zip: '44113', sourceObservedAt: '2024-01-10T00:00:00Z' },
  ];
  const result = computeNeighborhoodStats(listings, { nowMs: now, maxAgeDays: 30 });
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 1);
});

test('computeNeighborhoodStats: missing observedAt is dropped', () => {
  const now = Date.UTC(2026, 0, 15);
  const listings = [
    { id: 'L1', zip: '44113' },  // no observedAt
    { id: 'L2', zip: '44113', sourceObservedAt: '2026-01-10T00:00:00Z' },
  ];
  const result = computeNeighborhoodStats(listings, { nowMs: now });
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 1);
});

test('computeNeighborhoodStats: skipped listings without a unit key', () => {
  const now = Date.UTC(2026, 0, 15);
  const listings = [
    { id: 'L1', sourceObservedAt: '2026-01-10T00:00:00Z' },  // no zip / city
    { id: 'L2', zip: '44113', sourceObservedAt: '2026-01-10T00:00:00Z' },
  ];
  const result = computeNeighborhoodStats(listings, { nowMs: now });
  assert.equal(result.length, 1);
  assert.equal(result[0].key, '44113');
});

test('computeNeighborhoodStats: medianDealScore is null when no scores', () => {
  const now = Date.UTC(2026, 0, 15);
  const listings = [
    { id: 'L1', zip: '44113', openingBid: 100000, sourceObservedAt: '2026-01-10T00:00:00Z' },
  ];
  const result = computeNeighborhoodStats(listings, { nowMs: now });
  assert.equal(result[0].medianDealScore, null);
  assert.equal(result[0].medianOpeningBid, 100000);
});

test('computeNeighborhoodStats: medianSqft filters zero / negative sqft', () => {
  const now = Date.UTC(2026, 0, 15);
  const listings = [
    { id: 'L1', zip: '44113', sqft: 0, sourceObservedAt: '2026-01-10T00:00:00Z' },
    { id: 'L2', zip: '44113', sqft: 1500, sourceObservedAt: '2026-01-10T00:00:00Z' },
  ];
  const result = computeNeighborhoodStats(listings, { nowMs: now });
  assert.equal(result[0].medianSqft, 1500);
});

test('computeNeighborhoodStats: medianDiscount rounded to 4 decimals', () => {
  const now = Date.UTC(2026, 0, 15);
  const listings = [
    { id: 'L1', zip: '44113', openingBid: 33333, mid: 100000, sourceObservedAt: '2026-01-10T00:00:00Z' },
  ];
  const result = computeNeighborhoodStats(listings, { nowMs: now });
  assert.equal(result[0].medianDiscount, 0.6667);
});

test('computeNeighborhoodStats: includeKeys filters to a single key', () => {
  const now = Date.UTC(2026, 0, 15);
  const listings = [
    { id: 'L1', zip: '44113', openingBid: 100000, sourceObservedAt: '2026-01-10T00:00:00Z' },
    { id: 'L2', zip: '44114', openingBid: 200000, sourceObservedAt: '2026-01-10T00:00:00Z' },
  ];
  const result = computeNeighborhoodStats(listings, { nowMs: now, includeKeys: ['zip:44113'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].key, '44113');
});

// --- getNeighborhoodStats --------------------------------------------

test('getNeighborhoodStats: returns single bucket for key', () => {
  const now = Date.UTC(2026, 0, 15);
  const listings = [
    { id: 'L1', zip: '44113', openingBid: 100000, sourceObservedAt: '2026-01-10T00:00:00Z' },
    { id: 'L2', zip: '44114', openingBid: 200000, sourceObservedAt: '2026-01-10T00:00:00Z' },
  ];
  const result = getNeighborhoodStats('zip:44114', listings, { nowMs: now });
  assert.ok(result);
  assert.equal(result.key, '44114');
  assert.equal(result.count, 1);
});

test('getNeighborhoodStats: null when key has no listings', () => {
  const now = Date.UTC(2026, 0, 15);
  const listings = [
    { id: 'L1', zip: '44113', openingBid: 100000, sourceObservedAt: '2026-01-10T00:00:00Z' },
  ];
  const result = getNeighborhoodStats('zip:99999', listings, { nowMs: now });
  assert.equal(result, null);
});