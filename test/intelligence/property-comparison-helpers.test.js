'use strict';

// test/intelligence/property-comparison-helpers.test.js
//
// Direct unit coverage for server/intelligence/property-comparison.js.
// The "Compare" affordance in the workbench renders this output: 2-4
// rows side by side, per-field deltas vs. the target, and a "winner"
// pick per dimension. Silent drift in the direction map, the delta
// computation, or the discount normalization would silently change which
// row gets starred without changing the underlying numbers.
//
//   - MAX_LISTINGS cap (4) is published and enforced
//   - normalizeRow: numeric and string field projection
//   - finiteOrNull: null / undefined / empty / NaN coercion contract
//   - lowerBetter / higherBetter: tiebreak by first occurrence
//   - compareDimension: deltas pinned to values.slice(1).length, null
//     when target or comparison row is missing
//   - buildPropertyComparison: schema, targetId, count, reason codes

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPropertyComparison,
  normalizeRow,
  compareDimension,
  MAX_LISTINGS,
  _internals: { discount, finiteOrNull, lowerBetter, higherBetter },
} = require('../../server/intelligence/property-comparison');

// --- MAX_LISTINGS -------------------------------------------------------

test('MAX_LISTINGS: pinned at 4', () => {
  assert.equal(MAX_LISTINGS, 4);
});

// --- finiteOrNull -------------------------------------------------------

test('finiteOrNull: null / undefined / empty string -> null', () => {
  assert.equal(finiteOrNull(null), null);
  assert.equal(finiteOrNull(undefined), null);
  assert.equal(finiteOrNull(''), null);
});

test('finiteOrNull: numeric coercion + finite check', () => {
  assert.equal(finiteOrNull(42), 42);
  assert.equal(finiteOrNull('42'), 42);
  assert.equal(finiteOrNull('0'), 0);
  assert.equal(finiteOrNull(NaN), null);
  assert.equal(finiteOrNull(Infinity), null);
  assert.equal(finiteOrNull('not a number'), null);
});

// --- lowerBetter / higherBetter -----------------------------------------

test('lowerBetter: returns index of smallest finite value, ignoring non-finite', () => {
  assert.equal(lowerBetter([3, 1, 2]), 1);
  assert.equal(lowerBetter([Infinity, 1, 2]), 1);
  assert.equal(lowerBetter([NaN, NaN, NaN]), -1);
  assert.equal(lowerBetter([]), -1);
});

test('higherBetter: returns index of largest finite value, ignoring non-finite', () => {
  assert.equal(higherBetter([3, 1, 2]), 0);
  assert.equal(higherBetter([-Infinity, 1, 2]), 2);
  assert.equal(higherBetter([NaN, NaN, NaN]), -1);
  assert.equal(higherBetter([]), -1);
});

test('lowerBetter / higherBetter: first-occurrence wins on ties', () => {
  assert.equal(lowerBetter([5, 5, 5]), 0);
  assert.equal(higherBetter([5, 5, 5]), 0);
});

// --- discount ----------------------------------------------------------

test('discount: positive when bid is below mid', () => {
  assert.ok(Math.abs(discount({ openingBid: 100000, mid: 200000 }) - 0.5) < 1e-9);
});

test('discount: zero when bid equals mid', () => {
  assert.equal(discount({ openingBid: 100000, mid: 100000 }), 0);
});

test('discount: null when either value missing or non-positive', () => {
  assert.equal(discount({ openingBid: 100000 }), null);
  assert.equal(discount({ mid: 100000 }), null);
  assert.equal(discount({ openingBid: 0, mid: 100000 }), null);
  assert.equal(discount({ openingBid: 100000, mid: 0 }), null);
});

// --- normalizeRow ------------------------------------------------------

test('normalizeRow: numeric fields coerced through finiteOrNull', () => {
  const row = normalizeRow({
    id: 'L1', sqft: '1500', year: 1990, openingBid: 100000,
    mid: 200000, estLow: '180000', estHigh: '220000',
    dealScore: '85', lotSize: '0.5',
  });
  assert.equal(row.id, 'L1');
  assert.equal(row.sqft, 1500);
  assert.equal(row.year, 1990);
  assert.equal(row.openingBid, 100000);
  assert.equal(row.mid, 200000);
  assert.equal(row.estLow, 180000);
  assert.equal(row.estHigh, 220000);
  assert.equal(row.dealScore, 85);
  assert.equal(row.lotSize, 0.5);
  assert.ok(Math.abs(row.discount - 0.5) < 1e-9);
});

test('normalizeRow: string fields are trimmed, empty -> null', () => {
  const row = normalizeRow({ id: 'L1', city: '  Cleveland  ', zip: '', state: 'OH' });
  assert.equal(row.city, 'Cleveland');
  assert.equal(row.zip, null);
  assert.equal(row.state, 'OH');
});

test('normalizeRow: returns null for non-objects', () => {
  assert.equal(normalizeRow(null), null);
  assert.equal(normalizeRow(undefined), null);
  assert.equal(normalizeRow('L1'), null);
});

