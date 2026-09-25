'use strict';

// test/intelligence/price-drop-detector.test.js
//
// Tests for server/intelligence/price-drop-detector.js — the engine
// that decides whether a listing's opening bid has dropped vs the
// prior snapshot, and summarizes across many drops.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  detectPriceDrop,
  summarizePriceDrops
} = require('../../server/intelligence/price-drop-detector');

const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');

// --- detectPriceDrop ------------------------------------------------------

test('detectPriceDrop: returns reason=current_missing when current is null', () => {
  const result = detectPriceDrop({ current: null, previous: { openingBid: 50000 } });
  assert.equal(result.dropped, false);
  assert.equal(result.reason, 'current_missing');
});

test('detectPriceDrop: returns reason=previous_missing when previous is null', () => {
  const result = detectPriceDrop({ current: { openingBid: 50000 }, previous: null });
  assert.equal(result.dropped, false);
  assert.equal(result.reason, 'previous_missing');
});

test('detectPriceDrop: returns reason=opening_bid_missing when bids are non-finite', () => {
  const result = detectPriceDrop({ current: { openingBid: null }, previous: { openingBid: 50000 } });
  assert.equal(result.reason, 'opening_bid_missing');
});

test('detectPriceDrop: detects a 10% drop as moderate severity', () => {
  const result = detectPriceDrop({
    current: { openingBid: 90000 },
    previous: { openingBid: 100000 }
  });
  assert.equal(result.dropped, true);
  assert.equal(result.delta, -10000);
  assert.equal(result.deltaPct, -0.1);
  assert.equal(result.severity, 'moderate');
});

test('detectPriceDrop: detects a 25% drop as major severity', () => {
  const result = detectPriceDrop({
    current: { openingBid: 75000 },
    previous: { openingBid: 100000 }
  });
  assert.equal(result.severity, 'major');
  assert.equal(result.deltaPct, -0.25);
});

test('detectPriceDrop: detects a 50% drop as extreme severity', () => {
  const result = detectPriceDrop({
    current: { openingBid: 50000 },
    previous: { openingBid: 100000 }
  });
  assert.equal(result.severity, 'extreme');
});

test('detectPriceDrop: a 4% drop is severity=none (below minor threshold)', () => {
  const result = detectPriceDrop({
    current: { openingBid: 96000 },
    previous: { openingBid: 100000 }
  });
  assert.equal(result.dropped, true);
  assert.equal(result.severity, 'none');
});

test('detectPriceDrop: a 5% drop is exactly minor severity', () => {
  const result = detectPriceDrop({
    current: { openingBid: 95000 },
    previous: { openingBid: 100000 }
  });
  assert.equal(result.severity, 'minor');
});

test('detectPriceDrop: equal bids return dropped=false with severity=none', () => {
  const result = detectPriceDrop({
    current: { openingBid: 50000 },
    previous: { openingBid: 50000 }
  });
  assert.equal(result.dropped, false);
  assert.equal(result.delta, 0);
  assert.equal(result.deltaPct, 0);
  assert.equal(result.severity, 'none');
});

test('detectPriceDrop: a price increase returns dropped=false', () => {
  const result = detectPriceDrop({
    current: { openingBid: 60000 },
    previous: { openingBid: 50000 }
  });
  assert.equal(result.dropped, false);
  assert.equal(result.delta, 10000);
  assert.equal(result.deltaPct, 0, 'pct is reported as 0 for increases');
});

test('detectPriceDrop: previousBid=0 is treated as a price increase (no drop)', () => {
  // currentBid=1000 vs previousBid=0 — price went up. The drop detector
  // only surfaces drops, so this returns dropped=false with the
  // signed delta. deltaPct=0 because the previousBid=0 denominator
  // would otherwise produce an infinite ratio.
  const result = detectPriceDrop({
    current: { openingBid: 1000 },
    previous: { openingBid: 0 }
  });
  assert.equal(result.dropped, false);
  assert.equal(result.delta, 1000);
  assert.equal(result.deltaPct, 0);
});

test('detectPriceDrop: currentBid=0 from a real previous price is an extreme drop', () => {
  // Going from $100k to $0 is the largest possible drop. The
  // deltaPct=0 floor only triggers when previousBid=0.
  const result = detectPriceDrop({
    current: { openingBid: 0 },
    previous: { openingBid: 100000 }
  });
  assert.equal(result.dropped, true);
  assert.equal(result.delta, -100000);
  assert.equal(result.deltaPct, -1);
  assert.equal(result.severity, 'extreme');
});

