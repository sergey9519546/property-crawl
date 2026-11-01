'use strict';

// Fresh-boot schema guard.
//
// schema.sql and the migration chain are two hand-maintained descriptions of
// the same schema. They drifted once already: schema.sql kept
// `listings.id VARCHAR(64)` after migration 022 widened it to TEXT, and a
// fresh database only became correct because 022 happened to run after it.
// Nothing compared the two descriptions against each other.
//
// This test closes that gap end to end: boot a throwaway embedded PostgreSQL,
// run the real migrator exactly as production does (schema.sql, then the full
// ledger-guarded chain), and compare the resulting schema — every table,
// column, type, nullability, and default — against a committed golden.
//
// When a deliberate schema change lands, the comparison fails; regenerate the
// golden and review the diff as part of the same change:
//
//   UPDATE_GOLDEN=1 node --test test/db/fresh-boot-schema.test.js
//
// A diff that surprises you is a bug in schema.sql or in a migration — not a
// reason to regenerate blindly.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const GOLDEN_PATH = path.join(__dirname, 'golden-schema.json');

async function captureSchema(pool) {
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
  );
  const columns = await pool.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema='public'
      ORDER BY table_name, column_name`,
  );
  const ledger = await pool.query('SELECT name FROM discovery_schema_migrations ORDER BY name');
  return {
    tables: tables.rows.map((r) => r.table_name),
    columns: columns.rows.map((r) => ({
      table: r.table_name,
      column: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES',
      default: r.column_default === null ? null : String(r.column_default),
    })),
    appliedMigrations: ledger.rows.map((r) => r.name),
  };
}

test('a fresh database boots to the committed schema', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-boot-schema-'));
  try {
    const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
    const started = await startEmbeddedPostgres({ dataDir, log: () => {} });
    try {
      const { migrate } = require('../../scripts/discovery-migrate');
      await migrate(started.pool);
      const actual = await captureSchema(started.pool);

      const expectedFiles = fs
        .readdirSync(path.join(__dirname, '..', '..', 'server', 'db', 'migrations'))
        .filter((name) => /^\d+.*\.sql$/.test(name))
        .sort();
      assert.deepEqual(
        actual.appliedMigrations,
        expectedFiles,
        'a fresh boot must record every migration file in the ledger, in order',
      );

      if (process.env.UPDATE_GOLDEN) {
        fs.writeFileSync(GOLDEN_PATH, JSON.stringify({ tables: actual.tables, columns: actual.columns }, null, 2) + '\n');
        assert.ok(true, 'golden regenerated');
        return;
      }

      assert.ok(fs.existsSync(GOLDEN_PATH), 'golden-schema.json is missing; run UPDATE_GOLDEN=1 to create it');
      const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
      const diffs = [];
      const goldenTables = new Set(golden.tables);
      const actualTables = new Set(actual.tables);
      for (const t of golden.tables) if (!actualTables.has(t)) diffs.push(`table missing: ${t}`);
      for (const t of actual.tables) if (!goldenTables.has(t)) diffs.push(`unexpected table: ${t}`);

      const goldenByKey = new Map(golden.columns.map((c) => [c.table + '.' + c.column, c]));
      const actualByKey = new Map(actual.columns.map((c) => [c.table + '.' + c.column, c]));
      for (const [key, g] of goldenByKey) {
        const a = actualByKey.get(key);
        if (!a) { diffs.push(`column missing: ${key} (${g.type})`); continue; }
        for (const field of ['type', 'nullable', 'default']) {
          if (String(a[field]) !== String(g[field])) {
            diffs.push(`column changed: ${key} ${field}: golden=${g[field]} actual=${a[field]}`);
          }
        }
      }
      for (const [key] of actualByKey) {
        if (!goldenByKey.has(key)) diffs.push(`unexpected column: ${key}`);
      }

      assert.deepEqual(
        diffs,
        [],
        'the fresh-boot schema drifted from the committed golden.\n' +
          'If the change is deliberate, regenerate with:\n' +
          '  UPDATE_GOLDEN=1 node --test test/db/fresh-boot-schema.test.js\n' +
          'and review the golden diff as part of the same change. If it is not,\n' +
          'the drift is between schema.sql and the migration chain — fix the\n' +
          'description, not the test.\n\n' +
          diffs.slice(0, 25).join('\n'),
      );
    } finally {
      await started.pool.end().catch(() => {});
    }
  } finally {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  }
});
