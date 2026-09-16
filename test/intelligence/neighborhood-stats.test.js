'use strict';

// test/intelligence/neighborhood-stats.test.js
//
// Tests for server/intelligence/neighborhood-stats.js — the analytics
// layer that aggregates live listings into neighborhood statistics by
// ZIP code or by city+state. Pure-function tests: no DB, no Postgres.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  computeNeighborhoodStats,
  getNeighborhoodStats,
  unitKey
} = require('../../server/intelligence/neighborhood-stats');

const OBSERVED = '2026-09-01T12:00:00.000Z';
const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');

function listing(overrides = {}) {
  return {
    id: 'L1',
    source: 'treasury',
    state: 'TX',
    city: 'Bruni',
    zip: '78344',
    sqft: 1500,
    propType: 'Single Family',
    openingBid: 50000,
    mid: 100000,
    dealScore: 70,
    sourceObservedAt: OBSERVED,
    ...overrides
  };
}

// --- unitKey --------------------------------------------------------------

test('unitKey: returns zip bucket when zip is present', () => {
  const unit = unitKey({ zip: '12345', city: 'Houston', state: 'TX' });
  assert.equal(unit.kind, 'zip');
  assert.equal(unit.key, '12345');
});

test('unitKey: falls back to city+state when zip is missing', () => {
  const unit = unitKey({ zip: null, city: 'Houston', state: 'TX' });
  assert.equal(unit.kind, 'city');
  assert.equal(unit.key, 'TX::houston');
  assert.equal(unit.label, 'houston, TX');
});

test('unitKey: returns null when no usable location key exists', () => {
  assert.equal(unitKey({ zip: null, city: null, state: 'TX' }), null);
  assert.equal(unitKey({}), null);
});

test('unitKey: trims and normalizes zip to 5 digits', () => {
  assert.equal(unitKey({ zip: '12345-6789' }).key, '12345');
  assert.equal(unitKey({ zip: ' 12345 ' }).key, '12345');
});

// --- computeNeighborhoodStats --------------------------------------------

test('computeNeighborhoodStats: groups listings by zip and emits counts', () => {
  const pool = [
    listing({ id: 'A', zip: '11111' }),
    listing({ id: 'B', zip: '11111' }),
    listing({ id: 'C', zip: '22222' })
  ];
  const stats = computeNeighborhoodStats(pool, { nowMs: NOW_MS });
  const zip11111 = stats.find((s) => s.key === '11111');
  const zip22222 = stats.find((s) => s.key === '22222');
  assert.equal(zip11111.count, 2);
  assert.equal(zip22222.count, 1);
  assert.equal(stats.length, 2);
});

test('computeNeighborhoodStats: result is sorted by count desc, label asc', () => {
  const pool = [
    listing({ id: 'A', zip: '11111', openingBid: 100000 }),
    listing({ id: 'B', zip: '22222', openingBid: 100000 }),
    listing({ id: 'C', zip: '22222', openingBid: 100000 })
  ];
  const stats = computeNeighborhoodStats(pool, { nowMs: NOW_MS });
  // '22222' has 2 listings, '11111' has 1
  assert.equal(stats[0].key, '22222');
  assert.equal(stats[1].key, '11111');
});

test('computeNeighborhoodStats: medianOpeningBid + meanOpeningBid use only finite values', () => {
  const pool = [
    listing({ id: 'A', zip: '11111', openingBid: 50000 }),
    listing({ id: 'B', zip: '11111', openingBid: 70000 }),
    listing({ id: 'C', zip: '11111', openingBid: null, mid: null })
  ];
  const stats = computeNeighborhoodStats(pool, { nowMs: NOW_MS });
  const bucket = stats[0];
  assert.equal(bucket.medianOpeningBid, 60000);
  assert.equal(bucket.meanOpeningBid, 60000);
});

test('computeNeighborhoodStats: medianDiscount is 1 - openingBid/mid when both exist', () => {
  const pool = [
    listing({ id: 'A', zip: '11111', openingBid: 50000, mid: 100000 }), // 50% off
    listing({ id: 'B', zip: '11111', openingBid: 80000, mid: 100000 })  // 20% off
  ];
  const stats = computeNeighborhoodStats(pool, { nowMs: NOW_MS });
  assert.equal(stats[0].medianDiscount, 0.35);
});

