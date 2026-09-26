'use strict';

// test/intelligence/price-drop-detector-helpers.test.js
//
// Direct unit coverage for server/intelligence/price-drop-detector.js.
// The price-drop detector is what surfaces "your watched listing's
// opening bid just dropped by 15%" notifications and the aggregated
// summary on the portfolio dashboard. Silent drift in the severity
// thresholds or the delta computation would silently mis-rank drops.
//
//   - SEVERITY_THRESHOLDS frozen shape (extreme / major / moderate / minor)
//   - severityForPct: pct -> severity band mapping
//   - detectPriceDrop: single-pair predicate
//     - missing inputs (current / previous / openingBid) -> dropped:false
//     - equal prices -> dropped:false
//     - price increase -> dropped:false
//     - actual drop -> dropped:true with delta / deltaPct / severity
//   - summarizePriceDrops: count by severity, total savings,
//     median delta, top 5 drops, unchangedOrIncreased tally

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  detectPriceDrop,
  summarizePriceDrops,
  _internals: { severityForPct, SEVERITY_THRESHOLDS },
} = require('../../server/intelligence/price-drop-detector');

// --- SEVERITY_THRESHOLDS structural pins ------------------------------

test('SEVERITY_THRESHOLDS: published thresholds in descending severity order', () => {
  assert.equal(SEVERITY_THRESHOLDS.length, 4);
  const names = SEVERITY_THRESHOLDS.map((t) => t.name);
  assert.deepEqual(names, ['extreme', 'major', 'moderate', 'minor']);
  for (let i = 0; i < SEVERITY_THRESHOLDS.length - 1; i += 1) {
    assert.ok(SEVERITY_THRESHOLDS[i].minPct > SEVERITY_THRESHOLDS[i + 1].minPct,
      `${SEVERITY_THRESHOLDS[i].name}.minPct should exceed next`);
  }
});

// --- severityForPct ---------------------------------------------------

test('severityForPct: maps percentage drops to severity bands', () => {
  assert.equal(severityForPct(-0.05), 'minor');
  assert.equal(severityForPct(-0.10), 'moderate');
  assert.equal(severityForPct(-0.20), 'major');
  assert.equal(severityForPct(-0.40), 'extreme');
  assert.equal(severityForPct(-0.49), 'extreme');
});

test('severityForPct: small drops below 5% -> none', () => {
  assert.equal(severityForPct(-0.04), 'none');
  assert.equal(severityForPct(-0.01), 'none');
  assert.equal(severityForPct(0), 'none');
});

test('severityForPct: positive (price increase) classifies by absolute value', () => {
  // severityForPct uses Math.abs() — it treats a +50% move as a 50% magnitude,
  // but the detectPriceDrop caller ignores positive moves (currentBid >= previousBid).
  // Here we just document the helper's own behavior.
  assert.equal(severityForPct(0.50), 'extreme');
});

// --- detectPriceDrop --------------------------------------------------

test('detectPriceDrop: missing current -> dropped:false reason', () => {
  const r = detectPriceDrop({ previous: { openingBid: 100000 } });
  assert.equal(r.dropped, false);
  assert.equal(r.reason, 'current_missing');
});

test('detectPriceDrop: missing previous -> dropped:false reason', () => {
  const r = detectPriceDrop({ current: { openingBid: 100000 } });
  assert.equal(r.dropped, false);
  assert.equal(r.reason, 'previous_missing');
});

test('detectPriceDrop: missing openingBid -> dropped:false reason', () => {
  const r = detectPriceDrop({ current: { id: 'L1' }, previous: { id: 'L1' } });
  assert.equal(r.dropped, false);
  assert.equal(r.reason, 'opening_bid_missing');
});

test('detectPriceDrop: equal bids -> dropped:false, severity "none"', () => {
  const r = detectPriceDrop({ current: { openingBid: 100000 }, previous: { openingBid: 100000 } });
  assert.equal(r.dropped, false);
  assert.equal(r.delta, 0);
  assert.equal(r.deltaPct, 0);
  assert.equal(r.severity, 'none');
});

