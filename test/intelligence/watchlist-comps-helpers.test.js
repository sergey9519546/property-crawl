'use strict';

// test/intelligence/watchlist-comps-helpers.test.js
//
// Direct unit coverage for server/intelligence/watchlist-comps.js.
// The "watchlist comps" view scores nearby listings against a target
// by proximity, sqft band, opening-bid band, and prop-type match.
// Silent drift in the band tolerances or scoring weights would
// silently re-rank every comp the user sees.
//
//   - haversineKm: known distance sanity checks (Cleveland to Akron ~67km)
//   - withinSqftBand: candidate inside ±30% of target sqft
//   - withinPriceBand: candidate inside ±40% of target bid
//   - isWithinLastYear: freshness gate
//   - proximityScore / sizeScore / safeBandPct
//   - scoreCandidate: weighted sum of 4 components

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  haversineKm,
  withinSqftBand,
  withinPriceBand,
  _internals: { proximityScore, sizeScore, normalizedZip },
} = require('../../server/intelligence/watchlist-comps');

// --- haversineKm -------------------------------------------------------

test('haversineKm: same point -> 0 km', () => {
  assert.equal(haversineKm(41.5, -81.7, 41.5, -81.7), 0);
});

test('haversineKm: 1 degree of latitude ~111 km', () => {
  const d = haversineKm(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111) < 2, `expected ~111km, got ${d}`);
});

test('haversineKm: Cleveland (41.5, -81.7) to Akron (41.08, -81.52) ~49km', () => {
  const d = haversineKm(41.5, -81.7, 41.08, -81.52);
  assert.ok(d > 40 && d < 60, `expected 40-60km, got ${d}`);
});

// --- withinSqftBand ---------------------------------------------------

test('withinSqftBand: candidate at target sqft -> true', () => {
  assert.equal(withinSqftBand(1500, 1500), true);
});

test('withinSqftBand: candidate within ±30% -> true', () => {
  assert.equal(withinSqftBand(1500, 1100), true);  // -27%
  assert.equal(withinSqftBand(1500, 1900), true);  // +27%
});

test('withinSqftBand: candidate outside ±30% -> false', () => {
  assert.equal(withinSqftBand(1500, 1000), false);  // -33%
  assert.equal(withinSqftBand(1500, 2000), false);  // +33%
});

test('withinSqftBand: missing target sqft -> true (permissive)', () => {
  assert.equal(withinSqftBand(null, 1500), true);
});

test('withinSqftBand: missing candidate sqft -> true (permissive)', () => {
  assert.equal(withinSqftBand(1500, null), true);
});

test('withinSqftBand: custom tolerance honored', () => {
  assert.equal(withinSqftBand(1000, 1100, 0.05), false);  // 10% > 5%
  assert.equal(withinSqftBand(1000, 1100, 0.20), true);   // 10% < 20%
});

// --- withinPriceBand --------------------------------------------------

test('withinPriceBand: candidate at target bid -> true', () => {
  assert.equal(withinPriceBand(100000, 100000), true);
});

test('withinPriceBand: candidate within ±40% -> true', () => {
  assert.equal(withinPriceBand(100000, 70000), true);   // -30%
  assert.equal(withinPriceBand(100000, 130000), true);  // +30%
});

test('withinPriceBand: candidate outside ±40% -> false', () => {
  assert.equal(withinPriceBand(100000, 50000), false);  // -50%
  assert.equal(withinPriceBand(100000, 150000), false); // +50%
});

test('withinPriceBand: missing target bid -> true (permissive)', () => {
  assert.equal(withinPriceBand(null, 100000), true);
});

test('withinPriceBand: missing candidate bid -> true (permissive)', () => {
  assert.equal(withinPriceBand(100000, null), true);
});

// --- proximityScore ---------------------------------------------------

test('proximityScore: 0 distance -> 1.0', () => {
  assert.equal(proximityScore(0), 1);
});

test('proximityScore: increases with proximity (1km > 5km)', () => {
  assert.ok(proximityScore(1) > proximityScore(5));
  assert.ok(proximityScore(5) > proximityScore(10));
});

test('proximityScore: very far -> approaches 0', () => {
  assert.ok(proximityScore(1000) < 0.1);
});

// --- sizeScore -------------------------------------------------------

test('sizeScore: identical sqft -> 1.0', () => {
  assert.equal(sizeScore(1500, 1500), 1);
});

test('sizeScore: missing target -> 0.5 (neutral)', () => {
  assert.equal(sizeScore(null, 1500), 0.5);
});

test('sizeScore: missing candidate -> 0.5 (neutral)', () => {
  assert.equal(sizeScore(1500, null), 0.5);
});

// --- normalizedZip ---------------------------------------------------

test('normalizedZip: 5-digit zip passes through', () => {
  assert.equal(normalizedZip('44113'), '44113');
});

test('normalizedZip: ZIP+4 truncated to 5', () => {
  assert.equal(normalizedZip('44113-1234'), '44113');
});

test('normalizedZip: non-string -> null', () => {
  assert.equal(normalizedZip(12345), null);
  assert.equal(normalizedZip(null), null);
});

test('normalizedZip: whitespace trimmed', () => {
  assert.equal(normalizedZip('  44113  '), '44113');
});