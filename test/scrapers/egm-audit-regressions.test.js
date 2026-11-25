'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { TreasuryForfeitureScraper } = require('../../server/scrapers/treasury');
const { createScrapersHandler } = require('../../server/routes/scrapers');

test('Treasury money parsing, URL resolution and bounded slicing', async () => {
  const scraper = new TreasuryForfeitureScraper({ maxItems: 2 });
  assert.equal(scraper.parseMoney('$123,456.00'), 123456);
  assert.equal(scraper.parseMoney("Cashier's check of $25,000.00"), 25000);
  assert.equal(scraper.parseInt0('1,850 sq ft'), 1850);
  const fetched = [];
  scraper.crawlJitter = async () => {};
  scraper.fetchText = async (url) => {
    fetched.push(url);
    if (url.endsWith('realprop.shtml')) {
      return '<a href="lot-one.shtml">1</a><a href="lot-two.shtml">2</a><a href="lot-three.shtml">3</a>';
    }
    return '<html><head><title>100 Elm St, Indianapolis, Indiana 46204</title></head><body>Starting Bid: $45,000.00 Sale Number: 26-01</body></html>';
  };
  const out = await scraper.scrapeFeed();
  assert.equal(out.partialSweep, true);
  assert.equal(out.nextContinuationToken, '2');
  assert.ok(fetched.includes('https://www.treasury.gov/auctions/treasury/rp/lot-one.shtml'));
  assert.ok(!fetched.some((u) => u.includes('lot-three')));
});

test('scrapers route supports action=next-slice and action=prune', async () => {
  process.env.SCRAPER_ADMIN_TOKEN = 'test-slice-token';
  let ranWith = null;
  const mockDb = {
    isPg: true,
    pool: {
      async query(sql) {
        if (sql.includes('FROM discovery_checkpoints')) return { rows: [{ source_key: 'hud', cursor: { continuationToken: 'TX' } }] };
        if (sql.includes('DELETE FROM listings')) return { rowCount: 1, rows: [] };
        if (sql.includes("SET status =")) return { rowCount: 3, rows: [] };
        if (sql.includes('count(*)')) return { rows: [{ n: 5 }] };
        return { rows: [] };
      },
      async connect() {
        return { async query(sql) { return { rowCount: sql.startsWith('DELETE') ? 1 : 0 }; }, release() {} };
      },
    },
    async purgeStaleListings() { return { deleted: 0, observationsDeleted: 0 }; },
  };
  const handler = createScrapersHandler({
    database: mockDb,
    scheduler: { database: mockDb, async runAll(opts) { ranWith = opts; return { totalIngested: 3 }; } },
  });
  const makeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  const call = async (body) => {
    const res = makeRes();
    await handler({ method: 'POST', url: '/api/scrapers/run', headers: { authorization: 'Bearer test-slice-token' }, body }, res);
    return res;
  };
  try {
    const next = await call({ action: 'next-slice' });
    assert.equal(next.statusCode, 200);
    assert.equal(next.body.source, 'hud');
    assert.equal(ranWith.slice, true);
    const prune = await call({ action: 'prune' });
    assert.equal(prune.statusCode, 200);
    assert.equal(prune.body.report.concludedDeleted, 1);
    assert.equal(prune.body.report.statusReconciled, 3);
  } finally {
    delete process.env.SCRAPER_ADMIN_TOKEN;
  }
});

test('Cloudflare edge worker no longer caches /api/listings and defines scheduled()', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../cloudflare/property-crawl-edge/worker.js'), 'utf8');
  assert.doesNotMatch(src.match(/const CACHEABLE_PATHS = new Set\(\[[\s\S]*?\]\)/)[0], /'\/api\/listings'/);
  assert.match(src, /token === 'origin'/);
  assert.match(src, /async scheduled\(controller, env, ctx\)/);
  assert.match(src, /x-edge-secret/);
});

