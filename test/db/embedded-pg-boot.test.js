'use strict';

// test/db/embedded-pg-boot.test.js
//
// Regression coverage that ONLY a real PostgreSQL engine can give. The mock-pool
// tests elsewhere cannot see either of these defects:
//
//   1. Boot order. server/db/schema.sql is the CURRENT snapshot and indexes
//      columns (listings.triage_priority, migration 025) that an older on-disk
//      database only gains through a migration - CREATE TABLE IF NOT EXISTS never
//      adds columns to an existing table. Re-applying the snapshot BEFORE pending
//      migrations aborted boot with `column "triage_priority" does not exist`,
//      and `npm run discovery:migrate` could not repair it because it boots
//      through the same function.
//
//   2. Parameter typing. UPSERT_RUN_SQL used $2 as both a timestamptz column
//      value and inside CASE branches, so PostgreSQL deduced inconsistent types
//      ("inconsistent types deduced for parameter $2") and EVERY source-run write
//      failed - source history and last-success timestamps were never stored.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
const { migrate } = require('../../scripts/discovery-migrate');
const { recordSourceRun } = require('../../server/db/observations-persistence');

const BOOT_TIMEOUT_MS = 120_000;

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

async function columnExists(pool, table, column) {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return result.rows.length > 0;
}

test('an existing embedded database from before migration 025 boots by migrating first', { timeout: BOOT_TIMEOUT_MS * 3 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-embedded-legacy-'));
  try {
    // 1. A current database, fully migrated.
    const first = await startEmbeddedPostgres({ dataDir });
    await migrate(first.pool);
    assert.equal(await columnExists(first.pool, 'listings', 'triage_priority'), true, 'precondition: column present');

    // 2. Rewind it to what a pre-025/026 on-disk database looks like: the columns
    //    (and their index) absent, and the ledger not yet recording 025/026.
    await first.pool.query('DROP INDEX IF EXISTS idx_listings_triage_priority');
    await first.pool.query('ALTER TABLE listings DROP COLUMN triage_priority');
    await first.pool.query('ALTER TABLE listings DROP COLUMN triage_priority_refreshed_at');
    await first.pool.query(
      "DELETE FROM discovery_schema_migrations WHERE name LIKE '025\\_%' OR name LIKE '026\\_%'",
    );
    assert.equal(await columnExists(first.pool, 'listings', 'triage_priority'), false, 'precondition: legacy shape');
    await first.pool.end();

    // 3. Reboot. Before the fix this threw `column "triage_priority" does not exist`.
    const second = await startEmbeddedPostgres({ dataDir });
    try {
      assert.equal(await columnExists(second.pool, 'listings', 'triage_priority'), true);
      assert.equal(await columnExists(second.pool, 'listings', 'triage_priority_refreshed_at'), true);
      const ledger = await second.pool.query(
        "SELECT name FROM discovery_schema_migrations WHERE name LIKE '025\\_%' OR name LIKE '026\\_%' ORDER BY name",
      );
      assert.equal(ledger.rows.length, 2, 'the pending migrations were recorded as applied');
    } finally {
      await second.pool.end();
    }
  } finally {
    removeDir(dataDir);
  }
});

test('recordSourceRun persists run metadata on a real engine and accumulates across runs', { timeout: BOOT_TIMEOUT_MS }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-embedded-runs-'));
  try {
    const { pool } = await startEmbeddedPostgres({ dataDir });
    try {
      await migrate(pool);
      const source = (await pool.query('SELECT key FROM sources ORDER BY key LIMIT 1')).rows[0].key;

      // A clean run with no accepted listings.
      await recordSourceRun(pool, source, { listings: [], error: null, durationMs: 42, rejectedCount: 3 }, { now: '2026-10-01T00:00:00.000Z' });
      let row = (await pool.query('SELECT * FROM source_observation_runs WHERE source_key = $1', [source])).rows[0];
      assert.ok(row, 'run row written (was: inconsistent types deduced for parameter $2)');
      assert.equal(row.runs_count, 1);
      assert.equal(row.error, null);
      assert.equal(new Date(row.last_success_at).toISOString(), '2026-10-01T00:00:00.000Z');
      assert.equal(row.last_non_empty_at, null, 'an empty run is not a non-empty run');
      assert.equal(Number(row.duration_ms), 42);
      assert.equal(row.rejected_count, 3);

      // A later failed run: counts up, records the error, never overwrites the last success.
      await recordSourceRun(pool, source, { listings: [], error: 'WAF challenge', durationMs: 7 }, { now: '2026-10-02T00:00:00.000Z' });
      row = (await pool.query('SELECT * FROM source_observation_runs WHERE source_key = $1', [source])).rows[0];
      assert.equal(row.runs_count, 2);
      assert.equal(row.error, 'WAF challenge');
      assert.equal(new Date(row.last_run_at).toISOString(), '2026-10-02T00:00:00.000Z');
      assert.equal(new Date(row.last_success_at).toISOString(), '2026-10-01T00:00:00.000Z', 'failure keeps prior success');
    } finally {
      await pool.end();
    }
  } finally {
    removeDir(dataDir);
  }
});
