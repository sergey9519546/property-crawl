const crypto = require('node:crypto');
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
const flDorCadastral = require('./fl-dor-cadastral');
const caControllerTaxSale = require('./ca-controller-tax-sale');
const courtlistener = require('./courtlistener');
const hudUspsVacancy = require('./hud-usps-vacancy');
const publicNoticesEmail = require('./email-ingest');
const governmentLand = require('./government-land');
const localSurplus = require('./local-surplus');
const db = require('../db/client');
const { telemetryInstance } = require('./telemetry');
const { validateListingForIngestion } = require('./validation');
const { evaluateRecordsForDrift } = require('./drift-alarm');
const { requireCollectionStorage, inspectCollectionStorage } = require('../discovery/storage-health');
const { sanitizeRunReport } = require('../discovery/run-report');
const { collectionScope } = require('./collection-scope');
// Listing-admission gate (server/sources/catalog.js): a DISCOVERY_ONLY
// catalog source is discovery evidence, never an actionable sale listing,
// so its collector never gets a run slot. Uncataloged keys fail closed too.
const { listingSourceAdmission } = require('../sources/catalog');
const { validateScraperAdapters } = require('./scraper-interface');
const { hash: scopeHash } = require('../discovery/store');

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

/**
 * Registration admission gate. A scraper whose source key fails
 * servesListings() (DISCOVERY_ONLY status or not in the source catalog)
 * is dropped from the runnable set and logged; scrapeFeed must not run
 * for it at all. The full registry is kept on this.realScrapers so the
 * catalog adapter join and Source Radar adapter view stay observable;
 * the gate controls run slots, not the catalog join.
 */
