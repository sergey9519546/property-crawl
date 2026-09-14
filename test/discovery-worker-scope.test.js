'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hash } = require('../server/discovery/store');
const { collectionScope } = require('../server/scrapers/collection-scope');
const { acquisitionScope, sanitizeRunReport } = require('../server/discovery/run-report');
const { promotedSourcesWithinScope, run } = require('../scripts/discovery-worker');

function scopedStore(sourceKey, scope, checkpoint = null, overrides = {}) {
  return {
    async promotedSourceScopes() { return [{ sourceKey, scope, scopeHash: hash(scope), ...overrides }]; },
    async getCheckpoint() { return checkpoint; },
  };
}

test('CivilView recurring collection requires the exact promoted county scope', async () => {
  const scraper = { sourceKey: 'civilview', targetState: 'NJ', countyId: '20' };
  const scope = collectionScope(scraper);
  assert.deepEqual(scope, { endpoint: '/Sales/SalesSearch', filters: { state: 'NJ', countyId: '20' } });
  const policy = await promotedSourcesWithinScope(
    scopedStore('civilview', scope, { cursor: {}, scopeHash: hash(scope) }),
    { realScrapers: [scraper] },
    'wave2',
  );
  assert.deepEqual(policy, { eligible: ['civilview'], rejected: [] });
});

test('CivilView legacy bounded default selection cannot inherit county promotion', async () => {
  const promotedScope = { endpoint: '/Sales/SalesSearch', filters: { state: 'NJ', countyId: '20' } };
  const legacyDefault = { sourceKey: 'civilview', targetState: 'NJ', countyId: null, maxCounties: 4 };
  const policy = await promotedSourcesWithinScope(scopedStore('civilview', promotedScope), { realScrapers: [legacyDefault] }, 'wave2');
  assert.deepEqual(policy, { eligible: [], rejected: [{ sourceKey: 'civilview', code: 'COLLECTOR_SCOPE_MISMATCH' }] });
});

test('legacy promotion rows without configured scope fail closed', async () => {
  const store = {
    async promotedSourceScopes() { return [{ sourceKey: 'treasury', scope: {}, scopeHash: null }]; },
    async getCheckpoint() { throw new Error('checkpoint must not be consulted'); },
  };
  assert.deepEqual(await promotedSourcesWithinScope(store, { realScrapers: [{ sourceKey: 'treasury' }] }, 'wave1'), { eligible: [], rejected: [{ sourceKey: 'treasury', code: 'MISSING_CONFIGURED_SCOPE' }] });
});

test('national core scope must match its exact promoted endpoint and filter', async () => {
  const scraper = { sourceKey: 'treasury' };
  const scope = collectionScope(scraper);
  assert.deepEqual(await promotedSourcesWithinScope(scopedStore('treasury', scope), { realScrapers: [scraper] }, 'wave1'), { eligible: ['treasury'], rejected: [] });
  const widened = { endpoint: scope.endpoint, filters: {} };
  assert.deepEqual((await promotedSourcesWithinScope(scopedStore('treasury', widened), { realScrapers: [scraper] }, 'wave1')).rejected[0].code, 'COLLECTOR_SCOPE_MISMATCH');
});

test('HUD run budget may change while geography and page size remain scope identity', async () => {
  const scraper = { sourceKey: 'hud', inventoryUrl: 'https://example.gov/MapServer/1', states: ['OH', 'TX'], pageSize: 100, maxPagesPerState: 4 };
  const scope = collectionScope(scraper);
  assert.deepEqual(scope.filters, { caseStepNumber: 6 });
  const oldBudgetScope = collectionScope({ ...scraper, maxPagesPerState: 3 });
  assert.deepEqual(oldBudgetScope, scope);
  assert.deepEqual((await promotedSourcesWithinScope(scopedStore('hud', scope, { cursor: { continuationToken: 'opaque' }, scopeHash: hash(scope) }), { realScrapers: [{ ...scraper, maxPagesPerState: 9 }] }, 'wave1')).eligible, ['hud']);
  const oldGeographyScope = collectionScope({ ...scraper, states: ['OH'] });
  assert.equal((await promotedSourcesWithinScope(scopedStore('hud', oldGeographyScope), { realScrapers: [scraper] }, 'wave1')).rejected[0].code, 'COLLECTOR_SCOPE_MISMATCH');
  const oldPageSizeScope = collectionScope({ ...scraper, pageSize: 50 });
  assert.equal((await promotedSourcesWithinScope(scopedStore('hud', oldPageSizeScope), { realScrapers: [scraper] }, 'wave1')).rejected[0].code, 'COLLECTOR_SCOPE_MISMATCH');
});

test('worker rejects stores that expose only the legacy promotedSources contract', async () => {
  await assert.rejects(
    () => promotedSourcesWithinScope({ promotedSources: async () => ['hud'] }, { realScrapers: [] }, 'wave1'),
    /authoritative promoted source scopes/,
  );
});

