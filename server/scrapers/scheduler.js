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
const { sourcesForWave } = require('../discovery/contracts');

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
    this.discoveryStore = options.discoveryStore || null;
    this.telemetry = options.telemetry || telemetryInstance;
    this.onSourceRun = options.onSourceRun || (async () => {});
    this.onCycleStart = options.onCycleStart || (async () => null);
    this.onCycleComplete = options.onCycleComplete || (async () => {});
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
    const requested = options.wave ? sourcesForWave(options.wave) : options.sourceIds;
    if (requested && (!Array.isArray(requested) || !requested.length || requested.some((key) => !this.realScraperKeys.has(key)))) {
      throw new Error('Choose registered live source collectors');
    }
    const scrapers = requested ? this.realScrapers.filter((scraper) => requested.includes(scraper.sourceKey)) : this.realScrapers;
    const completeCycle = !requested && scrapers.length === this.realScrapers.length;
    let cycleContext = null;
    try {
      cycleContext = await this.onCycleStart({
        jobId: options.jobId || null,
        trigger: options.trigger || 'scheduler',
        sourceIds: scrapers.map((scraper) => scraper.sourceKey),
        completeCycle,
      });
    } catch (error) {
      console.error('[Scheduler] Could not initialize collection job:', error.message);
    }
    this.isRunning = true;
    console.log(`[Scheduler] Starting automated ingestion cycle with concurrency ${this.concurrency}...`);
    const startTime = Date.now();
    let totalIngested = 0;
    let totalRejected = 0;
    const sourceResults = [];

    try {
      await mapWithConcurrency(scrapers, this.concurrency, async (scraper) => {
        const scraperStart = Date.now();
        let rejectedForScraper = 0;
        let discoveryRun = null;
        try {
          if (options.leaseGuard && !await options.leaseGuard()) throw new Error('Collection job lease was lost before source execution');
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
          if (this.discoveryStore) {
            const checkpoint=await this.discoveryStore.getCheckpoint(scraper.sourceKey);
            if(typeof scraper.setCheckpoint==='function')scraper.setCheckpoint(checkpoint?.cursor||{});
            discoveryRun=await this.discoveryStore.beginRun({sourceKey:scraper.sourceKey,trigger:options.trigger||'scheduler',scope:{collector:scraper.name},idempotencyKey:options.jobId?`${options.jobId}:${scraper.sourceKey}`:null,jobId:options.jobId||null});
          }
          const items = await scraper.scrapeFeed();
          if (!Array.isArray(items)) {
            throw new TypeError(`${scraper.name} returned a non-array payload`);
          }
          if (scraper.circuitBreaker && scraper.circuitBreaker.isOpen()) {
            throw new Error(`${scraper.name} returned data after its circuit breaker opened; refusing ingestion`);
          }

          const accepted = [];
          for (const item of items) {
            if (options.leaseGuard && !await options.leaseGuard()) throw new Error('Collection job lease was lost; refusing further writes');
            const originalPublisherRecord = typeof scraper.getRawPublisherRecord === 'function' ? scraper.getRawPublisherRecord(item) : null;
            const validation = validateListingForIngestion(item, {
              expectedSource: scraper.sourceKey
            });
            if (!validation.isValid) {
              totalRejected++;
              rejectedForScraper++;
              console.warn(
                `[Scheduler] Rejected ${scraper.name} listing ${item && item.id ? item.id : '<missing-id>'}: ${validation.errors.join(', ')}`
              );
              continue;
            }
            if(this.discoveryStore&&discoveryRun){
              const rawPayload=originalPublisherRecord||(()=>{try{return JSON.parse(validation.listing.raw);}catch{return validation.listing;}})();
              const sourceFacts=validation.listing.provenance?.sourceFacts||{};
              await this.discoveryStore.ingestSnapshot({runId:discoveryRun.id,sourceKey:scraper.sourceKey,sourceRecordId:String(validation.listing.provenance.recordId),observedAt:validation.listing.sourceObservedAt||validation.listing.provenance.observedAt,rawPayload,provenance:validation.listing.provenance,observations:{auctionProgram:{value:validation.listing.auctionProgram??sourceFacts.auctionProgram??null,evidenceClass:'publisher_reported'},openingBid:{value:validation.listing.openingBid??null,evidenceClass:'publisher_reported'},saleDate:{value:validation.listing.saleDate??null,evidenceClass:'publisher_reported'},status:{value:validation.listing.status??null,evidenceClass:'publisher_reported'},sourceStatus:{value:sourceFacts.sourceStatus??validation.listing.status??null,evidenceClass:'publisher_reported'},lifecycleStatus:{value:validation.listing.lifecycleStatus??validation.listing.status??null,evidenceClass:'publisher_reported'},transactionOutcome:{value:validation.listing.transactionOutcome??null,evidenceClass:'unknown'},deposit:{value:validation.listing.deposit??null,evidenceClass:'publisher_reported'},address:{value:validation.listing.address??null,evidenceClass:'publisher_reported'},documents:{value:Array.isArray(sourceFacts.documents)?sourceFacts.documents:null,evidenceClass:'publisher_reported'}}},async(client)=>{const transactionalDb=Object.create(this.database);transactionalDb.pool=client;transactionalDb.isPg=true;await transactionalDb.createListing(validation.listing);});
            }else await this.database.createListing(validation.listing);
            accepted.push(validation.listing);
            totalIngested++;
          }
          const latency = Date.now() - scraperStart;
          this.telemetry.recordRun(scraper.name, accepted, latency, null, {
            rejectedCount: rejectedForScraper,
            circuitOpen: false
          });
          const report = scraper.lastRunReport && typeof scraper.lastRunReport === 'object'
            ? { outcome: scraper.lastRunReport.outcome || null, truncated: scraper.lastRunReport.truncated === true, complete: scraper.lastRunReport.complete, fullSweepComplete: scraper.lastRunReport.fullSweepComplete === true, scope: scraper.lastRunReport.scope || null }
            : null;
          let observationError = null;
          try {
            // Listing writes above are awaited before the observation boundary.
            await this.onSourceRun(scraper.sourceKey, { listings: accepted, error: null, durationMs: latency, rejectedCount: rejectedForScraper, report });
          } catch (error) {
            observationError = error.message;
            console.error('[Scheduler] Could not persist source history:', error.message);
          }
          if(this.discoveryStore&&discoveryRun){await this.discoveryStore.finishRun(discoveryRun.id,{status:report?.truncated||report?.complete===false?'partial':'complete',discovered:items.length,accepted:accepted.length,rejected:rejectedForScraper});if(scraper.lastRunReport?.nextContinuationToken)await this.discoveryStore.saveCheckpoint(scraper.sourceKey,{continuationToken:scraper.lastRunReport.nextContinuationToken,sweepStartedAt:scraper.lastRunReport.sweepStartedAt,pagesCommitted:(scraper.lastRunReport.pagesPreviouslyCommitted||0)+(scraper.lastRunReport.pagesFetched||0)},{collector:scraper.name});else await this.discoveryStore.saveCheckpoint(scraper.sourceKey,{}, {collector:scraper.name});}
          const sourceResult={ sourceId: scraper.sourceKey, runId: discoveryRun?.id || null, accepted: accepted.length, rejected: rejectedForScraper, error: null, observationError, report };
          Object.defineProperty(sourceResult,'acceptedListings',{value:accepted,enumerable:false});
          sourceResults.push(sourceResult);
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
          const errorDetails=err&&err.transportCode?{code:err.transportCode,hostname:err.hostname||null,retryable:err.retryable===true}:null;
          sourceResults.push({ sourceId: scraper.sourceKey, accepted: 0, rejected: rejectedForScraper, error: err.message, ...(errorDetails?{errorDetails}:{}) });
          if(this.discoveryStore&&discoveryRun)try{await this.discoveryStore.finishRun(discoveryRun.id,{status:'failed',rejected:rejectedForScraper,error:err.message});}catch(_){}
          try { await this.onSourceRun(scraper.sourceKey, { listings: [], error: err.message, durationMs: latency, rejectedCount: rejectedForScraper }); }
          catch (historyError) { console.error('[Scheduler] Could not persist source history:', historyError.message); }
          console.error(`[Scheduler] ${scraper.name} encountered an error:`, err.message);
          return 0;
        }
      });

      const duration = Date.now() - startTime;
      console.log(`[Scheduler] Ingestion cycle finished. Ingested ${totalIngested} listings in ${duration}ms`);
      const result = { totalIngested, totalRejected, durationMs: duration, skipped: false, sourceResults, completeCycle, jobId: cycleContext?.jobId || options.jobId || null };
      try { await this.onCycleComplete(result, { ...cycleContext, completeCycle, trigger: options.trigger || 'scheduler' }); }
      catch (error) { console.error('[Scheduler] Could not finalize collection job:', error.message); }
      return result;
    } finally {
      this.isRunning = false;
    }
  }
}

