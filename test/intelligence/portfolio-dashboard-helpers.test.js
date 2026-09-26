'use strict';

// test/intelligence/portfolio-dashboard-helpers.test.js
//
// Direct unit coverage for server/intelligence/portfolio-dashboard.js.
// The portfolio dashboard tab aggregates saved listings into per-state,
// per-source, per-propType counts, median opening bid / mid / deal
// score, upcoming sales, and missing-data reasons. Silent drift in the
// upcoming-sale window or median math would silently mis-report the
// user's portfolio without surfacing the change.
//
//   - computePortfolioDashboard: full payload structure
//   - sum / median / discount / parseDate (internal helpers)
//   - per-bucket tallies (perState / perSource / perPropType)
//   - missing reasons (missing_opening_bid / missing_mid /
//     missing_deal_score / missing_sale_date)
//   - upcomingSales sorted by date, capped to limit, within window
//   - options: nowMs / upcomingWindowDays / upcomingLimit

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  computePortfolioDashboard,
  _internals: { median, sum, discount, parseDate, tallyReasons },
} = require('../../server/intelligence/portfolio-dashboard');

const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);

// --- sum / median / discount / parseDate -------------------------------

test('sum: sums finite values, ignores non-finite', () => {
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(sum([1, Infinity, 3]), 4);
  assert.equal(sum([1, NaN, 3]), 4);
  assert.equal(sum([]), 0);
});

test('parseDate: null / empty -> null', () => {
  assert.equal(parseDate(null), null);
  assert.equal(parseDate(undefined), null);
  assert.equal(parseDate(''), null);
});

test('parseDate: numeric timestamp passes through', () => {
  assert.equal(parseDate(123456), 123456);
});

test('parseDate: ISO string parses to ms', () => {
  const t = parseDate('2026-05-07T12:00:00Z');
  assert.equal(typeof t, 'number');
  assert.ok(Number.isFinite(t));
});

test('parseDate: invalid string -> null', () => {
  assert.equal(parseDate('not a date'), null);
});

// --- computePortfolioDashboard ----------------------------------------

test('computePortfolioDashboard: empty listings -> zeros + generatedAt', () => {
  const result = computePortfolioDashboard([], { nowMs: NOW });
  assert.equal(result.count, 0);
  assert.equal(result.totalEstimatedValue, null);
  assert.equal(result.totalEstimatedEquity, 0);
  assert.equal(result.medianOpeningBid, null);
  assert.equal(result.medianMid, null);
  assert.equal(result.medianDealScore, null);
  assert.equal(result.medianDiscount, null);
  assert.equal(result.generatedAt, new Date(NOW).toISOString());
  assert.deepEqual(result.upcomingSales, []);
});

test('computePortfolioDashboard: counts and buckets per-state / per-source / per-propType', () => {
  const listings = [
    { id: 'L1', state: 'OH', source: 'sheriff', propType: 'single-family', openingBid: 100000, mid: 200000, dealScore: 80 },
    { id: 'L2', state: 'OH', source: 'treasury', propType: 'single-family', openingBid: 80000, mid: 220000, dealScore: 70 },
    { id: 'L3', state: 'FL', source: 'sheriff', propType: 'condo', openingBid: 60000, mid: 150000, dealScore: 60 },
  ];
  const result = computePortfolioDashboard(listings, { nowMs: NOW });
  assert.equal(result.count, 3);
  assert.deepEqual(result.perState, { OH: 2, FL: 1 });
  assert.deepEqual(result.perSource, { sheriff: 2, treasury: 1 });
  assert.deepEqual(result.perPropType, { 'single-family': 2, condo: 1 });
  assert.equal(result.medianOpeningBid, 80000);
  assert.equal(result.medianMid, 200000);
  assert.equal(result.medianDealScore, 70);
});

