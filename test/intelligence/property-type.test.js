'use strict';

// test/intelligence/property-type.test.js
//
// Publishers do not agree on how to say "we don't know". civilview writes the
// literal string "Unknown"; a listing whose propType is absent became the
// lowercase placeholder "unknown". Both engines bucketed propType with a bare
// `propTypes[rawValue] = ...`, so the same fact split into two buckets:
//
//   propTypes: { "Unknown": 4, "unknown": 37 }
//
// Live against the real store, /api/auction-calendar and /api/neighborhoods
// both published that pair. It is one concept rendered twice, and it is enough
// to break a JSON parser that folds case (PowerShell's ConvertFrom-Json
// refuses the payload outright).
//
// The fix must land in both engines. Correcting one side of a mirrored pair
// only moves the lie.

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildAuctionCalendar } = require('../../server/intelligence/auction-calendar');
const { computeNeighborhoodStats } = require('../../server/intelligence/neighborhood-stats');
const { canonicalPropType } = require('../../server/intelligence/property-type');

const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');
const SALE_DATE = '2026-09-22T10:00:00.000Z';

function listing(id, propType) {
  // sourceObservedAt is required: neighborhood-stats drops anything outside
  // the age window (365 days by default), and a row with no observation time
  // is dropped rather than treated as fresh.
  const l = {
    id,
    source: 'treasury',
    state: 'TX',
    city: 'AUSTIN',
    zip: '78701',
    saleDate: SALE_DATE,
    sourceObservedAt: new Date(NOW_MS).toISOString()
  };
  if (propType !== undefined) l.propType = propType;
  return l;
}

// --- the helper ----------------------------------------------------------

test('canonicalPropType: folds every spelling of unknown into one bucket', () => {
  for (const raw of ['Unknown', 'unknown', 'UNKNOWN', ' unknown ', 'UnKnOwN', '', null, undefined, '  ']) {
    assert.equal(canonicalPropType(raw), 'Unknown', `raw=${JSON.stringify(raw)}`);
  }
});

test('canonicalPropType: leaves real types exactly as the publisher wrote them', () => {
  assert.equal(canonicalPropType('Single Family'), 'Single Family');
  assert.equal(canonicalPropType('Multi-Family'), 'Multi-Family');
  assert.equal(canonicalPropType('Land'), 'Land');
});

test('canonicalPropType: trims surrounding whitespace', () => {
  assert.equal(canonicalPropType('  Condo  '), 'Condo');
});

test('canonicalPropType: a non-string is an unknown type, not a crash', () => {
  assert.equal(canonicalPropType(42), 'Unknown');
});

// --- auction calendar ----------------------------------------------------

test('buildAuctionCalendar: one bucket for unknown, not two', () => {
  const pool = [
    listing('A', 'Unknown'),   // civilview's spelling
    listing('B'),             // no propType at all
    listing('C', 'unknown'),  // servicelink's spelling
    listing('D', 'Single Family')
  ];
  const { weeks } = buildAuctionCalendar(pool, { nowMs: NOW_MS, windowDays: 60 });
  assert.equal(weeks.length, 1);
  const keys = Object.keys(weeks[0].propTypes).sort();
  assert.deepEqual(keys, ['Single Family', 'Unknown'],
    'the three ways of saying "unknown" must be one bucket');
  assert.equal(weeks[0].propTypes.Unknown, 3);
  assert.equal(weeks[0].propTypes['Single Family'], 1);
});

// --- neighborhood stats --------------------------------------------------

test('computeNeighborhoodStats: one bucket for unknown, not two', () => {
  const pool = [
    listing('A', 'Unknown'),
    listing('B'),
    listing('C', 'unknown'),
    listing('D', 'Condo')
  ];
  const buckets = computeNeighborhoodStats(pool, { nowMs: NOW_MS });
  assert.equal(buckets.length, 1);
  const keys = Object.keys(buckets[0].propTypes).sort();
  assert.deepEqual(keys, ['Condo', 'Unknown'],
    'the three ways of saying "unknown" must be one bucket');
  assert.equal(buckets[0].propTypes.Unknown, 3);
  assert.equal(buckets[0].propTypes.Condo, 1);
});

// --- the property both engines have always relied on ---------------------

test('both engines still tally a normal pool identically', () => {
  const pool = [listing('A', 'Land'), listing('B', 'Condo'), listing('C', 'Condo')];
  const { weeks } = buildAuctionCalendar(pool, { nowMs: NOW_MS, windowDays: 60 });
  const buckets = computeNeighborhoodStats(pool, { nowMs: NOW_MS });
  assert.deepEqual(weeks[0].propTypes, { Land: 1, Condo: 2 });
  assert.deepEqual(buckets[0].propTypes, { Land: 1, Condo: 2 });
});