const scheduler = new IngestionScheduler({
  discoveryStore: process.env.DISCOVERY_MODE === 'advanced' && db.isPg ? require('../discovery/store').createDiscoveryStore(db) : null,
  async onSourceRun(sourceId, run) {
    const path = require('node:path');
    const { mergeLiveRecords } = require('../db/live-record-store');
    const { recordSourceRun } = require('../sources/observations');
    if (!run.error && run.listings.length) {
      // A run may reconcile (retire records that disappeared from this source)
      // ONLY when the run completed without error AND was not truncated by
      // pagination, timeouts, or operator abort. The scheduler surfaces this
      // through run.report.complete / run.report.truncated. Any other state
      // — error, partial, truncated, or no report — must NOT retire records.
      const report = run.report && typeof run.report === 'object' ? run.report : null;
      const runCompleted = Boolean(report && report.complete === true && report.truncated !== true);
      try {
        mergeLiveRecords(
          process.env.PROPERTY_LIVE_CACHE_PATH || path.resolve(__dirname, '../../.cache/live-listings.json'),
          run.listings,
          { sourceKey: sourceId, runCompleted }
        );
      } catch (error) {
        // Advanced discovery has already committed each listing and its raw
        // publisher snapshot atomically.  The bounded JSON cache is only a
        // compatibility projection and must not invalidate durable evidence.
        if (!(db.isPg && process.env.DISCOVERY_MODE === 'advanced')) throw error;
        console.warn('[Scheduler] Live compatibility cache was not updated:', error.message);
      }
    }
    recordSourceRun(sourceId, run);
  },
});

// The singleton also creates durable jobs for boot/interval/CLI cycles.  A
// route-created job supplies its id, so retrying that request never produces a
// second hunt pass for the same completed cycle.
const { createCollectionCoordinator } = require('../sources/collection-coordinator');
const collectionCoordinator = createCollectionCoordinator({ scheduler, database: db });
scheduler.collectionCoordinator = collectionCoordinator;
scheduler.onCycleStart = async ({ jobId, trigger, sourceIds }) => {
  if (jobId) return { jobId };
  const job = await collectionCoordinator.store.createOrReuse({ sourceIds, trigger });
  await collectionCoordinator.store.update(job.id, { status: 'running', started: true, stage: { name: 'collection', value: { status: 'running' } } });
  return { jobId: job.id };
};
scheduler.onCycleComplete = async (result, context = {}) => {
  const id = context.jobId || result.jobId;
  if (id) await collectionCoordinator.finalize(id, result);
};

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
module.exports.sourcesForWave = sourcesForWave;
