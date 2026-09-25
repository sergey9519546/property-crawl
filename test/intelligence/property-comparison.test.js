'use strict';

// test/intelligence/property-comparison.test.js
//
// Tests for server/intelligence/property-comparison.js — the engine
// behind the side-by-side listing comparison surface.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPropertyComparison,
  normalizeRow,
  compareDimension,
  MAX_LISTINGS
} = require('../../server/intelligence/property-comparison');

function listing(overrides = {}) {
  return {
    id: 'L1',
    source: 'treasury',
    state: 'TX',
    city: 'Bruni',
    zip: '78344',
    address: '112 N Ave E',
    sqft: 1500,
    year: 1998,
    lotSize: null,
    propType: 'Single Family',
    openingBid: 50000,
    mid: 100000,
    estLow: 90000,
    estHigh: 110000,
    dealScore: 70,
    occupancy: 'Vacant',
    status: 'Active',
    ...overrides
  };
}

// --- normalizeRow --------------------------------------------------------

test('normalizeRow: returns null for null/undefined input', () => {
  assert.equal(normalizeRow(null), null);
  assert.equal(normalizeRow(undefined), null);
});

test('normalizeRow: extracts all numeric fields, null when missing', () => {
  const row = normalizeRow(listing({ sqft: 1500, openingBid: 50000, year: 1998 }));
  assert.equal(row.sqft, 1500);
  assert.equal(row.openingBid, 50000);
  assert.equal(row.year, 1998);
  assert.equal(row.lotSize, null);
});

test('normalizeRow: extracts string fields trimmed', () => {
  const row = normalizeRow(listing({ state: 'TX', city: '  Bruni  ', zip: ' 78344 ' }));
  assert.equal(row.state, 'TX');
  assert.equal(row.city, 'Bruni');
  assert.equal(row.zip, '78344');
});

test('normalizeRow: discount is computed when both openingBid and mid exist', () => {
  const row = normalizeRow(listing({ openingBid: 50000, mid: 100000 }));
  assert.equal(row.discount, 0.5);
  assert.equal(normalizeRow(listing({ openingBid: 50000, mid: null })).discount, null);
  assert.equal(normalizeRow(listing({ openingBid: null, mid: 100000 })).discount, null);
});

// --- buildPropertyComparison ----------------------------------------------

test('buildPropertyComparison: too-few listings returns reason=listings_too_few', () => {
  const result = buildPropertyComparison([listing()]);
  assert.equal(result.reason, 'listings_too_few');
  assert.equal(result.count, 1);
});

test('buildPropertyComparison: too-many listings returns reason=listings_too_many', () => {
  const result = buildPropertyComparison([listing(), listing({ id: 'L2' }), listing({ id: 'L3' }), listing({ id: 'L4' }), listing({ id: 'L5' })]);
  assert.equal(result.reason, 'listings_too_many');
});

test('buildPropertyComparison: a non-array input is treated as empty', () => {
  const result = buildPropertyComparison(null);
  assert.equal(result.reason, 'listings_too_few');
  assert.equal(result.count, 0);
});

test('buildPropertyComparison: returns targetId + count + normalized rows', () => {
  const target = listing({ id: 'A' });
  const other = listing({ id: 'B', sqft: 2000 });
  const result = buildPropertyComparison([target, other]);
  assert.equal(result.targetId, 'A');
  assert.equal(result.count, 2);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].id, 'A');
  assert.equal(result.rows[1].id, 'B');
  assert.equal(result.reason, null);
});

test('buildPropertyComparison: deltas show the signed difference vs target for each numeric field', () => {
  const target = listing({ id: 'A', sqft: 1500, openingBid: 50000 });
  const other = listing({ id: 'B', sqft: 1700, openingBid: 60000 });
  const result = buildPropertyComparison([target, other]);
  assert.equal(result.deltas.sqft.values[0], 1500);
  assert.equal(result.deltas.sqft.values[1], 1700);
  assert.deepEqual(result.deltas.sqft.deltas, [200]); // 1700 - 1500
  assert.equal(result.deltas.openingBid.values[0], 50000);
  assert.equal(result.deltas.openingBid.values[1], 60000);
  assert.deepEqual(result.deltas.openingBid.deltas, [10000]);
});

test('buildPropertyComparison: deltas are null when target has no value for the field', () => {
  const target = listing({ id: 'A', sqft: null });
  const other = listing({ id: 'B', sqft: 1500 });
  const result = buildPropertyComparison([target, other]);
  assert.deepEqual(result.deltas.sqft.deltas, [null], 'no signed delta without a target value');
});

