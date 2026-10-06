'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseClient } = require('../../server/db/client');

const NOW = Date.parse('2026-10-05T12:00:00Z');
const HOUR = 3_600_000;

function memoryClient(observedAges) {
  const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: null, workspaceStorePath: null });
  db.inMemoryData.listings = observedAges.map((ageHours, i) => ({
    id: `L-${i}`,
    sourceObservedAt: new Date(NOW - ageHours * HOUR).toISOString(),
  }));
  return db;
}

test('one fresh record does not make a stale inventory look fresh', async () => {
  // The bug this pins: collection is bounded (one page per sweep), so a
  // successful sweep makes max(source_observed_at) seconds old while the rest
  // is three weeks old. Deriving `stale` from the newest row reported a whole
  // stale inventory as fresh after a sweep that refreshed 25 of 3,225 rows.
  const db = memoryClient([0.1, 16 * 24, 17 * 24, 18 * 24]);
  const f = await db.inventoryFreshness(NOW);

  assert.equal(f.listings, 4);
  assert.equal(f.freshListings, 1);
  assert.equal(f.stale, true, '1 of 4 fresh is not a fresh inventory');
  assert.equal(f.ageHours < 1, true, 'the newest row really is minutes old');
  assert.match(f.staleBecause, /3 of 4 listings were last observed more than 24h ago/);
});

test('a fully re-observed inventory is not stale', async () => {
  const db = memoryClient([0.5, 2, 6, 23]);
  const f = await db.inventoryFreshness(NOW);
  assert.equal(f.freshListings, 4);
  assert.equal(f.stale, false);
  assert.equal(f.staleBecause, null);
});

test('an inventory with no observations is not reported as fresh', async () => {
  const db = memoryClient([100 * 24, 200 * 24]);
  const f = await db.inventoryFreshness(NOW);
  assert.equal(f.stale, true);
  assert.equal(f.freshListings, 0);
});

test('the stale window is configurable', async () => {
  const db = new DatabaseClient({
    env: { NODE_ENV: 'test', PROPERTY_STALE_AFTER_HOURS: '72' },
    liveCachePath: null,
    workspaceStorePath: null,
  });
  db.inMemoryData.listings = [{ id: 'A', sourceObservedAt: new Date(NOW - 48 * HOUR).toISOString() }];
  const f = await db.inventoryFreshness(NOW);
  assert.equal(f.staleAfterHours, 72);
  assert.equal(f.stale, false, '48h is inside a 72h window');
});