test('detectPriceDrop: price increase -> dropped:false', () => {
  const r = detectPriceDrop({ current: { openingBid: 150000 }, previous: { openingBid: 100000 } });
  assert.equal(r.dropped, false);
  assert.equal(r.delta, 50000);
});

test('detectPriceDrop: 10% drop -> moderate severity', () => {
  const r = detectPriceDrop({ current: { openingBid: 90000 }, previous: { openingBid: 100000 } });
  assert.equal(r.dropped, true);
  assert.equal(r.delta, -10000);
  assert.equal(r.deltaPct, -0.1);
  assert.equal(r.severity, 'moderate');
});

test('detectPriceDrop: 50% drop -> extreme severity', () => {
  const r = detectPriceDrop({ current: { openingBid: 50000 }, previous: { openingBid: 100000 } });
  assert.equal(r.dropped, true);
  assert.equal(r.severity, 'extreme');
});

test('detectPriceDrop: 5% drop -> minor severity', () => {
  const r = detectPriceDrop({ current: { openingBid: 95000 }, previous: { openingBid: 100000 } });
  assert.equal(r.dropped, true);
  assert.equal(r.severity, 'minor');
});

test('detectPriceDrop: 2% drop -> dropped:true but severity "none" (threshold-driven)', () => {
  // The detector's `dropped` flag fires whenever currentBid < previousBid.
  // The `severity` field captures how big the drop is — for sub-threshold
  // drops the alert UI uses severity to decide whether to surface the
  // notification.
  const r = detectPriceDrop({ current: { openingBid: 98000 }, previous: { openingBid: 100000 } });
  assert.equal(r.dropped, true);
  assert.equal(r.severity, 'none');
});

test('detectPriceDrop: previousBid = 0 -> deltaPct = 0, dropped:false', () => {
  const r = detectPriceDrop({ current: { openingBid: 100000 }, previous: { openingBid: 0 } });
  assert.equal(r.dropped, false);
  assert.equal(r.deltaPct, 0);
});

test('detectPriceDrop: deltaPct rounded to 4 decimals', () => {
  // Use a delta that survives 4-decimal rounding (1/100 = 0.01)
  const r = detectPriceDrop({ current: { openingBid: 99900 }, previous: { openingBid: 100000 } });
  assert.equal(r.dropped, true);
  // -100 / 100000 = -0.001
  assert.equal(r.deltaPct, -0.001);
});

// --- summarizePriceDrops ---------------------------------------------

test('summarizePriceDrops: empty array -> zeros', () => {
  const r = summarizePriceDrops([], { nowMs: Date.UTC(2026, 0, 1) });
  assert.equal(r.scanned, 0);
  assert.equal(r.dropped, 0);
  assert.equal(r.unchangedOrIncreased, 0);
  assert.equal(r.totalSavings, 0);
  assert.equal(r.medianDeltaPct, null);
  assert.equal(r.medianDollarSaving, null);
  assert.deepEqual(r.topDrops, []);
  assert.equal(r.generatedAt, '2026-01-01T00:00:00.000Z');
});

test('summarizePriceDrops: non-array -> zeros', () => {
  const r = summarizePriceDrops(null);
  assert.equal(r.scanned, 0);
});

test('summarizePriceDrops: counts drops by severity band', () => {
  const drops = [
    { dropped: true, severity: 'minor', delta: -5000, deltaPct: -0.05, previousBid: 100000, currentBid: 95000 },
    { dropped: true, severity: 'moderate', delta: -10000, deltaPct: -0.10, previousBid: 100000, currentBid: 90000 },
    { dropped: true, severity: 'extreme', delta: -50000, deltaPct: -0.50, previousBid: 100000, currentBid: 50000 },
    { dropped: false, severity: 'none' },  // no change
  ];
  const r = summarizePriceDrops(drops);
  assert.equal(r.scanned, 4);
  assert.equal(r.dropped, 3);
  assert.equal(r.unchangedOrIncreased, 1);
  assert.equal(r.bySeverity.minor, 1);
  assert.equal(r.bySeverity.moderate, 1);
  assert.equal(r.bySeverity.extreme, 1);
  assert.equal(r.bySeverity.none, 1);
});

