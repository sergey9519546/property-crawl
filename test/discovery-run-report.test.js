'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sanitizeRunReport } = require('../server/discovery/run-report');
const { createDiscoveryStore } = require('../server/discovery/store');

test('run report retains bounded common coverage including valid zero counts', () => {
  const coverage = sanitizeRunReport({
    outcome: 'empty', complete: true, fullSweepComplete: true, truncated: false,
    scope: { endpoint: '/inventory', filters: { assetClass: 'real_property', authorization: 'secret' } },
    recordsDiscovered: 0, recordsEmitted: 0, recordsRejected: 0, pagesRequested: 1, pagesFetched: 1,
    statesDiscovered: 2, discoveredStates: ['ca', 'TX', 'invalid'], maxPages: 10, limit: 25, bounded: true,
    sweepStartedAt: '2026-09-12T00:00:00Z'
  }, { accepted: 0, ingestionRejected: 0 });
  assert.equal(coverage.counts.publisherDiscovered, 0);
  assert.equal(coverage.counts.accepted, 0);
  assert.deepEqual(coverage.jurisdictions.codes.discovered, ['CA', 'TX']);
  assert.deepEqual(coverage.acquisitionScope.filters, { assetClass: 'real_property' });
  assert.deepEqual(coverage.budget, { bounded: true, maxPages: 10, pageSize: 25 });
});

test('run report rejects malformed counts and cannot retain tokens, failures, auth, extraction, or arbitrary metadata', () => {
  const coverage = sanitizeRunReport({
    outcome: 'invented', recordsDiscovered: -1, recordsEmitted: '4', pagesFetched: Number.MAX_SAFE_INTEGER,
    nextContinuationToken: 'cursor-secret', failures: [{ error: 'private' }], extraction: { raw: 'private' }, authorization: 'Bearer secret',
    scope: { endpoint: 'https://user:pass@example.test/list', filters: { token: 'secret' } }, arbitrary: { raw: true }
  });
  const serialized = JSON.stringify(coverage);
  assert.deepEqual(coverage, { version: 1 });
  assert.doesNotMatch(serialized, /cursor|private|secret|Bearer|extraction|failure/i);
});

test('run report retains an exact bounded county ID and rejects malformed county scope', () => {
  const exact = sanitizeRunReport({
    scope: { endpoint: '/Sales/SalesSearch', filters: { state: 'NJ', countyId: '0020' } },
  });
  assert.deepEqual(exact.acquisitionScope, {
    endpoint: '/Sales/SalesSearch', filters: { state: 'NJ', countyId: '0020' },
  });

  for (const countyId of [20, '', '20 OR 1=1', '1'.repeat(21)]) {
    const malformed = sanitizeRunReport({
      scope: { endpoint: '/Sales/SalesSearch', filters: { state: 'NJ', countyId } },
    });
    assert.deepEqual(malformed.acquisitionScope.filters, { state: 'NJ' });
  }
});

test('finishRun persists additive coverage while keeping legacy callers compatible', async () => {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ id: params[0] }] }; } };
  const store = createDiscoveryStore({ pool });
  await store.finishRun('run-covered', { status: 'complete', discovered: 5, accepted: 4, rejected: 1, coverage: { version: 1, counts: { publisherDiscovered: 5 } } });
  assert.match(calls[0].sql, /coverage=\$7::jsonb/);
  assert.deepEqual(JSON.parse(calls[0].params[6]), { version: 1, counts: { publisherDiscovered: 5 } });
  await store.finishRun('run-legacy', { status: 'complete', accepted: 0 });
  assert.deepEqual(JSON.parse(calls[1].params[6]), {});
});

test('HUD jurisdiction arrays retain completed and remaining codes while numeric USDA completion remains a count', () => {
  const hud = sanitizeRunReport({
    configuredStates: ['ca', 'TX', 'bad'], attemptedStates: ['CA', 'tx'],
    completedStates: ['CA'], remainingStates: ['TX'], statesAttempted: 2, statesFailed: 0
  });
  assert.deepEqual(hud.jurisdictions, {
    configured: 2, attempted: 2, completed: 1, remaining: 1, failed: 0,
    codes: { configured: ['CA', 'TX'], attempted: ['CA', 'TX'], completed: ['CA'], remaining: ['TX'] }
  });
  const usda = sanitizeRunReport({ configuredStates: 6, statesCompleted: 5 });
  assert.deepEqual(usda.jurisdictions, { configured: 6, completed: 5 });
  const malformed = sanitizeRunReport({ configuredStates: '6', statesCompleted: { length: 5 } });
  assert.equal(malformed.jurisdictions, undefined);
});
