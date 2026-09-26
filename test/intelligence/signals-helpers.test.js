'use strict';

// test/intelligence/signals-helpers.test.js
//
// Direct unit coverage for the Opportunity-Signal evaluator exported from
// server/intelligence/signals.js. Every dashboard triage number, "Next
// Action" chip, and contradiction badge across the app is computed here.
// Silent drift would silently re-rank every listing in the dashboard
// without changing any input.
//
//   - SIGNAL_WEIGHTS frozen with the published coefficients
//   - evaluateOpportunitySignals: full signal matrix + priority math
//   - summary counters (supported / unknown / contradicted)
//   - disclaimer pinned so it can never silently disappear
//   - generatedAt timestamp + listingId projection
//   - graceful handling of empty / minimal listing inputs

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  evaluateOpportunitySignals,
  SIGNAL_WEIGHTS,
} = require('../../server/intelligence/signals');

// --- SIGNAL_WEIGHTS ------------------------------------------------------

test('SIGNAL_WEIGHTS: sum to 1.0 across all six components', () => {
  const sum = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) < 1e-9, `weights sum to ${sum}, expected 1.0`);
});

test('SIGNAL_WEIGHTS: contains the six published coefficients', () => {
  assert.deepEqual(SIGNAL_WEIGHTS, {
    bidToValueRatio: 0.30,
    saleDateKnown: 0.20,
    bidReduction: 0.20,
    areaDiscrepancy: 0.10,
    returnedToMarket: 0.10,
    dataCompleteness: 0.10,
  });
});

test('SIGNAL_WEIGHTS: object is frozen', () => {
  assert.equal(Object.isFrozen(SIGNAL_WEIGHTS), true);
});

// --- empty listing -------------------------------------------------------

test('evaluateOpportunitySignals: empty listing still returns 6 signals and valid triage', () => {
  const result = evaluateOpportunitySignals({}, { now: Date.UTC(2026, 0, 15) });
  assert.equal(result.signals.length, 6);
  // every signal key appears exactly once
  const keys = result.signals.map((s) => s.key);
  assert.deepEqual(
    [...new Set(keys)].sort(),
    ['bid_reduction', 'bid_to_value_ratio', 'building_area_discrepancy', 'returned_to_market', 'sale_date_known', 'title_equity_unresolved']
  );
  // unknown / no data should produce minimal triage, but never below 1
  assert.ok(result.triagePriority >= 1);
  assert.ok(result.triagePriority <= 99);
});

// --- sale_date_known signal ---------------------------------------------

test('evaluateOpportunitySignals: future sale date -> supported', () => {
  const future = '2099-12-31';
  const result = evaluateOpportunitySignals({ saleDate: future }, { now: Date.UTC(2026, 0, 15) });
  const sig = result.signals.find((s) => s.key === 'sale_date_known');
  assert.equal(sig.status, 'supported');
  assert.match(sig.reason, new RegExp(future));
});

test('evaluateOpportunitySignals: past sale date -> unknown with "has passed" label', () => {
  const result = evaluateOpportunitySignals({ saleDate: '2020-01-01' }, { now: Date.UTC(2026, 0, 15) });
  const sig = result.signals.find((s) => s.key === 'sale_date_known');
  assert.equal(sig.status, 'unknown');
  assert.match(sig.label, /passed/i);
});

test('evaluateOpportunitySignals: missing saleDate -> unresolved', () => {
  const result = evaluateOpportunitySignals({}, { now: Date.UTC(2026, 0, 15) });
  const sig = result.signals.find((s) => s.key === 'sale_date_known');
  assert.equal(sig.status, 'unknown');
  assert.equal(sig.evidenceClass, 'unresolved');
});

// --- bid_reduction signal -----------------------------------------------

test('evaluateOpportunitySignals: bid_reduction observation -> supported', () => {
  const listing = { id: 'L1', provenance: { recordId: '42' } };
  const observations = { records: {}, signals: [{ listingId: 'L1', type: 'bid_reduced' }] };
  const result = evaluateOpportunitySignals(listing, { observations });
  const sig = result.signals.find((s) => s.key === 'bid_reduction');
  assert.equal(sig.status, 'supported');
  assert.equal(sig.evidenceClass, 'exact_source_observation');
});

test('evaluateOpportunitySignals: bid_reduction by label text fallback', () => {
  const observations = { records: {}, signals: [{ listingId: 'L1', label: 'Bid was dropped' }] };
  const result = evaluateOpportunitySignals({ id: 'L1' }, { observations });
  const sig = result.signals.find((s) => s.key === 'bid_reduction');
  assert.equal(sig.status, 'supported');
});

