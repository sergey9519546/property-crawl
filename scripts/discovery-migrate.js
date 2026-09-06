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
        if (found.rows[0].sha256 !== digest) throw new Error(`Previously applied migration changed: ${name}`);
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
if (require.main === module) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required for discovery migrations'); process.exitCode = 1; }
  else {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    migrate(pool).then(() => console.log('Discovery migrations applied')).catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
  }
}
module.exports = { migrate };
