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
        if (sql.includes('raw_notice')) return { rows: [{ id: 'OLD-1', source_key: 'hud', lifecycle_status: 'sold', status: 'sold', raw_notice: null }] };
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
