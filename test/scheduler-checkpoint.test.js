'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { IngestionScheduler, backgroundCollectionEnabled, backgroundCollectionReason, collectionRuntimeStatus } = require('../server/scrapers/scheduler');
const { hash } = require('../server/discovery/store');

const SERVICE_LINK_SCOPE = { endpoint: '/search-service/search/listings', filters: {} };

const healthyStorage = () => ({ ready: true, freeBytes: 2 ** 30, minimumFreeBytes: 2 ** 30 });
const telemetry = { recordRun() {} };

function listing(id) {
  return {
    id: `SLA-${id}`, source: 'servicelink', sourceKey: 'servicelink', state: 'CA',
    address: `${id} Main Street`, city: 'Test City', zip: '90001', sourceObservedAt: '2026-09-12T00:00:00.000Z',
    sourceUrl: `https://www.servicelinkauction.com/property-details/${id}-main-street-test-city-90001-ca-united-states-tps`,
    raw: JSON.stringify({ id }), provenance: { origin: 'live', observed: true, observedAt: '2026-09-12T00:00:00.000Z', publisher: 'ServiceLink Auction', recordId: String(id), sourceFacts: {} }
  };
}

function sharedStore(events, options = {}) {
  let cursor = {};
  let checkpointScopeHash = hash(SERVICE_LINK_SCOPE);
  return {
    async getCheckpoint(source) { events.push(['load', source, cursor]); return { cursor, scopeHash: checkpointScopeHash }; },
    async beginRun(input) { events.push(['begin', input.sourceKey]); return { id: `run-${events.length}` }; },
    async ingestSnapshot(input, writeListing) {
      events.push(['ingest', input.sourceRecordId]);
      if (options.failIngest) throw new Error('durable ingest failed');
      await writeListing({ query: async () => ({ rows: [] }) });
      events.push(['ingested', input.sourceRecordId]);
    },
    async finishRun(_id, update) { events.push(['finish', update.status]); },
    async saveCheckpoint(source, next, scope) { events.push(['save', source, next]); cursor = next; checkpointScopeHash = hash(scope); }
  };
}

function collector({ token, emittedId, fail = false }) {
  return {
    name: 'ServiceLinkCheckpointFixture', sourceKey: 'servicelink', checkpointSeen: null, lastRunReport: null,
    getCollectionScope() { return SERVICE_LINK_SCOPE; },
    setCheckpoint(value) { this.checkpointSeen = value; },
    async scrapeFeed() {
      if (fail) throw new Error('publisher collection failed');
      this.lastRunReport = { complete: !token, fullSweepComplete: !token, truncated: Boolean(token), nextContinuationToken: token || null, sweepStartedAt: '2026-09-12T00:00:00Z', pagesPreviouslyCommitted: this.checkpointSeen?.pagesCommitted || 0, pagesFetched: 1 };
      return [listing(emittedId)];
    }
  };
}

function scheduler(scraper, store, database = {}) {
  return new IngestionScheduler({
    realScrapers: [scraper], discoveryStore: store, storageProbe: healthyStorage, telemetry,
    database: { isPg: true, async createListing(row) { database.writes ||= []; database.writes.push(row.id); } },
    networkEnabled: true, concurrency: 1
  });
}

test('independent scheduler instances resume a durable cursor, save after ingestion, and clear terminal continuation', async () => {
  const events = [], writes = [], store = sharedStore(events);
  const first = collector({ token: 'page-2', emittedId: 'one' });
  const firstResult = await scheduler(first, store, { writes }).runAll({ sourceIds: ['servicelink'] });
  assert.equal(firstResult.totalIngested, 1);
  assert.deepEqual(first.checkpointSeen, {});
  assert.ok(events.findIndex(event => event[0] === 'ingested') < events.findIndex(event => event[0] === 'save'));
  assert.deepEqual(events.findLast(event => event[0] === 'save')[2], { continuationToken: 'page-2', sweepStartedAt: '2026-09-12T00:00:00Z', pagesCommitted: 1 });

  const second = collector({ token: null, emittedId: 'two' });
  const secondResult = await scheduler(second, store, { writes }).runAll({ sourceIds: ['servicelink'] });
  assert.equal(secondResult.totalIngested, 1);
  assert.deepEqual(second.checkpointSeen, { continuationToken: 'page-2', sweepStartedAt: '2026-09-12T00:00:00Z', pagesCommitted: 1 });
  assert.deepEqual(events.findLast(event => event[0] === 'save')[2], {});
});

test('legacy checkpoint without scope identity fails before publisher collection', async () => {
  let scrapeCalls = 0;
  const source = collector({ token: null, emittedId: 'never' });
  source.scrapeFeed = async () => { scrapeCalls += 1; return []; };
  const store = sharedStore([]);
  store.getCheckpoint = async () => ({ cursor: { continuationToken: 'legacy' }, scopeHash: null });
  const result = await scheduler(source, store).runAll({ sourceIds: ['servicelink'] });
  assert.equal(scrapeCalls, 0);
  assert.match(result.sourceResults[0].error, /Checkpoint scope does not match/);
});

test('a checkpoint from a different scope starts the new scope without resuming the old cursor', async () => {
  let scrapeCalls = 0;
  const source = collector({ token: null, emittedId: 'fresh-scope' });
  const original = source.scrapeFeed;
  source.scrapeFeed = async () => { scrapeCalls += 1; return original.call(source); };
  const store = sharedStore([]);
  store.getCheckpoint = async () => ({ cursor: { continuationToken: 'old-scope-page' }, scopeHash: hash({ endpoint: '/old-scope', filters: {} }) });
  const result = await scheduler(source, store).runAll({ sourceIds: ['servicelink'] });
  assert.equal(scrapeCalls, 1);
  assert.equal(result.totalIngested, 1);
  assert.deepEqual(source.checkpointSeen, {});
});

