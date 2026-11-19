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