function admitListingsScrapers(scrapers) {
  return (scrapers || []).filter((scraper) => {
    const key = (scraper && (scraper.sourceKey || scraper.name)) || '<unnamed>';
    const admission = listingSourceAdmission(scraper && scraper.sourceKey);
    if (admission.serves) return true;
    const reason = admission.reason === 'DISCOVERY_ONLY'
      ? 'DISCOVERY_ONLY, not a listing collector'
      : 'not in source catalog';
    console.log(`[Scheduler] Skipping ${key}: ${reason}`);
    return false;
  });
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

function backgroundCollectionReason(env = process.env) {
  if (!shouldAllowRealScrapers(env)) {
    if (env.RUN_REAL_SCRAPERS === '0') return 'run_real_scrapers_off';
    if (env.NODE_ENV === 'test') return 'node_env_test';
    if (/^test(?::|$)/.test(env.npm_lifecycle_event || '')) return 'npm_test_lifecycle';
    return 'scrapers_disallowed';
  }
  if (env.DISCOVERY_MODE === 'advanced') return 'discovery_mode_advanced';
  const flag = env.SCRAPER_BACKGROUND_ENABLED;
  if (flag == null || flag === '' || flag === '1') return 'enabled';
  return 'scraper_background_disabled';
}

function backgroundCollectionEnabled(env = process.env) {
  return backgroundCollectionReason(env) === 'enabled';
}

function collectionRuntimeStatus(target, env = process.env) {
  const report = target && target.telemetry && typeof target.telemetry.getHealthReport === 'function'
    ? target.telemetry.getHealthReport()
    : null;
  return {
    enabled: backgroundCollectionEnabled(env),
    reason: backgroundCollectionReason(env),
    running: Boolean(target && target.isRunning),
    startedAt: (target && target.cycleStartedAt) || null,
    lastFinishedAt: (target && target.lastCycleFinishedAt) || null,
    scraperStatus: report ? report.systemStatus : 'idle',
    scrapersSeen: report ? report.totalScrapers : 0,
    scrapersInFault: report ? report.scrapersInFault : 0,
  };
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
      flDorCadastral,
      caControllerTaxSale,
      courtlistener,
      hudUspsVacancy,
      // Email-as-API collector: only accepts evidence when IMAP/corpus is configured.
      new publicNoticesEmail.PublicNoticesEmailScraper({ env: options.env || process.env }),
      // End-coverage enrollment templates: scheduled so Source Radar always
      // shows these ends; fail closed / skip when not enrolled — never invent.
      governmentLand,
      localSurplus,
    ];
    // The nine members read below were never declared anywhere, so adapter
    // drift (a sourceKey that stopped matching the catalog, a missing publisher
    // record) failed silently. Surface it here instead. Deliberately NOT fatal:
    // one non-conforming adapter must not stop the scheduler from booting and
    // running the other twenty-three.
    const adapterContract = validateScraperAdapters(this.realScrapers);
    if (!adapterContract.ok) {
      console.warn(`[Scheduler] ${adapterContract.offenders.length} of ${this.realScrapers.length} scraper adapters violate the scraper contract:\n  ${adapterContract.errors.join('\n  ')}`);
    }
    this.database = options.database || db;
    this.discoveryStore = options.discoveryStore || null;
    this.storageProbe = options.storageProbe || inspectCollectionStorage;
    this.telemetry = options.telemetry || telemetryInstance;
    this.onSourceRun = options.onSourceRun || (async () => {});
    this.onCycleStart = options.onCycleStart || (async () => null);
    this.onCycleComplete = options.onCycleComplete || (async () => {});
    this.networkEnabled = options.networkEnabled ?? shouldAllowRealScrapers(options.env || process.env);
    this.concurrency = normalizeConcurrency(options.concurrency ?? (options.env || process.env).SCRAPER_CONCURRENCY);
    // Derive key set from actual array so the log message never drifts.
    this.realScraperKeys = new Set(this.realScrapers.map(s => s.sourceKey || s.name));
    // Registration gate: only listing-serving collectors get run slots.
    // Logged once per scheduler construction.
    this.listingServingScrapers = admitListingsScrapers(this.realScrapers);
    this.isRunning = false;
    this.cycleStartedAt = null;
    this.lastCycleFinishedAt = null;
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
    if (this.discoveryStore) requireCollectionStorage(this.storageProbe);
    const requested = options.wave ? sourcesForWave(options.wave) : options.sourceIds;
    if (requested && (!Array.isArray(requested) || !requested.length || requested.some((key) => !this.realScraperKeys.has(key)))) {
      throw new Error('Choose registered live source collectors');
    }
    // Default cycles run only listing-serving collectors; an explicitly
    // requested key that fails the admission gate is skipped (and logged)
    // rather than run.
    const scrapers = requested
      ? admitListingsScrapers(this.realScrapers.filter((scraper) => requested.includes(scraper.sourceKey)))
      : this.listingServingScrapers;
    let ownership = options.jobId && options.owner ? { jobId: options.jobId, owner: options.owner } : {};
    let leaseGuard = options.leaseGuard || null;
    const assertLease = async (message = 'Collection job lease was lost') => {
      if (leaseGuard && !await leaseGuard()) { const error=new Error(message);error.code='DISCOVERY_JOB_LEASE_LOST';throw error; }
    };
    const completeCycle = !requested && scrapers.length === this.listingServingScrapers.length;
    this.isRunning = true;
    this.cycleStartedAt = new Date().toISOString();
    const stopCycle = () => {
      this.isRunning = false;
      this.cycleStartedAt = null;
      this.lastCycleFinishedAt = new Date().toISOString();
    };
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
      if (this.discoveryStore?.requiresJobFence || error?.code === 'DISCOVERY_JOB_LEASE_LOST') {
        stopCycle();
        throw error;
      }
    }
    if (!ownership.jobId && cycleContext?.jobId && cycleContext?.owner) ownership = { jobId: cycleContext.jobId, owner: cycleContext.owner };
    if (!leaseGuard && cycleContext?.leaseGuard) leaseGuard = cycleContext.leaseGuard;
    if (this.discoveryStore?.requiresJobFence && (!ownership.jobId || !ownership.owner || typeof leaseGuard !== 'function')) {
      const error = new Error('Durable collection requires an owned live job claim');
      error.code = 'DISCOVERY_JOB_LEASE_LOST';
      stopCycle();
      throw error;
    }
    try {
      await assertLease('Collection job lease was lost before cycle execution');
    } catch (error) {
      stopCycle();
      throw error;
    }
    console.log(`[Scheduler] Starting automated ingestion cycle with concurrency ${this.concurrency}...`);
    const startTime = Date.now();
    let totalIngested = 0;
    let totalRejected = 0;
    const sourceResults = [];

    try {
      const workerResults=await mapWithConcurrency(scrapers, this.concurrency, async (scraper) => {
        const scraperStart = Date.now();
        let rejectedForScraper = 0;
        let discoveryRun = null;
        try {
          if (this.discoveryStore) requireCollectionStorage(this.storageProbe);
          await assertLease('Collection job lease was lost before source execution');
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
            const scope=collectionScope(scraper);
            if(!scope)throw new Error(`Collector ${scraper.sourceKey} does not expose a bounded collection scope`);
            const checkpoint=await this.discoveryStore.getCheckpoint(scraper.sourceKey);
            const freshCanary=options.trigger==='discovery_canary'&&checkpoint?.cursor&&typeof checkpoint.cursor==='object'&&!Array.isArray(checkpoint.cursor)&&Object.keys(checkpoint.cursor).length===0;
            // A checkpoint with no scope hash cannot be resumed or discarded safely.
            // A checkpoint whose hash belongs to a previous geography starts this
            // scope from the beginning. The old cursor is not applied, stored
            // listings stay, and this run does not promote the new scope.
            const scopeIdentityMissing=checkpoint&&(checkpoint.scopeHash==null||checkpoint.scopeHash==='');
            if(scopeIdentityMissing&&!freshCanary)throw new Error(`Checkpoint scope does not match ${scraper.sourceKey} collector configuration`);
            const scopeMoved=Boolean(checkpoint?.scopeHash&&checkpoint.scopeHash!==scopeHash(scope));
            if(scopeMoved)console.warn(`[Scheduler] ${scraper.sourceKey} checkpoint belongs to a previous scope. Starting this scope from the beginning. Stored listings stay.`);
            if(typeof scraper.setCheckpoint==='function')scraper.setCheckpoint(scopeMoved?{}:(checkpoint?.cursor||{}));
            discoveryRun=await this.discoveryStore.beginRun({sourceKey:scraper.sourceKey,trigger:options.trigger||'scheduler',scope,idempotencyKey:options.jobId?`${options.jobId}:${scraper.sourceKey}`:null,jobId:options.jobId||null},ownership);
          }
          if (scraper.sourceKey === 'servicelink') {
            if (this.discoveryStore) {
              scraper.checkpointPath = null;
            } else if (typeof scraper.setCheckpoint === 'function') {
              const checkpointPath = servicelink.explicitCheckpointPath(process.env.SERVICELINK_CHECKPOINT_PATH);
              scraper.checkpointPath = checkpointPath;
              if (checkpointPath) {
                const saved = servicelink.readCheckpointFile(checkpointPath);
                if (saved) scraper.setCheckpoint(saved);
              }
            }
          }
          const items = await scraper.scrapeFeed();
          await assertLease('Collection job lease was lost after source execution');
          // A report-only collector ingests its own evidence and reports counts
          // rather than returning listings. public-notices-email does this: it
          // writes evidence packets to the intake store and has no listing rows
          // to hand over. Treat that shape as a legitimate outcome instead of
          // throwing, which used to make the source fail on every sweep.
          const reportOnly = !Array.isArray(items) && items && typeof items === 'object' && 'report' in items;
          if (!Array.isArray(items) && !reportOnly) {
            throw new TypeError(`${scraper.name} returned a non-array payload`);
          }
          const itemsToIngest = reportOnly ? [] : items;
          if (reportOnly) {
            scraper.lastRunReport = items;
            totalRejected += items.rejected || 0;
            rejectedForScraper += items.rejected || 0;
            console.log(`[Scheduler] ${scraper.name} produced an evidence report (no listing rows): ${items.report?.reason || items.report?.mode || 'recorded'}`);
          }
          if (scraper.circuitBreaker && scraper.circuitBreaker.isOpen()) {
            throw new Error(`${scraper.name} returned data after its circuit breaker opened; refusing ingestion`);
          }

          const accepted = [];
          for (const item of itemsToIngest) {
            if (this.discoveryStore && accepted.length % 50 === 0) requireCollectionStorage(this.storageProbe);
            await assertLease('Collection job lease was lost; refusing further writes');
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
              // raw_payload records what the publisher actually returned. Prefer the
              // scraper's captured publisher record; otherwise use the stored raw only
              // when it parses as JSON. If neither is available the honest value is
              // null - an absent publisher payload is unknown, and it is NOT the
              // normalized listing. Storing the normalized record here would label
              // derived data as publisher-observed and quietly corrupt the evidence
              // chain while the run reported success. See migration 016.
              const rawPayload=originalPublisherRecord||(()=>{try{return JSON.parse(validation.listing.raw);}catch{return null;}})();
              const sourceFacts=validation.listing.provenance?.sourceFacts||{};
              await this.discoveryStore.ingestSnapshot({runId:discoveryRun.id,sourceKey:scraper.sourceKey,sourceRecordId:String(validation.listing.provenance.recordId),observedAt:validation.listing.sourceObservedAt||validation.listing.provenance.observedAt,rawPayload,provenance:validation.listing.provenance,observations:{auctionProgram:{value:validation.listing.auctionProgram??sourceFacts.auctionProgram??null,evidenceClass:'publisher_reported'},openingBid:{value:validation.listing.openingBid??null,evidenceClass:'publisher_reported'},saleDate:{value:validation.listing.saleDate??null,evidenceClass:'publisher_reported'},status:{value:validation.listing.status??null,evidenceClass:'publisher_reported'},sourceStatus:{value:sourceFacts.sourceStatus??validation.listing.status??null,evidenceClass:'publisher_reported'},lifecycleStatus:{value:validation.listing.lifecycleStatus??validation.listing.status??null,evidenceClass:'publisher_reported'},transactionOutcome:{value:validation.listing.transactionOutcome??null,evidenceClass:'unknown'},deposit:{value:validation.listing.deposit??null,evidenceClass:'publisher_reported'},address:{value:validation.listing.address??null,evidenceClass:'publisher_reported'},documents:{value:Array.isArray(sourceFacts.documents)?sourceFacts.documents:null,evidenceClass:'publisher_reported'}}},async(client)=>{const transactionalDb=Object.create(this.database);transactionalDb.pool=client;transactionalDb.isPg=true;await transactionalDb.createListing(validation.listing);},ownership);
            }else await this.database.createListing(validation.listing);
            accepted.push(validation.listing);
            totalIngested++;
          }
          const latency = Date.now() - scraperStart;
          let driftAlarm = null;
          if (accepted.length > 0) {
            driftAlarm = evaluateRecordsForDrift(scraper.sourceKey, accepted);
            if (driftAlarm.hasDrift) {
              console.warn(`[Scheduler] ${driftAlarm.warning}`);
            }
          }
          this.telemetry.recordRun(scraper.name, accepted, latency, null, {
            rejectedCount: rejectedForScraper,
            circuitOpen: false,
            driftAlarm: driftAlarm && driftAlarm.hasDrift ? driftAlarm : null
          });
          const coverage = sanitizeRunReport(scraper.lastRunReport, { accepted: accepted.length, ingestionRejected: rejectedForScraper });
          const report = scraper.lastRunReport && typeof scraper.lastRunReport === 'object'
            ? { outcome: coverage.outcome || null, truncated: coverage.truncated === true, complete: coverage.complete, fullSweepComplete: coverage.fullSweepComplete === true, scope: coverage.acquisitionScope || null, coverage, ...(driftAlarm && driftAlarm.hasDrift ? { driftAlarm } : {}) }
            : (driftAlarm && driftAlarm.hasDrift ? { driftAlarm } : null);
          let observationError = null;
          try {
            // Listing writes above are awaited before the observation boundary.
            await this.onSourceRun(scraper.sourceKey, { listings: accepted, error: null, durationMs: latency, rejectedCount: rejectedForScraper, report });
          } catch (error) {
            observationError = error.message;
            console.error('[Scheduler] Could not persist source history:', error.message);
          }
          if (this.discoveryStore && discoveryRun) {
            await assertLease('Collection job lease was lost before source completion');
            await this.discoveryStore.finishRun(discoveryRun.id, {
              status: report?.truncated || report?.complete === false ? 'partial' : 'complete',
              discovered: coverage.counts?.publisherDiscovered ?? itemsToIngest.length,
              accepted: accepted.length,
              rejected: rejectedForScraper + (coverage.counts?.parserRejected ?? coverage.counts?.malformedRows ?? 0),
              coverage,
            },ownership);
            const cursor = scraper.lastRunReport?.nextContinuationToken ? {
              continuationToken: scraper.lastRunReport.nextContinuationToken,
              sweepStartedAt: scraper.lastRunReport.sweepStartedAt,
              pagesCommitted: (scraper.lastRunReport.pagesPreviouslyCommitted || 0) + (scraper.lastRunReport.pagesFetched || 0),
            } : {};
            await assertLease('Collection job lease was lost before checkpoint advancement');
            await this.discoveryStore.saveCheckpoint(scraper.sourceKey, cursor, collectionScope(scraper),ownership);
          }
          const sourceResult={ sourceId: scraper.sourceKey, runId: discoveryRun?.id || null, accepted: accepted.length, rejected: rejectedForScraper, error: null, observationError, report };
          Object.defineProperty(sourceResult,'acceptedListings',{value:accepted,enumerable:false});
          sourceResults.push(sourceResult);
          console.log(`[Scheduler] ${scraper.name} completed successfully (${accepted.length} accepted, ${itemsToIngest.length - accepted.length} rejected)`);
          return accepted.length;
        } catch (err) {
          if(err?.code==='DISCOVERY_JOB_LEASE_LOST')throw err;
          const latency = Date.now() - scraperStart;
          this.telemetry.recordRun(scraper.name, [], latency, err, {
            rejectedCount: rejectedForScraper,
            errorCode: err.code || err.name,
            circuitOpen: Boolean(scraper.circuitBreaker && scraper.circuitBreaker.isOpen()),
            circuitReason: scraper.circuitBreaker && scraper.circuitBreaker.lastFailureReason
          });
          const errorDetails=err&&err.transportCode?{code:err.transportCode,hostname:err.hostname||null,retryable:err.retryable===true}:null;
          sourceResults.push({ sourceId: scraper.sourceKey, accepted: 0, rejected: rejectedForScraper, error: err.message, ...(errorDetails?{errorDetails}:{}) });
          if(this.discoveryStore&&discoveryRun)try{await assertLease();await this.discoveryStore.finishRun(discoveryRun.id,{status:'failed',rejected:rejectedForScraper,error:err.message},ownership);}catch(finishError){if(finishError?.code==='DISCOVERY_JOB_LEASE_LOST')throw finishError;}
          try { await this.onSourceRun(scraper.sourceKey, { listings: [], error: err.message, durationMs: latency, rejectedCount: rejectedForScraper }); }
          catch (historyError) { console.error('[Scheduler] Could not persist source history:', historyError.message); }
          console.error(`[Scheduler] ${scraper.name} encountered an error:`, err.message);
          return 0;
        }
      });
      const leaseFailure=workerResults.find(entry=>entry.status==='rejected'&&entry.reason?.code==='DISCOVERY_JOB_LEASE_LOST');
      if(leaseFailure)throw leaseFailure.reason;

      const duration = Date.now() - startTime;
      console.log(`[Scheduler] Ingestion cycle finished. Ingested ${totalIngested} listings in ${duration}ms`);
      const result = { totalIngested, totalRejected, durationMs: duration, skipped: false, sourceResults, completeCycle, jobId: cycleContext?.jobId || options.jobId || null };
      if (!options.coordinatorManaged) {
        try { await this.onCycleComplete(result, { ...cycleContext, completeCycle, trigger: options.trigger || 'scheduler', ...ownership, leaseGuard }); }
        catch (error) { console.error('[Scheduler] Could not finalize collection job:', error.message); if(error?.code==='DISCOVERY_JOB_LEASE_LOST')throw error; }
      }
      return result;
    } finally {
      stopCycle();
    }
  }
}

