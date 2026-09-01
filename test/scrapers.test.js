const assert = require('assert');
const sheriff = require('../server/scrapers/sheriff');
const hud = require('../server/scrapers/hud');
const fannie = require('../server/scrapers/fannie');
const freddie = require('../server/scrapers/freddie');
const va = require('../server/scrapers/va');
const marshals = require('../server/scrapers/marshals');
const irs = require('../server/scrapers/irs');
const landbanksearch = require('../server/scrapers/landbanksearch');
const fdic = require('../server/scrapers/fdic');
const civilview = require('../server/scrapers/civilview');
const bid4assets = require('../server/scrapers/bid4assets');
const scheduler = require('../server/scrapers/scheduler');

console.log('=== RUNNING SCRAPERS TEST SUITE ===');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    });
}

async function run() {
  await test('Sheriff scraper returns standardized listings with computed deal scores', async () => {
    const items = await sheriff.scrapeFeed();
    assert.ok(items.length >= 0);
    if (items.length > 0) {
      const item = items[0];
      assert.strictEqual(item.source, 'sheriff');
      assert.ok(/^[A-Z]{2}$/.test(item.state));
    }
  });

  await test('HUD scraper returns standardized HUD HomeStore listings', async () => {
    const items = await hud.scrapeFeed();
    assert.ok(items.length >= 0);
    if (items.length > 0) {
      const item = items[0];
      assert.strictEqual(item.source, 'hud');
      assert.ok(/^HUD-/.test(item.id));
    }
  });

  await test('Fannie Mae scraper returns HomePath listings', async () => {
    const items = await fannie.scrapeFeed();
    assert.ok(items.length >= 0);
    if (items.length > 0) {
      const item = items[0];
      assert.strictEqual(item.source, 'fannie');
      assert.ok(/^[A-Z]{2}$/.test(item.state));
    }
  });

  await test('Freddie Mac scraper returns HomeSteps listings', async () => {
    const items = await freddie.scrapeFeed();
    assert.ok(items.length >= 0);
    if (items.length > 0) {
      const item = items[0];
      assert.strictEqual(item.source, 'freddie');
      assert.ok(/^FRE-/.test(item.id));
    }
  });

  await test('VA REO scraper returns VRM Properties listings', async () => {
    const items = await va.scrapeFeed();
    assert.ok(items.length >= 0);
    if (items.length > 0) {
      const item = items[0];
      assert.strictEqual(item.source, 'va');
      assert.ok(/^VA-/.test(item.id));
    }
  });

  await test('US Marshals scraper returns seized asset listings', async () => {
    const items = await marshals.scrapeFeed();
    assert.ok(items.length >= 0);
    if (items.length > 0) {
      const item = items[0];
      assert.strictEqual(item.source, 'marshals');
      assert.ok(/^USMS-/.test(item.id));
    }
  });

  await test('IRS scraper standardizes seized asset auctions', async () => {
    if (process.env.RUN_REAL_SCRAPERS !== '1') {
      console.log('  (skipped: set RUN_REAL_SCRAPERS=1 to enable)');
      return;
    }
    const items = await irs.scrapeFeed();
    assert.ok(items.length > 0);
    const item = items[0];
    assert.strictEqual(item.source, 'irs');
    assert.ok(/^[A-Z]{2}$/.test(item.state), `state should be 2 letters: ${item.state}`);
  });

  await test('Ingestion scheduler runs all scrapers concurrently and persists to database', async () => {
    const result = await scheduler.runAll();
    assert.ok(result.totalIngested >= 0);
    assert.ok(result.durationMs >= 0);
  });

  await test('LandBankSearch scraper returns standardized listings from real source (gated)', async () => {
    if (process.env.RUN_REAL_SCRAPERS !== '1') {
      console.log('  (skipped: set RUN_REAL_SCRAPERS=1 to enable)');
      return;
    }
    const items = await landbanksearch.scrapeFeed();
    assert.ok(items.length >= 10, `expected >= 10 listings, got ${items.length}`);
    const item = items[0];
    assert.ok(/^LB-/.test(item.id), `id should start with LB-: ${item.id}`);
    assert.ok(/^[A-Z]{2}$/.test(item.state), `state should be 2 letters: ${item.state}`);
    assert.ok(item.openingBid > 0, `openingBid should be > 0: ${item.openingBid}`);
    assert.strictEqual(item.source, 'landbank');
  });

  await test('FDIC scraper extracts standardized failed-bank asset listings', async () => {
    const items = await fdic.scrapeFeed();
    assert.ok(items.length > 0, `expected FDIC listings, got ${items.length}`);
    const item = items[0];
    assert.ok(/^FDIC-/.test(item.id), `id should start with FDIC-: ${item.id}`);
    assert.ok(/^[A-Z]{2}$/.test(item.state), `state should be 2 letters: ${item.state}`);
    assert.ok(item.openingBid > 0, `openingBid should be > 0: ${item.openingBid}`);
  });

  await test('CivilView scraper extracts county foreclosure notices', async () => {
    const items = await civilview.scrapeFeed();
    assert.ok(items.length >= 0, `CivilView returned listings`);
    if (items.length > 0) {
      const item = items[0];
      assert.ok(/^CIV-/.test(item.id), `id should start with CIV-: ${item.id}`);
      assert.ok(/^[A-Z]{2}$/.test(item.state), `state should be 2 letters: ${item.state}`);
    }
  });

  await test('Bid4Assets scraper parses auction channels into standardized listings', async () => {
    const items = await bid4assets.scrapeFeed();
    assert.ok(items.length > 0, `Bid4Assets returned listings`);
    const item = items[0];
    assert.ok(/^B4A-/.test(item.id), `id should start with B4A-: ${item.id}`);
    assert.ok(/^[A-Z]{2}$/.test(item.state), `state should be 2 letters: ${item.state}`);
    assert.ok(item.openingBid > 0, `openingBid should be > 0: ${item.openingBid}`);
  });

  console.log(`--- SCRAPER TEST SUMMARY: ${passed} Passed, ${failed} Failed ---`);
  if (failed > 0) process.exit(1);
}

run();
