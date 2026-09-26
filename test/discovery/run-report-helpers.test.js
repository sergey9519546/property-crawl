'use strict';

// test/discovery/run-report-helpers.test.js
//
// Direct unit coverage for server/discovery/run-report.js. The run
// report is what the discovery worker emits on every sweep; its shape
// is the source of truth for downstream dashboards and audit gates.
// Silent drift in the count normalization or scope sanitization would
// silently change every emitted report.
//
//   - MAX_COUNT cap (1e9) and the nonnegativeInteger contract
//   - firstInteger: takes the first finite positive integer
//   - stateCodes: trim + uppercase + dedupe + 2-letter filter + 60-cap
//   - safeEndpoint: relative-path acceptance, https-only URL rejection
//   - safeFilters: allowlisted keys, countyId regex, types
//   - acquisitionScope: composes safe endpoint / filters / states / pageSize
//   - sanitizeRunReport: full report schema, count normalization,
//     outcome enum, jurisdiction code projection

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  sanitizeRunReport,
  acquisitionScope,
  MAX_COUNT,
} = require('../../server/discovery/run-report');

// --- MAX_COUNT --------------------------------------------------------

test('MAX_COUNT: 1 billion upper bound on integer count fields', () => {
  assert.equal(MAX_COUNT, 1_000_000_000);
});

// --- acquisitionScope -------------------------------------------------

test('acquisitionScope: non-object -> undefined', () => {
  assert.equal(acquisitionScope(null), undefined);
  assert.equal(acquisitionScope('x'), undefined);
  assert.equal(acquisitionScope([]), undefined);
});

test('acquisitionScope: relative path endpoint with no query/hash -> accepted', () => {
  const out = acquisitionScope({ endpoint: '/search' });
  assert.ok(out);
  assert.equal(out.endpoint, '/search');
});

test('acquisitionScope: relative path with query string -> rejected', () => {
  // Pair the rejected endpoint with an accepted field so the result
  // object still exists (acquisitionScope drops the result entirely
  // when no field survives).
  const out = acquisitionScope({ endpoint: '/search?x=1', pageSize: 25 });
  assert.equal(out.endpoint, undefined);
  assert.equal(out.pageSize, 25);
});

test('acquisitionScope: https URL without credentials / query / hash -> accepted', () => {
  const out = acquisitionScope({ endpoint: 'https://example.com/auction' });
  assert.equal(out.endpoint, 'https://example.com/auction');
});

test('acquisitionScope: http URL rejected', () => {
  const out = acquisitionScope({ endpoint: 'http://example.com/x', pageSize: 25 });
  assert.equal(out.endpoint, undefined);
  assert.equal(out.pageSize, 25);
});

test('acquisitionScope: URL with credentials rejected', () => {
  const out = acquisitionScope({ endpoint: 'https://user:pass@example.com/x', pageSize: 25 });
  assert.equal(out.endpoint, undefined);
  assert.equal(out.pageSize, 25);
});

test('acquisitionScope: URL with query string rejected', () => {
  const out = acquisitionScope({ endpoint: 'https://example.com/x?y=1', pageSize: 25 });
  assert.equal(out.endpoint, undefined);
  assert.equal(out.pageSize, 25);
});

test('acquisitionScope: empty scope -> undefined', () => {
  assert.equal(acquisitionScope({}), undefined);
});

test('acquisitionScope: filters with allowlisted keys only', () => {
  const out = acquisitionScope({ filters: { assetClass: 'residential', NOT_ALLOWED: 'x' } });
  assert.ok(out.filters);
  assert.equal(out.filters.assetClass, 'residential');
  assert.equal(out.filters.NOT_ALLOWED, undefined);
});

test('acquisitionScope: states filter trims + uppercases + dedupes', () => {
  // The 2-letter regex only filters non-string / non-2-letter codes; 'XX'
  // passes the regex check even though it isn't a real US state. The
  // documented contract is "uppercase 2-letter codes only" — we pin that.
  const out = acquisitionScope({ states: [' oh ', 'oh', 'TX'] });
  assert.deepEqual(out.states, ['OH', 'TX']);
});

test('acquisitionScope: states rejects non-string entries', () => {
  const out = acquisitionScope({ states: ['OH', 123, 'TX'] });
  assert.deepEqual(out.states, ['OH', 'TX']);
});

