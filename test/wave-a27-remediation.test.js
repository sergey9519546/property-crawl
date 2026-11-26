'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createCheckLadderHandler } = require('../server/routes/check-ladder');
const handleListings = require('../server/routes/listings');
const { createScrapersHandler } = require('../server/routes/scrapers');
const { queryNjCadastralAtPoint, applyNjCadastralData } = require('../server/enrichment/nj-cadastral');
const { queryArcgisParcel } = require('../server/enrichment/arcgis-parcels');
const { normalizeCandidateDeedRecord } = require('../server/enrichment/deed-comps');
const { matchListingAgainstSearch } = require('../server/intelligence/saved-search-alerts');
const { evaluateSecondLookTriggers } = require('../server/intelligence/second-look');
const { deterministicParse } = require('../server/ai/notice-parser');
const { findWatchlistComps } = require('../server/intelligence/watchlist-comps');
const { computeOpportunity } = require('../server/scrapers/listing-intelligence');
const { CivilViewScraper } = require('../server/scrapers/civilview');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
    send(p) { this.payload = p; return this; },
    end() { return this; },
  };
}

test('I2 + NJ SALES_CODE: queryNjCadastralAtPoint requests SALES_CODE (not NU_CODE/SALE_NU/BLDG_SQFT), maps nuCode & BLDG_DESC sqft, and queryArcgisParcel uses durable_kv_cache', async () => {
  let requestedUrl = '';
  const features = await queryNjCadastralAtPoint(40.7357, -74.1724, {
    fetchFn: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({ features: [{ attributes: { PAMS_PIN: '0714_100_1' } }] }),
      };
    },
  });
  assert.equal(features.length, 1);
  assert.match(requestedUrl, /SALES_CODE/);
  assert.doesNotMatch(requestedUrl, /NU_CODE|SALE_NU|BLDG_SQFT/);

  const listing = { address: '100 Main St', state: 'NJ', sourceUrl: 'https://example.test/1' };
  applyNjCadastralData(listing, {
    observedAt: '2026-11-26T00:00:00.000Z',
    feature: {
      attributes: {
        PAMS_PIN: '0714_100_1',
        COUNTY: 'ESSEX',
        PROP_CLASS: '2',
        BLDG_DESC: '2S-D-1,840 SF',
        SALES_CODE: '26',
        NET_VALUE: 250000,
      },
    },
  });
  assert.equal(listing.assessorParcel.salesCode, '26');
  assert.equal(listing.assessorParcel.nuCode, '26');
  assert.equal(listing.assessorParcel.livingAreaSqft, 1840);
  const normDeed = normalizeCandidateDeedRecord({ ...listing.assessorParcel, deedDate: '2026-06-01', recordedSalePrice: 200000 });
  assert.equal(normDeed.qualified, false);

  const kvStore = new Map();
  const mockDb = {
    isPg: true,
    pool: {
      async query(sql, params) {
        if (/SELECT payload/i.test(sql)) {
          const hit = kvStore.get(`${params[0]}:${params[1]}`);
          return { rows: hit ? [{ payload: hit }] : [] };
        }
        if (/INSERT INTO durable_kv_cache/i.test(sql)) {
          kvStore.set(`${params[0]}:${params[1]}`, JSON.parse(params[2]));
          return { rowCount: 1 };
        }
        return { rows: [] };
      },
    },
  };
  let fetchCalls = 0;
  const fetchFn = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      json: async () => ({
        features: [{
          attributes: {
            PARCEL_ID: '12345',
            JUST_VAL: 300000,
            SALE_PRC1: 280000,
            SALES_CODE: '00',
            BLDG_DESC: '1650 SF',
          },
        }],
      }),
    };
  };
  const first = await queryArcgisParcel({ state: 'FL', county: 'Alachua', lat: 29.6516, lng: -82.3248, db: mockDb, fetchFn });
  const second = await queryArcgisParcel({ state: 'FL', county: 'Alachua', lat: 29.6516, lng: -82.3248, db: mockDb, fetchFn });
  assert.ok(first);
  assert.equal(first.livingAreaSqft, 1650);
  assert.equal(first.nuCode, '00');
  assert.deepEqual(second, first);
  assert.equal(fetchCalls, 1, 'Second queryArcgisParcel call must hit durable_kv_cache');
});

