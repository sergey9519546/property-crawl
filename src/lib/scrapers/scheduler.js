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
const civilview = require('./civilview');
const bid4assets = require('./bid4assets');
const servicelink = require('./servicelink');
const db = require('../db/client');
const { telemetryInstance } = require('./telemetry');
const { validateListingForIngestion } = require('./validation');

const DEFAULT_INTERVAL_HOURS = 6;
const MIN_INTERVAL_HOURS = 0.25;
const MAX_INTERVAL_HOURS = 168;
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 8;

function normalizeConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(parsed)));
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, normalizeConcurrency(concurrency));

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function parseScrapeIntervalHours(value, options = {}) {
  const fallback = Number(options.fallbackHours) || DEFAULT_INTERVAL_HOURS;
  const min = Number(options.minHours) || MIN_INTERVAL_HOURS;
  const max = Number(options.maxHours) || MAX_INTERVAL_HOURS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function shouldAllowRealScrapers(env = process.env) {
  if (env.RUN_REAL_SCRAPERS === '1') return true;
  if (env.RUN_REAL_SCRAPERS === '0') return false;
  if (env.NODE_ENV === 'test') return false;
  if (/^test(?::|$)/.test(env.npm_lifecycle_event || '')) return false;
  return true;
}

class IngestionScheduler {
  constructor(options = {}) {
    this.mockScrapers = [];
    this.realScrapers = options.realScrapers || [
      treasury,
      gsa,
      irs,
      usda,
      landbanksearch,
      civilview,
      bid4assets,
      servicelink,
      sheriff,
      hud,
      fannie,
      freddie,
      va,
      marshals,
    ];
    this.database = options.database || db;
    this.telemetry = options.telemetry || telemetryInstance;
    this.networkEnabled = options.networkEnabled ?? shouldAllowRealScrapers(options.env || process.env);
    this.concurrency = normalizeConcurrency(options.concurrency ?? (options.env || process.env).SCRAPER_CONCURRENCY);
    // Derive key set from actual array so the log message never drifts.
    this.realScraperKeys = new Set(this.realScrapers.map(s => s.sourceKey || s.name));
    this.isRunning = false;
  }

  async runAll(options = {}) {
    const allowNetwork = options.allowNetwork ?? this.networkEnabled;
    if (!allowNetwork) {
      console.log('[Scheduler] Real scraper execution disabled for this environment.');
      return { totalIngested: 0, totalRejected: 0, durationMs: 0, skipped: true };
    }
    if (this.isRunning) {
      console.log('[Scheduler] Scrape run already in progress, skipping...');
      return { totalIngested: 0, totalRejected: 0, durationMs: 0, skipped: true };
    }
    this.isRunning = true;
    const scrapers = this.realScrapers;
    console.log(`[Scheduler] Starting automated ingestion cycle with concurrency ${this.concurrency}...`);
    const startTime = Date.now();
    let totalIngested = 0;
    let totalRejected = 0;

    try {
      await mapWithConcurrency(scrapers, this.concurrency, async (scraper) => {
        const scraperStart = Date.now();
        let rejectedForScraper = 0;
        try {
          if (scraper.fixtureOnly === true) {
            const error = new Error(`${scraper.name} is fixture-only and cannot run in production ingestion`);
            error.code = 'FIXTURE_ONLY_SCRAPER';
            throw error;
          }
          if (scraper.historicalOnly === true) {
            const error = new Error(`${scraper.name} is historical-only and cannot run in live opportunity ingestion`);
            error.code = 'HISTORICAL_ONLY_SCRAPER';
            throw error;
          }
          console.log(`[Scheduler] Running ${scraper.name}...`);
          const items = await scraper.scrapeFeed();
          if (!Array.isArray(items)) {
            throw new TypeError(`${scraper.name} returned a non-array payload`);
          }
          if (scraper.circuitBreaker && scraper.circuitBreaker.isOpen()) {
            throw new Error(`${scraper.name} returned data after its circuit breaker opened; refusing ingestion`);
          }
          const accepted = [];
          for (const item of items) {
            const validation = validateListingForIngestion(item, { expectedSource: scraper.sourceKey });
            if (!validation.isValid) {
              totalRejected++;
              rejectedForScraper++;
              console.warn(`[Scheduler] Rejected ${scraper.name} listing ${item && item.id ? item.id : '<missing-id>'}: ${validation.errors.join(', ')}`);
              continue;
            }
            await this.database.createListing(validation.listing);
            accepted.push(validation.listing);
            totalIngested++;
          }
          const latency = Date.now() - scraperStart;
          this.telemetry.recordRun(scraper.name, accepted, latency, null, {
            rejectedCount: rejectedForScraper,
            circuitOpen: false
          });
          console.log(`[Scheduler] ${scraper.name} completed successfully (${accepted.length} accepted, ${items.length - accepted.length} rejected)`);
          return accepted.length;
        } catch (err) {
          const latency = Date.now() - scraperStart;
          this.telemetry.recordRun(scraper.name, [], latency, err, {
            rejectedCount: rejectedForScraper,
            errorCode: err.code || err.name,
            circuitOpen: Boolean(scraper.circuitBreaker && scraper.circuitBreaker.isOpen()),
            circuitReason: scraper.circuitBreaker && scraper.circuitBreaker.lastFailureReason
          });
          console.error(`[Scheduler] ${scraper.name} encountered an error:`, err.message);
          return 0;
        }
      });

      const duration = Date.now() - startTime;
      console.log(`[Scheduler] Ingestion cycle finished. Ingested ${totalIngested} listings in ${duration}ms`);
      return { totalIngested, totalRejected, durationMs: duration, skipped: false };
    } finally {
      this.isRunning = false;
    }
  }
}

const scheduler = new IngestionScheduler();

if (require.main === module) {
  scheduler.runAll().then(() => process.exit(0)).catch((error) => {
    console.error('[Scheduler] Fatal run error:', error);
    process.exit(1);
  });
}

module.exports = scheduler;
module.exports.IngestionScheduler = IngestionScheduler;
module.exports.DEFAULT_CONCURRENCY = DEFAULT_CONCURRENCY;
module.exports.MAX_INTERVAL_HOURS = MAX_INTERVAL_HOURS;
module.exports.MAX_CONCURRENCY = MAX_CONCURRENCY;
module.exports.MIN_INTERVAL_HOURS = MIN_INTERVAL_HOURS;
module.exports.mapWithConcurrency = mapWithConcurrency;
module.exports.normalizeConcurrency = normalizeConcurrency;
module.exports.parseScrapeIntervalHours = parseScrapeIntervalHours;
module.exports.shouldAllowRealScrapers = shouldAllowRealScrapers;