test('evaluateOpportunitySignals: no observation -> unresolved', () => {
  const result = evaluateOpportunitySignals({ id: 'L1' });
  const sig = result.signals.find((s) => s.key === 'bid_reduction');
  assert.equal(sig.status, 'unknown');
});

// --- returned_to_market signal ------------------------------------------

test('evaluateOpportunitySignals: status "returned" -> supported', () => {
  const result = evaluateOpportunitySignals({ status: 'returned to market' });
  const sig = result.signals.find((s) => s.key === 'returned_to_market');
  assert.equal(sig.status, 'supported');
});

test('evaluateOpportunitySignals: status "re-listed" -> supported', () => {
  const result = evaluateOpportunitySignals({ status: 'Re-listed' });
  const sig = result.signals.find((s) => s.key === 'returned_to_market');
  assert.equal(sig.status, 'supported');
});

test('evaluateOpportunitySignals: status "rescheduled" -> supported', () => {
  const result = evaluateOpportunitySignals({ status: 'Rescheduled' });
  const sig = result.signals.find((s) => s.key === 'returned_to_market');
  assert.equal(sig.status, 'supported');
});

test('evaluateOpportunitySignals: status "adjourned - active" -> supported', () => {
  const result = evaluateOpportunitySignals({ status: 'Adjourned - Active' });
  const sig = result.signals.find((s) => s.key === 'returned_to_market');
  assert.equal(sig.status, 'supported');
});

test('evaluateOpportunitySignals: rawNotice with "returned to market" -> supported', () => {
  const result = evaluateOpportunitySignals({ raw: 'Property returned to market after postponement' });
  const sig = result.signals.find((s) => s.key === 'returned_to_market');
  assert.equal(sig.status, 'supported');
});

test('evaluateOpportunitySignals: active standard status -> unknown', () => {
  const result = evaluateOpportunitySignals({ status: 'Active' });
  const sig = result.signals.find((s) => s.key === 'returned_to_market');
  assert.equal(sig.status, 'unknown');
});

// --- bid_to_value_ratio signal -----------------------------------------

test('evaluateOpportunitySignals: bid below mid -> supported', () => {
  // mid = (200 + 300) / 2 = 250; ratio = 100 / 250 = 40%
  const result = evaluateOpportunitySignals({ openingBid: 100000, estLow: 200000, estHigh: 300000 });
  const sig = result.signals.find((s) => s.key === 'bid_to_value_ratio');
  assert.equal(sig.status, 'supported');
  assert.match(sig.reason, /40\.0%/);
});

test('evaluateOpportunitySignals: bid above mid -> contradicted', () => {
  const result = evaluateOpportunitySignals({ openingBid: 400000, estLow: 200000, estHigh: 300000 });
  const sig = result.signals.find((s) => s.key === 'bid_to_value_ratio');
  assert.equal(sig.status, 'contradicted');
});

test('evaluateOpportunitySignals: explicit mid field overrides estLow/estHigh average', () => {
  const result = evaluateOpportunitySignals({ openingBid: 100000, mid: 200000, estLow: 1000000, estHigh: 1000000 });
  const sig = result.signals.find((s) => s.key === 'bid_to_value_ratio');
  assert.equal(sig.status, 'supported');
  assert.match(sig.reason, /50\.0%/);  // 100k / 200k = 50%
});

test('evaluateOpportunitySignals: missing bid -> unresolved', () => {
  const result = evaluateOpportunitySignals({ estLow: 100000, estHigh: 200000 });
  const sig = result.signals.find((s) => s.key === 'bid_to_value_ratio');
  assert.equal(sig.status, 'unknown');
});

// --- building_area_discrepancy signal ---------------------------------

test('evaluateOpportunitySignals: matching sqft -> supported', () => {
  const publicRecords = { parcel: { properties: { livingAreaSqft: 1500 }, source: { url: 'parcel.example' } } };
  const result = evaluateOpportunitySignals({ sqft: 1500 }, { publicRecords });
  const sig = result.signals.find((s) => s.key === 'building_area_discrepancy');
  assert.equal(sig.status, 'supported');
  assert.equal(sig.sourceUrl, 'parcel.example');
});

test('evaluateOpportunitySignals: >10% sqft mismatch -> contradicted', () => {
  const publicRecords = { parcel: { properties: { livingAreaSqft: 1500 } } };
  const result = evaluateOpportunitySignals({ sqft: 1000 }, { publicRecords });
  const sig = result.signals.find((s) => s.key === 'building_area_discrepancy');
  assert.equal(sig.status, 'contradicted');
  assert.equal(sig.evidenceClass, 'official_parcel_roll');
});

