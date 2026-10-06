'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseClient } = require('../server/db/client');

test('an unreachable DATABASE_URL is reported, not disguised as working inventory', async () => {
  // No NODE_ENV=test and no PROPERTY_INVENTORY_BACKEND: this is what a real
  // process looks like, which is why nothing may be seeded here.
  const db = new DatabaseClient({
    env: {
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:1/property_crawl',
    },
    liveCachePath: null,
    workspaceStorePath: null,
  });
  assert.equal(db.isPg, false, 'Pool construction must not count as a connection');
  assert.equal(db.postgresReachable, false);
  // The behaviour this test used to pin - "demo", with seed inventory holding
  // the API up - was the thing that let a dead database look healthy. A server
  // with no database must say so instead of serving something.
  assert.equal(db.dataMode(), 'unavailable');
  assert.equal(db.inMemoryData.listings.length, 0, 'nothing may be seeded without an explicit opt-in');
  assert.equal(db.inventorySource(), null);
  assert.ok(db.inventoryUnavailableReason(), 'the reason must be available before the probe too');

  const reachable = await db.verifyConnection();
  assert.equal(reachable, false);
  assert.equal(db.isPg, false);
  assert.equal(db.pool, null, 'a dead pool must be dropped rather than retried forever');
  assert.equal(db.dataMode(), 'unavailable');
  assert.ok(db.postgresError, 'the failure reason must be retained for /api/health');
  assert.match(db.inventoryUnavailableReason(), /PostgreSQL is not answering/,
    'after a failed probe the reason must name the probe failure');

  const page = await db.getListings({ limit: 1 });
  assert.equal(page.listings.length, 0, 'no database means no inventory, not a fallback');
});

test('NODE_ENV=test is a declaration, not a fallback', () => {
  // The test runner sets it, so in-memory is an opt-in by that route. It is
  // still not postgres and must not claim to be.
  const db = new DatabaseClient({
    env: { NODE_ENV: 'test' },
    liveCachePath: null,
    workspaceStorePath: null,
  });
  assert.ok(db.inMemoryData.listings.length > 0);
  assert.equal(db.dataMode(), 'memory');
  assert.equal(db.inventorySource(), 'memory');
  assert.equal(db.inventoryUnavailableReason(), null,
    'a declared source is not an outage; routes must be allowed to serve it');
});

test('PROPERTY_INVENTORY_BACKEND=memory is honoured outside tests', () => {
  const db = new DatabaseClient({
    env: { PROPERTY_INVENTORY_BACKEND: 'memory' },
    liveCachePath: null,
    workspaceStorePath: null,
  });
  assert.ok(db.inMemoryData.listings.length > 0);
  assert.equal(db.dataMode(), 'memory');
});