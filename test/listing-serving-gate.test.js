'use strict';

// test/listing-serving-gate.test.js
//
// The listing-admission gate lives in server/sources/catalog.js: a
// DISCOVERY_ONLY catalog source (court dockets, cadastral parcels) is
// discovery evidence, never an actionable sale listing. The primitives
// existed before this suite; what was missing was wiring. These tests pin
// every serving choke point:
//
//   - discovery.search / matches()  (in-memory query backend, facets included)
//   - pgWhere()                     (PostgreSQL query backend)
//   - db.getListings()              (both store branches; store stays intact)
//   - GET /api/listings/:id         (single-listing route answers 404)
//   - scheduler registration        (scrapeFeed never runs for gated keys)
//   - /api/listings payload         (the data path src/app/sitemap.ts maps)
//
// Non-destructive by contract: every test asserts the records are still in
// the store after the gate refused them, and that the /sources evidence
// surfaces still see them.

const assert = require('node:assert/strict');
const test = require('node:test');

const query = require('../server/discovery/query');
const dbModule = require('../server/db/client');
const { DatabaseClient } = dbModule;
const { servesListings, listingSourceAdmission, getSource } = require('../server/sources/catalog');
const schedulerModule = require('../server/scrapers/scheduler');
const { IngestionScheduler } = schedulerModule;
const handleListings = require('../server/routes/listings');

const COURTLISTENER_ID = 'CL-GATE-TEST-1';
const FLDOR_ID = 'FLDOR-GATE-TEST-1';

function record(overrides = {}) {
  const observedAt = '2026-10-01T00:00:00.000Z';
  return {
    id: 'SV-GATE-TEST-1',
    source: 'servicelink',
    state: 'NJ',
    county: 'Bergen',
    city: 'Hackensack',
    address: '10 Gate Test Avenue, Hackensack, NJ 07601',
    zip: '07601',
    lat: 40.8859,
    lng: -74.0435,
    propType: 'Single Family Home',
    status: 'active',
    openingBid: 50000,
    dealScore: 55,
    sourceUrl: 'https://www.servicelinkauction.com/gate-test',
    sourceObservedAt: observedAt,
    provenance: { origin: 'live', observed: true, recordKind: 'source_record', publisher: 'Public Auction Network', recordId: 'gate-1', observedAt },
    ...overrides,
  };
}

const servingA = record();
const servingB = record({ id: 'SV-GATE-TEST-2', source: 'hud', state: 'OH', county: 'Cuyahoga', city: 'Cleveland', dealScore: 70 });
const courtlistener = record({
  id: COURTLISTENER_ID,
  source: 'courtlistener',
  state: 'NY',
  county: 'New York',
  city: 'New York',
  dealScore: null,
  provenance: { origin: 'live', observed: true, recordKind: 'source_record', publisher: 'CourtListener / RECAP', recordId: 'gate-cl-1', observedAt: '2026-10-01T00:00:00.000Z' },
});
const flDor = record({
  id: FLDOR_ID,
  source: 'fl-dor-cadastral',
  state: 'FL',
  county: 'Alachua',
  city: 'Gainesville',
  dealScore: null,
  provenance: { origin: 'live', observed: true, recordKind: 'source_record', publisher: 'FL DOR Statewide Cadastral', recordId: 'gate-fl-1', observedAt: '2026-10-01T00:00:00.000Z' },
});
const allRecords = [servingA, servingB, courtlistener, flDor];

function url(q = '') {
  return new URL(`http://localhost/api/listings${q}`);
}

function mockRes() {
  const res = { statusCode: 200, body: null }; // res.json without status() is a 200
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function captureConsoleLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.map(String).join(' ')); };
  try {
    return { lines, result: fn() };
  } finally {
    console.log = original;
  }
}

test('the gate primitives fail closed for DISCOVERY_ONLY and uncataloged keys', () => {
  assert.equal(servesListings('courtlistener'), false);
  assert.equal(servesListings('fl-dor-cadastral'), false);
  assert.equal(servesListings('servicelink'), true);
  assert.equal(servesListings('definitely-not-a-source'), false);
  assert.equal(listingSourceAdmission('courtlistener').reason, 'DISCOVERY_ONLY');
  assert.equal(listingSourceAdmission('definitely-not-a-source').reason, 'NOT_IN_CATALOG');
});

test('discovery.search excludes DISCOVERY_ONLY records and facets never count them', async () => {
  const stubDb = { getListings: async () => ({ total: allRecords.length, listings: allRecords }) };
  const result = await query.search(stubDb, query.queryFromUrl(url('?facets=source,state&limit=10')));
  assert.deepEqual(result.listings.map((l) => l.id).sort(), ['SV-GATE-TEST-1', 'SV-GATE-TEST-2']);
  assert.equal(result.total, 2, 'total must count only listing-serving records');
  const sourceBuckets = (result.facets.source || []).map((f) => f.value);
  assert.ok(sourceBuckets.includes('servicelink') && sourceBuckets.includes('hud'),
    'serving sources stay in the facet');
  assert.ok(!sourceBuckets.includes('courtlistener'), 'courtlistener must not be a facet bucket');
  assert.ok(!sourceBuckets.includes('fl-dor-cadastral'), 'fl-dor-cadastral must not be a facet bucket');
  assert.equal((result.facets.state || []).reduce((total, f) => total + f.count, 0), 2,
    'state facet buckets must sum to the gated total only');

  const requested = await query.search(stubDb, query.queryFromUrl(url('?source=courtlistener&limit=10')));
  assert.equal(requested.total, 0, 'an explicit request for a gated source returns nothing');
});