test('evaluateOpportunitySignals: missing parcel -> unresolved', () => {
  const result = evaluateOpportunitySignals({ sqft: 1500 });
  const sig = result.signals.find((s) => s.key === 'building_area_discrepancy');
  assert.equal(sig.status, 'unknown');
});

// --- title_equity_unresolved signal -----------------------------------

test('evaluateOpportunitySignals: all three title fields -> supported', () => {
  const result = evaluateOpportunitySignals({ seniorLienRisk: 'low', redemptionDays: 30, cashToClose: 5000 });
  const sig = result.signals.find((s) => s.key === 'title_equity_unresolved');
  assert.equal(sig.status, 'supported');
});

test('evaluateOpportunitySignals: missing redemptionDays -> unresolved', () => {
  const result = evaluateOpportunitySignals({ seniorLienRisk: 'low', cashToClose: 5000 });
  const sig = result.signals.find((s) => s.key === 'title_equity_unresolved');
  assert.equal(sig.status, 'unknown');
});

// --- triagePriority + summary -----------------------------------------

test('evaluateOpportunitySignals: all-supported signals -> max possible priority', () => {
  const future = '2099-12-31';
  const observations = { signals: [{ listingId: 'L1', type: 'bid_reduced' }] };
  const publicRecords = { parcel: { properties: { livingAreaSqft: 1500 }, source: { url: 'parcel.example' } } };
  // With bid=50k and mid=250k, discount fraction = 0.8 → bidToValueRatio component = 24
  // Plus full saleDate (20) + bidReduction (20) + areaDiscrepancy (10) + returnedToMarket (10) + dataCompleteness (10) = 94
  const result = evaluateOpportunitySignals(
    {
      id: 'L1', openingBid: 50000, estLow: 200000, estHigh: 300000,
      sqft: 1500, saleDate: future, status: 'returned',
      seniorLienRisk: 'low', redemptionDays: 30, cashToClose: 5000,
    },
    { observations, publicRecords }
  );
  assert.equal(result.summary.supported, 6);
  assert.equal(result.summary.unknown, 0);
  assert.equal(result.summary.contradicted, 0);
  assert.equal(result.triagePriority, 94);
});

test('evaluateOpportunitySignals: zero bid is treated as missing (ratio branch only fires when bid > 0)', () => {
  const future = '2099-12-31';
  const observations = { signals: [{ listingId: 'L1', type: 'bid_reduced' }] };
  const publicRecords = { parcel: { properties: { livingAreaSqft: 1500 }, source: { url: 'parcel.example' } } };
  // bid=0 falls into the "valuation ratio unavailable" branch — the ratio component
  // is suppressed from priority, so 5/6 supported → 20 + 20 + 10 + 10 + (5/6 * 10) = 68
  const result = evaluateOpportunitySignals(
    {
      id: 'L1', openingBid: 0, mid: 200000,
      sqft: 1500, saleDate: future, status: 'returned',
      seniorLienRisk: 'low', redemptionDays: 30, cashToClose: 5000,
    },
    { observations, publicRecords }
  );
  assert.equal(result.triagePriority, 68);
});

test('evaluateOpportunitySignals: priority is clamped to [1, 99]', () => {
  const low = evaluateOpportunitySignals({});
  assert.ok(low.triagePriority >= 1 && low.triagePriority <= 99);
  const high = evaluateOpportunitySignals(
    { openingBid: 100, estLow: 1000000, estHigh: 2000000, saleDate: '2099-01-01' },
    { observations: { signals: [{ listingId: undefined, type: 'bid_reduced' }] } }
  );
  assert.ok(high.triagePriority >= 1 && high.triagePriority <= 99);
});

test('evaluateOpportunitySignals: triage includes disclaimer', () => {
  const result = evaluateOpportunitySignals({});
  assert.match(result.disclaimer, /triage priority only/i);
});

// --- generatedAt + listingId ------------------------------------------

test('evaluateOpportunitySignals: generatedAt is an ISO string from now', () => {
  const now = Date.UTC(2026, 4, 7, 12, 0, 0);
  const result = evaluateOpportunitySignals({ id: 'L1' }, { now });
  assert.equal(result.generatedAt, new Date(now).toISOString());
  assert.equal(result.listingId, 'L1');
});

test('evaluateOpportunitySignals: listingId null if listing has no id', () => {
  const result = evaluateOpportunitySignals({});
  assert.equal(result.listingId, undefined);
});

test('evaluateOpportunitySignals: observedAt pulls from listing.sourceObservedAt', () => {
  const result = evaluateOpportunitySignals({ id: 'L1', sourceObservedAt: '2025-09-01T00:00:00.000Z' });
  for (const sig of result.signals) {
    assert.equal(sig.observedAt, '2025-09-01T00:00:00.000Z');
  }
});