test('next-slice ignores idle "0" wrap cursors so stale Tier A/B sources do not starve', async () => {
  const { createScrapersHandler } = require('../../server/routes/scrapers');
  process.env.SCRAPER_ADMIN_TOKEN = 'test-slice-token-2';
  let ranWith = null;
  const mockDb = {
    isPg: true,
    pool: {
      async query(sql) {
        if (sql.includes('discovery_checkpoints')) {
          return {
            rows: [
              { source_key: 'sheriff', cursor: '0', updated_at: new Date().toISOString() },
              { source_key: 'civilview', cursor: { continuationToken: '0' }, updated_at: new Date().toISOString() },
            ],
          };
        }
        if (sql.includes('raw_notice') || sql.includes('lifecycle_status')) return { rows: [] };
        return { rows: [{ source: 'sheriff', cnt: 0, n: 0 }] };
      },
    },
    async purgeStaleListings() { return { deleted: 0, observationsDeleted: 0 }; },
  };
  const handler = createScrapersHandler({
    database: mockDb,
    scheduler: { database: mockDb, async runAll(opts) { ranWith = opts; return { totalIngested: 0 }; } },
  });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  try {
    await handler({ method: 'POST', url: '/api/scrapers/run', headers: { authorization: 'Bearer test-slice-token-2' }, body: { action: 'next-slice' } }, res);
    assert.equal(res.statusCode, 200);
    assert.notEqual(res.body.reason, 'resuming');
    assert.equal(ranWith.slice, true);
  } finally {
    delete process.env.SCRAPER_ADMIN_TOKEN;
  }
});

test('slice mode returns nextContinuationToken=null on tail completion instead of wrapping to "0"', async () => {
  const { TreasuryForfeitureScraper } = require('../../server/scrapers/treasury');
  const { UsdaResalesScraper } = require('../../server/scrapers/usda');

  const treasury = new TreasuryForfeitureScraper({ useScrapling: false });
  treasury.maxItems = 2;
  treasury.crawlJitter = async () => {};
  treasury.fetchText = async () => '<html><body><a href="sale1.shtml">Sale 1</a></body></html>';
  treasury.fetchDetail = async () => null;
  await treasury.scrapeFeed({ slice: true, continuationToken: '0' });
  assert.equal(treasury.lastRunReport.nextContinuationToken, null);
  assert.equal(treasury.lastRunReport.complete, true);

  const usda = new UsdaResalesScraper({ useScrapling: false, maxStates: 2 });
  usda.fetchText = async () => '<select id="stateCode"><option value="01">Alabama (1)</option></select>';
  usda.searchState = async () => [];
  await usda.scrapeFeed({ slice: true, continuationToken: '0' });
  assert.equal(usda.lastRunReport.nextContinuationToken, null);
  assert.equal(usda.lastRunReport.complete, true);
});

test('scheduler deletes discovery_checkpoints row when tail slice completes with nextContinuationToken=null', async () => {
  const { IngestionScheduler } = require('../../server/scrapers/scheduler');
  const pgQueries = [];
  const fakeDb = {
    isPg: true,
    pool: {
      async query(sql, params) {
        pgQueries.push({ sql, params });
        return { rows: [] };
      },
    },
    async createListing() { return null; },
  };
  const scheduler = new IngestionScheduler({ database: fakeDb, discoveryStore: null, skipCircuitBreaker: true });
  scheduler.telemetry = { recordRun() {}, flush() {} };
  const tailStub = {
    name: 'TreasuryTailStub',
    sourceKey: 'treasury',
    isEnabled: () => true,
    getCollectionScope: () => ({}),
    getRawPublisherRecord: (item) => item,
    lastRunReport: {
      outcome: 'empty',
      partialSweep: true,
      truncated: true,
      complete: false,
      fullSweepComplete: false,
      nextContinuationToken: null,
      failures: [],
    },
    async scrapeFeed() { return []; },
  };
  scheduler.realScrapers = [tailStub];
  scheduler.scrapers = [tailStub];
  await scheduler.runAll({ sourceIds: ['treasury'], allowNetwork: true, slice: true });
  assert.ok(
    pgQueries.some((q) => q.sql.includes('DELETE FROM discovery_checkpoints WHERE source_key = $1') && q.params?.[0] === 'treasury'),
    'expected tail slice completion with null continuationToken to delete discovery_checkpoints row',
  );
});