test('acquisitionScope: pageSize within bounds survives', () => {
  const out = acquisitionScope({ pageSize: 100 });
  assert.equal(out.pageSize, 100);
});

test('acquisitionScope: pageSize over MAX_COUNT drops the whole result', () => {
  // When the only field is rejected, the whole result is undefined.
  const out = acquisitionScope({ pageSize: MAX_COUNT + 1 });
  assert.equal(out, undefined);
});

test('acquisitionScope: jurisdictionSelection restricted to publisher_inventory_options', () => {
  const out1 = acquisitionScope({ jurisdictionSelection: 'publisher_inventory_options', pageSize: 25 });
  assert.equal(out1.jurisdictionSelection, 'publisher_inventory_options');

  const out2 = acquisitionScope({ jurisdictionSelection: 'other_value', pageSize: 25 });
  assert.equal(out2.jurisdictionSelection, undefined);
  assert.equal(out2.pageSize, 25);
});

// --- sanitizeRunReport ------------------------------------------------

test('sanitizeRunReport: non-object input -> sanitized empty output', () => {
  const out = sanitizeRunReport(null);
  assert.equal(out.version, 1);
});

test('sanitizeRunReport: counts take firstInteger of legacy aliases', () => {
  const out = sanitizeRunReport({ recordsDiscovered: 10, sourceRows: 5 });
  assert.equal(out.counts.publisherDiscovered, 10);  // recordsDiscovered wins

  const out2 = sanitizeRunReport({ sourceRows: 7 });
  assert.equal(out2.counts.publisherDiscovered, 7);
});

test('sanitizeRunReport: outcome enum restricted to known values', () => {
  const out1 = sanitizeRunReport({ outcome: 'success' });
  assert.equal(out1.outcome, 'success');

  const out2 = sanitizeRunReport({ outcome: 'random' });
  assert.equal(out2.outcome, undefined);
});

test('sanitizeRunReport: pages block aggregates attempted/fetched counts', () => {
  const out = sanitizeRunReport({
    pagesRequested: 10, pagesAttempted: 8, pagesFetched: 7, pagesPreviouslyCommitted: 1,
  });
  assert.equal(out.pages.requested, 10);
  assert.equal(out.pages.attempted, 8);
  assert.equal(out.pages.fetched, 7);
  assert.equal(out.pages.previouslyCommitted, 1);
});

test('sanitizeRunReport: jurisdictions.codes projects state arrays', () => {
  const out = sanitizeRunReport({
    configuredStates: ['OH', 'TX'],
    attemptedStates: ['OH'],
    completedStates: ['OH'],
    recordsDiscovered: 5,
  });
  assert.ok(out.jurisdictions.codes);
  assert.deepEqual(out.jurisdictions.codes.configured, ['OH', 'TX']);
  assert.deepEqual(out.jurisdictions.codes.attempted, ['OH']);
  assert.deepEqual(out.jurisdictions.codes.completed, ['OH']);
});

test('sanitizeRunReport: non-array configuredStates -> jurisdictions omitted entirely', () => {
  // stateCodes returns undefined for non-array input, so the entire
  // jurisdictions block has nothing to project — it gets dropped.
  const out = sanitizeRunReport({ configuredStates: 'not an array' });
  assert.equal(out.jurisdictions, undefined);
});

test('sanitizeRunReport: bounded boolean projected to budget.bounded', () => {
  const out = sanitizeRunReport({ bounded: true });
  assert.equal(out.budget.bounded, true);
});

test('sanitizeRunReport: sweepStartedAt validated as ISO', () => {
  const out1 = sanitizeRunReport({ sweepStartedAt: '2026-01-15T12:00:00Z' });
  assert.equal(out1.sweepStartedAt, '2026-01-15T12:00:00.000Z');

  const out2 = sanitizeRunReport({ sweepStartedAt: 'not a date' });
  assert.equal(out2.sweepStartedAt, undefined);
});

test('sanitizeRunReport: full / partial / truncated flags respected when boolean', () => {
  const out = sanitizeRunReport({ complete: true, fullSweepComplete: true, truncated: false });
  assert.equal(out.complete, true);
  assert.equal(out.fullSweepComplete, true);
  assert.equal(out.truncated, false);
});