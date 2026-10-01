'use strict';

// test/intelligence/signals-helpers.test.js
//
// Direct unit coverage for the Opportunity-Signal evaluator exported
// from server/intelligence/signals.js. Every dashboard triage number,
// "Next Action" chip, and contradiction badge across the app is computed
// here.
//
// HONESTY GATE (pinned hard, because it is the point of the module):
// a signal may only be reported as `supported` when the listing is
// backed by validated live publisher evidence —
//   provenance.origin === 'live'
//   provenance.observed === true
//   listing.sourceUrl is non-empty
//   provenance.publisher is non-empty
//   provenance.recordId is non-empty
//   the observedAt timestamp is parseable
// A listing missing any one of those can never claim `supported`, no
// matter how complete its fields look. Demo / snapshot / fixture rows
// therefore never inflate the triage score.
//
// Additional pinned contracts:
//   - valuation mid is derived from the estLow..estHigh band (not from a
//     caller-supplied `mid`), and the band must be ordered and positive
//   - square-footage corroboration requires a parcel with
//     status === 'matched', not merely a parcel object
//   - seniorLienRisk of exactly 'unknown' never counts as resolved risk
//   - SIGNAL_WEIGHTS sum to 1.0; triage is clamped to [1, 99]

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  evaluateOpportunitySignals,
  SIGNAL_WEIGHTS,
} = require('../../server/intelligence/signals');

const NOW = Date.UTC(2026, 0, 15);

// A listing that satisfies the publisher-evidence gate. Every
// "supported" assertion below builds on this so a single failing
// prerequisite cannot silently make the whole matrix look green.
function liveListing(overrides = {}) {
  return {
    id: 'L1',
    sourceUrl: 'https://sheriffsaleauction.ohio.gov/x/2024-CV-001',
    sourceObservedAt: '2026-01-10T00:00:00.000Z',
    provenance: {
      origin: 'live',
      observed: true,
      publisher: 'Ohio Sheriff Sale Auction',
      recordId: '2024-CV-001',
    },
    ...overrides,
  };
}

function signalFor(result, key) {
  return result.signals.find((s) => s.key === key);
}

// --- SIGNAL_WEIGHTS ----------------------------------------------------

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

// --- shape invariants --------------------------------------------------

test('evaluateOpportunitySignals: empty listing still returns 6 signals and valid triage', () => {
  const result = evaluateOpportunitySignals({}, { now: NOW });
  assert.equal(result.signals.length, 6);
  const keys = result.signals.map((s) => s.key);
  assert.deepEqual(
    [...new Set(keys)].sort(),
    ['bid_reduction', 'bid_to_value_ratio', 'building_area_discrepancy', 'returned_to_market', 'sale_date_known', 'title_equity_unresolved']
  );
  assert.ok(result.triagePriority >= 1);
  assert.ok(result.triagePriority <= 99);
});

test('evaluateOpportunitySignals: priority is clamped to [1, 99]', () => {
  const low = evaluateOpportunitySignals({}, { now: NOW });
  assert.ok(low.triagePriority >= 1 && low.triagePriority <= 99);
});

test('evaluateOpportunitySignals: triage includes disclaimer', () => {
  assert.match(evaluateOpportunitySignals({}, { now: NOW }).disclaimer, /triage priority only/i);
});

test('evaluateOpportunitySignals: generatedAt is an ISO string from now', () => {
  const result = evaluateOpportunitySignals({ id: 'L1' }, { now: NOW });
  assert.equal(result.generatedAt, new Date(NOW).toISOString());
  assert.equal(result.listingId, 'L1');
});

test('evaluateOpportunitySignals: observedAt pulled from listing.sourceObservedAt', () => {
  const result = evaluateOpportunitySignals(liveListing({ saleDate: '2099-12-31' }), { now: NOW });
  assert.equal(signalFor(result, 'sale_date_known').observedAt, '2026-01-10T00:00:00.000Z');
});

// --- the publisher-evidence gate ---------------------------------------

test('gate: complete publisher evidence is required for a supported sale date', () => {
  const result = evaluateOpportunitySignals(liveListing({ saleDate: '2099-12-31' }), { now: NOW });
  assert.equal(signalFor(result, 'sale_date_known').status, 'supported');
});

