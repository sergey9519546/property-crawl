'use strict';

// test/source-taxonomy-summary.test.js
//
// The Source Radar's status line is the only place the page summarises source
// TRUST. It read `s.status`, which carries the operational collection state
// (collected / attention / stale / import_available / ...). The catalog taxonomy
// it was counting -- VERIFIED_OFFICIAL, SCOPE_LIMITED, DISCOVERY_ONLY,
// INCONCLUSIVE_BLOCKED -- lives on `s.trustStatus`.
//
// The two vocabularies are disjoint, so all four counters were permanently zero
// and the page rendered:
//
//     0 verified · 0 scope-limited · 0 discovery-only · 0 blocked
//
// directly above a list naming four blocked sources. Four confident zeros read
// as "nothing is verified and nothing is blocked", which is the opposite of the
// truth: 10 verified, 2 blocked.
//
// The same shape as the seven silent-slice sites fixed earlier -- a summary
// describing a different layer than the data it summarises.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const COMPONENT = path.join(ROOT, 'src', 'components', 'sources', 'source-network.tsx');

// taxonomySummary is exported for this test; before that it was unreachable and
// the only thing that could check it was a regex over the source.
const { taxonomySummary } = require(path.join(ROOT, 'src', 'lib', 'source-taxonomy.js'));

test('trust taxonomy is read from trustStatus, not from the operational status', () => {
  const sources = [
    { id: 'a', status: 'collected', trustStatus: 'VERIFIED_OFFICIAL' },
    { id: 'b', status: 'collected', trustStatus: 'VERIFIED_FIRST_PARTY' },
    { id: 'c', status: 'attention', trustStatus: 'INCONCLUSIVE_BLOCKED' },
    { id: 'd', status: 'stale', trustStatus: 'DISCOVERY_ONLY' },
    { id: 'e', status: 'collected', trustStatus: 'SCOPE_LIMITED' },
  ];
  const line = taxonomySummary(sources);
  assert.equal(line, '2 verified · 1 scope-limited · 1 discovery-only · 1 blocked');
  // The regression in one assertion: every source above has an operational
  // status, and not one of those values appears in the taxonomy.
  assert.doesNotMatch(line, /\b0 verified/);
  assert.doesNotMatch(line, /\b0 blocked/);
});

test('an operational status must never be mistaken for a trust value', () => {
  // Guard against the same confusion coming back through a different spelling.
  const sources = [
    { id: 'a', status: 'collected', trustStatus: 'VERIFIED_OFFICIAL' },
    { id: 'b', status: 'import_available', trustStatus: 'LOCAL_ROUTE' },
    { id: 'c', status: 'attention', trustStatus: 'INCONCLUSIVE_BLOCKED' },
  ];
  assert.equal(taxonomySummary(sources), '1 verified · 1 scope-limited · 0 discovery-only · 1 blocked');
  // Nothing may be counted on `status` alone.
  const noTrust = [{ id: 'z', status: 'VERIFIED_OFFICIAL' }];
  assert.equal(taxonomySummary(noTrust), '0 verified · 0 scope-limited · 0 discovery-only · 0 blocked',
    'a source with no trustStatus must contribute to nothing, not be credited on its status');
});

test('a source missing trustStatus does not make the whole line collapse to zero', () => {
  // The original failure mode was total: one bad field zeroed all four buckets
  // at once, so a partially-populated payload read as a blank slate.
  const sources = [
    { id: 'a', trustStatus: 'VERIFIED_OFFICIAL' },
    { id: 'b', trustStatus: undefined },
    { id: 'c', trustStatus: 'DISCOVERY_ONLY' },
  ];
  assert.equal(taxonomySummary(sources), '1 verified · 0 scope-limited · 1 discovery-only · 0 blocked');
});

test('the component calls the shared helper rather than counting inline', () => {
  // The count must live in one place. Two implementations of "what does
  // verified mean" is how they drift apart in the first place.
  const src = fs.readFileSync(COMPONENT, 'utf8');
  assert.match(src, /from ['"]@\/lib\/source-taxonomy['"]/,
    'the component must import taxonomySummary from src/lib');
  assert.doesNotMatch(src, /function taxonomySummary/,
    'the inline copy must be gone, not merely unused');
});