test('computePortfolioDashboard: totalEstimatedEquity = sum(mid - openingBid)', () => {
  const listings = [
    { openingBid: 100000, mid: 200000 },  // equity = 100000
    { openingBid: 80000, mid: 220000 },   // equity = 140000
  ];
  const result = computePortfolioDashboard(listings, { nowMs: NOW });
  assert.equal(result.totalEstimatedEquity, 240000);
});

test('computePortfolioDashboard: missing reasons tally partial listings', () => {
  const listings = [
    { id: 'L1', openingBid: 100000, mid: 200000, dealScore: 80, saleDate: '2026-06-07T12:00:00Z' },
    { id: 'L2' },  // all missing
    { id: 'L3', openingBid: 50000 },  // missing mid, dealScore, saleDate
  ];
  const result = computePortfolioDashboard(listings, { nowMs: NOW });
  assert.equal(result.missing.missing_opening_bid, 1);  // L2
  assert.equal(result.missing.missing_mid, 2);  // L2, L3
  assert.equal(result.missing.missing_deal_score, 2);
  assert.equal(result.missing.missing_sale_date, 2);
});

test('computePortfolioDashboard: upcomingSales sorted ascending within window', () => {
  const listings = [
    { id: 'late', saleDate: '2026-06-20T12:00:00Z' },
    { id: 'soon', saleDate: '2026-05-15T12:00:00Z' },
    { id: 'past', saleDate: '2026-04-01T12:00:00Z' },  // before now
    { id: 'no-date' },
  ];
  const result = computePortfolioDashboard(listings, { nowMs: NOW, upcomingWindowDays: 60 });
  assert.equal(result.upcomingSales.length, 2);
  assert.equal(result.upcomingSales[0].id, 'soon');
  assert.equal(result.upcomingSales[1].id, 'late');
});

test('computePortfolioDashboard: upcomingLimit caps the list', () => {
  const listings = Array.from({ length: 10 }, (_, i) => ({
    id: `L${i}`,
    saleDate: new Date(NOW + (i + 1) * 86_400_000).toISOString(),
  }));
  const result = computePortfolioDashboard(listings, { nowMs: NOW, upcomingWindowDays: 60, upcomingLimit: 3 });
  assert.equal(result.upcomingSales.length, 3);
  assert.equal(result.upcomingSales[0].id, 'L0');
  assert.equal(result.upcomingSales[2].id, 'L2');
});

test('computePortfolioDashboard: medianDiscount rounded to 4 decimals', () => {
  const listings = [
    { openingBid: 33333, mid: 100000 },  // discount = 0.66667 -> 0.6667
  ];
  const result = computePortfolioDashboard(listings, { nowMs: NOW });
  assert.equal(result.medianDiscount, 0.6667);
});

test('computePortfolioDashboard: non-array listings -> empty result', () => {
  const result = computePortfolioDashboard(null, { nowMs: NOW });
  assert.equal(result.count, 0);
});

test('computePortfolioDashboard: userId projected from options', () => {
  const result = computePortfolioDashboard([], { nowMs: NOW, userId: 'user-1' });
  assert.equal(result.userId, 'user-1');
});

// --- tallyReasons -----------------------------------------------------

test('tallyReasons: counts only the relevant missing fields per listing', () => {
  const reasons = tallyReasons([
    { openingBid: 1, mid: 1, dealScore: 1, saleDate: '2026-01-01' },
    { openingBid: 1, mid: 1 },  // missing dealScore, saleDate
    {},  // missing everything
  ]);
  // Listing 1 has openingBid set; only L2 + L3 are missing it.
  assert.equal(reasons.missing_opening_bid, 1);
  // mid: L1+L2 set, L3 missing
  assert.equal(reasons.missing_mid, 1);
  // dealScore: L1 set, L2 + L3 missing
  assert.equal(reasons.missing_deal_score, 2);
  // saleDate: L1 set, L2 + L3 missing
  assert.equal(reasons.missing_sale_date, 2);
});