test('gate: snapshot origin cannot claim a supported sale date', () => {
  const listing = liveListing({ saleDate: '2099-12-31' });
  listing.provenance = { ...listing.provenance, origin: 'archive' };
  const result = evaluateOpportunitySignals(listing, { now: NOW });
  const sig = signalFor(result, 'sale_date_known');
  assert.equal(sig.status, 'unknown');
  assert.match(sig.reason, /not backed by validated live publisher evidence/i);
});

test('gate: unobserved listing cannot claim a supported sale date', () => {
  const listing = liveListing({ saleDate: '2099-12-31' });
  listing.provenance = { ...listing.provenance, observed: false };
  assert.equal(signalFor(evaluateOpportunitySignals(listing, { now: NOW }), 'sale_date_known').status, 'unknown');
});

test('gate: missing sourceUrl cannot claim a supported sale date', () => {
  const listing = liveListing({ saleDate: '2099-12-31' });
  delete listing.sourceUrl;
  assert.equal(signalFor(evaluateOpportunitySignals(listing, { now: NOW }), 'sale_date_known').status, 'unknown');
});

test('gate: missing publisher cannot claim a supported sale date', () => {
  const listing = liveListing({ saleDate: '2099-12-31' });
  delete listing.provenance.publisher;
  assert.equal(signalFor(evaluateOpportunitySignals(listing, { now: NOW }), 'sale_date_known').status, 'unknown');
});

test('gate: missing recordId cannot claim a supported sale date', () => {
  const listing = liveListing({ saleDate: '2099-12-31' });
  delete listing.provenance.recordId;
  assert.equal(signalFor(evaluateOpportunitySignals(listing, { now: NOW }), 'sale_date_known').status, 'unknown');
});

test('gate: a fully-populated demo row never reaches supported on any signal', () => {
  // Everything a listing could carry, but none of the provenance a
  // live publisher record would have. Nothing may be "supported".
  const result = evaluateOpportunitySignals({
    id: 'D1',
    saleDate: '2099-12-31',
    openingBid: 50000,
    estLow: 200000,
    estHigh: 300000,
    sqft: 1500,
    status: 'returned',
    seniorLienRisk: 'low',
    redemptionDays: 30,
    cashToClose: 5000,
  }, { now: NOW, publicRecords: { parcel: { status: 'matched', properties: { livingAreaSqft: 1500 } } } });
  assert.equal(result.summary.supported, 0);
  for (const sig of result.signals) {
    assert.notEqual(sig.status, 'supported', `${sig.key} wrongly claimed supported`);
  }
});

// --- sale_date_known ---------------------------------------------------

test('sale_date_known: past sale date -> unknown with "has passed" label', () => {
  const result = evaluateOpportunitySignals(liveListing({ saleDate: '2020-01-01' }), { now: NOW });
  const sig = signalFor(result, 'sale_date_known');
  assert.equal(sig.status, 'unknown');
  assert.match(sig.label, /passed/i);
});

test('sale_date_known: missing saleDate -> unresolved', () => {
  const result = evaluateOpportunitySignals(liveListing(), { now: NOW });
  const sig = signalFor(result, 'sale_date_known');
  assert.equal(sig.status, 'unknown');
  assert.equal(sig.evidenceClass, 'unresolved');
});

test('sale_date_known: future sale date reason quotes the date', () => {
  const result = evaluateOpportunitySignals(liveListing({ saleDate: '2099-12-31' }), { now: NOW });
  assert.match(signalFor(result, 'sale_date_known').reason, /2099-12-31/);
});

// --- bid_reduction -----------------------------------------------------

test('bid_reduction: bid_reduced observation -> supported', () => {
  const observations = { records: {}, signals: [{ listingId: 'L1', type: 'bid_reduced' }] };
  const result = evaluateOpportunitySignals(liveListing(), { observations, now: NOW });
  const sig = signalFor(result, 'bid_reduction');
  assert.equal(sig.status, 'supported');
  assert.equal(sig.evidenceClass, 'exact_source_observation');
});

test('bid_reduction: `kind` field is accepted as well as `type`', () => {
  const observations = { records: {}, signals: [{ listingId: 'L1', kind: 'bid_reduced' }] };
  const result = evaluateOpportunitySignals(liveListing(), { observations, now: NOW });
  assert.equal(signalFor(result, 'bid_reduction').status, 'supported');
});