test('detectPriceDrop: handles numeric strings (the engine coerces with finiteOrNull)', () => {
  const result = detectPriceDrop({
    current: { openingBid: '80000' },
    previous: { openingBid: '100000' }
  });
  assert.equal(result.dropped, true);
  assert.equal(result.delta, -20000);
});

// --- summarizePriceDrops --------------------------------------------------

test('summarizePriceDrops: counts by severity, computes total savings', () => {
  const drops = [
    { dropped: true, delta: -5000, deltaPct: -0.05, severity: 'minor', listingId: 'A' },
    { dropped: true, delta: -15000, deltaPct: -0.15, severity: 'moderate', listingId: 'B' },
    { dropped: true, delta: -30000, deltaPct: -0.30, severity: 'major', listingId: 'C' },
    { dropped: false, severity: 'none' },
    { dropped: false, severity: 'none' }
  ];
  const summary = summarizePriceDrops(drops, { nowMs: NOW_MS });
  assert.equal(summary.scanned, 5);
  assert.equal(summary.dropped, 3);
  assert.equal(summary.unchangedOrIncreased, 2);
  assert.equal(summary.totalSavings, 5000 + 15000 + 30000);
  assert.deepEqual(summary.bySeverity, { minor: 1, moderate: 1, major: 1, extreme: 0, none: 2 });
});

test('summarizePriceDrops: medianDeltaPct + medianDollarSaving use only valid values', () => {
  const drops = [
    { dropped: true, delta: -5000, deltaPct: -0.05 },
    { dropped: true, delta: -15000, deltaPct: -0.15 },
    { dropped: true, delta: -30000, deltaPct: -0.30 }
  ];
  const summary = summarizePriceDrops(drops, { nowMs: NOW_MS });
  assert.equal(summary.medianDeltaPct, -0.15);
  assert.equal(summary.medianDollarSaving, 15000);
});

test('summarizePriceDrops: topDrops caps at 5 entries and orders by |deltaPct| descending', () => {
  const drops = [
    { dropped: true, delta: -1000, deltaPct: -0.10, severity: 'moderate', listingId: 'A' },
    { dropped: true, delta: -2000, deltaPct: -0.20, severity: 'major', listingId: 'B' },
    { dropped: true, delta: -3000, deltaPct: -0.30, severity: 'major', listingId: 'C' },
    { dropped: true, delta: -4000, deltaPct: -0.40, severity: 'extreme', listingId: 'D' },
    { dropped: true, delta: -5000, deltaPct: -0.50, severity: 'extreme', listingId: 'E' },
    { dropped: true, delta: -6000, deltaPct: -0.60, severity: 'extreme', listingId: 'F' }
  ];
  const summary = summarizePriceDrops(drops, { nowMs: NOW_MS });
  assert.equal(summary.topDrops.length, 5);
  assert.equal(summary.topDrops[0].listingId, 'F'); // 60% off — biggest
  assert.equal(summary.topDrops[4].listingId, 'B'); // 20% off — smallest of the top 5
});

test('summarizePriceDrops: empty input returns zeroed summary', () => {
  const summary = summarizePriceDrops([], { nowMs: NOW_MS });
  assert.equal(summary.scanned, 0);
  assert.equal(summary.dropped, 0);
  assert.equal(summary.totalSavings, 0);
  assert.equal(summary.medianDeltaPct, null);
  assert.equal(summary.medianDollarSaving, null);
  assert.equal(summary.topDrops.length, 0);
});

test('summarizePriceDrops: a non-array input is treated as empty', () => {
  const summary = summarizePriceDrops(null, { nowMs: NOW_MS });
  assert.equal(summary.scanned, 0);
  assert.equal(summary.dropped, 0);
});

test('summarizePriceDrops: generatedAt is the injected clock', () => {
  const summary = summarizePriceDrops([], { nowMs: NOW_MS });
  assert.equal(summary.generatedAt, new Date(NOW_MS).toISOString());
});

test('summarizePriceDrops: drops with non-finite delta do not pollute totals', () => {
  const drops = [
    { dropped: true, delta: null, deltaPct: null, severity: 'minor' },
    { dropped: true, delta: -10000, deltaPct: -0.10, severity: 'moderate' }
  ];
  const summary = summarizePriceDrops(drops, { nowMs: NOW_MS });
  assert.equal(summary.totalSavings, 10000);
  assert.equal(summary.medianDeltaPct, -0.10);
});