// --- compareDimension --------------------------------------------------

test('compareDimension: "higher" direction picks largest finite value', () => {
  const result = compareDimension([{ sqft: 1500 }, { sqft: 1800 }, { sqft: 1200 }], 'sqft', 'higher');
  assert.equal(result.bestIndex, 1);
  assert.deepEqual(result.values, [1500, 1800, 1200]);
  assert.deepEqual(result.deltas, [300, -300]);
});

test('compareDimension: "lower" direction picks smallest finite value', () => {
  const result = compareDimension([{ openingBid: 100000 }, { openingBid: 50000 }, { openingBid: 75000 }], 'openingBid', 'lower');
  assert.equal(result.bestIndex, 1);
  assert.deepEqual(result.deltas, [-50000, -25000]);
});

test('compareDimension: target missing -> all deltas null', () => {
  const result = compareDimension([{ sqft: null }, { sqft: 1800 }], 'sqft', 'higher');
  assert.deepEqual(result.deltas, [null]);
  assert.equal(result.bestIndex, 1);
});

test('compareDimension: comparison row missing -> null delta', () => {
  const result = compareDimension([{ sqft: 1500 }, { sqft: null }], 'sqft', 'higher');
  assert.deepEqual(result.deltas, [null]);
});

// --- buildPropertyComparison: reason codes ----------------------------

test('buildPropertyComparison: empty / single listing -> reason "listings_too_few"', () => {
  assert.equal(buildPropertyComparison([]).reason, 'listings_too_few');
  assert.equal(buildPropertyComparison(null).reason, 'listings_too_few');
  assert.equal(buildPropertyComparison([{ id: 'L1' }]).reason, 'listings_too_few');
});

test('buildPropertyComparison: 5 listings -> reason "listings_too_many"', () => {
  const listings = Array.from({ length: 5 }, (_, i) => ({ id: `L${i}` }));
  const result = buildPropertyComparison(listings);
  assert.equal(result.reason, 'listings_too_many');
  assert.equal(result.targetId, 'L0');
  assert.equal(result.count, 5);
  assert.deepEqual(result.rows, []);
});

test('buildPropertyComparison: 2-4 listings -> schema + rows + deltas', () => {
  const listings = [
    { id: 'L1', sqft: 1500, openingBid: 100000, mid: 200000, city: 'Cleveland', state: 'OH', zip: '44113' },
    { id: 'L2', sqft: 1800, openingBid: 80000, mid: 220000, city: 'Akron', state: 'OH', zip: '44308' },
    { id: 'L3', sqft: 1200, openingBid: 50000, mid: 150000, city: 'Toledo', state: 'OH', zip: '43604' },
  ];
  const result = buildPropertyComparison(listings);
  assert.equal(result.schema, 'property-crawl.compare/v1');
  assert.equal(result.targetId, 'L1');
  assert.equal(result.count, 3);
  assert.equal(result.reason, null);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].city, 'Cleveland');
  assert.ok(result.deltas.sqft);
  assert.ok(result.deltas.openingBid);
  assert.ok(result.deltas.discount);
});

test('buildPropertyComparison: winner picks the highest sqft and lowest openingBid', () => {
  const listings = [
    { id: 'L1', sqft: 1500, openingBid: 100000, mid: 200000 },
    { id: 'L2', sqft: 1800, openingBid: 80000, mid: 220000 },
    { id: 'L3', sqft: 1200, openingBid: 50000, mid: 150000 },
  ];
  const result = buildPropertyComparison(listings);
  assert.equal(result.winnerByField.sqft, 'L2');
  assert.equal(result.winnerByField.openingBid, 'L3');
});

test('buildPropertyComparison: discount delta is computed from row.discount, not stored fields', () => {
  const listings = [
    { id: 'L1', openingBid: 100000, mid: 200000 },  // 0.5
    { id: 'L2', openingBid: 50000, mid: 200000 },   // 0.75
  ];
  const result = buildPropertyComparison(listings);
  assert.equal(result.winnerByField.discount, 'L2');
  assert.equal(Math.round(result.deltas.discount.deltas[0] * 1000) / 1000, 0.25);
});

test('buildPropertyComparison: missing mid -> discount unavailable, bestIndex -1', () => {
  const listings = [
    { id: 'L1', openingBid: 100000 },
    { id: 'L2', openingBid: 50000 },
  ];
  const result = buildPropertyComparison(listings);
  assert.deepEqual(result.deltas.discount.values, [null, null]);
  assert.equal(result.deltas.discount.bestIndex, -1);
  assert.equal(result.winnerByField.discount, null);
});

test('buildPropertyComparison: targetId is null when target lacks id', () => {
  const result = buildPropertyComparison([{ sqft: 1000 }, { sqft: 2000 }]);
  assert.equal(result.targetId, null);
  assert.equal(result.winnerByField.sqft, null);
});