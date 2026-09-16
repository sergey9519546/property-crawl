'use strict';

// test/intelligence/watchlist-comps.test.js
//
// Tests for the watchlist comps engine at server/intelligence/watchlist-comps.js.
// This module is the analytics layer behind GET /api/watchlist/:listingId/comps:
// given a saved listing, return the most comparable active listings on the
// platform (similar size + price band + proximity). The function is pure:
// the test pool is in-memory, no DB required.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  findWatchlistComps,
  haversineKm,
  withinSqftBand,
  withinPriceBand,
  median
} = require('../../server/intelligence/watchlist-comps');

const OBSERVED = '2026-09-01T12:00:00.000Z';
const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');

function listing(overrides = {}) {
  return {
    id: 'LIST-001',
    source: 'treasury',
    state: 'TX',
    city: 'Bruni',
    zip: '78344',
    address: '112 North Avenue E, Bruni, TX 78344',
    sqft: 1500,
    year: 1998,
    propType: 'Single Family',
    openingBid: 50000,
    estLow: 90000,
    estHigh: 110000,
    mid: 100000,
    dealScore: 78,
    lat: 27.45,
    lng: -98.88,
    sourceObservedAt: OBSERVED,
    ...overrides
  };
}

// --- pure helpers ----------------------------------------------------------

test('haversineKm: returns 0 for the same point', () => {
  assert.equal(haversineKm(40.7128, -74.0060, 40.7128, -74.0060), 0);
});

test('haversineKm: New York to Los Angeles is roughly 3935 km', () => {
  const km = haversineKm(40.7128, -74.0060, 34.0522, -118.2437);
  assert.ok(Math.abs(km - 3935) < 50, `expected ~3935km, got ${km.toFixed(0)}km`);
});

test('withinSqftBand: target ±30% by default', () => {
  assert.equal(withinSqftBand(1000, 1200), true, '1200 within ±30% of 1000');
  assert.equal(withinSqftBand(1000, 1400), false, '1400 outside ±30% of 1000');
});

test('withinSqftBand: missing sqft on either side does not block (engine drops the band)', () => {
  assert.equal(withinSqftBand(null, 5000), true);
  assert.equal(withinSqftBand(1000, null), true);
});

test('withinPriceBand: target ±40% by default', () => {
  assert.equal(withinPriceBand(100000, 130000), true);
  assert.equal(withinPriceBand(100000, 200000), false);
});

test('median: handles empty + even + odd lists', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
});

// --- core: findWatchlistComps ---------------------------------------------

test('findWatchlistComps: returns the target, comps, and stats in a single shape', () => {
  const target = listing({ id: 'TARGET' });
  const pool = [
    target,
    listing({ id: 'A', lat: 27.455, lng: -98.881, sqft: 1480, openingBid: 52000 }),
    listing({ id: 'B', lat: 27.46, lng: -98.89, sqft: 1620, openingBid: 48000 }),
    listing({ id: 'OUT', state: 'CA', sqft: 1500, openingBid: 50000, lat: 34.05, lng: -118.24, zip: '90001' })
  ];
  const result = findWatchlistComps(target, pool, { nowMs: NOW_MS });
  assert.equal(result.target.id, 'TARGET');
  assert.ok(result.comps.length >= 1, 'expected at least one in-state comp');
  assert.equal(result.stats.count, result.comps.length);
  assert.ok(typeof result.stats.medianOpeningBid === 'number');
  assert.ok(result.comps.every((c) => c.listing.state === 'TX'), 'all comps are in-state');
  // The CA listing must never surface.
  assert.ok(!result.comps.find((c) => c.listing.id === 'OUT'));
});

test('findWatchlistComps: the target itself never appears in the comp list', () => {
  const target = listing({ id: 'SELF' });
  const pool = [target, listing({ id: 'X', lat: 27.46, lng: -98.88, sqft: 1500, openingBid: 50000 })];
  const result = findWatchlistComps(target, pool, { nowMs: NOW_MS });
  assert.equal(result.comps.find((c) => c.listing.id === 'SELF'), undefined);
});

test('findWatchlistComps: candidates from a different state are excluded', () => {
  const target = listing({ id: 'TX-T', state: 'TX' });
  const sameState = listing({ id: 'OK-C', state: 'OK', lat: 27.46, lng: -98.88, sqft: 1500, openingBid: 50000 });
  const result = findWatchlistComps(target, [sameState], { nowMs: NOW_MS });
  assert.equal(result.comps.length, 0);
});

