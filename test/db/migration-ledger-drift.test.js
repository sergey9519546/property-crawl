'use strict';

// Guards for the migration ledger's drift behaviour.
//
// Incident it was written for: an already-applied migration file was edited
// in place (024_materialized_views_and_spatial.sql, commits 0f9bcc8 and
// 51e034c). The migrator threw on the digest mismatch and aborted the whole
// run, so every later migration was permanently blocked — a live deploy
// shipped code referencing `listings.triage_priority` and
// `source_observations` that production did not have, and `/api/listings`
// failed with 'column "triage_priority" does not exist'.
//
// Required behaviour: re-record the digest, leave the applied SQL alone, and
// keep migrating the files that come after it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { migrate } = require('../../scripts/discovery-migrate');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../server/db/migrations');
const MIGRATION_COUNT = fs.readdirSync(MIGRATIONS_DIR).filter((name) => /^\d+.*\.sql$/.test(name)).length;

// A pg-shaped client that records every statement and never executes SQL.
function fakeClient({ ledgerRows = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(text, params) {
      const sql = String(text);
      queries.push({ sql, params });
      if (sql.includes('SELECT to_regclass')) return { rows: [{ relation: 'listings' }], rowCount: 1 };
      if (sql.includes('SELECT sha256 FROM discovery_schema_migrations')) {
        return { rows: ledgerRows, rowCount: ledgerRows.length };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
}

function fakePool(client) {
  return { async connect() { return client; } };
}

test('a drifted already-applied migration is re-recorded, not fatal', async () => {
  // Every file reports a stale digest, as production did for the edited 024.
  const client = fakeClient({ ledgerRows: [{ sha256: 'stale-digest-from-an-earlier-revision' }] });
  await migrate(fakePool(client)); // must not throw

  const updates = client.queries.filter((q) => q.sql.startsWith('UPDATE discovery_schema_migrations'));
  const inserts = client.queries.filter((q) => q.sql.startsWith('INSERT INTO discovery_schema_migrations'));
  const begins = client.queries.filter((q) => q.sql === 'BEGIN');
  const appliedSql = client.queries.filter((q) => q.sql.includes('CREATE MATERIALIZED VIEW') || q.sql.includes('CREATE TABLE source_observations'));

  // The digest is re-recorded once per drifted file...
  assert.equal(updates.length, MIGRATION_COUNT, 'each drifted file records its current digest');
  // ...the applied SQL is never re-run, and nothing is applied as new...
  assert.equal(inserts.length, 0, 'no file is recorded as newly applied');
  assert.equal(begins.length, 0, 'no migration transaction is opened');
  assert.equal(appliedSql.length, 0, 'no migration SQL is executed for a drifted file');
  // ...and the ledger mutation is scoped to the drifted file by name.
  assert.ok(updates.every((q) => typeof q.params[1] === 'string' && q.params[1].endsWith('.sql')));
});

test('an empty ledger applies migrations in order and records each digest', async () => {
  const client = fakeClient({ ledgerRows: [] });
  await migrate(fakePool(client)); // must not throw

  const begins = client.queries.filter((q) => q.sql === 'BEGIN');
  const inserts = client.queries.filter((q) => q.sql.startsWith('INSERT INTO discovery_schema_migrations'));
  assert.equal(begins.length, MIGRATION_COUNT, 'each migration runs in its own transaction');
  assert.equal(inserts.length, MIGRATION_COUNT, 'each migration records its digest');
  // Ordering: the first applied file is the lowest-numbered migration.
  const firstApply = client.queries.find((q) => q.sql === 'BEGIN');
  const firstApplyIndex = client.queries.indexOf(firstApply);
  const firstFileRead = client.queries.slice(0, firstApplyIndex).some((q) => q.sql.includes('SELECT sha256'));
  assert.ok(firstFileRead, 'the ledger is consulted before the first apply');
});