test('one invalid promoted source does not block an independently valid source', async () => {
  const treasury = { sourceKey: 'treasury' };
  const treasuryScope = collectionScope(treasury);
  const hud = { sourceKey: 'hud', inventoryUrl: 'https://example.gov/MapServer/1', states: ['OH'], pageSize: 100, maxPagesPerState: 4 };
  const mismatchedHudScope = collectionScope({ ...hud, states: ['TX'] });
  const store = {
    async promotedSourceScopes() {
      return [
        { sourceKey: 'hud', scope: mismatchedHudScope, scopeHash: hash(mismatchedHudScope) },
        { sourceKey: 'treasury', scope: treasuryScope, scopeHash: hash(treasuryScope) },
      ];
    },
    async getCheckpoint() { return null; },
  };
  const policy = await promotedSourcesWithinScope(store, { realScrapers: [treasury, hud] }, 'wave1');
  assert.deepEqual(policy, { eligible: ['treasury'], rejected: [{ sourceKey: 'hud', code: 'COLLECTOR_SCOPE_MISMATCH' }] });
});

test('checkpoint mismatch is a bounded per-source diagnostic', async () => {
  const scraper = { sourceKey: 'treasury' };
  const scope = collectionScope(scraper);
  const policy = await promotedSourcesWithinScope(scopedStore('treasury', scope, { cursor: {}, scopeHash: hash({ endpoint: '/legacy' }) }), { realScrapers: [scraper] }, 'wave1');
  assert.deepEqual(policy.rejected, [{ sourceKey: 'treasury', code: 'CHECKPOINT_SCOPE_MISMATCH' }]);
});

test('worker jobs contain only eligible sources and retain rejection diagnostics', async () => {
  const treasury = { sourceKey: 'treasury' };
  const hud = { sourceKey: 'hud', inventoryUrl: 'https://example.gov/MapServer/1', states: ['OH'], pageSize: 100 };
  const treasuryScope = collectionScope(treasury);
  const approvedHudScope = collectionScope({ ...hud, states: ['TX'] });
  const health = [], created = [];
  const store = {
    pool: { async query(sql) { return /MAX\(completed_at\)/.test(sql) ? { rows: [] } : { rows: [] }; } },
    async promotedSourceScopes() { return [{ sourceKey: 'hud', scope: approvedHudScope, scopeHash: hash(approvedHudScope) }, { sourceKey: 'treasury', scope: treasuryScope, scopeHash: hash(treasuryScope) }]; },
    async getCheckpoint() { return null; },
    async recordWorkerHealth(_key, update) { health.push(update); },
    async failAbandonedRuns() {},
    async createOrReuseJob(input) { created.push(input); return { id: 'job_scope', sourceIds: input.sourceIds, trigger: input.trigger }; },
    async claimJob(_id, _owner) { return { id: 'job_scope', sourceIds: created[0].sourceIds, trigger: created[0].trigger }; },
    async renewJobClaim() { return true; },
  };
  const priorMode = process.env.DISCOVERY_MODE;
  process.env.DISCOVERY_MODE = 'advanced';
  try {
    const result = await run({
      wave: 'wave1', database: { isPg: true }, discoveryStore: store,
      collector: { realScrapers: [hud, treasury], collectionCoordinator: { async execute() { return { id: 'job_scope', status: 'completed' }; } } },
      storageProbe: () => ({ ready: true }),
    });
    assert.deepEqual(created[0].sourceIds, ['treasury']);
    assert.deepEqual(result.scopeRejections, [{ sourceKey: 'hud', code: 'COLLECTOR_SCOPE_MISMATCH' }]);
    assert.deepEqual(health.at(-1).details.scopeRejections, result.scopeRejections);
  } finally {
    if (priorMode === undefined) delete process.env.DISCOVERY_MODE; else process.env.DISCOVERY_MODE = priorMode;
  }
});

test('USDA publisher-selected jurisdictions remain part of normalized scope identity', () => {
  const scope = collectionScope(require('../server/scrapers/usda'));
  assert.equal(scope.jurisdictionSelection, 'publisher_inventory_options');
  assert.deepEqual(acquisitionScope(scope), scope);
});

test('ServiceLink scope comes from the adapter route used by its run report', () => {
  const scraper = require('../server/scrapers/servicelink');
  assert.deepEqual(collectionScope(scraper), { endpoint: '/api/listingsvc/v1/Listings', filters: {} });
  assert.deepEqual(scraper.getCollectionScope(), collectionScope(scraper));
});

test('production HUD adapter exposes the same normalized step-6 scope used by preflight', () => {
  const scraper = require('../server/scrapers/hud');
  const scope = collectionScope(scraper);
  assert.deepEqual(acquisitionScope(scraper.getCollectionScope()), scope);
  assert.deepEqual(scope.filters, { caseStepNumber: 6 });
  assert.equal(scope.states.length, 52);
});

test('HUD run page budget remains visible without changing acquisition identity', () => {
  const scraper = require('../server/scrapers/hud');
  const report = sanitizeRunReport({ scope: { ...scraper.getCollectionScope(), maxPagesPerState: 7 } });
  assert.equal(report.budget.maxPagesPerState, 7);
  assert.equal(Object.hasOwn(report.acquisitionScope, 'maxPagesPerState'), false);
  assert.deepEqual(report.acquisitionScope, collectionScope(scraper));
});
