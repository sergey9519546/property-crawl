'use strict';

// test/intelligence/portfolio-dashboard.test.js
//
// Tests for server/intelligence/portfolio-dashboard.js — the roll-up
// analytics layer behind GET /api/portfolio/dashboard.

const assert = require('node:assert/strict');
const test = require('node:test');

const { computePortfolioDashboard } = require('../../server/intelligence/portfolio-dashboard');

const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');

function listing(overrides = {}) {
  return {
    id: 'L1',
    source: 'treasury',
    state: 'TX',
    city: 'Bruni',
    address: '112 North Avenue E',
    propType: 'Single Family',
    sqft: 1500,
    openingBid: 50000,
    mid: 100000,
    dealScore: 70,
    saleDate: null,
    ...overrides
  };
}

test('computePortfolioDashboard: empty input returns nulls + zero counts', () => {
  const dash = computePortfolioDashboard([], { nowMs: NOW_MS });
  assert.equal(dash.count, 0);
  assert.equal(dash.medianOpeningBid, null);
  assert.equal(dash.totalEstimatedValue, null);
  assert.deepEqual(dash.perState, {});
  assert.deepEqual(dash.upcomingSales, []);
});

test('computePortfolioDashboard: non-array input is treated as empty', () => {
  const dash = computePortfolioDashboard(null, { nowMs: NOW_MS });
  assert.equal(dash.count, 0);
});

test('computePortfolioDashboard: count + totals reflect the saved listings', () => {
  const pool = [
    listing({ id: 'A', openingBid: 50000, mid: 100000 }),
    listing({ id: 'B', openingBid: 70000, mid: 120000 }),
    listing({ id: 'C', openingBid: null, mid: 80000 })
  ];
  const dash = computePortfolioDashboard(pool, { nowMs: NOW_MS });
  assert.equal(dash.count, 3);
  assert.equal(dash.totalEstimatedValue, 100000 + 120000 + 80000);
  // totalEstimatedEquity = (100000-50000) + (120000-70000) + skip(mid missing opening)
  assert.equal(dash.totalEstimatedEquity, 50000 + 50000);
});

test('computePortfolioDashboard: medians use only finite values', () => {
  const pool = [
    listing({ openingBid: 50000, mid: 100000, dealScore: 60 }),
    listing({ openingBid: 80000, mid: 110000, dealScore: 80 }),
    listing({ openingBid: null, mid: null, dealScore: null })
  ];
  const dash = computePortfolioDashboard(pool, { nowMs: NOW_MS });
  assert.equal(dash.medianOpeningBid, 65000);
  assert.equal(dash.medianMid, 105000);
  assert.equal(dash.medianDealScore, 70);
});

test('computePortfolioDashboard: medianDiscount is 1 - openingBid/mid when both exist', () => {
  const pool = [
    listing({ openingBid: 50000, mid: 100000 }), // 50% off
    listing({ openingBid: 80000, mid: 100000 })  // 20% off
  ];
  const dash = computePortfolioDashboard(pool, { nowMs: NOW_MS });
  assert.equal(dash.medianDiscount, 0.35);
});

test('computePortfolioDashboard: perState + perSource + perPropType tally correctly', () => {
  const pool = [
    listing({ id: 'A', state: 'TX', source: 'hud', propType: 'Single Family' }),
    listing({ id: 'B', state: 'TX', source: 'hud', propType: 'Single Family' }),
    listing({ id: 'C', state: 'CA', source: 'irs', propType: 'Land' })
  ];
  const dash = computePortfolioDashboard(pool, { nowMs: NOW_MS });
  assert.deepEqual(dash.perState, { TX: 2, CA: 1 });
  assert.deepEqual(dash.perSource, { hud: 2, irs: 1 });
  assert.deepEqual(dash.perPropType, { 'Single Family': 2, Land: 1 });
});

test('computePortfolioDashboard: upcomingSales surfaces sales within the window sorted ascending', () => {
  const pool = [
    listing({ id: 'A', saleDate: '2026-09-25T15:00:00.000Z' }), // 9 days out
    listing({ id: 'B', saleDate: '2026-09-20T15:00:00.000Z' }), // 4 days out (earliest)
    listing({ id: 'C', saleDate: '2026-12-25T15:00:00.000Z' }), // far outside window
    listing({ id: 'D', saleDate: '2025-01-01T15:00:00.000Z' })  // in the past
  ];
  const dash = computePortfolioDashboard(pool, {
    nowMs: NOW_MS,
    upcomingWindowDays: 30,
    upcomingLimit: 5
  });
  assert.equal(dash.upcomingSales.length, 2);
  assert.equal(dash.upcomingSales[0].id, 'B'); // earliest sale date first
  assert.equal(dash.upcomingSales[1].id, 'A');
});

test('computePortfolioDashboard: upcomingLimit caps the result', () => {
  const pool = Array.from({ length: 8 }, (_, i) => listing({
    id: `S${i}`,
    saleDate: new Date(NOW_MS + (i + 1) * 86_400_000).toISOString()
  }));
  const dash = computePortfolioDashboard(pool, {
    nowMs: NOW_MS,
    upcomingWindowDays: 60,
    upcomingLimit: 3
  });
  assert.equal(dash.upcomingSales.length, 3);
});

test('computePortfolioDashboard: missing saleDate is excluded from upcomingSales', () => {
  const pool = [
    listing({ id: 'A', saleDate: null }),
    listing({ id: 'B', saleDate: '2026-09-20T15:00:00.000Z' })
  ];
  const dash = computePortfolioDashboard(pool, { nowMs: NOW_MS });
  assert.equal(dash.upcomingSales.length, 1);
  assert.equal(dash.upcomingSales[0].id, 'B');
});

test('computePortfolioDashboard: missing tally reports every gap explicitly', () => {
  const pool = [
    listing({ id: 'A', openingBid: 50000, mid: 100000, dealScore: 70, saleDate: '2026-09-20T15:00:00.000Z' }),
    listing({ id: 'B', openingBid: null, mid: null, dealScore: null, saleDate: null })
  ];
  const dash = computePortfolioDashboard(pool, { nowMs: NOW_MS });
  assert.equal(dash.missing.missing_opening_bid, 1);
  assert.equal(dash.missing.missing_mid, 1);
  assert.equal(dash.missing.missing_deal_score, 1);
  assert.equal(dash.missing.missing_sale_date, 1);
});

test('computePortfolioDashboard: userId is echoed back when provided', () => {
  const dash = computePortfolioDashboard([], { nowMs: NOW_MS, userId: 'workspace:operator' });
  assert.equal(dash.userId, 'workspace:operator');
});

test('computePortfolioDashboard: generatedAt is the injected clock', () => {
  const dash = computePortfolioDashboard([], { nowMs: NOW_MS });
  assert.equal(dash.generatedAt, new Date(NOW_MS).toISOString());
});