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
// The flat-window bug this pins: a 6h-cadence source that stopped being
// collected a month ago is invisible behind a 24h global threshold. The health
// endpoint reported "296 of 7999 stale" while the entire ServiceLink inventory
// sat at 689h old, because those 296 were the only rows past 24h.
test('each source is judged against its own declared cadence', async () => {
  const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: null, workspaceStorePath: null });
  db.inMemoryData.listings = [
    // servicelink declares 6h and has not been collected for 200h.
    { id: 'S-1', source: 'servicelink', sourceObservedAt: new Date(NOW - 200 * HOUR).toISOString() },
    { id: 'S-2', source: 'servicelink', sourceObservedAt: new Date(NOW - 1 * HOUR).toISOString() },
    // fl-dor-cadastral declares 720h, so 200h is comfortably inside its window.
    { id: 'F-1', source: 'fl-dor-cadastral', sourceObservedAt: new Date(NOW - 200 * HOUR).toISOString() },
  ];

  const flat = await db.inventoryFreshness(NOW);
  assert.equal(flat.stale, true, 'the flat window already sees the servicelink rows as stale');

  const perSource = await db.inventoryFreshness(NOW, { cadences: { servicelink: 6, 'fl-dor-cadastral': 720 } });
  assert.equal(perSource.stale, true);
  assert.equal(perSource.listings, 3);
  // 2 rows: the 200h-old servicelink record, and nothing from fl-dor-cadastral,
  // whose 200h is well inside its declared 720h.
  assert.equal(perSource.freshListings, 2, 'a 200h-old record is current for a 720h source');
  assert.deepEqual(perSource.bySource.map((r) => r.source).sort(), ['fl-dor-cadastral', 'servicelink']);
  assert.equal(perSource.bySource.find((r) => r.source === 'fl-dor-cadastral').stale, false);
  assert.equal(perSource.bySource.find((r) => r.source === 'servicelink').stale, true);
});

test('the staleness report names the sources that are behind', async () => {
  const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: null, workspaceStorePath: null });
  db.inMemoryData.listings = [
    { id: 'S-1', source: 'servicelink', sourceObservedAt: new Date(NOW - 200 * HOUR).toISOString() },
  ];
  const f = await db.inventoryFreshness(NOW, { cadences: { servicelink: 6 } });
  assert.match(f.staleBecause, /past their own source's refresh cadence/);
  // "1 of 7999 listings are stale" says nothing an operator can act on; the
  // publisher that stopped is the whole point.
  assert.match(f.staleBecause, /servicelink 1\/1 \(every 6h\)/);
  assert.equal(f.laggingSources[0].source, 'servicelink');
});

test('no cadences supplied falls back to the flat window unchanged', async () => {
  const db = memoryClient([1, 2, 48]);
  const f = await db.inventoryFreshness(NOW);
  assert.equal(f.bySource, null);
  assert.match(f.staleBecause, /were last observed more than 24h ago/);
});
