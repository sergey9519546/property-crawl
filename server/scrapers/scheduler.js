const sheriff = require('./sheriff');
const hud = require('./hud');
const fannie = require('./fannie');
const irs = require('./irs');
const treasury = require('./treasury');
const db = require('../db/client');

class IngestionScheduler {
  constructor() {
    this.scrapers = [sheriff, hud, fannie, irs, treasury];
    this.isRunning = false;
  }

  async runAll() {
    if (this.isRunning) {
      console.log('[Scheduler] Scrape run already in progress, skipping...');
      return;
    }
    this.isRunning = true;
    console.log('[Scheduler] Starting automated ingestion cycle...');
    const startTime = Date.now();
    let totalIngested = 0;

    for (const scraper of this.scrapers) {
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
