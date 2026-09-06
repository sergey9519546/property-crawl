'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CollectionJobStore, createCollectionCoordinator, huntSafety } = require('../server/sources/collection-coordinator');
const { IngestionScheduler } = require('../server/scrapers/scheduler');

function temporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-collection-jobs-'));
  return { directory, filePath: path.join(directory, 'jobs.json') };
}

function fullResult(overrides = {}) {
  return {
    skipped: false, completeCycle: true, totalIngested: 2, totalRejected: 0,
    sourceResults: [{ sourceId: 'hud', accepted: 2, rejected: 0, error: null, observationError: null, report: { outcome: 'success', complete: true } }],
    ...overrides,
  };
}

test('collection jobs are durable and an idempotency key returns the same job', () => {
  const { directory, filePath } = temporaryStore();
  try {
    const store = new CollectionJobStore({ filePath, now: '2026-09-05T20:00:00.000Z' });
    const first = store.createOrReuse({ sourceIds: ['hud'], trigger: 'source_network', idempotencyKey: 'source-hud-20260905' });
    const retry = store.createOrReuse({ sourceIds: ['hud'], trigger: 'source_network', idempotencyKey: 'source-hud-20260905' });
    assert.equal(first.id, retry.id);
    const updated = store.update(first.id, { status: 'running', started: true, stage: { name: 'collection', value: { status: 'running' } } });
    assert.equal(updated.revision, 2);
    assert.equal(new CollectionJobStore({ filePath }).get(first.id).status, 'running');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a complete clean cycle evaluates enabled hunts once and hands results to the optional case sink', async () => {
  const { directory, filePath } = temporaryStore();
  try {
    const calls = { scheduler: 0, runs: 0, cases: 0 };
    const scheduler = { async runAll() { calls.scheduler++; return fullResult(); } };
    const hunts = {
      listHunts: () => [{ id: 'hunt_0123456789abcdef01234567', enabled: true }],
      runHunt: (id, inventory) => { calls.runs++; assert.equal(id, 'hunt_0123456789abcdef01234567'); assert.equal(inventory.length, 2); return { huntId: id, newEvents: [] }; },
    };
    const coordinator = createCollectionCoordinator({
      scheduler, database: { getListings: async () => ({ total: 2, listings: [{ id: 'A' }, { id: 'B' }] }) }, hunts,
      caseSink: { async upsertFromHunt(payload) { calls.cases++; assert.equal(payload.job.status, 'running'); } },
      filePath,
    });
    const initial = await coordinator.start({ trigger: 'scheduler', idempotencyKey: 'full-cycle-20260905' });
    const retry = await coordinator.start({ trigger: 'scheduler', idempotencyKey: 'full-cycle-20260905' });
    assert.equal(initial.id, retry.id);
    await coordinator.inFlight.get(initial.id);
    const final = coordinator.store.get(initial.id);
    assert.equal(calls.scheduler, 1);
    assert.equal(calls.runs, 1);
    assert.equal(calls.cases, 1);
    assert.equal(final.status, 'completed');
    assert.equal(final.stages.inventory.status, 'completed');
    assert.equal(final.stages.observations.status, 'completed');
    assert.equal(final.stages.hunts.status, 'completed');
    assert.equal(final.stages.cases.status, 'completed');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('failed, empty, and truncated sources are unsafe while a complete scoped source permits positive evaluation', async () => {
  const unsafe = [
    fullResult({ sourceResults: [{ sourceId: 'hud', accepted: 0, rejected: 0, error: null }] }),
    fullResult({ sourceResults: [{ sourceId: 'hud', accepted: 1, rejected: 0, error: 'upstream unavailable' }] }),
    fullResult({ sourceResults: [{ sourceId: 'hud', accepted: 1, rejected: 0, report: { truncated: true } }] }),
  ];
  for (const result of unsafe) assert.equal(huntSafety(result).safe, false);
  const scoped = huntSafety(fullResult({ completeCycle: false }));
  assert.equal(scoped.safe, true);
  assert.deepEqual(scoped.safePositiveSourceIds, ['hud']);

  const { directory, filePath } = temporaryStore();
  try {
    let huntRuns = 0;
    const coordinator = createCollectionCoordinator({
      scheduler: { async runAll() { return fullResult({ sourceResults: [{ sourceId: 'hud', accepted: 0, rejected: 0, error: null }] }); } },
      database: { getListings: async () => { throw new Error('unsafe cycle must not read inventory'); } },
      hunts: { listHunts: () => [{ id: 'hunt_0123456789abcdef01234567', enabled: true }], runHunt: () => { huntRuns++; } },
      caseSink: null, filePath,
    });
    const job = await coordinator.start({ sourceIds: ['hud'], idempotencyKey: 'empty-cycle-20260905' });
    await coordinator.inFlight.get(job.id);
    const final = coordinator.store.get(job.id);
    assert.equal(huntRuns, 0);
    assert.equal(final.stages.hunts.status, 'skipped');
    assert.equal(final.stages.hunts.reason, 'source_empty');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('scheduler writes validated inventory before observations, then invokes one cycle finalizer', async () => {
  const order = [];
  const listing = {
    id: 'CIV-NJ-123-456', source: 'civilview', state: 'NJ', county: 'Example', city: 'Trenton', zip: '08608',
    address: '1 Test Street, Trenton, NJ 08608', lat: null, lng: null, openingBid: 100000, estLow: null, estHigh: null,
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=456', raw: 'Publisher notice',
    provenance: { origin: 'live', observed: true, recordKind: 'source_record', publisher: 'CivilView', recordId: '456', observedAt: '2026-09-05T20:00:00.000Z' },
  };
  const scheduler = new IngestionScheduler({
    realScrapers: [{ name: 'Ordered collector', sourceKey: 'civilview', async scrapeFeed() { order.push('fetch'); return [listing]; } }],
    networkEnabled: true, telemetry: { recordRun() {} },
    database: { async createListing() { order.push('inventory'); } },
    async onSourceRun() { assert.deepEqual(order, ['fetch', 'inventory']); order.push('observation'); },
    async onCycleComplete(result) { assert.deepEqual(order, ['fetch', 'inventory', 'observation']); assert.equal(result.sourceResults.length, 1); order.push('finalizer'); },
  });
  const result = await scheduler.runAll();
  assert.equal(result.totalIngested, 1);
  assert.deepEqual(order, ['fetch', 'inventory', 'observation', 'finalizer']);
});

test('an unrelated source failure still evaluates positive matches from the complete source only', async () => {
  const { directory, filePath } = temporaryStore();
  try {
    let evaluatedIds=[];
    const result=fullResult({completeCycle:true,sourceResults:[
      {sourceId:'hud',accepted:1,rejected:0,error:null,observationError:null,report:{outcome:'success',complete:true}},
      {sourceId:'irs',accepted:0,rejected:0,error:'upstream unavailable'},
    ]});
    const coordinator=createCollectionCoordinator({
      scheduler:{async runAll(){return result;}},
      database:{async getListings(){return {total:2,listings:[{id:'HUD',source:'hud'},{id:'IRS',source:'irs'}]};}},
      hunts:{listHunts:()=>[{id:'hunt_0123456789abcdef01234567',enabled:true}],runHunt:(_id,items)=>{evaluatedIds=items.map(x=>x.id);return {results:[],newEvents:[]};}},
      caseSink:null,filePath,
    });
    const job=await coordinator.start({idempotencyKey:'partial-positive-20260905'});await coordinator.inFlight.get(job.id);
    assert.deepEqual(evaluatedIds,['HUD']);
    const final=coordinator.store.get(job.id);assert.equal(final.result.huntSafety.safe,true);assert.deepEqual(final.result.huntSafety.unsafeSourceIds,[{sourceId:'irs',reason:'source_failed'}]);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
