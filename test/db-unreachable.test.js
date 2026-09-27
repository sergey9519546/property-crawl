'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseClient } = require('../server/db/client');

test('an unreachable DATABASE_URL does not advertise postgres or drop demo inventory', async () => {
  const db = new DatabaseClient({
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:1/property_crawl',
    },
    liveCachePath: null,
    workspaceStorePath: null,
  });
  assert.equal(db.isPg, false, 'Pool construction must not count as a connection');
  assert.equal(db.postgresReachable, false);
  assert.equal(db.dataMode(), 'demo');
  assert.ok(db.inMemoryData.listings.length > 0, 'demo inventory must be seeded before the probe');

  const reachable = await db.verifyConnection();
  assert.equal(reachable, false);
  assert.equal(db.isPg, false);
  assert.equal(db.pool, null, 'a dead pool must be dropped so later queries use memory');
  assert.equal(db.dataMode(), 'demo');
  assert.ok(db.postgresError, 'the failure reason must be retained for /api/health');

  const page = await db.getListings({ limit: 1 });
  assert.equal(page.listings.length, 1);
  assert.ok(page.total > 0);
});