test('findWatchlistComps: candidates outside the radius are excluded when geo is available', () => {
  const target = listing({ id: 'T', lat: 27.45, lng: -98.88 });
  const near = listing({ id: 'NEAR', lat: 27.455, lng: -98.881, sqft: 1500, openingBid: 50000 });
  const far = listing({ id: 'FAR', lat: 30.27, lng: -97.74, sqft: 1500, openingBid: 50000 }); // Austin
  const result = findWatchlistComps(target, [near, far], { radiusKm: 8, nowMs: NOW_MS });
  assert.ok(result.comps.find((c) => c.listing.id === 'NEAR'));
  assert.equal(result.comps.find((c) => c.listing.id === 'FAR'), undefined);
});

test('findWatchlistComps: falls back to zip-code match when neither side has coords', () => {
  // Different cities ensure the geo gate only passes for the candidate
  // whose zip matches the target. The city-fallback path would also let
  // in a same-city candidate; we want to isolate the zip branch.
  const target = listing({ id: 'T', lat: null, lng: null, zip: '12345', city: 'Bruni' });
  const sameZip = listing({ id: 'SAME', lat: null, lng: null, zip: '12345', sqft: 1500, openingBid: 50000, city: 'Houston' });
  const otherZip = listing({ id: 'OTHER', lat: null, lng: null, zip: '99999', sqft: 1500, openingBid: 50000, city: 'Dallas' });
  const result = findWatchlistComps(target, [sameZip, otherZip], { nowMs: NOW_MS });
  assert.equal(result.comps.length, 1);
  assert.equal(result.comps[0].listing.id, 'SAME');
});

test('findWatchlistComps: returns reason=target_geocode_missing when target has no geo and no zip and no city match', () => {
  // When target has no coords AND no zip, the only way to pass the geo
  // gate is exact city-name match. With mismatched cities, the engine
  // reports target_geocode_missing rather than fabricating proximity.
  const target = listing({ id: 'T', lat: null, lng: null, zip: null, city: 'Bruni' });
  const pool = [listing({ id: 'P', lat: 27.5, lng: -98.9, sqft: 1500, openingBid: 50000, city: 'Houston' })];
  const result = findWatchlistComps(target, pool, { nowMs: NOW_MS });
  assert.equal(result.comps.length, 0);
  assert.equal(result.reason, 'target_geocode_missing');
});

test('findWatchlistComps: stale candidates (>maxAgeDays old) are filtered out', () => {
  const target = listing({ id: 'T' });
  const stale = listing({ id: 'STALE', sourceObservedAt: '2023-01-01T00:00:00.000Z', lat: 27.46, lng: -98.88, sqft: 1500, openingBid: 50000 });
  const fresh = listing({ id: 'FRESH', sourceObservedAt: OBSERVED, lat: 27.46, lng: -98.88, sqft: 1500, openingBid: 50000 });
  const result = findWatchlistComps(target, [stale, fresh], { maxAgeDays: 90, nowMs: NOW_MS });
  assert.equal(result.comps.length, 1);
  assert.equal(result.comps[0].listing.id, 'FRESH');
});

test('findWatchlistComps: missing sourceObservedAt is treated as stale (excluded)', () => {
  // The watchlist comp set should never include records with no observed
  // timestamp — those are ungrounded and could be cached/snapshot listings.
  const target = listing({ id: 'T' });
  const noObserved = listing({ id: 'NONE', sourceObservedAt: null, lat: 27.46, lng: -98.88, sqft: 1500, openingBid: 50000 });
  const result = findWatchlistComps(target, [noObserved], { nowMs: NOW_MS });
  assert.equal(result.comps.length, 0);
});

test('findWatchlistComps: candidates outside the sqft band are excluded', () => {
  const target = listing({ id: 'T', sqft: 1500 });
  const inBand = listing({ id: 'IN', lat: 27.46, lng: -98.88, sqft: 1700, openingBid: 50000 });
  const outBand = listing({ id: 'OUT', lat: 27.46, lng: -98.88, sqft: 5000, openingBid: 50000 });
  const result = findWatchlistComps(target, [inBand, outBand], { nowMs: NOW_MS });
  assert.equal(result.comps.length, 1);
  assert.equal(result.comps[0].listing.id, 'IN');
});

test('findWatchlistComps: candidates outside the ±40% price band are excluded', () => {
  const target = listing({ id: 'T', openingBid: 100000 });
  const inBand = listing({ id: 'IN', lat: 27.46, lng: -98.88, sqft: 1500, openingBid: 120000 });
  const outBand = listing({ id: 'OUT', lat: 27.46, lng: -98.88, sqft: 1500, openingBid: 500000 });
  const result = findWatchlistComps(target, [inBand, outBand], { nowMs: NOW_MS });
  assert.equal(result.comps.length, 1);
  assert.equal(result.comps[0].listing.id, 'IN');
});

