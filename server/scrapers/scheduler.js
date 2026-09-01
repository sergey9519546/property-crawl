const sheriff = require('./sheriff');
const hud = require('./hud');
const fannie = require('./fannie');
const freddie = require('./freddie');
const va = require('./va');
const marshals = require('./marshals');
const irs = require('./irs');
const treasury = require('./treasury');
const gsa = require('./gsa');
const usda = require('./usda');
const landbanksearch = require('./landbanksearch');
const fdic = require('./fdic');
const civilview = require('./civilview');
const bid4assets = require('./bid4assets');
const db = require('../db/client');
const { telemetryInstance } = require('./telemetry');

const RUN_REAL = true;

class IngestionScheduler {
  constructor() {
    this.mockScrapers = [];
    this.realScrapers = [
      treasury,
      gsa,
      irs,
      usda,
      landbanksearch,
      fdic,
      civilview,
      bid4assets,
      sheriff,
      hud,
      fannie,
      freddie,
      va,
      marshals,
    ];
    // Derive key set from actual array so the log message never drifts.
    this.realScraperKeys = new Set(this.realScrapers.map(s => s.sourceKey || s.name));
    this.isRunning = false;
  }

  async runAll() {
    if (this.isRunning) {
      console.log('[Scheduler] Scrape run already in progress, skipping...');
      return;
    }
    this.isRunning = true;
    const scrapers = this.realScrapers;
    console.log('[Scheduler] Starting automated ingestion cycle across all 11+ live sources...');
    const startTime = Date.now();
    let totalIngested = 0;

    try {
      for (const scraper of scrapers) {
        const scraperStart = Date.now();
        try {
          console.log(`[Scheduler] Running ${scraper.name}...`);
          const items = await scraper.scrapeFeed();
          for (const item of items) {
            await db.createListing(item);
            totalIngested++;
          }
          const latency = Date.now() - scraperStart;
          telemetryInstance.recordRun(scraper.name, items, latency, null);
          console.log(`[Scheduler] ${scraper.name} completed successfully (${items.length} items)`);
        } catch (err) {
          const latency = Date.now() - scraperStart;
          telemetryInstance.recordRun(scraper.name, [], latency, err);
          console.error(`[Scheduler] ${scraper.name} encountered an error:`, err.message);
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[Scheduler] Ingestion cycle finished. Ingested ${totalIngested} listings in ${duration}ms`);
      return { totalIngested, durationMs: duration };
    } finally {
      this.isRunning = false;
    }
  }
}

const scheduler = new IngestionScheduler();

if (require.main === module) {
  scheduler.runAll().then(() => process.exit(0));
}

module.exports = scheduler;
