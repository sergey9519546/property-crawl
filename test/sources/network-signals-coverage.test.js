'use strict';

// test/sources/network-signals-coverage.test.js
//
// buildSourceNetwork returned `signals: observations.signals.slice(0, 100)`
// and nothing else about how many signals exist.
//
// Measured against the live observation store that is 100 of 2,000 -- 5% --
// with no total, no count and no "more" flag in the payload. The only
// near-total key in the response is `historyUnavailable`, a boolean. So
// /api/source-network shows a reader a hundred "collection changes" and gives
// them no way to know nineteen hundred more exist.
//
// Same defect as the auction calendar and /api/neighborhoods, same lesson:
// truncation has to be described at the layer it happened. The observation
// store is read whole; the RESULT is the slice, and nothing said so.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { buildSourceNetwork } = require('../../server/sources/network');

const CATALOG = [{
  id: 'hud-homestore',
  adapterKey: 'hud',
  label: 'HUD Homes to Buy',
  tier: 1,
  color: '#000000',
  note: '',
  active: true,
  workflow: { cadenceHours: 24, scope: 'national' },
}];

function observations(signalCount) {
  const signals = Array.from({ length: signalCount }, (_, i) => ({
    id: `sig_${String(i).padStart(24, '0')}`,
    sourceId: 'hud',
    recordId: String(i),
    listingId: `L-${i}`,
    address: `${i} Test Avenue`,
    observedAt: '2026-10-01T00:00:00.000Z',
  }));
  return { version: 1, runs: {}, records: {}, signals };
}

function network(store) {
  return buildSourceNetwork({
    catalog: CATALOG,
    adapters: [],
    listings: [],
    evidenceCollectors: [],
    evidenceSummary: {},
    observations: store,
  });
}

test('a sliced signal list publishes how many signals exist', () => {
  const result = network(observations(1000));

  assert.equal(result.signals.length, 100, 'the cap is unchanged');
  assert.equal(result.signalsTotal, 1000, 'but the payload must say 1,000 exist');
  assert.equal(result.signalsReturned, 100);
  assert.equal(result.signalsTruncated, true, 'slicing the result is truncation');
});

test('a complete signal list does not claim to be truncated', () => {
  const result = network(observations(12));
  assert.equal(result.signals.length, 12);
  assert.equal(result.signalsTotal, 12);
  assert.equal(result.signalsTruncated, false);
});

test('an empty observation store reports zero rather than omitting the fields', () => {
  const result = network({ version: 1, runs: {}, records: {}, signals: [] });
  assert.deepEqual(result.signals, []);
  assert.equal(result.signalsTotal, 0);
  assert.equal(result.signalsReturned, 0);
  assert.equal(result.signalsTruncated, false);
});

test('the cap takes the head of the stored order rather than picking arbitrarily', () => {
  // buildSourceNetwork does not re-sort: the observation store keeps signals
  // newest-first and this takes the first hundred of whatever order it is
  // given. That is the property worth pinning -- if it ever started sorting,
  // filtering or sampling, "the 100 newest" would quietly become "100 of
  // them", which is the same defect in a new place.
  const store = observations(1000);
  const result = network(store);

  assert.deepEqual(
    result.signals.map((s) => s.id),
    store.signals.slice(0, 100).map((s) => s.id),
    'the returned signals are the first hundred the store listed',
  );
});