test('matches() refuses a record whose declared source is DISCOVERY_ONLY', () => {
  const emptyFilter = query.queryFromUrl(url());
  assert.equal(query.matches(courtlistener, emptyFilter), false);
  assert.equal(query.matches(flDor, emptyFilter), false);
  assert.equal(query.matches(servingA, emptyFilter), true);
});

test('pgWhere allow-lists only listing-serving source keys and adds no bound parameters', () => {
  const where = query.pgWhere(query.queryFromUrl(url('?state=nj')));
  assert.match(where.sql, /source_key IN \(/);
  assert.ok(!where.sql.includes("'courtlistener'"), 'courtlistener must not be admitted in SQL');
  assert.ok(!where.sql.includes("'fl-dor-cadastral'"), 'fl-dor-cadastral must not be admitted in SQL');
  assert.ok(where.sql.includes("'servicelink'"), 'a serving source must be in the allow-list');
  assert.deepEqual(where.params, ['nj'], 'the admission term must be parameter-free');
});

test('db.getListings excludes gated records on both backends while the store keeps them', async () => {
  // In-memory branch.
  const memoryDb = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: null, workspaceStorePath: null });
  memoryDb.inMemoryData.listings = allRecords;
  const memoryResult = await memoryDb.getListings({ limit: 10 });
  assert.deepEqual(memoryResult.listings.map((l) => l.id).sort(), ['SV-GATE-TEST-1', 'SV-GATE-TEST-2']);
  assert.equal(memoryResult.total, 2);
  assert.equal(memoryDb.inMemoryData.listings.length, 4, 'the store must be untouched (non-destructive)');

  // PostgreSQL branch: capture the SQL the branch builds.
  const pgDb = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: null, workspaceStorePath: null });
  const captured = { sql: null };
  pgDb.isPg = true;
  pgDb.pool = { query: async (sql) => { captured.sql = String(sql); return { rows: [] }; } };
  const pgResult = await pgDb.getListings({ limit: 10 });
  assert.deepEqual(pgResult, { total: 0, listings: [] });
  assert.match(captured.sql, /AND source_key IN \(/, 'the PostgreSQL branch must carry the admission term');
  assert.ok(!captured.sql.includes("'courtlistener'"));
  assert.ok(!captured.sql.includes("'fl-dor-cadastral'"));
});

test('the single-listing route answers the same 404 for DISCOVERY_ONLY records', async () => {
  const original = dbModule.getListingById;
  try {
    dbModule.getListingById = async (id) => allRecords.find((r) => r.id === id) || null;

    const gated = mockRes();
    await handleListings({ url: `/api/listings/${COURTLISTENER_ID}`, method: 'GET' }, gated);
    assert.equal(gated.statusCode, 404);
    assert.deepEqual(gated.body, { error: 'Listing not found' });

    const gatedParcel = mockRes();
    await handleListings({ url: `/api/listings/${FLDOR_ID}`, method: 'GET' }, gatedParcel);
    assert.equal(gatedParcel.statusCode, 404);

    const missing = mockRes();
    await handleListings({ url: '/api/listings/NO-SUCH-RECORD', method: 'GET' }, missing);
    assert.equal(missing.statusCode, 404, 'a genuinely absent record still 404s');

    const serving = mockRes();
    await handleListings({ url: '/api/listings/SV-GATE-TEST-1', method: 'GET' }, serving);
    assert.equal(serving.statusCode, 200, 'a serving record still answers 200');
    assert.equal(serving.body.id, 'SV-GATE-TEST-1');
  } finally {
    dbModule.getListingById = original;
  }
});

test('the /api/listings payload the sitemap maps carries no DISCOVERY_ONLY ids', async () => {
  // src/app/sitemap.ts builds /listings/{id} URLs from exactly the records
  // /api/listings returns (discovery.search). Gate the payload and the
  // sitemap cannot advertise a gated record.
  const stubDb = { getListings: async () => ({ total: allRecords.length, listings: allRecords }) };
  const result = await query.search(stubDb, query.queryFromUrl(url('?limit=1000')));
  const ids = result.listings.map((l) => l.id);
  assert.ok(!ids.includes(COURTLISTENER_ID));
  assert.ok(!ids.includes(FLDOR_ID));
});