const scheduler = new IngestionScheduler({
  discoveryStore: process.env.DISCOVERY_MODE === 'advanced' && db.isPg ? require('../discovery/store').createDiscoveryStore(db) : null,
  async onSourceRun(sourceId, run) {
    const path = require('node:path');
    const { mergeLiveRecords } = require('../db/live-record-store');
    const { recordSourceRun } = require('../db/observations-persistence');
    // Harvest enrolled-county assessor rolls before the record is cached or
    // snapshotted: the bid-to-value signal stays dark without a valuation
    // band (0 of 10,285 live records carry one), and the county roll is the
    // honest source where a statutory market conversion is enrolled.
    // Bounded per run, disk-cached, fail-open.
    if (!run.error && run.listings.length) {
      try {
        const { harvestAssessorRolls } = require('../enrichment/assessor-harvest');
        const harvest = await harvestAssessorRolls(run.listings);
        if (harvest.harvested > 0) {
          console.log(`[Scheduler] Harvested ${harvest.harvested} assessor roll(s) for ${sourceId}`);
        }
      } catch (error) {
        console.warn('[Scheduler] Assessor roll harvest failed (non-fatal):', error.message);
      }
    }
    // PostgreSQL already committed listing projections and immutable evidence.
    // The bounded demo cache cannot represent a national or resumed sweep.
    if (!run.error && run.listings.length && !(db.isPg && process.env.DISCOVERY_MODE === 'advanced')) {
      // A complete, non-truncated run may annotate same-source records that
      // were absent from that index. The store keeps the record and does not
      // write sold or closed. Error, partial, truncated, or no report must
      // not annotate. run.report.complete / run.report.truncated is the gate.
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
    // PostgreSQL is the operational observation store (migrations 025 + 027):
    // advancing snapshots are inserted into source_observations and the run
    // metadata is upserted into source_observation_runs. Without a reachable
    // database this throws and the caller logs "Could not persist source
    // history" — there is deliberately no local file to fall back to, so a
    // dead database can never read as "no observations recorded".
    const observationResult = await recordSourceRun(db.pool, sourceId, run);

    // Refresh the triage_priority cache for the listings this run advanced.
    // The route's write-through covers listings people evaluate; this fills
    // the rest the moment their evidence changes, so hunt sorting does not
    // wait on views. Best-effort and bounded per run.
    if (observationResult.snapshots && observationResult.snapshots.length) {
      try {
        const { recomputeTriageForListings } = require('../db/observations-persistence');
        const advancedIds = new Set(observationResult.snapshots.map((snapshot) => snapshot.listingId));
        const advanced = run.listings.filter((listing) => listing && advancedIds.has(listing.id));
        const refreshed = await recomputeTriageForListings(db.pool, advanced, {});
        if (refreshed.updated > 0) {
          console.log(`[Scheduler] Refreshed triage_priority for ${refreshed.updated} listing(s) from ${sourceId}`);
        }
      } catch (error) {
        console.warn('[Scheduler] triage_priority was not refreshed:', error.message);
      }
    }

    // Fire saved-search alerts for newly accepted listings (the core of the
    // "saved-search alerts" feature). This runs for the configured workspace
    // identity so that persisted alert_matches become visible via
    // /api/alerts/matches. Non-fatal: a failure here must never break ingestion.
    if (Array.isArray(run.listings) && run.listings.length > 0) {
      try {
        const { runAlertsForUser } = require('../intelligence/alerts-runner');
        const { accountServiceFor } = require('../accounts/store');
        const wsId = process.env.PROPERTY_WORKSPACE_ID || 'operator';
        const userIds = new Set([`workspace:${wsId}`, ...(typeof db.listSavedSearchUserIds === 'function' ? await db.listSavedSearchUserIds() : [])]);
        const accounts = accountServiceFor(db);
        for (const userId of userIds) {
          // Members get saved-search alerts only while their subscription is active.
          if (userId.startsWith('account:') && !(await accounts.get(userId.slice(8)))?.entitled) continue;
          if (!userId.startsWith('workspace:') && !userId.startsWith('account:')) continue;
          const alertResult = await runAlertsForUser({ userId, listings: run.listings, database: db });
          if (alertResult && alertResult.totalNewMatches > 0) {
            console.log(`[Alerts] ${alertResult.totalNewMatches} new matches across ${alertResult.searches} searches for ${userId}`);
          }
        }
      } catch (alertErr) {
        console.warn('[Alerts] Saved search alert processing failed (non-fatal):', alertErr && alertErr.message);
      }
    }

    // Snapshot the freshly-observed listings so the price-drop detector
    // has a prior-bid reference on the next ingestion cycle. Snapshots
    // are idempotent on (listing_id, source_observed_at), so re-running
    // the same scrape does not create duplicate history rows. Non-fatal
    // — a failure here must never break ingestion.
    if (Array.isArray(run.listings) && run.listings.length > 0) {
      try {
        const recorded = await db.recordListingHistorySnapshots(run.listings);
        if (recorded > 0) {
          console.log(`[History] Snapshotted ${recorded} listings for price-drop tracking.`);
        }
      } catch (historyErr) {
        console.warn('[History] Listing history snapshot failed (non-fatal):', historyErr && historyErr.message);
      }
    }
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
  if(typeof collectionCoordinator.store.claim!=='function')return {jobId:job.id};
  const owner=`scheduler:${process.pid}:${crypto.randomUUID()}`;
  const claimed=await collectionCoordinator.store.claim(job.id,owner,300);
  if(!claimed){const error=new Error('Collection job is already claimed');error.code='DISCOVERY_JOB_LEASE_LOST';throw error;}
  await collectionCoordinator.store.update(job.id, { status: 'running', started: true, stage: { name: 'collection', value: { status: 'running' } } });
  return { jobId: job.id, owner, leaseGuard: async()=>collectionCoordinator.store.renewClaim(job.id,owner,300) };
};
scheduler.onCycleComplete = async (result, context = {}) => {
  const id = context.jobId || result.jobId;
  if (id) await collectionCoordinator.finalize(id, result, {owner:context.owner,leaseGuard:context.leaseGuard});
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
module.exports.backgroundCollectionEnabled = backgroundCollectionEnabled;
module.exports.backgroundCollectionReason = backgroundCollectionReason;
module.exports.collectionRuntimeStatus = collectionRuntimeStatus;
module.exports.sourcesForWave = sourcesForWave;