test('bid_reduction: label-text fallback ("Bid was dropped")', () => {
  const observations = { records: {}, signals: [{ listingId: 'L1', label: 'Bid was dropped' }] };
  const result = evaluateOpportunitySignals(liveListing(), { observations, now: NOW });
  assert.equal(signalFor(result, 'bid_reduction').status, 'supported');
});

test('bid_reduction: no observation -> unresolved', () => {
  const result = evaluateOpportunitySignals(liveListing(), { now: NOW });
  const sig = signalFor(result, 'bid_reduction');
  assert.equal(sig.status, 'unknown');
});

// --- returned_to_market ------------------------------------------------

test('returned_to_market: "returned to market" status -> supported', () => {
  assert.equal(signalFor(evaluateOpportunitySignals(liveListing({ status: 'returned to market' }), { now: NOW }), 'returned_to_market').status, 'supported');
});

test('returned_to_market: "Re-listed" status -> supported', () => {
  assert.equal(signalFor(evaluateOpportunitySignals(liveListing({ status: 'Re-listed' }), { now: NOW }), 'returned_to_market').status, 'supported');
});

test('returned_to_market: "Rescheduled" status -> supported', () => {
  assert.equal(signalFor(evaluateOpportunitySignals(liveListing({ status: 'Rescheduled' }), { now: NOW }), 'returned_to_market').status, 'supported');
});

test('returned_to_market: rawNotice phrase -> supported', () => {
  const listing = liveListing({ raw: 'Property returned to market after postponement' });
  assert.equal(signalFor(evaluateOpportunitySignals(listing, { now: NOW }), 'returned_to_market').status, 'supported');
});

test('returned_to_market: plain "Active" -> unknown', () => {
  assert.equal(signalFor(evaluateOpportunitySignals(liveListing({ status: 'Active' }), { now: NOW }), 'returned_to_market').status, 'unknown');
});

// --- bid_to_value_ratio ------------------------------------------------

test('bid_to_value_ratio: bid under the estLow..estHigh mid -> supported', () => {
  // mid = (200k + 300k) / 2 = 250k; ratio = 100k / 250k = 40%
  const result = evaluateOpportunitySignals(liveListing({ openingBid: 100000, estLow: 200000, estHigh: 300000 }), { now: NOW });
  const sig = signalFor(result, 'bid_to_value_ratio');
  assert.equal(sig.status, 'supported');
  assert.match(sig.reason, /40\.0%/);
});

test('bid_to_value_ratio: bid over the mid -> contradicted', () => {
  const result = evaluateOpportunitySignals(liveListing({ openingBid: 400000, estLow: 200000, estHigh: 300000 }), { now: NOW });
  assert.equal(signalFor(result, 'bid_to_value_ratio').status, 'contradicted');
});

test('bid_to_value_ratio: mid comes from the band, not a caller-supplied `mid`', () => {
  // A `mid` of 200000 would imply a 50% ratio. The module ignores it and
  // uses the estLow..estHigh band (mid 250000 -> 40%).
  const result = evaluateOpportunitySignals(
    liveListing({ openingBid: 100000, mid: 200000, estLow: 200000, estHigh: 300000 }),
    { now: NOW },
  );
  assert.match(signalFor(result, 'bid_to_value_ratio').reason, /40\.0%/);
});

test('bid_to_value_ratio: estHigh below estLow is not a usable band', () => {
  const result = evaluateOpportunitySignals(liveListing({ openingBid: 100000, estLow: 300000, estHigh: 200000 }), { now: NOW });
  assert.equal(signalFor(result, 'bid_to_value_ratio').status, 'unknown');
});

test('bid_to_value_ratio: non-positive estLow is not a usable band', () => {
  const result = evaluateOpportunitySignals(liveListing({ openingBid: 100000, estLow: 0, estHigh: 300000 }), { now: NOW });
  assert.equal(signalFor(result, 'bid_to_value_ratio').status, 'unknown');
});

test('bid_to_value_ratio: missing band -> unavailable', () => {
  const result = evaluateOpportunitySignals(liveListing({ openingBid: 100000 }), { now: NOW });
  assert.equal(signalFor(result, 'bid_to_value_ratio').status, 'unknown');
});

test('bid_to_value_ratio: zero bid is treated as missing', () => {
  const result = evaluateOpportunitySignals(liveListing({ openingBid: 0, estLow: 200000, estHigh: 300000 }), { now: NOW });
  assert.equal(signalFor(result, 'bid_to_value_ratio').status, 'unknown');
});

// --- building_area_discrepancy ----------------------------------------

