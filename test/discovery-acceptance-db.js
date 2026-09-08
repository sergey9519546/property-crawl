'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

function testDatabaseUrl(env = process.env) {
  const url = env.DISCOVERY_TEST_DATABASE_URL || env.TEST_DATABASE_URL || env.DATABASE_URL;
  if (!url) throw new Error('DISCOVERY_TEST_DATABASE_URL (or TEST_DATABASE_URL) is required; PostgreSQL acceptance tests cannot use demo memory data');
  return url;
}

function safeSchema(prefix = 'discovery_acceptance') {
  return `${prefix}_${process.pid}_${crypto.randomBytes(5).toString('hex')}`;
}

async function createIsolatedDatabase(options = {}) {
  const schema = options.schema || safeSchema(options.prefix);
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(schema)) throw new Error('Unsafe acceptance schema name');
  const connectionString = options.url || testDatabaseUrl();
  const bootstrap = new Pool({ connectionString, max: 1 });
  await bootstrap.query(`CREATE SCHEMA "${schema}"`);
  await bootstrap.end();
  const pool = new Pool({ connectionString, max: options.max || 20, options: `-c search_path=${schema},public` });
  try {
    await pool.query(fs.readFileSync(path.resolve(__dirname, '../server/db/schema.sql'), 'utf8'));
    for (const name of fs.readdirSync(path.resolve(__dirname, '../server/db/migrations')).filter((item) => /^\d+.*\.sql$/.test(item)).sort()) {
      await pool.query(fs.readFileSync(path.resolve(__dirname, '../server/db/migrations', name), 'utf8'));
    }
  } catch (error) {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
    throw error;
  }
  return {
    pool,
    schema,
    async close() {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    },
  };
}

async function seedListings(pool, count) {
  await pool.query(`INSERT INTO listings(id,source_key,state,county,city,address,latitude,longitude,geog,prop_type,opening_bid,est_low,est_high,deal_score,status,lifecycle_status,source_observed_at)
    SELECT 'accept-'||n, CASE WHEN n%3=0 THEN 'hud' ELSE 'servicelink' END,
      (ARRAY['CA','FL','TX','OH'])[(n%4)+1], 'County '||(n%100), 'City '||(n%500), n||' Main Street',
      25+(n%3000)/100.0, -120+(n%3000)/100.0,
      ST_SetSRID(ST_MakePoint(-120+(n%3000)/100.0,25+(n%3000)/100.0),4326)::geography,
      CASE WHEN n%2=0 THEN 'Single Family' ELSE 'Land' END, 50000+(n%1000)*100,
      180000+(n%1000)*100, 220000+(n%1000)*100, 50+(n%45), 'active', 'active', NOW()
    FROM generate_series(1,$1::int) n`, [count]);
}

module.exports = { createIsolatedDatabase, seedListings, testDatabaseUrl };