test('RealAuction FL address splitting strips hyphenated FL-ZIP while keeping unit numbers and AREA=C sets cancelled status', () => {
  const { parseRealAuctionCard, splitRealAuctionAddress } = require('../../server/scrapers/adapters/realauction');
  const { SheriffSaleScraper } = require('../../server/scrapers/sheriff');

  const split = splitRealAuctionAddress('5120 OAKDALE AVE, UNIT 4B, TAMPA, FL- 33610', 'FL');
  const ohSplit = splitRealAuctionAddress('119 Union Street, Lancaster, 43130', 'OH');
  assert.equal(ohSplit.streetAddress, '119 Union Street');
  assert.equal(ohSplit.city, 'Lancaster');
  assert.equal(ohSplit.state, 'OH');
  assert.equal(ohSplit.zip, '43130');
  assert.equal(split.streetAddress, '5120 OAKDALE AVE, UNIT 4B');
  assert.equal(split.address, '5120 OAKDALE AVE, UNIT 4B, TAMPA, FL 33610');
  assert.equal(split.city, 'Tampa');
  assert.equal(split.state, 'FL');
  assert.equal(split.zip, '33610');

  const flHtml = `
    <div class="AUCTION_ITEM">
      <table class="ad_tab">
        <tr><th class="AD_LBL">Case #:</th><td class="AD_DTA">25-CA-001122</td></tr>
        <tr><th class="AD_LBL">Property Address:</th><td class="AD_DTA">5120 OAKDALE AVE, UNIT 4B</td></tr>
        <tr><th class="AD_LBL"></th><td class="AD_DTA">TAMPA, FL- 33610</td></tr>
        <tr><th class="AD_LBL">Auction Date:</th><td class="AD_DTA">12/10/2026</td></tr>
      </table>
    </div>
  `;
  const parsed = parseRealAuctionCard(flHtml, 'hillsborough', 'FL');
  assert.equal(parsed.streetAddress, '5120 OAKDALE AVE, UNIT 4B');
  assert.equal(parsed.address, '5120 OAKDALE AVE, UNIT 4B, TAMPA, FL 33610');
  assert.equal(parsed.city, 'Tampa');
  assert.equal(parsed.zip, '33610');

  const scraper = new SheriffSaleScraper();
  const areaC = scraper.parseRealauctionHtml(flHtml, { name: 'Hillsborough', state: 'FL', domain: 'hillsborough.realforeclose.com' }, { area: 'C' });
  assert.equal(areaC.length, 1);
  assert.equal(areaC[0].area, 'C');
  assert.equal(areaC[0].city, 'Tampa');
  assert.equal(areaC[0].zip, '33610');
  assert.equal(areaC[0].status, 'cancelled');
  assert.equal(areaC[0].lifecycleStatus, 'cancelled');
  assert.equal(areaC[0].transactionOutcome, 'cancelled');
});

test('Phase 1: federal active status, ServiceLink structured flags, Null Island guard, and conditional Vary header', () => {
  const { prepareListingForPersistence } = require('../../server/db/client');
  const servicelink = require('../../server/scrapers/servicelink');

  assert.equal(prepareListingForPersistence({ status: 'live' }).status, 'active');
  assert.equal(prepareListingForPersistence({ status: 'outbid' }).status, 'closed');
  assert.equal(prepareListingForPersistence({ lat: 0, lng: 0 }).lat, null);
  assert.equal(prepareListingForPersistence({ lat: 0, lng: 0 }).lng, null);
  assert.equal(prepareListingForPersistence({ propType: 'Single Family Home' }).propType, 'Single Family');

  const closedByFlag = servicelink.toListing({
    listingId: 'a1cVO000004XjDoYAK',
    propertyInfo: { websiteUrl: 'https://www.servicelinkauction.com/property-details/10-oak-st-tampa-33602-fl-united-states-tps', address: '10 Oak St', city: 'Tampa', state: 'FL', postalCode: '33602', propertyType: 'Single Family Home' },
    listingStatus: { isAuctionClosed: true },
  }, '2026-11-18T00:00:00.000Z');
  assert.equal(closedByFlag.status, 'closed');
  assert.equal(closedByFlag.propType, 'Single Family');

  const serverSrc = fs.readFileSync(path.resolve(__dirname, '../../server/server.js'), 'utf8');
  assert.match(serverSrc, /if\s*\(req\.headers\.origin\)\s*res\.setHeader\('Vary',\s*'Origin'\)/);
});