test('building_area_discrepancy: matched parcel with equal sqft -> supported', () => {
  const publicRecords = { parcel: { status: 'matched', properties: { livingAreaSqft: 1500 }, source: { url: 'parcel.example' } } };
  const result = evaluateOpportunitySignals(liveListing({ sqft: 1500 }), { publicRecords, now: NOW });
  const sig = signalFor(result, 'building_area_discrepancy');
  assert.equal(sig.status, 'supported');
  assert.equal(sig.sourceUrl, 'parcel.example');
});

test('building_area_discrepancy: >10% sqft mismatch -> contradicted', () => {
  const publicRecords = { parcel: { status: 'matched', properties: { livingAreaSqft: 1500 } } };
  const result = evaluateOpportunitySignals(liveListing({ sqft: 1000 }), { publicRecords, now: NOW });
  const sig = signalFor(result, 'building_area_discrepancy');
  assert.equal(sig.status, 'contradicted');
  assert.equal(sig.evidenceClass, 'official_parcel_roll');
});

test('building_area_discrepancy: parcel present but not matched -> uncorroborated', () => {
  const publicRecords = { parcel: { status: 'candidate', properties: { livingAreaSqft: 1500 } } };
  const result = evaluateOpportunitySignals(liveListing({ sqft: 1500 }), { publicRecords, now: NOW });
  assert.equal(signalFor(result, 'building_area_discrepancy').status, 'unknown');
});

test('building_area_discrepancy: no parcel -> uncorroborated', () => {
  const result = evaluateOpportunitySignals(liveListing({ sqft: 1500 }), { now: NOW });
  assert.equal(signalFor(result, 'building_area_discrepancy').status, 'unknown');
});

// --- title_equity_unresolved ------------------------------------------

test('title_equity_unresolved: all three title facts -> supported', () => {
  const listing = liveListing({ seniorLienRisk: 'low', redemptionDays: 30, cashToClose: 5000 });
  assert.equal(signalFor(evaluateOpportunitySignals(listing, { now: NOW }), 'title_equity_unresolved').status, 'supported');
});

test('title_equity_unresolved: seniorLienRisk "unknown" never counts as resolved', () => {
  const listing = liveListing({ seniorLienRisk: 'unknown', redemptionDays: 30, cashToClose: 5000 });
  const sig = signalFor(evaluateOpportunitySignals(listing, { now: NOW }), 'title_equity_unresolved');
  assert.equal(sig.status, 'unknown');
});

test('title_equity_unresolved: missing redemptionDays -> unresolved', () => {
  const listing = liveListing({ seniorLienRisk: 'low', cashToClose: 5000 });
  assert.equal(signalFor(evaluateOpportunitySignals(listing, { now: NOW }), 'title_equity_unresolved').status, 'unknown');
});

// --- triage priority ---------------------------------------------------

test('triage: all six signals supported -> weighted score of 94', () => {
  const observations = { signals: [{ listingId: 'L1', type: 'bid_reduced' }] };
  const publicRecords = { parcel: { status: 'matched', properties: { livingAreaSqft: 1500 } } };
  const result = evaluateOpportunitySignals(
    liveListing({
      openingBid: 50000, estLow: 200000, estHigh: 300000,
      sqft: 1500, saleDate: '2099-12-31', status: 'returned',
      seniorLienRisk: 'low', redemptionDays: 30, cashToClose: 5000,
    }),
    { observations, publicRecords, now: NOW },
  );
  assert.equal(result.summary.supported, 6);
  assert.equal(result.summary.unknown, 0);
  assert.equal(result.summary.contradicted, 0);
  // ratio 0.8 -> 24, then 20 + 20 + 10 + 10 + 10 completeness
  assert.equal(result.triagePriority, 94);
});

test('triage: a contradicted area record is a flag, never a score bonus', () => {
  const publicRecords = { parcel: { status: 'matched', properties: { livingAreaSqft: 3000 } } };
  const listing = liveListing({ sqft: 1000, saleDate: '2099-12-31' });
  const result = evaluateOpportunitySignals(listing, { publicRecords, now: NOW });
  assert.equal(signalFor(result, 'building_area_discrepancy').status, 'contradicted');
  // Only sale_date is supported: 20 pts, plus completeness 1/6 * 10 = 1.67.
  // The area contradiction contributes nothing.
  assert.equal(result.triagePriority, 22);
});