test('summarizePriceDrops: totalSavings sums abs(delta) across drops', () => {
  const drops = [
    { dropped: true, severity: 'moderate', delta: -10000, deltaPct: -0.10, previousBid: 100000, currentBid: 90000 },
    { dropped: true, severity: 'minor', delta: -5000, deltaPct: -0.05, previousBid: 100000, currentBid: 95000 },
  ];
  const r = summarizePriceDrops(drops);
  assert.equal(r.totalSavings, 15000);
});

test('summarizePriceDrops: topDrops capped at 5, sorted by abs(deltaPct)', () => {
  const drops = [
    { dropped: true, listingId: 'L1', severity: 'minor', delta: -5000, deltaPct: -0.05, previousBid: 100000, currentBid: 95000 },
    { dropped: true, listingId: 'L2', severity: 'extreme', delta: -50000, deltaPct: -0.50, previousBid: 100000, currentBid: 50000 },
    { dropped: true, listingId: 'L3', severity: 'moderate', delta: -10000, deltaPct: -0.10, previousBid: 100000, currentBid: 90000 },
    { dropped: true, listingId: 'L4', severity: 'major', delta: -20000, deltaPct: -0.20, previousBid: 100000, currentBid: 80000 },
    { dropped: true, listingId: 'L5', severity: 'minor', delta: -3000, deltaPct: -0.03, previousBid: 100000, currentBid: 97000 },
    { dropped: true, listingId: 'L6', severity: 'moderate', delta: -7000, deltaPct: -0.07, previousBid: 100000, currentBid: 93000 },
    { dropped: true, listingId: 'L7', severity: 'major', delta: -30000, deltaPct: -0.30, previousBid: 100000, currentBid: 70000 },
  ];
  const r = summarizePriceDrops(drops);
  assert.equal(r.topDrops.length, 5);
  // Sorted by abs(deltaPct) desc: L2 (0.50), L7 (0.30), L4 (0.20), L3 (0.10), L6 (0.07)
  assert.equal(r.topDrops[0].listingId, 'L2');
  assert.equal(r.topDrops[1].listingId, 'L7');
  assert.equal(r.topDrops[2].listingId, 'L4');
  assert.equal(r.topDrops[3].listingId, 'L3');
  assert.equal(r.topDrops[4].listingId, 'L6');
});

test('summarizePriceDrops: medianDeltaPct computed across dropped only', () => {
  const drops = [
    { dropped: true, severity: 'minor', delta: -5000, deltaPct: -0.05, previousBid: 100000, currentBid: 95000 },
    { dropped: true, severity: 'moderate', delta: -10000, deltaPct: -0.10, previousBid: 100000, currentBid: 90000 },
    { dropped: true, severity: 'major', delta: -30000, deltaPct: -0.30, previousBid: 100000, currentBid: 70000 },
  ];
  const r = summarizePriceDrops(drops);
  assert.equal(r.medianDeltaPct, -0.1);  // middle of [-0.30, -0.10, -0.05]
});

test('summarizePriceDrops: medianDollarSaving rounded to integer', () => {
  const drops = [
    { dropped: true, severity: 'minor', delta: -5000, deltaPct: -0.05, previousBid: 100000, currentBid: 95000 },
    { dropped: true, severity: 'moderate', delta: -10500, deltaPct: -0.10, previousBid: 100000, currentBid: 89500 },
  ];
  const r = summarizePriceDrops(drops);
  // median of [-5000, -10500] = -7750 (abs = 7750)
  assert.equal(r.medianDollarSaving, 7750);
});