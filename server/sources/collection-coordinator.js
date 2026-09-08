'use strict';

// Durable coordination for collection cycles.  This module intentionally does
// not fetch publishers or infer lifecycle changes from missing records.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_JOB_PATH = path.resolve(__dirname, '../../.cache/collection-jobs.json');
const MAX_JOBS = 200;
const MAX_INVENTORY = 10_000;
const ID = /^job_[a-f0-9]{24}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;

function iso(value) { return new Date(value || Date.now()).toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeError(error) { return String(error?.message || error || 'Collection failed').slice(0, 500); }
function jobId() { return `job_${crypto.randomBytes(12).toString('hex')}`; }
function defaultStore() { return { version: 1, jobs: [] }; }

class CollectionJobStore {
  constructor(options = {}) { this.filePath = options.filePath || process.env.PROPERTY_COLLECTION_JOBS_PATH || DEFAULT_JOB_PATH; this.now = options.now; }
  load() {
    if (!fs.existsSync(this.filePath)) return defaultStore();
    const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (data?.version !== 1 || !Array.isArray(data.jobs)) throw new Error('Invalid collection job store; existing history was preserved');
    return data;
  }
  write(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
  mutate(mutator) {
    const data = this.load();
    const value = mutator(data);
    data.updatedAt = iso(this.now);
    this.write(data);
    return clone(value);
  }
  createOrReuse(input = {}) {
    const key = input.idempotencyKey && String(input.idempotencyKey);
    if (key && !IDEMPOTENCY_KEY.test(key)) throw new Error('Invalid collection idempotency key');
    return this.mutate((data) => {
      const existing = key && data.jobs.find((job) => job.idempotencyKey === key);
      if (existing) return existing;
      const now = iso(this.now);
      const job = {
        id: jobId(), idempotencyKey: key || null, kind: input.kind || 'property', trigger: input.trigger || 'manual',
        sourceIds: [...new Set((input.sourceIds || []).map(String))].sort(), status: 'queued', revision: 1,
        createdAt: now, startedAt: null, completedAt: null, stages: {
          collection: { status: 'queued', updatedAt: now },
          inventory: { status: 'queued', updatedAt: now },
          observations: { status: 'queued', updatedAt: now },
          hunts: { status: 'queued', updatedAt: now },
          cases: { status: 'queued', updatedAt: now },
        }, errors: [], result: null,
      };
      data.jobs.unshift(job); data.jobs = data.jobs.slice(0, MAX_JOBS);
      return job;
    });
  }
  get(id) {
    if (!ID.test(id || '')) return null;
    const job = this.load().jobs.find((entry) => entry.id === id);
    return job ? clone(job) : null;
  }
  list(limit = 50) {
    const bounded = Math.max(1, Math.min(50, Math.floor(Number(limit) || 50)));
    const jobs = this.load().jobs.slice(0, bounded).map((job) => clone(job));
    return { items: jobs, total: this.load().jobs.length };
  }
  update(id, update) {
    return this.mutate((data) => {
      const job = data.jobs.find((entry) => entry.id === id);
      if (!job) throw new Error('Collection job was not found');
      const now = iso(this.now);
      if (update.status) job.status = update.status;
      if (update.result !== undefined) job.result = update.result;
      if (update.error) job.errors.push({ stage: update.error.stage || 'collection', message: safeError(update.error.message), at: now });
      if (update.stage) job.stages[update.stage.name] = { ...(job.stages[update.stage.name] || {}), ...update.stage.value, updatedAt: now };
      if (update.started && !job.startedAt) job.startedAt = now;
      if (update.completed) job.completedAt = now;
      job.revision += 1; job.updatedAt = now;
      return job;
    });
  }
}
class PgCollectionJobStore {
  constructor(discoveryStore){this.discoveryStore=discoveryStore;this.claimOwners=new Map();}
  createOrReuse(input){return this.discoveryStore.createOrReuseJob(input);}
  get(id){return this.discoveryStore.getJob(id);}
  list(limit){return this.discoveryStore.listJobs(limit);}
  update(id,update){return this.discoveryStore.updateJob(id,update,{ownerId:this.claimOwners.get(id)});}
  async claim(id,owner,ttl){const job=await this.discoveryStore.claimJob(id,owner,ttl);if(job)this.claimOwners.set(id,owner);return job;}
  renewClaim(id,owner,ttl){return this.discoveryStore.renewJobClaim(id,owner,ttl);}
  bindClaim(id,owner){this.claimOwners.set(id,owner);}
}

function sourceRunUnsafe(result) {
  if (!result || result.error || result.observationError || result.accepted === 0 || result.rejected > 0) return true;
  return ['failed', 'empty'].includes(result.report?.outcome);
}

function sourceScopeComplete(result) { const report=result?.report||{};return report.complete===true&&report.fullSweepComplete===true&&report.truncated!==true&&report.scope&&typeof report.scope==='object'&&!Array.isArray(report.scope)&&Object.keys(report.scope).length>0; }

function huntSafety(result = {}) {
  if (result.skipped) return { safe: false, reason: 'scheduler_skipped', safePositiveSourceIds: [], unsafeSourceIds: [] };
  if (!Array.isArray(result.sourceResults) || !result.sourceResults.length) return { safe: false, reason: 'no_source_results', safePositiveSourceIds: [], unsafeSourceIds: [] };
  const safePositiveSourceIds=[], completeSourceIds=[], unsafeSourceIds=[];
  for(const source of result.sourceResults){if(sourceRunUnsafe(source))unsafeSourceIds.push({sourceId:source.sourceId,reason:source.error?'source_failed':source.accepted===0?'source_empty':'source_incomplete'});else{safePositiveSourceIds.push(source.sourceId);if(sourceScopeComplete(source))completeSourceIds.push(source.sourceId);}}
  return {safe:safePositiveSourceIds.length>0,reason:safePositiveSourceIds.length?'source_scoped':unsafeSourceIds[0]?.reason||'no_safe_sources',safePositiveSourceIds,completeSourceIds,unsafeSourceIds};
}

function optionalCaseSink() {
  for (const modulePath of ['../intelligence/research-cases', '../intelligence/cases']) {
    try {
      const candidate = require(modulePath);
      if (typeof candidate?.upsertFromHunt === 'function') return candidate;
      if (typeof candidate?.upsertResearchCaseFromHunt === 'function') return { upsertFromHunt: candidate.upsertResearchCaseFromHunt };
      if (typeof candidate?.createCase === 'function') {
        // `createCase` is an identity upsert.  The adapter is deliberately
        // narrow: only a validated listing with a current `match` result is
        // handed off, and the hunt event (when present) becomes the origin.
        return {
          async upsertFromHunt({ hunt, evaluation, listings = [] }) {
            if (evaluation?.resultsTruncated) return { skipped: 'evaluation_results_truncated', upserted: 0 };
            const byId = new Map(listings.map((listing) => [listing.id, listing]));
            const events = new Map((evaluation?.newEvents || []).map((event) => [event.identityKey, event]));
            let upserted = 0;
            for (const result of evaluation?.results || []) {
              if (result.status !== 'match') continue;
              const listing = byId.get(result.listingId);
              if (!listing) continue;
              const event = events.get(result.identityKey);
              const type = event?.type === 'new_match' || event?.type === 'material_change' ? event.type : 'hunt_match';
              candidate.createCase({
                listing,
                origin: {
                  type, huntId: hunt.id, huntVersion: hunt.version,
                  observedAt: result.observedAt,
                  ...(type === 'material_change' && event?.changedFields?.length ? { changedFields: event.changedFields, changes: event.changes } : {}),
                },
              });
              upserted++;
            }
            return { upserted };
          },
        };
      }
    } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  return null;
}

class CollectionCoordinator {
  constructor(options = {}) {
    this.scheduler = options.scheduler;
    this.database = options.database;
    this.hunts = options.hunts || require('../intelligence/hunts');
    this.durableHunts = options.durableHunts || (this.database?.isPg && (options.env||process.env).DISCOVERY_MODE==='advanced'
      ? require('../discovery/hunt-store').createPgHuntStore(this.database) : null);
    this.huntFilePath = options.huntFilePath;
    this.caseSink = options.caseSink === undefined ? optionalCaseSink() : options.caseSink;
    this.store = options.store || (this.database?.isPg && (options.env||process.env).DISCOVERY_MODE==='advanced'
      ? new PgCollectionJobStore(require('../discovery/store').createDiscoveryStore(this.database)) : new CollectionJobStore(options));
    this.now = options.now;
    this.inFlight = new Map();
  }
  async start(input = {}) {
    if (!this.scheduler?.runAll) throw new Error('Collection scheduler is unavailable');
    const job = await this.store.createOrReuse(input);
    if (['completed', 'partial', 'failed'].includes(job.status) || this.inFlight.has(job.id)) return job;
    const owner = `coordinator:${process.pid}:${crypto.randomUUID()}`;
    const claimed = this.store.claim ? await this.store.claim(job.id, owner, 300) : job;
    if (!claimed) return this.store.get(job.id);
    const running = this.execute(job.id, input, { owner }).catch(() => {});
    this.inFlight.set(job.id, running);
    running.finally(() => this.inFlight.delete(job.id));
    return this.store.get(job.id);
  }
  async execute(id, input = {}, claim = {}) {
    if(claim.owner&&this.store.bindClaim)this.store.bindClaim(id,claim.owner);
    await this.store.update(id, { status: 'running', started: true, stage: { name: 'collection', value: { status: 'running' } } });
    try {
      const result = await this.scheduler.runAll({ ...(input.sourceIds?.length ? { sourceIds: input.sourceIds } : {}), jobId: id, trigger: input.trigger || 'manual', ...(claim.owner ? { leaseGuard: async () => this.store.renewClaim(id, claim.owner, 300) } : {}) });
      return this.finalize(id, result);
    } catch (error) {
      await this.store.update(id, { status: 'failed', completed: true, error: { stage: 'collection', message: error }, stage: { name: 'collection', value: { status: 'failed' } } });
      return this.store.get(id);
    }
  }
  async finalize(id, result = {}) {
    const existing = await this.store.get(id);
    if (!existing || ['completed', 'partial', 'failed'].includes(existing.status)) return existing;
    await this.store.update(id, { stage: { name: 'collection', value: { status: result.skipped ? 'skipped' : 'completed', summary: { totalIngested: result.totalIngested || 0, sources: result.sourceResults?.length || 0 } } } });
    await this.store.update(id, { stage: { name: 'inventory', value: { status: result.skipped ? 'skipped' : 'completed', committed: result.totalIngested || 0 } } });
    const observationIssue = (result.sourceResults || []).find((item) => item.observationError);
    await this.store.update(id, { stage: { name: 'observations', value: { status: observationIssue ? 'failed' : result.skipped ? 'skipped' : 'completed', ...(observationIssue ? { error: observationIssue.observationError } : {}) } }, ...(observationIssue ? { error: { stage: 'observations', message: observationIssue.observationError } } : {}) });
    const safety = huntSafety(result);
    if (!safety.safe) {
      return this.store.update(id, { status: result.skipped || result.sourceResults?.some((entry) => entry.error) ? 'partial' : 'completed', completed: true, result: { ...result, huntSafety: safety }, stage: { name: 'hunts', value: { status: 'skipped', reason: safety.reason, ...(safety.sourceId ? { sourceId: safety.sourceId } : {}) } }, stageCases: undefined });
    }
    let inventory;
    try {
      const safeSources=new Set(safety.completeSourceIds), listings=(result.sourceResults||[]).flatMap(source=>sourceRunUnsafe(source)?[]:(source.acceptedListings||[]));
      // Advanced jobs evaluate evidence accepted by this exact run. Cached rows
      // from the same publisher are retained in the baseline, but cannot become
      // fresh positive evidence merely because a sweep reported completeness.
      if(!this.durableHunts){if(this.database?.isPg){const discoveryQuery=require('../discovery/query'),baseQuery=discoveryQuery.queryFromUrl(new URL('http://localhost/api/listings?limit=1000'));let cursor=null;do{inventory=await discoveryQuery.search(this.database,{...baseQuery,cursor});const page=inventory?.listings;if(!Array.isArray(page))throw new Error('Listing inventory is unavailable');listings.push(...page.filter(item=>safeSources.has(item.source)||!item.source));cursor=inventory.page?.nextCursor||null;}while(cursor);}else{let offset=0,total=Infinity;while(offset<total){inventory=await this.database.getListings({limit:1000,offset});const page=Array.isArray(inventory)?inventory:inventory?.listings;total=Array.isArray(inventory)?page.length:Number(inventory?.total);if(!Array.isArray(page))throw new Error('Listing inventory is unavailable');listings.push(...page.filter(item=>safeSources.has(item.source)||!item.source));offset+=page.length;if(!page.length||Array.isArray(inventory))break;}}}
      const enabled = (this.durableHunts ? await this.durableHunts.list() : this.hunts.listHunts({ filePath: this.huntFilePath })).filter((hunt) => hunt.enabled);
      const evaluations = [];
      for (const hunt of enabled) {
        if (this.durableHunts) {
          let baseline=await this.durableHunts.baseline(hunt.id),evaluated=null;const initial=!baseline,events=[];
          for(let pageOffset=0;pageOffset<listings.length||(!listings.length&&pageOffset===0);pageOffset+=1000){evaluated=this.hunts.evaluateInventory(hunt,listings.slice(pageOffset,pageOffset+1000),{previousBaseline:baseline,now:this.now&&iso(this.now),baselineLimit:Infinity,suppressEvents:initial});baseline=evaluated.baseline;events.push(...evaluated.events);}
          evaluated.events=events;evaluated.response.newEvents=events.slice(0,200);evaluated.response.eventsTruncated=events.length>200;
          evaluations.push({hunt,evaluation:await this.durableHunts.saveEvaluation(hunt,evaluated)});
        } else evaluations.push({ hunt, evaluation: this.hunts.runHunt(hunt.id, listings, { filePath: this.huntFilePath, now: this.now && iso(this.now) }) });
      }
      await this.store.update(id, { stage: { name: 'hunts', value: { status: 'completed', evaluated: evaluations.length, inventory: listings.length } } });
      const caseSink = this.caseSink || optionalCaseSink();
      if (caseSink?.upsertFromHunt) this.caseSink = caseSink;
      if (!caseSink?.upsertFromHunt) {
        return this.store.update(id, { status: 'completed', completed: true, result: { ...result, huntSafety: safety, hunts: { evaluated: evaluations.length } }, stage: { name: 'cases', value: { status: 'skipped', reason: 'case_sink_unavailable' } } });
      }
      try {
        let handoffs = 0, upserted = 0, skipped = 0;
        for (const entry of evaluations) {
          const handoff = await caseSink.upsertFromHunt({ job: await this.store.get(id), hunt: entry.hunt, evaluation: entry.evaluation, listings });
          handoffs++;
          upserted += Math.max(0, Number(handoff?.upserted) || 0);
          if (handoff?.skipped) skipped++;
        }
        return this.store.update(id, { status: 'completed', completed: true, result: { ...result, huntSafety: safety, hunts: { evaluated: evaluations.length } }, stage: { name: 'cases', value: { status: 'completed', handoffs, upserted, skipped } } });
      } catch (error) {
        return this.store.update(id, { status: 'partial', completed: true, result: { ...result, huntSafety: safety, hunts: { evaluated: evaluations.length } }, error: { stage: 'cases', message: error }, stage: { name: 'cases', value: { status: 'failed', error: safeError(error) } } });
      }
    } catch (error) {
      return this.store.update(id, { status: 'partial', completed: true, result: { ...result, huntSafety: safety }, error: { stage: 'hunts', message: error }, stage: { name: 'hunts', value: { status: 'failed', error: safeError(error) } }, });
    }
  }
}

module.exports = { CollectionCoordinator, CollectionJobStore, PgCollectionJobStore, DEFAULT_JOB_PATH, MAX_INVENTORY, createCollectionCoordinator: (options) => new CollectionCoordinator(options), huntSafety, optionalCaseSink };
