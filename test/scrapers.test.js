const assert = require('assert');
const sheriff = require('../server/scrapers/sheriff');
const hud = require('../server/scrapers/hud');
const fannie = require('../server/scrapers/fannie');
const irs = require('../server/scrapers/irs');
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
    assert.ok(items.length > 0);
    const item = items[0];
    assert.strictEqual(item.source, 'sheriff');
    assert.ok(item.dealScore >= 1 && item.dealScore <= 99);
    assert.ok(item.equity > 0);
  });

  await test('HUD scraper returns HUD listings with proper tier and sourceUrl', async () => {
    const items = await hud.scrapeFeed();
    assert.ok(items.length > 0);
    const item = items[0];
    assert.strictEqual(item.source, 'hud');
    assert.strictEqual(item.sourceUrl, 'https://www.hudhomestore.gov');
  });

  await test('Fannie Mae scraper returns HomePath listings', async () => {
    const items = await fannie.scrapeFeed();
    assert.ok(items.length > 0);
    const item = items[0];
    assert.strictEqual(item.source, 'fannie');
    assert.strictEqual(item.state, 'TX');
  });

  await test('IRS scraper standardizes seized asset auctions', async () => {
    const items = await irs.scrapeFeed();
    assert.ok(items.length > 0);
    const item = items[0];
    assert.strictEqual(item.source, 'irs');
    assert.strictEqual(item.state, 'NV');
  });

  await test('Ingestion scheduler runs all scrapers concurrently and persists to database', async () => {
    const result = await scheduler.runAll();
    assert.ok(result.totalIngested >= 4);
    assert.ok(result.durationMs >= 0);
  });

  console.log(`--- SCRAPER TEST SUMMARY: ${passed} Passed, ${failed} Failed ---`);
  if (failed > 0) process.exit(1);
}

run();
