'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(72463198)');
    await client.query('CREATE TABLE IF NOT EXISTS discovery_schema_migrations(name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = path.resolve(__dirname, '../server/db/migrations');
    const base = await client.query("SELECT to_regclass('public.listings') AS relation");
    if (!base.rows[0].relation) await client.query(fs.readFileSync(path.resolve(__dirname, '../server/db/schema.sql'), 'utf8'));
    for (const name of fs.readdirSync(directory).filter(n => /^\d+.*\.sql$/.test(n)).sort()) {
      const sql = fs.readFileSync(path.join(directory, name), 'utf8');
      const digest = crypto.createHash('sha256').update(sql).digest('hex');
      const found = await client.query('SELECT sha256 FROM discovery_schema_migrations WHERE name=$1', [name]);
      if (found.rows.length) {
        if (found.rows[0].sha256 !== digest) {
          // The file changed after it was applied (an in-place edit of an
          // already-applied migration). Re-running its SQL would be unsafe, but
          // aborting wedges every later migration permanently: production
          // recorded `024_materialized_views_and_spatial.sql`, the file was then
          // edited twice (0f9bcc8, 51e034c), and 025-027 could never apply —
          // the listings column and observation tables were missing on a live
          // deploy. Re-record the digest and continue; the applied SQL stays
          // exactly as it ran.
          console.warn(`[migrate] previously applied migration changed; re-recording digest: ${name}`);
          await client.query('UPDATE discovery_schema_migrations SET sha256=$1 WHERE name=$2', [digest, name]);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO discovery_schema_migrations(name,sha256) VALUES($1,$2)', [name, digest]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { await client.query('SELECT pg_advisory_unlock(72463198)'); client.release(); }
}
function migrationTarget(env = process.env) {
  if (env.PROPERTY_DB === 'embedded' || Boolean(env.PROPERTY_PG_DATA_DIR)) return 'embedded';
  if (env.DATABASE_URL) return 'tcp';
  return 'missing';
}

async function openConfiguredPool(env = process.env) {
  const target = migrationTarget(env);
  if (target === 'embedded') {
    if (env.DATABASE_URL) {
      console.log('PROPERTY_DB/PROPERTY_PG_DATA_DIR is set, so the embedded engine is used and DATABASE_URL is not opened.');
    }
    const { startEmbeddedPostgres } = require('../server/db/pglite-pool');
    const started = await startEmbeddedPostgres({ log: console.log });
    return started.pool;
  }
  if (target !== 'tcp') {
    const error = new Error('DATABASE_URL is required for discovery migrations');
    error.code = 'DISCOVERY_DATABASE_MISSING';
    throw error;
  }
  const { Pool } = require('pg');
  return new Pool({ connectionString: env.DATABASE_URL });
}

if (require.main === module) {
  const target = migrationTarget();
  if (target === 'missing') {
    console.error('DATABASE_URL is required for discovery migrations');
    process.exitCode = 1;
  } else {
    openConfiguredPool()
      .then(async (pool) => {
        try {
          await migrate(pool);
          console.log(target === 'embedded'
            ? 'Discovery migrations applied to the embedded database'
            : 'Discovery migrations applied');
        } finally {
          await pool.end();
        }
      })
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
module.exports = { migrate, migrationTarget, openConfiguredPool };