test('Phase 1: cross-source dedupe keeps distinct apartment units separate and query.js excludes supersededBy unless includeSuperseded=true', async () => {
  process.env.PROPERTY_INVENTORY_BACKEND = 'memory';
  const db = require('../../server/db/client');
  const { queryFromUrl, matches } = require('../../server/discovery/query');

  const prev = [...db.inMemoryData.listings];
  try {
    db.inMemoryData.listings = [
      { id: 'A-1', source: 'hud', state: 'OH', zip: '44109', address: '100 Main St, Unit 1A, Cleveland, OH 44109', parcelKey: '39035:100-01', status: 'active', openingBid: 50000, lat: 41.4, lng: -81.7, sourceObservedAt: '2026-11-18T00:00:00.000Z' },
      { id: 'B-1', source: 'sheriff', state: 'OH', zip: '44109', address: '100 Main St, Unit 1A, Cleveland, OH 44109', parcelKey: '39035:100-01', status: 'active', openingBid: null, lat: null, lng: null, sourceObservedAt: '2026-11-17T00:00:00.000Z' },
      { id: 'C-2', source: 'hud', state: 'OH', zip: '44109', address: '100 Main St, Unit 2B, Cleveland, OH 44109', parcelKey: '39035:100-01', status: 'active', openingBid: 60000, lat: 41.4, lng: -81.7, sourceObservedAt: '2026-11-18T00:00:00.000Z' },
    ];
    const res = await db.reconcileCrossSourceDuplicates();
    assert.equal(res.superseded, 1);
    const b1 = db.inMemoryData.listings.find((x) => x.id === 'B-1');
    const c2 = db.inMemoryData.listings.find((x) => x.id === 'C-2');
    assert.equal(b1.provenance?.supersededBy?.byId, 'A-1');
    assert.equal(c2.provenance?.supersededBy, undefined, 'distinct unit must not be superseded');

    const defaultFilter = queryFromUrl(new URL('http://localhost/api/listings'));
    const includeFilter = queryFromUrl(new URL('http://localhost/api/listings?includeSuperseded=true'));
    assert.equal(matches(b1, defaultFilter), false);
    assert.equal(matches(b1, includeFilter), true);
  } finally {
    db.inMemoryData.listings = prev;
  }
});

test('Phase 2.3 regressions: PROP_TYPE_ALIAS_SQL normalization, deadlineAt slice propagation, NJ cadastral boundary lookup, computeCountyStats, and 25-source policy parity', async () => {
  const { queryFromUrl, pgWhere } = require('../../server/discovery/query');
  const { normalizePropType: canonicalPropType } = require('../../server/scrapers/normalization');
  assert.equal(canonicalPropType('Mobile Home'), 'Manufactured');
  assert.equal(canonicalPropType('Modular'), 'Manufactured');
  assert.equal(canonicalPropType('Vacant Lot'), 'Land');
  assert.equal(canonicalPropType('Condominium'), 'Condo');
  assert.equal(canonicalPropType('Single Family Home'), 'Single Family');
  const manufacturedSql = pgWhere(queryFromUrl(new URL('http://localhost/api/listings?type=manufactured')));
  const sfhSql = pgWhere(queryFromUrl(new URL('http://localhost/api/listings?type=single%20family')));
  assert.match(manufacturedSql.sql, /'mobile home'/);
  assert.match(sfhSql.sql, /'single family home'/);

  const { IngestionScheduler } = require('../../server/scrapers/scheduler');
  let capturedOpts = null;
  const fakeScraper = {
    sourceKey: 'sheriff',
    name: 'FakeSheriff',
    isEnabled: () => true,
    getCollectionScope: () => ({}),
    circuitBreaker: null,
    getRawPublisherRecord: () => null,
    async scrapeFeed(opts) {
      capturedOpts = opts;
      return { listings: [], partialSweep: true, nextContinuationToken: null };
    },
  };
  const sched = new IngestionScheduler({ networkEnabled: true, database: null, discoveryStore: null, skipCircuitBreaker: true });
  sched.telemetry = { recordRun() {}, flush() {} };
  sched.realScrapers = [fakeScraper];
  sched.scrapers = [fakeScraper];
  await sched.runAll({ sourceIds: ['sheriff'], allowNetwork: true, slice: true, scraperTimeoutMs: 15_000, enableAssessorHarvest: false, enableAssessorBackfill: false });
  assert.equal(capturedOpts?.slice, true);
  assert.ok(Number.isFinite(capturedOpts?.deadlineAt) && capturedOpts.deadlineAt > Date.now());

  const { resolveBoundaryEndpoints, queryArcGisRest } = require('../../server/routes/parcel-boundary');
  const njEndpoints = resolveBoundaryEndpoints('NJ', 'Hudson');
  assert.ok(njEndpoints.some((e) => e.endpoint.includes('Framework/Cadastral') && e.countyFilterField === 'COUNTY'));
  // Junk APN must be rejected before making external fetch calls
  const prevFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return new Response(JSON.stringify({ features: [] }), { status: 200 }); };
  try {
    await assert.rejects(() => queryArcGisRest(null, null, 'NJ', 'TAXLOT 12 BLK 4', 'Hudson'), /PARCEL_GEOMETRY_NOT_FOUND|could not|polygon/i);
    assert.equal(fetchCalls, 0, 'junk TAXLOT/BLOCK/LOT APN must not hit external ArcGIS endpoint');
  } finally {
    globalThis.fetch = prevFetch;
  }

  const { computeCountyStats } = require('../../server/intelligence/neighborhood-stats');
  const countyBucket = computeCountyStats('NJ-Hudson', [
    { state: 'NJ', county: 'Hudson County', openingBid: 100_000, sqft: 1200, dealScore: 50, source: 'civilview', sourceObservedAt: new Date().toISOString() },
    { state: 'NJ', county: 'Hudson', openingBid: 200_000, sqft: 1600, dealScore: 60, source: 'hud', sourceObservedAt: new Date().toISOString() },
  ]);
  assert.equal(countyBucket?.count, 2);
  assert.equal(countyBucket?.medianOpeningBid, 150_000);

  const { SOURCE_CATALOG } = require('../../server/sources/catalog');
  const { SOURCE_HOSTS } = require('../../server/scrapers/source-policy');
  for (const entry of SOURCE_CATALOG) {
    const key = entry.adapterKey || entry.id;
    if (entry.serves === 'LISTINGS') {
      assert.ok(Array.isArray(SOURCE_HOSTS[key]) && SOURCE_HOSTS[key].length > 0, `SOURCE_HOSTS must include listing source ${key}`);
    }
  }
});