test('I4: GET /api/scrapers hydrates and preserves driftAlarm in PG mode', async () => {
  const driftAlarm = { hasDrift: true, severity: 'high', warning: 'Zero opening bids in latest run' };
  const mockDb = {
    isPg: true,
    pool: {
      async query(sql) {
        if (/FROM source_observation_runs/i.test(sql)) {
          return {
            rows: [{
              source_key: 'sheriff',
              last_run_at: '2026-11-26T08:00:00.000Z',
              last_success_at: '2026-11-26T08:00:00.000Z',
              last_non_empty_at: '2026-11-26T08:00:00.000Z',
              accepted_count: 10,
              evidence_count: 0,
              rejected_count: 0,
              error: null,
              duration_ms: 1200,
              runs_count: 3,
            }],
          };
        }
        if (/FROM listings/i.test(sql)) {
          return { rows: [{ source_key: 'sheriff', active_listings: 10 }] };
        }
        if (/FROM durable_kv_cache/i.test(sql)) {
          return {
            rows: [{
              cache_key: 'sheriff',
              payload: { sourceKey: 'sheriff', driftDetected: true, driftAlarm },
            }],
          };
        }
        return { rows: [] };
      },
    },
  };
  const handler = createScrapersHandler({
    database: mockDb,
    scheduler: {
      getTelemetry: () => ({ sheriff: { runs: 0 } }),
      scrapers: [{ sourceKey: 'sheriff', name: 'Sheriff Sales' }],
      activeRuns: [],
      isRunning: false,
      lastCycleAt: null,
    },
  });
  const res = makeRes();
  await handler({ method: 'GET', url: '/api/scrapers', headers: {} }, res, new URL('http://localhost/api/scrapers'));
  assert.equal(res.statusCode, 200);
  const sheriffRow = res.payload.scrapers.find((s) => s.sourceKey === 'sheriff');
  assert.ok(sheriffRow);
  assert.equal(sheriffRow.driftDetected, true);
  assert.deepEqual(sheriffRow.driftAlarm, driftAlarm);
});

test('I14: POST /api/check-ladder accepts 60 targets and GET /api/listings?ids= batch-hydrates while stripping raw', async () => {
  const ladderHandler = createCheckLadderHandler({ now: () => new Date('2026-12-01T12:00:00.000Z') });
  const targets = Array.from({ length: 60 }, (_, i) => ({
    id: `T-${i}`,
    address: `${100 + i} Oak St, Newark, NJ`,
    state: 'NJ',
    source: 'civilview',
    saleDate: '2026-12-10T14:00:00.000Z',
    maxBid: 50000,
    status: 'active',
  }));
  const ladderRes = makeRes();
  await ladderHandler({ method: 'POST', body: { targets, availableCapital: 1000000 } }, ladderRes);
  assert.equal(ladderRes.statusCode, 200);
  assert.equal(ladderRes.payload.summary.activeTargetCount, 60);

  const mockDb = {
    isPg: true,
    dataMode: () => 'postgres',
    inventoryUnavailableReason: () => null,
    async getListingsByIds(ids) {
      return ids
        .filter((id) => id === 'A1' || id === 'B2')
        .map((id) => ({
          id,
          source: 'hud',
          state: 'FL',
          address: `${id} Pine St`,
          raw: 'SENSITIVE_RAW_TEXT',
          provenance: { observed: true, origin: 'live', sourceFields: { x: 1 }, statusHistory: ['active'] },
        }));
    },
  };
  const listRes = makeRes();
  await handleListings({ method: 'GET', url: '/api/listings?ids=A1,B2,MISSING', headers: {} }, listRes, mockDb);
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.payload.listings.length, 2);
  assert.deepEqual(listRes.payload.missingIds, ['MISSING']);
  assert.equal(listRes.payload.listings[0].raw, undefined);
  assert.equal(listRes.payload.listings[0].provenance.sourceFields, undefined);
});

