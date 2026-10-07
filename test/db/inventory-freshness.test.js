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

// The production path (postgres + cadences) is the only one that ever ran against
// real inventory, and it is the one that got oldestObservation wrong: the value
// was derived from each source's NEWEST observation, so the reported "oldest" was
// the least-recently-refreshed source's newest record. Live health answered
// 2026-10-06T07:34Z - exactly HUD's newest row - while ServiceLink held rows far
// older. The endpoint exists to say "a database full of rows is not the same claim
// as an inventory somebody checked today", so understating the oldest data by weeks
// defeats its only job. The flat-window path already used a true min(); one field,
// two meanings, chosen by which branch ran.
test('postgres reports the oldest observation in the store, not the oldest per-source newest', async () => {
  const rows = [
    // servicelink: one fresh row, two long-stale ones.
    ['servicelink', 1], ['servicelink', 30], ['servicelink', 40],
    // hud: fresh within its own 24h cadence.
    ['hud', 2],
  ];
  const iso = (ageHours) => new Date(NOW - ageHours * HOUR).toISOString();
  const pool = {
    query: async (sql) => {
      if (!sql.includes('unnest')) throw new Error(`Unexpected query: ${sql}`);
      // One statement: per-source rows, each carrying the store-wide scalars.
      return { rows: [
        { source: 'servicelink', n: 3, fresh: 1, newest: iso(1), oldest: iso(40) },
        { source: 'hud', n: 1, fresh: 1, newest: iso(2), oldest: iso(40) },
      ] };
    },
  };
  const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, pool, liveCachePath: null, workspaceStorePath: null });
  const f = await db.inventoryFreshness(NOW, { cadences: { servicelink: 6, hud: 24 } });

  assert.equal(f.oldestObservation, iso(40), 'the 40h-old row is the oldest in the store');
  assert.equal(f.newestObservation, iso(1));
  assert.equal(f.listings, 4);
  assert.equal(f.freshListings, 2, 'freshness still respects each source cadence');
  assert.equal(f.stale, true);
});

// A cadence-declared-source gap: records whose source_key is not in the catalog
// are outside both this breakdown and its total, because counting the whole
// table means a second scan of a 46-column table with no index on
// source_observed_at - measured at 156ms against a 79ms baseline for an endpoint
// the banner fetches on every page render. Recorded here so the tradeoff is
// deliberate: the totals are exactly the sources the catalog declares a cadence
// for, and today that is every source holding inventory.
test('the freshness breakdown covers exactly the cadence-declared sources', async () => {
  const iso = (ageHours) => new Date(NOW - ageHours * HOUR).toISOString();
  const pool = {
    query: async (sql) => {
      if (!sql.includes('unnest')) throw new Error(`Unexpected query: ${sql}`);
      return { rows: [
        { source: 'servicelink', n: 3, fresh: 1, newest: iso(1), oldest: iso(40) },
      ] };
    },
  };
  const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, pool, liveCachePath: null, workspaceStorePath: null });
  const f = await db.inventoryFreshness(NOW, { cadences: { servicelink: 6 } });

  assert.equal(f.listings, 3);
  assert.equal(f.freshListings, 1);
  assert.equal(f.stale, true);
  assert.match(f.staleBecause, /Behind: servicelink 2\/3 \(every 6h\)\./);
});

// 161 catalog sources were LEFT JOINed into the health payload on every poll, 152
// of them with zero listings. That is 18KB of the 20.5KB response describing
// nothing, fetched on every page render by the data-mode banner, and read by no
// consumer outside the tests. laggingSources already carries the actionable subset.
test('the health payload omits catalog sources that hold no listings', async () => {
  const iso = (ageHours) => new Date(NOW - ageHours * HOUR).toISOString();
  const pool = {
    query: async (sql) => {
      if (!sql.includes('unnest')) throw new Error(`Unexpected query: ${sql}`);
      return { rows: [
        { source: 'servicelink', n: 3, fresh: 1, newest: iso(1), oldest: iso(30) },
        { source: 'county-tax-sale-template', n: 0, fresh: 0, newest: null, oldest: null },
        { source: 'mls-licensed-feed', n: 0, fresh: 0, newest: null, oldest: null },
      ] };
    },
  };
  const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, pool, liveCachePath: null, workspaceStorePath: null });
  const f = await db.inventoryFreshness(NOW, { cadences: { servicelink: 6, 'county-tax-sale-template': 24, 'mls-licensed-feed': 6 } });

  assert.deepEqual(f.bySource.map((r) => r.source), ['servicelink']);
  assert.equal(f.listings, 3, 'dropping zero rows must not change the totals');
  assert.equal(f.freshListings, 1);
  assert.equal(f.stale, true);
});