test('multi-slice absence safety: HUD and ServiceLink final slices never trigger nationwide absence wipe, while single-pass complete sweeps do', async () => {
  const os = require('node:os');
  const { HudHomeScraper } = require('../../server/scrapers/hud');
  const { ServiceLinkScraper } = require('../../server/scrapers/servicelink');
  const defaultScheduler = require('../../server/scrapers/scheduler');
  const { IngestionScheduler } = defaultScheduler;

  const makeHudListing = (state, caseNum) => ({
    id: `HUD-${caseNum}`,
    source: 'hud',
    state,
    county: null,
    city: 'Test City',
    zip: '90001',
    address: `100 Main St, Test City, ${state} 90001`,
    propType: 'Single Family',
    openingBid: 85000,
    status: 'active',
    sourceUrl: `https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=${caseNum}`,
    sourceObservedAt: '2026-11-24T00:00:00.000Z',
    raw: JSON.stringify({ caseNumber: caseNum }),
    provenance: {
      origin: 'live',
      observed: true,
      observedAt: '2026-11-24T00:00:00.000Z',
      publisher: 'HUD HomeStore',
      recordId: caseNum,
      sourceFacts: {},
    },
  });

  // 1. HUD slice 1 -> slice 2 (final slice): statesPreviouslyCompleted > 0, complete: true, nextContinuationToken: null
  const hud1 = new HudHomeScraper({ states: ['AL', 'AK', 'WY', 'PR'], maxStates: 2, maxPagesPerState: 1, stateConcurrency: 1 });
  hud1.executeWithRetry = (fn) => fn();
  hud1.fetchStateHudHomes = async (state) => ({
    state,
    listings: state === 'AL' ? [makeHudListing('AL', '111-111111')] : [],
    pagesAttempted: 1,
    pagesFetched: 1,
    sourceRows: state === 'AL' ? 1 : 0,
    malformedRows: 0,
    usedHtmlFallback: false,
    truncated: false,
  });
  await hud1.scrapeFeed();
  assert.equal(hud1.lastRunReport.complete, false);
  assert.equal(hud1.lastRunReport.resumedFromCheckpoint, false);
  assert.ok(hud1.lastRunReport.nextContinuationToken);

  const hud2 = new HudHomeScraper({ states: ['AL', 'AK', 'WY', 'PR'], maxStates: 2, maxPagesPerState: 1, stateConcurrency: 1 });
  hud2.executeWithRetry = (fn) => fn();
  hud2.fetchStateHudHomes = async (state) => ({
    state,
    listings: state === 'WY' ? [makeHudListing('WY', '222-222222')] : [],
    pagesAttempted: 1,
    pagesFetched: 1,
    sourceRows: state === 'WY' ? 1 : 0,
    malformedRows: 0,
    usedHtmlFallback: false,
    truncated: false,
  });
  hud2.setCheckpoint({
    continuationToken: hud1.lastRunReport.nextContinuationToken,
    sweepStartedAt: hud1.lastRunReport.sweepStartedAt,
    pagesCommitted: 2,
  });

  const hudAbsenceCalls = [];
  const hudQueries = [];
  const hudDb = {
    isPg: true,
    pool: {
      async query(sql, params) {
        hudQueries.push({ sql, params });
        return { rows: [] };
      },
    },
    async createListing(l) { return l; },
    async reconcileDuplicateDockets() { return { superseded: 0 }; },
    async reconcilePublisherAbsence(sourceId, seenIds, opts) {
      hudAbsenceCalls.push({ sourceId, seenIds, opts });
      return { retired: 0, restored: 0 };
    },
  };
  const tmpCache = path.join(os.tmpdir(), `egm-absence-${Date.now()}.json`);
  const tmpSlCheckpoint = path.join(os.tmpdir(), `egm-sl-cp-${Date.now()}.json`);
  const prevLivePath = process.env.PROPERTY_LIVE_CACHE_PATH;
  const prevSlCpPath = process.env.SERVICELINK_CHECKPOINT_PATH;
  process.env.PROPERTY_LIVE_CACHE_PATH = tmpCache;
  process.env.SERVICELINK_CHECKPOINT_PATH = tmpSlCheckpoint;
  try {
    const hudSched = new IngestionScheduler({
      realScrapers: [hud2],
      discoveryStore: null,
      database: hudDb,
      telemetry: { recordRun() {}, flush() {} },
      networkEnabled: true,
      concurrency: 1,
      onSourceRun: async (sourceId, run) => {
        await defaultScheduler.onSourceRun.call(
          { database: hudDb },
          sourceId,
          { ...run, enableAssessorHarvest: false, enableAssessorBackfill: false },
        );
      },
    });
    await hudSched.runAll({ sourceIds: ['hud'] });
    assert.equal(hud2.lastRunReport.complete, true);
    assert.equal(hud2.lastRunReport.nextContinuationToken, undefined);
    assert.equal(hud2.lastRunReport.statesPreviouslyCompleted, 2);
    assert.equal(hud2.lastRunReport.resumedFromCheckpoint, true);
    assert.ok(
      hudQueries.some((q) => q.sql.includes('DELETE FROM discovery_checkpoints WHERE source_key = $1') && q.params?.[0] === 'hud'),
      'final HUD slice must still delete its finished checkpoint row',
    );
    assert.equal(
      hudAbsenceCalls.some((c) => c.opts?.state == null && c.opts?.county == null),
      false,
      'final HUD slice must NOT run nationwide publisherAbsence reconciliation',
    );
    assert.deepEqual(
      hudAbsenceCalls.map((c) => ({ state: c.opts?.state, seenIds: c.seenIds })),
      [{ state: 'WY', seenIds: ['HUD-222-222222'] }],
      'final HUD slice must only run per-state absence reconciliation for its attempted completed states',
    );

    // 2. ServiceLink final continuation slice: resumedFromCheckpoint: true, complete: true, nextCursor: null
    const slFinal = new ServiceLinkScraper({
      maxPages: 2,
      limit: 25,
      random: () => 0,
      sleep: async () => {},
      now: () => new Date('2026-11-24T00:00:00.000Z'),
      fetchImpl: async () => ({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          continuationToken: null,
          data: [{
            listingId: 'a1cVO000004XjDoYAK',
            auctionProgram: 'TPS',
            propertyInfo: {
              websiteUrl: 'https://www.servicelinkauction.com/property-details/946-western-ave-pittsburgh-15233-pa-united-states-tps',
              address: '946 Western Ave',
              city: 'Pittsburgh',
              county: 'Allegheny',
              state: 'PA',
              postalCode: '15233',
              propertyType: 'Single Family Home',
            },
            listingStatus: { statusText: 'Active' },
          }],
        }),
      }),
    });
    slFinal.setCheckpoint({
      continuationToken: 'cursor-page-40',
      sweepStartedAt: '2026-11-24T00:00:00.000Z',
      pagesCommitted: 40,
    });
    const slAbsenceCalls = [];
    const slQueries = [];
    const slDb = {
      isPg: true,
      pool: {
        async query(sql, params) {
          slQueries.push({ sql, params });
          return { rows: [] };
        },
      },
      async createListing(l) { return l; },
      async reconcileDuplicateDockets() { return { superseded: 0 }; },
      async reconcilePublisherAbsence(sourceId, seenIds, opts) {
        slAbsenceCalls.push({ sourceId, seenIds, opts });
        return { retired: 0, restored: 0 };
      },
    };
    const slSched = new IngestionScheduler({
      realScrapers: [slFinal],
      discoveryStore: null,
      database: slDb,
      telemetry: { recordRun() {}, flush() {} },
      networkEnabled: true,
      concurrency: 1,
      onSourceRun: async (sourceId, run) => {
        await defaultScheduler.onSourceRun.call(
          { database: slDb },
          sourceId,
          { ...run, enableAssessorHarvest: false, enableAssessorBackfill: false },
        );
      },
    });
    await slSched.runAll({ sourceIds: ['servicelink'] });
    assert.equal(slFinal.lastRunReport.complete, true);
    assert.equal(slFinal.lastRunReport.nextCursor, null);
    assert.equal(slFinal.lastRunReport.pagesPreviouslyCommitted, 40);
    assert.equal(slFinal.lastRunReport.resumedFromCheckpoint, true);
    assert.equal(slFinal.lastRunReport.fullSweepComplete, false);
    assert.ok(
      slQueries.some((q) => q.sql.includes('DELETE FROM discovery_checkpoints WHERE source_key = $1') && q.params?.[0] === 'servicelink'),
      'final ServiceLink slice must delete its finished checkpoint row',
    );
    assert.equal(
      slAbsenceCalls.length,
      0,
      'final ServiceLink continuation slice must NOT mark the rest of the catalog publisherAbsence',
    );

    // 3. Single-pass complete sweep (statesPreviouslyCompleted: 0, resumedFromCheckpoint: false, complete: true) STILL runs full reconcilePublisherAbsence
    const slSingle = new ServiceLinkScraper({
      maxPages: 2,
      limit: 25,
      random: () => 0,
      sleep: async () => {},
      now: () => new Date('2026-11-24T00:00:00.000Z'),
      fetchImpl: async () => ({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          continuationToken: null,
          data: [{
            listingId: 'a1cVO000004XjDoBBB',
            auctionProgram: 'TPS',
            propertyInfo: {
              websiteUrl: 'https://www.servicelinkauction.com/property-details/100-oak-st-tampa-33602-fl-united-states-tps',
              address: '100 Oak St',
              city: 'Tampa',
              county: 'Hillsborough',
              state: 'FL',
              postalCode: '33602',
              propertyType: 'Single Family Home',
            },
            listingStatus: { statusText: 'Active' },
          }],
        }),
      }),
    });
    const singleAbsenceCalls = [];
    const singleDb = {
      isPg: true,
      pool: { async query() { return { rows: [] }; } },
      async createListing(l) { return l; },
      async reconcileDuplicateDockets() { return { superseded: 0 }; },
      async reconcilePublisherAbsence(sourceId, seenIds, opts) {
        singleAbsenceCalls.push({ sourceId, seenIds, opts });
        return { retired: 0, restored: 0 };
      },
    };
    const singleSched = new IngestionScheduler({
      realScrapers: [slSingle],
      discoveryStore: null,
      database: singleDb,
      telemetry: { recordRun() {}, flush() {} },
      networkEnabled: true,
      concurrency: 1,
      onSourceRun: async (sourceId, run) => {
        await defaultScheduler.onSourceRun.call(
          { database: singleDb },
          sourceId,
          { ...run, enableAssessorHarvest: false, enableAssessorBackfill: false },
        );
      },
    });
    await singleSched.runAll({ sourceIds: ['servicelink'] });
    assert.equal(slSingle.lastRunReport.resumedFromCheckpoint, false);
    assert.equal(slSingle.lastRunReport.fullSweepComplete, true);
    assert.equal(singleAbsenceCalls.length, 1);
    assert.equal(singleAbsenceCalls[0].opts?.runCompleted, true);
    assert.equal(singleAbsenceCalls[0].opts?.state, null);
    assert.equal(singleAbsenceCalls[0].opts?.county, null);
  } finally {
    if (prevLivePath === undefined) delete process.env.PROPERTY_LIVE_CACHE_PATH;
    else process.env.PROPERTY_LIVE_CACHE_PATH = prevLivePath;
    if (prevSlCpPath === undefined) delete process.env.SERVICELINK_CHECKPOINT_PATH;
    else process.env.SERVICELINK_CHECKPOINT_PATH = prevSlCpPath;
    try { fs.rmSync(tmpCache, { force: true }); } catch (_) {}
    try { fs.rmSync(tmpSlCheckpoint, { force: true }); } catch (_) {}
  }
});

