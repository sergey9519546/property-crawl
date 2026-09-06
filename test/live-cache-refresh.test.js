const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const serverClient = require('../server/db/client');
const nextClient = require('../src/lib/db/client');
if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = previousNodeEnv;

const temporaryDirectories = [];
const implementations = [
  ['server', serverClient.DatabaseClient],
  ['next', nextClient.DatabaseClient],
];

function temporaryCache() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-live-refresh-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'live-listings.json');
}

function liveListing(overrides = {}) {
  const observedAt = overrides.sourceObservedAt || '2025-09-05T10:00:00.000Z';
  return {
    id: 'CIV-NJ-7-LIVE-REFRESH', source: 'civilview', state: 'NJ', county: 'Bergen',
    city: 'Park Ridge', zip: '07656', address: '19 Live Cache Refresh Avenue, Park Ridge, NJ 07656',
    lat: null, lng: null, openingBid: 100000, estLow: null, estHigh: null,
    raw: 'Official CivilView source record used to verify live cache refresh.',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    sourceObservedAt: observedAt, fetchedAt: '2025-09-05T10:00:05.000Z',
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record',
      publisher: 'CivilView', recordId: '2128964683', observedAt,
    },
    ...overrides,
  };
}

function writeCache(filePath, listings) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1, updatedAt: new Date().toISOString(), listings,
  }));
}

afterEach(() => {
  while (temporaryDirectories.length) {
    const target = temporaryDirectories.pop();
    if (target.startsWith(os.tmpdir())) fs.rmSync(target, { recursive: true, force: true });
  }
});

for (const [name, DatabaseClient] of implementations) {
  test(`${name} in-memory client discovers collector output after startup`, async () => {
    const cachePath = temporaryCache();
    const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: cachePath });
    assert.equal(await db.getListingById(liveListing().id), null);

    writeCache(cachePath, [liveListing()]);
    const byId = await db.getListingById(liveListing().id);
    const filtered = await db.getListings({ q: 'Live Cache Refresh', limit: 10 });

    assert.ok(byId);
    assert.equal(filtered.total, 1);
    assert.equal(byId.sourceObservedAt, '2025-09-05T10:00:00.000Z');
    assert.equal(byId.fetchedAt, '2025-09-05T10:00:05.000Z');
    assert.equal(byId.provenance.observedAt, '2025-09-05T10:00:00.000Z');
  });

  test(`${name} live-cache refresh cannot overwrite a newer in-memory observation`, async () => {
    const cachePath = temporaryCache();
    writeCache(cachePath, [liveListing()]);
    const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: cachePath });
    const newer = liveListing({ sourceObservedAt: '2025-09-05T11:00:00.000Z', openingBid: 80000 });
    newer.provenance = { ...newer.provenance, observedAt: newer.sourceObservedAt };
    await db.createListing(newer);

    const second = liveListing({
      id: 'CIV-NJ-7-SECOND-REFRESH',
      sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964684',
      address: '20 West Park Avenue, Park Ridge, NJ 07656',
      provenance: { ...liveListing().provenance, recordId: '2128964684' },
    });
    writeCache(cachePath, [liveListing({ openingBid: 120000 }), second]);

    const refreshed = await db.getListingById(newer.id);
    assert.equal(refreshed.openingBid, 80000);
    assert.equal(refreshed.sourceObservedAt, '2025-09-05T11:00:00.000Z');
    assert.ok(await db.getListingById(second.id));
  });

  test(`${name} client preserves current inventory when a changed cache is corrupt`, async () => {
    const cachePath = temporaryCache();
    writeCache(cachePath, [liveListing()]);
    const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: cachePath });
    assert.ok(await db.getListingById(liveListing().id));

    fs.writeFileSync(cachePath, '{"version":1,"listings":');
    assert.ok(await db.getListingById(liveListing().id));
    assert.equal(db.inMemoryData.listings.filter((item) => item.id === liveListing().id).length, 1);
  });

  test(`${name} saved-deal reads refresh live records before resolving ids`, async () => {
    const cachePath = temporaryCache();
    const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: cachePath });
    await db.saveDeal('operator', liveListing().id);
    writeCache(cachePath, [liveListing()]);

    const saved = await db.getSavedDeals('operator');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, liveListing().id);
  });

  test(`${name} live-cache refresh ignores future-dated observations`, async () => {
    const cachePath = temporaryCache();
    const future = liveListing({ id: 'CIV-FUTURE-CACHE', sourceObservedAt: '2999-01-01T00:00:00.000Z' });
    future.provenance = { ...future.provenance, recordId: 'future-cache', observedAt: future.sourceObservedAt };
    writeCache(cachePath, [future]);
    const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: cachePath });

    assert.equal(await db.getListingById(future.id), null);
  });
}

test('default live cache matches collect-source output and tests can disable it', () => {
  const collectorDefault = path.resolve(__dirname, '../.cache/live-listings.json');
  assert.equal(serverClient.DEFAULT_LIVE_CACHE_PATH, collectorDefault);
  assert.equal(nextClient.DEFAULT_LIVE_CACHE_PATH, collectorDefault);
  assert.equal(new serverClient.DatabaseClient({ env: { NODE_ENV: 'test' } }).liveCachePath, null);
  assert.equal(new nextClient.DatabaseClient({ env: { NODE_ENV: 'test' } }).liveCachePath, null);
});

test('Postgres mode never inspects or overlays the local live cache', () => {
  const cachePath = path.join(os.tmpdir(), `missing-live-cache-${process.pid}-${Date.now()}.json`);
  for (const [, DatabaseClient] of implementations) {
    const db = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: cachePath });
    db.isPg = true;
    const result = db.refreshLiveCache({ force: true });
    assert.deepEqual(result, { refreshed: false, applied: 0 });
  }
});