test('scheduler registration skips DISCOVERY_ONLY and uncataloged collectors with the required log', () => {
  const serving = { name: 'ServingFixture', sourceKey: 'servicelink', async scrapeFeed() { return []; } };
  const docket = { name: 'DocketFixture', sourceKey: 'courtlistener', async scrapeFeed() { return []; } };
  const parcel = { name: 'ParcelFixture', sourceKey: 'fl-dor-cadastral', async scrapeFeed() { return []; } };
  const mystery = { name: 'MysteryFixture', sourceKey: 'mystery-key', async scrapeFeed() { return []; } };

  const { lines, result } = captureConsoleLog(() => new IngestionScheduler({
    realScrapers: [serving, docket, parcel, mystery],
    database: { async createListing() {} },
    telemetry: { recordRun() {} },
    networkEnabled: true,
  }));
  const scheduler = result;

  assert.deepEqual(
    scheduler.listingServingScrapers.map((s) => s.sourceKey),
    ['servicelink'],
    'only listing-serving collectors get run slots',
  );
  assert.equal(scheduler.realScrapers.length, 4, 'the full registry stays intact for the catalog join');
  assert.ok(lines.includes('[Scheduler] Skipping courtlistener: DISCOVERY_ONLY, not a listing collector'));
  assert.ok(lines.includes('[Scheduler] Skipping fl-dor-cadastral: DISCOVERY_ONLY, not a listing collector'));
  assert.ok(lines.includes('[Scheduler] Skipping mystery-key: not in source catalog'));
});

test('runAll never executes scrapeFeed for a gated collector, requested or not', async () => {
  const called = { serving: false, docket: false, mystery: false };
  const serving = { name: 'ServingFixture', sourceKey: 'servicelink', async scrapeFeed() { called.serving = true; return []; } };
  const docket = { name: 'DocketFixture', sourceKey: 'courtlistener', async scrapeFeed() { called.docket = true; return []; } };
  const mystery = { name: 'MysteryFixture', sourceKey: 'mystery-key', async scrapeFeed() { called.mystery = true; return []; } };
  const scheduler = new IngestionScheduler({
    realScrapers: [serving, docket, mystery],
    database: { async createListing() {} },
    telemetry: { recordRun() {} },
    networkEnabled: true,
  });

  const fullRun = await scheduler.runAll();
  assert.deepEqual(fullRun.sourceResults.map((r) => r.sourceId), ['servicelink']);
  assert.equal(called.serving, true);
  assert.equal(called.docket, false, 'a DISCOVERY_ONLY collector must never run');
  assert.equal(called.mystery, false, 'an uncataloged collector must never run');

  called.serving = false;
  const requested = await scheduler.runAll({ sourceIds: ['courtlistener'] });
  assert.equal(requested.sourceResults.length, 0, 'an explicitly requested gated source is skipped');
  assert.equal(called.docket, false);
});

test('the production registry keeps every collector registered while gating run slots', () => {
  // test/courtlistener.test.js, test/fl-dor-cadastral.test.js,
  // test/ca-controller-tax-sale.test.js and test/hud-usps-vacancy.test.js pin
  // these collectors as registered; the gate removes run slots, not the
  // registration.
  const registryKeys = new Set(schedulerModule.realScrapers.map((s) => s.sourceKey));
  for (const key of ['courtlistener', 'fl-dor-cadastral', 'ca-controller-tax-sale', 'hud-usps-vacancy']) {
    assert.ok(registryKeys.has(key), `${key} must stay registered`);
  }
  const servingKeys = new Set(schedulerModule.listingServingScrapers.map((s) => s.sourceKey));
  for (const key of ['courtlistener', 'fl-dor-cadastral', 'ca-controller-tax-sale', 'hud-usps-vacancy', 'public-notices-email', 'government-land', 'local-surplus', 'fannie', 'freddie', 'va', 'marshals']) {
    assert.ok(!servingKeys.has(key), `${key} must not get a run slot while DISCOVERY_ONLY`);
  }
  for (const key of ['servicelink', 'treasury', 'gsa', 'irs', 'usda', 'hud', 'civilview', 'bid4assets', 'landbank', 'sheriff']) {
    assert.ok(servingKeys.has(key), `${key} must keep its run slot`);
  }
});

test('the /sources evidence surfaces still list the gated sources and their records', async () => {
  // Source Radar builds its source list from SOURCE_CATALOG: every gated
  // source must still be a first-class catalog row.
  const docketEntry = getSource('courtlistener');
  const parcelEntry = getSource('fl-dor-cadastral');
  assert.ok(docketEntry && docketEntry.status === 'DISCOVERY_ONLY');
  assert.ok(parcelEntry && parcelEntry.status === 'DISCOVERY_ONLY');

  // The evidence aggregate behind Source Radar record counts reads the store
  // directly (native SQL in PostgreSQL mode) and must keep counting records
  // the listing feed refuses.
  const memoryDb = new DatabaseClient({ env: { NODE_ENV: 'test' }, liveCachePath: null, workspaceStorePath: null });
  memoryDb.inMemoryData.listings = allRecords;
  const counts = await memoryDb.getSourceInventoryAggregatesNative();
  assert.equal(counts.get('courtlistener')?.observedRecords, 1);
  assert.equal(counts.get('fl-dor-cadastral')?.observedRecords, 1);
  assert.equal(memoryDb.inMemoryData.listings.length, 4, 'the store is untouched');
});
