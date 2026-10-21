'use strict';

// test/health-observation-store-capacity.test.js
//
// Observation history is stored in Postgres (migrations 025 + 027). The old
// bounded JSON file had a ceiling it provably reached — 51.84MB of 64MB,
// ~7.6 days of runway — and nothing reported it until loadObservations threw.
// /api/health still publishes the store's numbers, but the facts changed with
// the store: rows, observed span and table size, not a countdown to a file
// ceiling that no longer exists.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const PERSISTENCE = fs.readFileSync(path.join(ROOT, 'server', 'db', 'observations-persistence.js'), 'utf8');

test('/api/health publishes the observation store state', () => {
  assert.match(
    SERVER,
    /observationStore/,
    'the observation store is a backing store like the others health already '
      + 'reports on; it should be visible there too',
  );
  assert.match(
    SERVER,
    /observationStoreStats/,
    'health must call the Postgres-backed stats reader, not the retired file measurement',
  );
});

test('the reported facts are measured from Postgres, not asserted from constants', () => {
  // A health field that quotes constants instead of querying the store would
  // report the same numbers regardless of what the store holds.
  assert.match(
    PERSISTENCE,
    /FROM source_observations/,
    'stats must be measured with a query against the store, not asserted from a constant',
  );
  assert.match(
    PERSISTENCE,
    /pg_total_relation_size/,
    'the table size must be measured by Postgres itself',
  );
  assert.match(
    PERSISTENCE,
    /function\s+\w*observationStoreStats\w*/,
    'the persistence layer should expose a stats helper the health route can call',
  );
});

test('the report names the freshness an operator can act on, not just volume', () => {
  assert.match(
    PERSISTENCE,
    /newestObservedAt/,
    'a table full of stale rows is not current coverage; the newest observation '
      + 'is the fact an operator acts on',
  );
});

test('a store with no rows is a real, reportable state — zero rows, not an outage', () => {
  // The SQL aggregates one row even over an empty table (COUNT/MIN/MAX over
  // zero rows), so an empty store reads as rows: 0 with null bounds rather
  // than null or an error.
  assert.match(
    PERSISTENCE,
    /count\(\*\)::int AS rows/,
    'an empty store must aggregate to a real zero-row report',
  );
});