test('buildPropertyComparison: deltas are null when the comparison row has no value', () => {
  const target = listing({ id: 'A', sqft: 1500 });
  const other = listing({ id: 'B', sqft: null });
  const result = buildPropertyComparison([target, other]);
  assert.deepEqual(result.deltas.sqft.deltas, [null]);
});

test('buildPropertyComparison: winnerByField picks the cheapest openingBid', () => {
  const target = listing({ id: 'A', openingBid: 60000 });
  const cheaper = listing({ id: 'B', openingBid: 50000 });
  const expensive = listing({ id: 'C', openingBid: 80000 });
  const result = buildPropertyComparison([target, cheaper, expensive]);
  assert.equal(result.winnerByField.openingBid, 'B');
});

test('buildPropertyComparison: winnerByField picks the largest sqft', () => {
  const a = listing({ id: 'A', sqft: 1500 });
  const b = listing({ id: 'B', sqft: 2400 });
  const c = listing({ id: 'C', sqft: 1800 });
  const result = buildPropertyComparison([a, b, c]);
  assert.equal(result.winnerByField.sqft, 'B');
});

test('buildPropertyComparison: winnerByField picks the highest dealScore', () => {
  const a = listing({ id: 'A', dealScore: 60 });
  const b = listing({ id: 'B', dealScore: 90 });
  const c = listing({ id: 'C', dealScore: 75 });
  const result = buildPropertyComparison([a, b, c]);
  assert.equal(result.winnerByField.dealScore, 'B');
});

test('buildPropertyComparison: winnerByField is null when no row has a finite value', () => {
  const a = listing({ id: 'A', sqft: null });
  const b = listing({ id: 'B', sqft: null });
  const result = buildPropertyComparison([a, b]);
  assert.equal(result.winnerByField.sqft, null);
});

test('buildPropertyComparison: winnerByField.discount picks the highest discount', () => {
  // discount = 1 - openingBid/mid
  const a = listing({ id: 'A', openingBid: 50000, mid: 100000 }); // 50% off
  const b = listing({ id: 'B', openingBid: 80000, mid: 100000 }); // 20% off
  const c = listing({ id: 'C', openingBid: null, mid: 100000 }); // 0% off (no openingBid)
  const result = buildPropertyComparison([a, b, c]);
  assert.equal(result.winnerByField.discount, 'A');
});

test('buildPropertyComparison: every deltas entry has the right array length', () => {
  const target = listing({ id: 'A' });
  const list = [listing({ id: 'B' }), listing({ id: 'C' }), listing({ id: 'D' })];
  const result = buildPropertyComparison([target, ...list]);
  // 4 rows total, target is at index 0, so deltas arrays should have 3 entries
  for (const field of Object.keys(result.deltas)) {
    assert.equal(result.deltas[field].values.length, 4, `${field} values should have 4 entries`);
    assert.equal(result.deltas[field].deltas.length, 3, `${field} deltas should have 3 entries`);
  }
});

test('buildPropertyComparison: 4 listings is at the upper bound', () => {
  const list = [listing({ id: 'A' }), listing({ id: 'B' }), listing({ id: 'C' }), listing({ id: 'D' })];
  const result = buildPropertyComparison(list);
  assert.equal(result.count, 4);
  assert.equal(result.reason, null);
});

test('MAX_LISTINGS is 4 (the documented upper bound)', () => {
  assert.equal(MAX_LISTINGS, 4);
});

// --- compareDimension ----------------------------------------------------

test('compareDimension: lower direction picks the lowest finite value', () => {
  const { values, bestIndex } = compareDimension(
    [{ openingBid: 100000 }, { openingBid: 50000 }, { openingBid: 80000 }],
    'openingBid',
    'lower'
  );
  assert.deepEqual(values, [100000, 50000, 80000]);
  assert.equal(bestIndex, 1);
});

test('compareDimension: higher direction picks the highest finite value', () => {
  const { bestIndex } = compareDimension(
    [{ sqft: 1500 }, { sqft: 2400 }, { sqft: 1800 }],
    'sqft',
    'higher'
  );
  assert.equal(bestIndex, 1);
});

test('compareDimension: skips null/undefined values', () => {
  const { bestIndex } = compareDimension(
    [{ sqft: null }, { sqft: 2400 }, { sqft: undefined }],
    'sqft',
    'higher'
  );
  assert.equal(bestIndex, 1);
});

test('compareDimension: returns bestIndex=-1 when every value is missing', () => {
  const { bestIndex } = compareDimension(
    [{ sqft: null }, { sqft: undefined }],
    'sqft',
    'higher'
  );
  assert.equal(bestIndex, -1);
});