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

function civilviewListing(id) {
  return {
    id: `civilview:${id}`, source: 'civilview', sourceKey: 'civilview', state: 'NJ',
    address: `${id} Main Street`, city: 'Newark', zip: '07101', sourceObservedAt: '2026-09-12T00:00:00.000Z',
    sourceUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${id}`,
    raw: JSON.stringify({ id }), provenance: { origin: 'live', observed: true, observedAt: '2026-09-12T00:00:00.000Z', publisher: 'CivilView', recordId: String(id), sourceFacts: {} }
  };
}

test('in-memory checkpoints resume across successive cycles when discoveryStore is null', async () => {
  let sweepIndex = 0;
  const checkpointsSeen = [];
  const testCollector = {
    name: 'MemoryResumeFixture',
    sourceKey: 'civilview',
    getCollectionScope() { return { endpoint: '/test', filters: {} }; },
    setCheckpoint(value) { checkpointsSeen.push(value); },
    async scrapeFeed() {
      sweepIndex += 1;
      if (sweepIndex === 1) {
        return Object.defineProperties([civilviewListing('m-1')], {
          partialSweep: { value: true, enumerable: false },
          nextCursor: { value: 'page-2-cursor', enumerable: false },
          nextContinuationToken: { value: 'page-2-cursor', enumerable: false },
          report: { value: { complete: false, truncated: true, partialSweep: true, nextContinuationToken: 'page-2-cursor' }, enumerable: false },
        });
      }
      return Object.defineProperties([civilviewListing('m-2')], {
        partialSweep: { value: false, enumerable: false },
        nextCursor: { value: null, enumerable: false },
        nextContinuationToken: { value: null, enumerable: false },
        report: { value: { complete: true, truncated: false, partialSweep: false, nextContinuationToken: null }, enumerable: false },
      });
    },
  };

  const subject = new IngestionScheduler({
    realScrapers: [testCollector],
    discoveryStore: null,
    telemetry: { recordRun() {} },
    database: { isPg: false, inMemoryData: { listings: [] }, async createListing() {} },
    networkEnabled: true,
    concurrency: 1,
  });

  const res1 = await subject.runAll({ sourceIds: ['civilview'] });
  assert.equal(res1.totalIngested, 1);
  assert.deepEqual(checkpointsSeen, []);
  assert.equal(subject.sourceCheckpoints.get('civilview')?.continuationToken, 'page-2-cursor');

  const res2 = await subject.runAll({ sourceIds: ['civilview'] });
  assert.equal(res2.totalIngested, 1);
  assert.equal(checkpointsSeen.length, 1);
  assert.equal(checkpointsSeen[0]?.continuationToken, 'page-2-cursor');
  assert.equal(subject.sourceCheckpoints.has('civilview'), false, 'cleared on complete');
});

test('SheriffSaleScraper bounded county rotation emits continuation tokens and advances checkpoints', async () => {
  const { SheriffSaleScraper } = require('../server/scrapers/sheriff');
  const scraper = new SheriffSaleScraper({
    counties: [
      { name: 'Franklin', state: 'OH', domain: 'franklin.realauction.com' },
      { name: 'Cuyahoga', state: 'OH', domain: 'cuyahoga.realauction.com' },
      { name: 'Hamilton', state: 'OH', domain: 'hamilton.realauction.com' },
    ],
    maxCounties: 1,
  });
  scraper.fetchCountyRealauction = async (c) => [{
    id: `SHERIFF-${c.state}-${c.name}-1`,
    source: 'sheriff',
    address: `100 Main St, ${c.name}, ${c.state}`,
    openingBid: 50000,
    saleDate: '2026-12-01',
    provenance: { county: c.name, state: c.state, recordId: `1-${c.name}` },
    _alreadyStandardized: true,
  }];

  const pass1 = await scraper.scrapeFeed();
  assert.equal(pass1.partialSweep, true);
  assert.equal(pass1.nextContinuationToken, '1');
  assert.equal(pass1.complete, false);

  scraper.setCheckpoint({ continuationToken: '1' });
  const pass2 = await scraper.scrapeFeed();
  assert.equal(pass2.partialSweep, true);
  assert.equal(pass2.nextContinuationToken, '2');

  scraper.setCheckpoint('2');
  const pass3 = await scraper.scrapeFeed();
  assert.equal(pass3.nextContinuationToken, '0');
});

test('ScraperScheduler queries and saves PostgreSQL checkpoint when discoveryStore is null', async () => {
  const pgQueries = [];
  const mockPool = {
    async query(sql, params) {
      pgQueries.push({ sql, params });
      if (sql.includes('SELECT cursor, scope_hash FROM discovery_checkpoints')) {
        return { rows: [{ cursor: 'saved-pg-cursor', scope_hash: 'abc' }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const mockDb = {
    isPg: true,
    pool: mockPool,
    async createListing(l) { return l; },
    getAlertSubscriptions() { return []; },
  };

  const loadedCheckpoints = [];
  const testScraper = {
    name: 'PgCheckpointScraper',
    sourceKey: 'civilview',
    setCheckpoint(cp) { loadedCheckpoints.push(cp); },
    async scrapeFeed() {
      const items = [civilviewListing('pg-1')];
      items.partialSweep = true;
      items.complete = false;
      items.nextContinuationToken = 'next-pg-cursor';
      return items;
    },
    passesFilter() { return true; },
    getRawPublisherRecord() { return { raw: 'data' }; },
  };

  const scheduler = new IngestionScheduler({
    realScrapers: [testScraper],
    database: mockDb,
    discoveryStore: null,
    telemetry: { recordRun() {} },
    concurrency: 1,
  });

  const runRes = await scheduler.runAll({ sourceIds: ['civilview'] });
  assert.equal(runRes.totalIngested, 1);
  assert.equal(loadedCheckpoints.length, 1);
  assert.equal(loadedCheckpoints[0]?.cursor, 'saved-pg-cursor');
  assert.ok(pgQueries.some(q => q.sql.includes('INSERT INTO discovery_checkpoints') && q.sql.includes('to_jsonb($2::text)') && q.params[1] === 'next-pg-cursor'));
});

test('ScraperScheduler safely unpacks JSONB object cursors from discovery_checkpoints', async () => {
  const pgQueries = [];
  const mockPool = {
    async query(sql, params) {
      pgQueries.push({ sql, params });
      if (sql.includes('SELECT cursor, scope_hash FROM discovery_checkpoints')) {
        return { rows: [{ cursor: { continuationToken: 'obj-token-123', sweepStartedAt: '2026-11-10T00:00:00Z', pagesCommitted: 2 }, scope_hash: 'abc' }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const mockDb = {
    isPg: true,
    pool: mockPool,
    async createListing(l) { return l; },
    getAlertSubscriptions() { return []; },
  };

  const loadedCheckpoints = [];
  const testScraper = {
    name: 'ObjectCheckpointScraper',
    sourceKey: 'servicelink',
    setCheckpoint(cp) { loadedCheckpoints.push(cp); },
    async scrapeFeed() {
      const items = [listing('pg-obj')];
      items.partialSweep = true;
      items.complete = false;
      items.nextContinuationToken = 'next-token-456';
      return items;
    },
    passesFilter() { return true; },
    getRawPublisherRecord() { return { raw: 'data' }; },
  };

  const scheduler = new IngestionScheduler({
    realScrapers: [testScraper],
    database: mockDb,
    discoveryStore: null,
    telemetry: { recordRun() {} },
    concurrency: 1,
  });

  const runRes = await scheduler.runAll({ sourceIds: ['servicelink'] });
  assert.equal(runRes.totalIngested, 1);
  assert.ok(loadedCheckpoints.length >= 1);
  const cp = loadedCheckpoints.at(-1);
  assert.equal(typeof cp?.continuationToken, 'string');
  assert.equal(cp?.continuationToken, 'obj-token-123');
  assert.equal(cp?.cursor, 'obj-token-123');
  assert.equal(cp?.pagesCommitted, 2);
  assert.ok(pgQueries.some(q => q.sql.includes('to_jsonb($2::text)') && q.params[1] === 'next-token-456'));
});

test('a stalled scraper times out instead of wedging the cycle, and the next run proceeds', async () => {
  const stalled = { name: 'Stalled', sourceKey: 'treasury', scrapeFeed: () => new Promise(() => {}), getRawPublisherRecord: () => null };
  const scheduler = new IngestionScheduler({ realScrapers: [stalled], scraperTimeoutMs: 50, concurrency: 1 });
  scheduler.telemetry = telemetry;
  const first = await scheduler.runAll();
  assert.equal(first.skipped, false);
  assert.equal(first.sourceResults[0].error.includes('timed out'), true);
  assert.equal(scheduler.isRunning, false, 'a timeout must release the cycle lock');
  assert.equal(scheduler.inFlight.size, 0);
  const second = await scheduler.runAll();
  assert.equal(second.skipped, false);
});

test('cadence-aware scheduling skips a source whose cadence has not elapsed but re-runs partial sweeps', () => {
  const a = { name: 'A', sourceKey: 'treasury' };
  const b = { name: 'B', sourceKey: 'servicelink' };
  const scheduler = new IngestionScheduler({ realScrapers: [a, b], cadenceAware: true });
  assert.equal(scheduler.dueScrapers([a, b]).length, 2, 'never-run sources are due');
  scheduler.sourceLastRun.set('treasury', { at: Date.now(), partial: false });
  scheduler.sourceLastRun.set('servicelink', { at: Date.now(), partial: true });
  assert.deepEqual(scheduler.dueScrapers([a, b]).map((s) => s.sourceKey), ['servicelink']);
  scheduler.sourceLastRun.set('treasury', { at: Date.now() - 13 * 3600 * 1000, partial: false });
  assert.equal(scheduler.dueScrapers([a, b]).length, 2, 'elapsed cadence makes it due again');
  const off = new IngestionScheduler({ realScrapers: [a, b] });
  off.sourceLastRun.set('treasury', { at: Date.now(), partial: false });
  assert.equal(off.dueScrapers([a, b]).length, 2, 'filtering is opt-in');
});
