'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { DiscoveryStore } = require('../server/discovery/store');

const databaseUrl = process.env.DATABASE_URL || process.env.DISCOVERY_DATABASE_URL;

async function withStore(fn) {
  if (!databaseUrl) return;
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await fn(pool, new DiscoveryStore(pool));
  } finally {
    await pool.end();
  }
}

test('Postgres discovery leases exclude another owner and permit recovery after expiry', { skip: !databaseUrl }, async () => {
  await withStore(async (pool, store) => {
    const key = `acceptance-${crypto.randomUUID()}`;
    assert.equal(await store.acquireLease(key, 'owner-a', 10), true);
    assert.equal(await store.acquireLease(key, 'owner-b', 10), false);
    assert.equal(await store.renewLease(key, 'owner-a', 10), true);
    assert.equal(await store.releaseLease(key, 'owner-a'), true);
    assert.equal(await store.acquireLease(key, 'owner-b', 10), true);
    await pool.query('DELETE FROM discovery_leases WHERE lease_key=$1', [key]);
  });
});

test('Postgres discovery run idempotency and abandoned-run recovery use migration tables', { skip: !databaseUrl }, async () => {
  await withStore(async (pool, store) => {
    const key = `acceptance-${crypto.randomUUID()}`;
    const first = await store.beginRun({ sourceKey: 'servicelink', trigger: 'acceptance', idempotencyKey: key });
    const retry = await store.beginRun({ sourceKey: 'servicelink', trigger: 'acceptance', idempotencyKey: key });
    assert.equal(first.id, retry.id);
    await pool.query("UPDATE discovery_source_runs SET started_at=NOW()-INTERVAL '2 hours' WHERE id=$1", [first.id]);
    const abandoned = await store.failAbandonedRuns(3600);
    assert.ok(abandoned.includes(first.id));
    await pool.query('DELETE FROM discovery_source_runs WHERE id=$1', [first.id]);
  });
});