test('an empty legacy checkpoint permits an explicit fresh canary requalification', async () => {
  const source = collector({ token: null, emittedId: 'fresh-canary' });
  const store = sharedStore([]);
  store.getCheckpoint = async () => ({ cursor: {}, scopeHash: null });
  const result = await scheduler(source, store).runAll({ sourceIds: ['servicelink'], trigger: 'discovery_canary' });
  assert.equal(result.totalIngested, 1);
  assert.deepEqual(source.checkpointSeen, {});
});

test('failed durable ingestion does not advance the loaded checkpoint', async () => {
  const events = [], store = sharedStore(events, { failIngest: true });
  await store.saveCheckpoint('servicelink', { continuationToken: 'existing', pagesCommitted: 4 }, SERVICE_LINK_SCOPE);
  events.length = 0;
  const source = collector({ token: 'next', emittedId: 'failed' });
  const result = await scheduler(source, store).runAll({ sourceIds: ['servicelink'] });
  assert.equal(result.totalIngested, 0);
  assert.match(result.sourceResults[0].error, /durable ingest failed/);
  assert.deepEqual(source.checkpointSeen, { continuationToken: 'existing', pagesCommitted: 4 });
  assert.equal(events.some(event => event[0] === 'save'), false);
  assert.ok(events.some(event => event[0] === 'finish' && event[1] === 'failed'));
});

test('background collection is on for a real server when the flag is unset or 1, and off for the explicit stops', () => {
  assert.equal(backgroundCollectionEnabled({ NODE_ENV: 'test' }), false);
  assert.equal(backgroundCollectionEnabled({ RUN_REAL_SCRAPERS: '0', NODE_ENV: 'production' }), false);
  assert.equal(backgroundCollectionEnabled({ npm_lifecycle_event: 'test:ui', NODE_ENV: 'production' }), false);
  assert.equal(backgroundCollectionEnabled({ NODE_ENV: 'production', DISCOVERY_MODE: 'advanced', SCRAPER_BACKGROUND_ENABLED: '1' }), false);
  assert.equal(backgroundCollectionEnabled({ NODE_ENV: 'production', SCRAPER_BACKGROUND_ENABLED: '0' }), false);
  assert.equal(backgroundCollectionEnabled({ NODE_ENV: 'production', SCRAPER_BACKGROUND_ENABLED: 'yes' }), false);
  assert.equal(backgroundCollectionEnabled({ NODE_ENV: 'production' }), true);
  assert.equal(backgroundCollectionEnabled({ NODE_ENV: 'production', SCRAPER_BACKGROUND_ENABLED: '' }), true);
  assert.equal(backgroundCollectionEnabled({ NODE_ENV: 'production', SCRAPER_BACKGROUND_ENABLED: '1' }), true);
  assert.equal(backgroundCollectionReason({ NODE_ENV: 'test' }), 'node_env_test');
  assert.equal(backgroundCollectionReason({ RUN_REAL_SCRAPERS: '0', NODE_ENV: 'production' }), 'run_real_scrapers_off');
  assert.equal(backgroundCollectionReason({ npm_lifecycle_event: 'test:ui', NODE_ENV: 'production' }), 'npm_test_lifecycle');
  assert.equal(backgroundCollectionReason({ NODE_ENV: 'production', DISCOVERY_MODE: 'advanced', SCRAPER_BACKGROUND_ENABLED: '1' }), 'discovery_mode_advanced');
  assert.equal(backgroundCollectionReason({ NODE_ENV: 'production', SCRAPER_BACKGROUND_ENABLED: '0' }), 'scraper_background_disabled');
  assert.equal(backgroundCollectionReason({ NODE_ENV: 'production', SCRAPER_BACKGROUND_ENABLED: '1' }), 'enabled');
});

test('a running cycle publishes its start and clears it when the cycle finishes', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let seen = null;
  const source = {
    name: 'Gate',
    sourceKey: 'servicelink',
    async scrapeFeed() {
      seen = { running: subject.isRunning, startedAt: subject.cycleStartedAt };
      await gate;
      return [];
    },
  };
  const subject = new IngestionScheduler({
    realScrapers: [source],
    discoveryStore: null,
    telemetry: { recordRun() {}, getHealthReport() { return { systemStatus: 'idle', totalScrapers: 0, scrapersInFault: 0 }; } },
    database: { async createListing() {} },
    networkEnabled: true,
    concurrency: 1,
  });
  const pending = subject.runAll();
  const deadline = Date.now() + 1000;
  while (!seen && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(seen, 'scrapeFeed did not start');
  assert.equal(seen.running, true);
  assert.equal(typeof seen.startedAt, 'string');
  const during = collectionRuntimeStatus(subject, { NODE_ENV: 'production', SCRAPER_BACKGROUND_ENABLED: '1' });
  assert.equal(during.enabled, true);
  assert.equal(during.reason, 'enabled');
  assert.equal(during.running, true);
  assert.equal(during.startedAt, seen.startedAt);
  release();
  await pending;
  assert.equal(subject.isRunning, false);
  assert.equal(subject.cycleStartedAt, null);
  assert.equal(typeof subject.lastCycleFinishedAt, 'string');
  const after = collectionRuntimeStatus(subject, { NODE_ENV: 'production', DISCOVERY_MODE: 'advanced', SCRAPER_BACKGROUND_ENABLED: '1' });
  assert.equal(after.enabled, false);
  assert.equal(after.reason, 'discovery_mode_advanced');
  assert.equal(after.running, false);
  assert.equal(after.startedAt, null);
  assert.equal(after.lastFinishedAt, subject.lastCycleFinishedAt);
});