test('findWatchlistComps: candidates with the same propType rank above different-type', () => {
  const target = listing({ id: 'T', propType: 'Single Family' });
  const sameType = listing({ id: 'SAME', lat: 27.46, lng: -98.88, sqft: 1500, openingBid: 50000, propType: 'Single Family' });
  const otherType = listing({ id: 'OTHER', lat: 27.46, lng: -98.88, sqft: 1500, openingBid: 50000, propType: 'Commercial' });
  const result = findWatchlistComps(target, [sameType, otherType], { nowMs: NOW_MS });
  assert.equal(result.comps[0].listing.id, 'SAME');
});

test('findWatchlistComps: closer candidates outrank farther ones when other signals tie', () => {
  const target = listing({ id: 'T', lat: 27.45, lng: -98.88 });
  const closer = listing({ id: 'C1', lat: 27.452, lng: -98.881, sqft: 1500, openingBid: 50000 });
  const farther = listing({ id: 'C2', lat: 27.48, lng: -98.91, sqft: 1500, openingBid: 50000 });
  const result = findWatchlistComps(target, [farther, closer], { nowMs: NOW_MS });
  assert.equal(result.comps[0].listing.id, 'C1');
  assert.ok(result.comps[0].distanceKm < result.comps[1].distanceKm);
});

test('findWatchlistComps: limit caps the returned comp count', () => {
  const target = listing({ id: 'T' });
  const pool = Array.from({ length: 12 }, (_, i) => listing({
    id: `C${i}`,
    lat: 27.45 + i * 0.001,
    lng: -98.88 + i * 0.001,
    sqft: 1500 + i * 5,
    openingBid: 50000 + i * 100
  }));
  const result = findWatchlistComps(target, pool, { limit: 5, nowMs: NOW_MS });
  assert.equal(result.comps.length, 5);
});

test('findWatchlistComps: stats.medianOpeningBid + medianSqft are computed from the comp set', () => {
  const target = listing({ id: 'T', sqft: 1500, openingBid: 100000 });
  const pool = [
    listing({ id: 'A', lat: 27.46, lng: -98.88, sqft: 1500, openingBid: 90000 }),
    listing({ id: 'B', lat: 27.47, lng: -98.88, sqft: 1700, openingBid: 110000 }),
    listing({ id: 'C', lat: 27.48, lng: -98.88, sqft: 1900, openingBid: 130000 })
  ];
  const result = findWatchlistComps(target, pool, { nowMs: NOW_MS });
  assert.equal(result.stats.count, 3);
  assert.equal(result.stats.medianOpeningBid, 110000);
  assert.equal(result.stats.medianSqft, 1700);
  assert.deepEqual(Object.keys(result.stats.sources).sort(), ['treasury']);
});

test('findWatchlistComps: stats.sources aggregates per-source counts', () => {
  const target = listing({ id: 'T' });
  const pool = [
    listing({ id: 'A', source: 'hud', lat: 27.46, lng: -98.88, sqft: 1500, openingBid: 50000 }),
    listing({ id: 'B', source: 'hud', lat: 27.47, lng: -98.88, sqft: 1500, openingBid: 50000 }),
    listing({ id: 'C', source: 'irs', lat: 27.48, lng: -98.88, sqft: 1500, openingBid: 50000 })
  ];
  const result = findWatchlistComps(target, pool, { nowMs: NOW_MS });
  assert.equal(result.stats.sources.hud, 2);
  assert.equal(result.stats.sources.irs, 1);
});

test('findWatchlistComps: missing target returns reason=target_missing', () => {
  const result = findWatchlistComps(null, [listing({ id: 'X' })], { nowMs: NOW_MS });
  assert.equal(result.reason, 'target_missing');
  assert.deepEqual(result.comps, []);
  assert.equal(result.target, null);
});

test('findWatchlistComps: a non-array pool is treated as empty', () => {
  const target = listing({ id: 'T' });
  const result = findWatchlistComps(target, null, { nowMs: NOW_MS });
  assert.equal(result.comps.length, 0);
  assert.equal(result.stats.count, 0);
});

test('findWatchlistComps: scoring is bounded in [0, 1] for every candidate', () => {
  const target = listing({ id: 'T', sqft: 1500, openingBid: 50000, propType: 'Single Family' });
  const pool = [
    listing({ id: 'NEAR-PERFECT', lat: 27.451, lng: -98.881, sqft: 1500, openingBid: 50000, propType: 'Single Family' }),
    listing({ id: 'FAR-OTHER', lat: 30.0, lng: -97.0, sqft: 5000, openingBid: 500000, propType: 'Commercial' })
  ];
  const result = findWatchlistComps(target, pool, { radiusKm: 8, nowMs: NOW_MS });
  for (const c of result.comps) {
    assert.ok(c.score >= 0 && c.score <= 1, `score out of bounds: ${c.score}`);
  }
});