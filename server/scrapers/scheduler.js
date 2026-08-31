const sheriff = require('./sheriff');
const hud = require('./hud');
const fannie = require('./fannie');
const irs = require('./irs');
const treasury = require('./treasury');
const gsa = require('./gsa');
const usda = require('./usda');
const db = require('../db/client');

// Scrapers that talk to live external sites. These only run when the caller
// explicitly opts in (RUN_REAL_SCRAPERS=1 or --real). Default runs stay fully
// offline so `npm test` and local dev never hit the network.
const REAL_SCRAPER_KEYS = new Set(['treasury', 'irs', 'gsa', 'usda']);
const RUN_REAL =
  process.env.RUN_REAL_SCRAPERS === '1' || process.argv.includes('--real');

class IngestionScheduler {
  constructor() {
    this.mockScrapers = [sheriff, hud, fannie];
    this.realScrapers = [treasury, gsa, irs, usda];
    this.isRunning = false;
  }

  async runAll() {
    if (this.isRunning) {
      console.log('[Scheduler] Scrape run already in progress, skipping...');
      return;
    }
    this.isRunning = true;
    const scrapers = RUN_REAL
      ? [...this.mockScrapers, ...this.realScrapers]
      : this.mockScrapers;
    const skipped = this.realScrapers.length;
    console.log('[Scheduler] Starting automated ingestion cycle...');
    if (!RUN_REAL && skipped > 0) {
      console.log(`[Scheduler] RUN_REAL_SCRAPERS not set — skipping ${skipped} live scraper(s) (${[...REAL_SCRAPER_KEYS].join(', ')})`);
    }
    const startTime = Date.now();
    let totalIngested = 0;

    for (const scraper of scrapers) {
      try {
        console.log(`[Scheduler] Running ${scraper.name}...`);
        const items = await scraper.scrapeFeed();
        for (const item of items) {
          await db.createListing(item);
          totalIngested++;
        }
        console.log(`[Scheduler] ${scraper.name} completed successfully (${items.length} items)`);
      } catch (err) {
        console.error(`[Scheduler] ${scraper.name} encountered an error:`, err.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Scheduler] Ingestion cycle finished. Ingested ${totalIngested} listings in ${duration}ms`);
    this.isRunning = false;
    return { totalIngested, durationMs: duration };
  }
}

const scheduler = new IngestionScheduler();

if (require.main === module) {
  scheduler.runAll().then(() => process.exit(0));
}

module.exports = scheduler;