test('computeNeighborhoodStats: missing mid or openingBid yields no discount contribution', () => {
  const pool = [
    listing({ id: 'A', zip: '11111', openingBid: 50000, mid: null }),
    listing({ id: 'B', zip: '11111', openingBid: null, mid: 100000 }),
    listing({ id: 'C', zip: '11111', openingBid: 50000, mid: 100000 })
  ];
  const stats = computeNeighborhoodStats(pool, { nowMs: NOW_MS });
  assert.equal(stats[0].medianDiscount, 0.5);
});

test('computeNeighborhoodStats: sources + propTypes tally correctly', () => {
  const pool = [
    listing({ id: 'A', zip: '11111', source: 'hud', propType: 'Single Family' }),
    listing({ id: 'B', zip: '11111', source: 'hud', propType: 'Single Family' }),
    listing({ id: 'C', zip: '11111', source: 'irs', propType: 'Land' })
  ];
  const stats = computeNeighborhoodStats(pool, { nowMs: NOW_MS });
  const bucket = stats[0];
  assert.deepEqual(bucket.sources, { hud: 2, irs: 1 });
  assert.deepEqual(bucket.propTypes, { 'Single Family': 2, Land: 1 });
});

test('computeNeighborhoodStats: city-fallback bucket when zip is missing', () => {
  const pool = [
    listing({ id: 'A', zip: null, city: 'Houston', state: 'TX' }),
    listing({ id: 'B', zip: null, city: 'Houston', state: 'TX' }),
    listing({ id: 'C', zip: null, city: 'Dallas', state: 'TX' })
  ];
  const stats = computeNeighborhoodStats(pool, { nowMs: NOW_MS });
  const houston = stats.find((s) => s.kind === 'city' && s.key === 'TX::houston');
  assert.ok(houston);
  assert.equal(houston.count, 2);
  assert.equal(houston.label, 'houston, TX');
});

test('computeNeighborhoodStats: stale listings (>maxAgeDays) are dropped', () => {
  const pool = [
    listing({ id: 'A', zip: '11111', sourceObservedAt: OBSERVED }),
    listing({ id: 'B', zip: '11111', sourceObservedAt: '2023-01-01T00:00:00.000Z' })
  ];
  const stats = computeNeighborhoodStats(pool, { maxAgeDays: 90, nowMs: NOW_MS });
  assert.equal(stats[0].count, 1);
});

test('computeNeighborhoodStats: includeKeys filters to a single bucket', () => {
  const pool = [
    listing({ id: 'A', zip: '11111' }),
    listing({ id: 'B', zip: '22222' }),
    listing({ id: 'C', zip: '33333' })
  ];
  const stats = computeNeighborhoodStats(pool, {
    nowMs: NOW_MS,
    includeKeys: ['zip:22222']
  });
  assert.equal(stats.length, 1);
  assert.equal(stats[0].key, '22222');
});

test('computeNeighborhoodStats: empty pool returns empty array', () => {
  const stats = computeNeighborhoodStats([], { nowMs: NOW_MS });
  assert.deepEqual(stats, []);
});

test('computeNeighborhoodStats: a non-array pool is treated as empty', () => {
  const stats = computeNeighborhoodStats(null, { nowMs: NOW_MS });
  assert.deepEqual(stats, []);
});

// --- getNeighborhoodStats -------------------------------------------------

test('getNeighborhoodStats: returns one bucket for a known zip', () => {
  const pool = [listing({ zip: '11111' }), listing({ zip: '11111' })];
  const bucket = getNeighborhoodStats('zip:11111', pool, { nowMs: NOW_MS });
  assert.ok(bucket);
  assert.equal(bucket.kind, 'zip');
  assert.equal(bucket.count, 2);
});

test('getNeighborhoodStats: returns null when no listings match the key', () => {
  const pool = [listing({ zip: '11111' })];
  const bucket = getNeighborhoodStats('zip:99999', pool, { nowMs: NOW_MS });
  assert.equal(bucket, null);
});