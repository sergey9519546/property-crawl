'use strict';
// test/hunt-unsatisfiable-criteria.test.js
//
// A hunt can be UNSATISFIABLE rather than merely unmatched: if every record
// reports a criterion's field as unavailable, no amount of re-running could
// establish it. That is the case for a rule on a derived value when nothing
// carries the evidence it is computed from.
//
// Before this, "this rule could never match" and "this hunt simply found
// nothing" were indistinguishable in a bare no-match result - so a user could
// save a hunt that could never fire and believe it was working.

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { evaluateInventory } = require('../server/intelligence/hunts');
const { loadLiveRecords, resolveLiveStorePath } = require('../server/db/live-record-store');

const NOW = new Date().toISOString();

// Built from a real, already-valid record rather than hand-rolled: a synthetic
// listing that fails ingestion validation is rejected before any clause is
// evaluated, which would make this test pass for the wrong reason.
const SEEDS = loadLiveRecords(resolveLiveStorePath(process.env.PROPERTY_LIVE_CACHE_PATH))
  .filter((record) => record.id && record.source)
  .slice(0, 3);
if (SEEDS.length < 3) {
  test('fixtures available', { skip: `need 3 live store records, found ${SEEDS.length}` }, () => {});
}

function listing(index, extra = {}) {
  const seed = SEEDS[index % SEEDS.length];
  return {
    ...seed,
    id: `${seed.id}-HUNT-${index}`,
    sourceObservedAt: NOW,
    provenance: { ...seed.provenance, origin: 'live', observedAt: NOW },
    // Derived fields are removed by default: this test is about criteria the
    // inventory cannot establish.
    estLow: null, estHigh: null, assessed: null, dealScore: null, equity: null, mid: null,
    openingBid: null,
    ...extra,
  };
}

function hunt(rules) {
  return {
    id: 'HUNT-TEST',
    name: 'test hunt',
    mode: 'all',
    enabled: true,
    version: 1,
    criteria: { mode: 'all', rules },
  };
}

test('a criterion no record can satisfy is reported as unsatisfiable', () => {
  // dealScore is derived from estLow/estHigh. These records carry neither, so
  // the clause is `unknown` for every one of them - never `match`, never a
  // genuine `no_match`.
  const result = evaluateInventory(hunt([{ field: 'dealScore', operator: 'gte', value: 60 }]), [
    listing(0),
    listing(1),
    listing(2),
  ], { now: NOW });

  assert.equal(result.response.counts.match, 0);
  assert.ok(Array.isArray(result.response.unsatisfiableCriteria));
  assert.equal(result.response.unsatisfiableCriteria.length, 1);
  assert.equal(result.response.unsatisfiableCriteria[0].field, 'dealScore');
  assert.match(result.response.unsatisfiableCriteria[0].reason, /unavailable on every record/);
  assert.match(result.response.unsatisfiableCriteriaNote, /cannot match, however often it runs/);
});

test('a criterion that records genuinely fail is NOT called unsatisfiable', () => {
  // openingBid IS present, it simply is not above the threshold. That is an
  // ordinary no-match, and calling it unsatisfiable would be its own lie.
  const result = evaluateInventory(hunt([{ field: 'openingBid', operator: 'gte', value: 500000 }]), [
    listing(0, { openingBid: 50000 }),
    listing(1, { openingBid: 75000 }),
  ], { now: NOW });

  assert.equal(result.response.counts.noMatch, 2);
  assert.deepEqual(result.response.unsatisfiableCriteria, [],
    'a criterion the inventory can evaluate and every record fails is a real no-match');
  assert.equal(result.response.unsatisfiableCriteriaNote, null);
});

test('a satisfiable criterion produces no warning', () => {
  const result = evaluateInventory(hunt([{ field: 'openingBid', operator: 'gte', value: 60000 }]), [
    listing(0, { openingBid: 75000 }),
    listing(1, { openingBid: 10000 }),
  ], { now: NOW });

  assert.equal(result.response.counts.match, 1);
  assert.deepEqual(result.response.unsatisfiableCriteria, []);
  assert.equal(result.response.unsatisfiableCriteriaNote, null);
});