test('HUD deadlineAt before state fetch excludes unattempted state from attemptedStates and completedStates', async () => {
  const { HudHomeScraper } = require('../../server/scrapers/hud');
  const hud = new HudHomeScraper({ states: ['AL', 'AK', 'AZ'], maxStates: 3, maxPagesPerState: 1, stateConcurrency: 1 });
  hud.executeWithRetry = (fn) => fn();
  let calls = 0;
  hud.fetchStateHudHomes = async (state) => {
    calls += 1;
    if (calls === 2) {
      await new Promise((r) => setTimeout(r, 30));
    }
    return {
      state,
      listings: [],
      pagesAttempted: 1,
      pagesFetched: 1,
      sourceRows: 0,
      malformedRows: 0,
      usedHtmlFallback: false,
      truncated: false,
    };
  };
  await hud.scrapeFeed({ deadlineAt: Date.now() + 2010 });
  assert.deepEqual(hud.lastRunReport.attemptedStates, ['AL', 'AK']);
  assert.deepEqual(hud.lastRunReport.completedStates, ['AL', 'AK']);
  assert.deepEqual(hud.lastRunReport.remainingStates, ['AZ']);
  assert.equal(hud.lastRunReport.complete, false);
});

test('treasury and usda setCheckpoint unwrap object cursors and treasury sets bounded timeoutMs', () => {
  const { TreasuryForfeitureScraper } = require('../../server/scrapers/treasury');
  const { UsdaResalesScraper } = require('../../server/scrapers/usda');

  const treasury = new TreasuryForfeitureScraper({ useScrapling: false });
  treasury.setCheckpoint({ continuationToken: '3' });
  assert.equal(treasury.slugOffset, 3);
  const treasuryFromOpts = new TreasuryForfeitureScraper({ useScrapling: false, checkpoint: { cursor: '5' } });
  assert.equal(treasuryFromOpts.slugOffset, 5);
  assert.equal(treasury.timeoutMs, 15_000);

  const prevVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    const vercelTreasury = new TreasuryForfeitureScraper({ useScrapling: false });
    assert.equal(vercelTreasury.timeoutMs, 8_000);
    assert.equal(vercelTreasury.maxRetries, 1);
    assert.equal(vercelTreasury.maxItems, 6);
  } finally {
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
  }

  const usda = new UsdaResalesScraper({ useScrapling: false });
  usda.setCheckpoint({ continuationToken: '10' });
  assert.equal(usda.stateOffset, 10);
  const usdaFromOpts = new UsdaResalesScraper({ useScrapling: false, checkpoint: { nextCursor: '7' } });
  assert.equal(usdaFromOpts.stateOffset, 7);
});

test('civilview empty-county and deadline-aborted slices return cleanly without throwing error state', async () => {
  const { CivilViewScraper } = require('../../server/scrapers/civilview');
  const scraper = new CivilViewScraper({ targetState: 'NJ', maxCounties: 1, useScrapling: false });
  scraper.fetchCounties = async () => [
    { id: '1', name: 'Atlantic County', state: 'NJ' },
    { id: '2', name: 'Bergen County', state: 'NJ' },
  ];
  scraper.fetchCountySummaries = async () => ({ summaries: [], sessionCookie: '' });

  const emptyResult = await scraper.scrapeFeed({ slice: true });
  assert.deepEqual(emptyResult, []);
  assert.equal(scraper.lastRunReport.outcome, 'empty');
  assert.equal(scraper.lastRunReport.partialSweep, true);
  assert.equal(scraper.lastRunReport.nextContinuationToken, '1');
});
