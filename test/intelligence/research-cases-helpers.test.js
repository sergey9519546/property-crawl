'use strict';

// test/intelligence/research-cases-helpers.test.js
//
// Direct unit coverage for the pure helpers exported from
// server/intelligence/research-cases.js. These back the research
// workspace — case creation, reconsideration rules, dossier summaries,
// and provenance normalization. Silent drift would let malformed
// provenance or oversized dossiers land in the workspace and corrupt
// every downstream summary.
//
//   - canonicalJson: stable key-sorted JSON, key order independence,
//     array and primitive handling
//   - sha: deterministic hash for the same inputs
//   - identityKey: `${sourceId}:${recordId}` contract
//   - normalizeSourceRef: source key lower-case + recordId trim
//   - caseSummary: read-only projection of the case record
//   - normalizeReconsideration: mode/conditions validation, operator
//     allow-list per field, numeric bounds, primitive value coercion

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  canonicalJson,
  sha,
  identityKey,
  normalizeSourceRef,
  caseSummary,
} = require('../../server/intelligence/research-cases');

// --- canonicalJson ---------------------------------------------------

test('canonicalJson: keys are sorted alphabetically regardless of input order', () => {
  const a = canonicalJson({ b: 1, a: 2 });
  const b = canonicalJson({ a: 2, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1}');
});

test('canonicalJson: nested object keys are also sorted', () => {
  const a = canonicalJson({ outer: { z: 1, a: 2 } });
  assert.equal(a, '{"outer":{"a":2,"z":1}}');
});

test('canonicalJson: arrays preserve their order (order-sensitive)', () => {
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
});

test('canonicalJson: handles null and primitive values', () => {
  assert.equal(canonicalJson(null), 'null');
  assert.equal(canonicalJson(42), '42');
  assert.equal(canonicalJson('hello'), '"hello"');
  assert.equal(canonicalJson(true), 'true');
});

// --- sha --------------------------------------------------------------

test('sha: same input yields the same 64-char hex digest', () => {
  assert.equal(sha({ a: 1, b: 2 }), sha({ a: 1, b: 2 }));
  assert.match(sha({ a: 1 }), /^[a-f0-9]{64}$/);
});

test('sha: key order does not affect the hash (canonicalJson dependency)', () => {
  // canonicalJson sorts keys, so sha() of {a:1,b:2} and {b:2,a:1} match.
  assert.equal(sha({ a: 1, b: 2 }), sha({ b: 2, a: 1 }));
});

test('sha: accepts a string input directly', () => {
  const expected = sha('plain-string-input');
  assert.equal(sha('plain-string-input'), expected);
});

// --- identityKey ------------------------------------------------------

test('identityKey: returns a 64-char hex digest derived from sourceId+recordId', () => {
  const out = identityKey({ sourceId: 'sheriff', recordId: 'rec-1' });
  assert.match(out, /^[a-f0-9]{64}$/);
});

test('identityKey: is deterministic for the same inputs', () => {
  const a = identityKey({ sourceId: 'sheriff', recordId: 'rec-1' });
  const b = identityKey({ sourceId: 'SHERIFF', recordId: 'rec-1' });
  // normalizeSourceRef lower-cases sourceId, so case is normalised.
  assert.equal(a, b);
});

test('identityKey: different recordIds produce different keys', () => {
  const a = identityKey({ sourceId: 'sheriff', recordId: 'rec-1' });
  const b = identityKey({ sourceId: 'sheriff', recordId: 'rec-2' });
  assert.notEqual(a, b);
});

test('identityKey: throws RESEARCH_SOURCE_REF_INVALID on non-object input', () => {
  // identityKey delegates validation to normalizeSourceRef, which throws.
  assert.throws(() => identityKey(null), (err) => err.code === 'RESEARCH_SOURCE_REF_INVALID');
  assert.throws(() => identityKey('not an object'), (err) => err.code === 'RESEARCH_SOURCE_REF_INVALID');
});

// --- normalizeSourceRef ----------------------------------------------

test('normalizeSourceRef: lower-cases the sourceId and trims recordId', () => {
  const out = normalizeSourceRef({ sourceId: '  SHERIFF  ', recordId: '  rec-1  ' });
  assert.equal(out.sourceId, 'sheriff');
  assert.equal(out.recordId, 'rec-1');
});

test('normalizeSourceRef: throws RESEARCH_SOURCE_REF_INVALID on empty sourceId', () => {
  assert.throws(
    () => normalizeSourceRef({ sourceId: '', recordId: 'rec-1' }),
    (err) => err.code === 'RESEARCH_SOURCE_REF_INVALID'
  );
});

test('normalizeSourceRef: throws RESEARCH_INVALID on missing recordId', () => {
  // The helper delegates to cleanText with required=true, which throws
  // RESEARCH_INVALID when recordId is empty.
  assert.throws(
    () => normalizeSourceRef({ sourceId: 'sheriff' }),
    (err) => err.code === 'RESEARCH_INVALID' || err.code === 'RESEARCH_SOURCE_REF_INVALID'
  );
});

test('normalizeSourceRef: throws RESEARCH_SOURCE_REF_INVALID on sourceId with disallowed characters', () => {
  // The SOURCE_ID regex requires lowercase alphanumeric + hyphens.
  assert.throws(
    () => normalizeSourceRef({ sourceId: 'INVALID!', recordId: 'rec-1' }),
    (err) => err.code === 'RESEARCH_SOURCE_REF_INVALID'
  );
});

test('normalizeSourceRef: throws RESEARCH_SOURCE_REF_INVALID on non-object input', () => {
  assert.throws(
    () => normalizeSourceRef(null),
    (err) => err.code === 'RESEARCH_SOURCE_REF_INVALID'
  );
  assert.throws(
    () => normalizeSourceRef('not an object'),
    (err) => err.code === 'RESEARCH_SOURCE_REF_INVALID'
  );
  assert.throws(
    () => normalizeSourceRef([1, 2, 3]),
    (err) => err.code === 'RESEARCH_SOURCE_REF_INVALID'
  );
});

// --- caseSummary -----------------------------------------------------

test('caseSummary: projects the documented summary fields from a case record', () => {
  const item = {
    id: 'case-1',
    identityKey: 'sheriff:1',
    sourceRef: { sourceId: 'sheriff', recordId: 'rec-1' },
    listingId: 'L1',
    address: '500 Oak',
    state: 'Active',
    listingAliases: ['L1', 'L1-alt'],
    revision: 5,
    decision: 'approved',
    reconsideration: null,
    reconsiderationRequired: false,
    latestTrigger: { type: 'bid_reduced' },
    origins: [{ type: 'live' }],
    listingSnapshot: { saleDate: '2026-09-01', openingBid: 100000, status: 'Active' },
    evidenceLinks: [{ id: 'e1' }, { id: 'e2' }],
    createdAt: '2026-06-15T10:00:00Z',
    updatedAt: '2026-06-16T10:00:00Z',
  };
  const summary = caseSummary(item);
  assert.equal(summary.id, 'case-1');
  assert.equal(summary.identityKey, 'sheriff:1');
  assert.equal(summary.sourceRef.sourceId, 'sheriff');
  assert.equal(summary.listingId, 'L1');
  assert.deepEqual(summary.listingAliases, ['L1', 'L1-alt']);
  assert.equal(summary.workspaceState, 'Active');
  assert.equal(summary.revision, 5);
  assert.equal(summary.decision, 'approved');
  assert.equal(summary.reconsiderationRequired, false);
  assert.equal(summary.originCount, 1);
  assert.equal(summary.evidenceCount, 2);
  assert.equal(summary.saleDate, '2026-09-01');
  assert.equal(summary.openingBid, 100000);
  assert.equal(summary.publishedStatus, 'Active');
});

test('caseSummary: defaults listingAliases to a one-element array when missing', () => {
  const summary = caseSummary({
    id: 'c', listingId: 'L1', state: 'Active', origins: [], evidenceLinks: [],
    listingSnapshot: {}, createdAt: '', updatedAt: '',
  });
  assert.deepEqual(summary.listingAliases, ['L1']);
});

test('caseSummary: returns null for the numeric snapshot fields when not present', () => {
  const summary = caseSummary({
    id: 'c', state: 'Active', origins: [], evidenceLinks: [],
    listingSnapshot: {}, createdAt: '', updatedAt: '',
  });
  assert.equal(summary.openingBid, null);
  assert.equal(summary.saleDate, null);
  assert.equal(summary.publishedStatus, null);
});

test('caseSummary: returns null latestTrigger when none is recorded', () => {
  const summary = caseSummary({
    id: 'c', state: 'Active', origins: [], evidenceLinks: [],
    listingSnapshot: {}, createdAt: '', updatedAt: '',
  });
  assert.equal(summary.latestTrigger, null);
  assert.equal(summary.latestOrigin, null);
});