test('C1, C3, I6, I9, I12, discountPct regressions pass', async () => {
  // C1: saved search discoveryFilters
  const dropSearch = { filters: { state: 'NJ', priceDropped: true, excludeTerminal: true } };
  const droppedListing = { id: 'L1', state: 'NJ', openingBid: 80000, priorOpeningBid: 100000, status: 'active' };
  const terminalListing = { id: 'L2', state: 'NJ', openingBid: 80000, priorOpeningBid: 100000, status: 'Sold', discoveryTerminal: true };
  assert.equal(matchListingAgainstSearch(droppedListing, dropSearch).match, true);
  assert.equal(matchListingAgainstSearch(terminalListing, dropSearch).match, false);

  // C3: second-look fallback to priorDecidedOpeningBid
  const evalOut = evaluateSecondLookTriggers({
    state: 'pass',
    decision: { state: 'pass' },
    latestTrigger: { priorDecidedOpeningBid: 120000 },
    reconsideration: { conditions: [{ field: 'openingBid', operator: 'dropped_by_pct', value: 15 }] },
  }, { openingBid: 95000 });
  assert.equal(evalOut.shouldTrigger, true);

  // I6: CivilView scrapeFeed honors compound detailOffset cursor
  const scraper = new CivilViewScraper({ state: 'NJ', maxCounties: 1, maxDetailPages: 1 });
  scraper.fetchCounties = async () => [{ id: '1', name: 'Essex', state: 'NJ' }];
  scraper.fetchCountySummaries = async () => ({
    sessionCookie: '',
    summaries: [
      { propertyId: 'P1', detailUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=1', sheriffNumber: 'S1' },
      { propertyId: 'P2', detailUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2', sheriffNumber: 'S2' },
    ],
  });
  const fetchedUrls = [];
  scraper.fetchText = async (u) => { fetchedUrls.push(u); return '<html></html>'; };
  scraper.parseDetailPage = (_html, sum) => ({ id: sum.propertyId, address: '1 Main', state: 'NJ', source: 'civilview', provenance: { propertyId: sum.propertyId, recordId: sum.propertyId } });
  scraper.passesFilter = () => true;
  await scraper.scrapeFeed({ cursor: JSON.stringify({ countyOffset: 0, detailOffset: 1 }), slice: true });
  assert.equal(fetchedUrls.length, 1);
  assert.match(fetchedUrls[0], /PropertyId=2/);

  // I9: Starting bid equal to judgment preserved
  const parsed = deterministicParse('123 Main St, Columbus, OH 43215. Judgment amount: $100,000.00. Starting bid: $100,000.00.', { state: 'OH' });
  assert.equal(parsed.opening_bid, 100000);

  // I12: Nominal $100 upset bid does not drop valid comps
  const target = { id: 'T1', state: 'NJ', lat: 40.73, lng: -74.17, sqft: 1500, openingBid: 100, mid: 300000, sourceObservedAt: '2026-11-20T00:00:00.000Z' };
  const comp = { id: 'C1', state: 'NJ', lat: 40.731, lng: -74.171, sqft: 1550, openingBid: 180000, mid: 310000, sourceObservedAt: '2026-11-20T00:00:00.000Z' };
  const compsOut = findWatchlistComps(target, [comp], { nowMs: Date.parse('2026-11-26T00:00:00.000Z') });
  assert.equal(compsOut.comps.length, 1);

  // discountPct on computeOpportunity
  const opp = computeOpportunity({ openingBid: 75000, estLow: 90000, estHigh: 110000, dealScore: 80 });
  assert.equal(opp.discountPct, 25);
});

test('C8: scheduler.onCycleComplete runs reconcileCrossSourceDuplicates under VERCEL=1 + slice=true when totalIngested > 0', async () => {
  const db = require('../server/db/client');
  const scheduler = require('../server/scrapers/scheduler');
  const prevIsPg = db.isPg;
  const prevRec = db.reconcileCrossSourceDuplicates;
  const prevPurge = db.purgeStaleListings;
  const prevVercel = process.env.VERCEL;
  let recCalls = 0;
  let purgeCalls = 0;
  try {
    db.isPg = true;
    db.reconcileCrossSourceDuplicates = async () => { recCalls += 1; return { reconciled: 1 }; };
    db.purgeStaleListings = async () => { purgeCalls += 1; return { deleted: 0 }; };
    process.env.VERCEL = '1';
    await scheduler.onCycleComplete({ totalIngested: 3 }, { slice: true });
    assert.equal(recCalls, 1);
    assert.equal(purgeCalls, 0);
  } finally {
    db.isPg = prevIsPg;
    db.reconcileCrossSourceDuplicates = prevRec;
    db.purgeStaleListings = prevPurge;
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
  }
});
