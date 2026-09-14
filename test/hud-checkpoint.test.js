'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { HudHomeScraper, HUD_REO_LAYER } = require('../server/scrapers/hud');

function scraper(options, fetchState) {
  const value = new HudHomeScraper({ states: ['CA', 'TX'], maxStates: 1, maxPagesPerState: 1, pageSize: 10, stateConcurrency: 1, ...options });
  value.executeWithRetry = operation => operation();
  value.fetchStateHudHomes = fetchState;
  return value;
}

function stateResult(state, { truncated = false, nextPage, listings = [] } = {}) {
  return { state, listings, pagesAttempted: 1, pagesFetched: 1, sourceRows: listings.length,
    malformedRows: 0, usedHtmlFallback: false, truncated, ...(nextPage ? { nextPage } : {}) };
}

test('HUD resumes a partial state page across scraper instances and completes remaining jurisdictions', async () => {
  const calls = [];
  const first = scraper({}, async (state, page) => {
    calls.push([state, page]);
    return stateResult(state, { truncated: true, nextPage: page + 1 });
  });
  await first.scrapeFeed();
  assert.deepEqual(calls, [['CA', 1]]);
  assert.equal(first.lastRunReport.complete, false);
  assert.ok(first.lastRunReport.nextContinuationToken);

  const second = scraper({}, async (state, page) => {
    calls.push([state, page]);
    return stateResult(state);
  });
  second.setCheckpoint({ continuationToken: first.lastRunReport.nextContinuationToken,
    sweepStartedAt: first.lastRunReport.sweepStartedAt, pagesCommitted: 1 });
  await second.scrapeFeed();
  assert.deepEqual(calls.at(-1), ['CA', 2]);
  assert.deepEqual(second.lastRunReport.completedStates, ['CA']);
  assert.deepEqual(second.lastRunReport.remainingStates, ['TX']);

  const third = scraper({}, async (state, page) => {
    calls.push([state, page]);
    return stateResult(state);
  });
  third.setCheckpoint({ continuationToken: second.lastRunReport.nextContinuationToken,
    sweepStartedAt: second.lastRunReport.sweepStartedAt, pagesCommitted: 2 });
  await third.scrapeFeed();
  assert.deepEqual(calls.at(-1), ['TX', 1]);
  assert.equal(third.lastRunReport.complete, true);
  assert.equal(third.lastRunReport.fullSweepComplete, true);
  assert.equal(third.lastRunReport.nextContinuationToken, undefined);
});

test('a failed jurisdiction stays pending while later completed jurisdictions remain committed', async () => {
  const first = scraper({ maxStates: 2 }, async state => {
    if (state === 'CA') throw new Error('temporary CA failure');
    return stateResult(state);
  });
  await first.scrapeFeed();
  assert.deepEqual(first.lastRunReport.completedStates, ['TX']);
  assert.deepEqual(first.lastRunReport.remainingStates, ['CA']);
  assert.equal(first.lastRunReport.complete, false);

  const calls = [];
  const resumed = scraper({ maxStates: 2 }, async (state, page) => {
    calls.push([state, page]);
    return stateResult(state);
  });
  resumed.setCheckpoint({ continuationToken: first.lastRunReport.nextContinuationToken });
  await resumed.scrapeFeed();
  assert.deepEqual(calls, [['CA', 1]]);
  assert.equal(resumed.lastRunReport.complete, true);
  assert.equal(resumed.lastRunReport.nextContinuationToken, undefined);
});

test('HUD rejects malformed and scope-incompatible cursors before fetching', async () => {
  const first = scraper({}, async (state, page) => stateResult(state, { truncated: true, nextPage: page + 1 }));
  await first.scrapeFeed();

  let fetched = false;
  const changed = scraper({ pageSize: 20 }, async () => { fetched = true; return stateResult('CA'); });
  changed.setCheckpoint({ continuationToken: first.lastRunReport.nextContinuationToken });
  await assert.rejects(changed.scrapeFeed(), /scope does not match/);
  assert.equal(fetched, false);

  const malformed = scraper({}, async () => { fetched = true; return stateResult('CA'); });
  malformed.setCheckpoint({ continuationToken: 'not-json' });
  await assert.rejects(malformed.scrapeFeed(), /malformed/);
});

test('per-run state and page budgets may change without invalidating the sweep scope', async () => {
  const first = scraper({}, async (state, page) => stateResult(state, { truncated: true, nextPage: page + 1 }));
  await first.scrapeFeed();
  const calls = [];
  const largerBatch = scraper({ maxStates: 2, maxPagesPerState: 3 }, async (state, page) => {
    calls.push([state, page]);
    return stateResult(state);
  });
  largerBatch.setCheckpoint({ continuationToken: first.lastRunReport.nextContinuationToken });
  await largerBatch.scrapeFeed();
  assert.deepEqual(calls, [['CA', 2], ['TX', 1]]);
  assert.equal(largerBatch.lastRunReport.complete, true);
});

test('DataGrid and ArcGIS page functions apply resumed page positions', async () => {
  const dataUrls = [];
  const dataGrid = new HudHomeScraper({ states: ['CA'], maxPagesPerState: 1, pageSize: 10 });
  dataGrid.requestText = async url => {
    dataUrls.push(new URL(url));
    return JSON.stringify({ aaData: [], iTotalRecords: 0 });
  };
  await dataGrid.fetchStateHudHomes('CA', 4);
  assert.equal(dataUrls[0].searchParams.get('pageNo'), '4');

  const arcUrls = [];
  const arc = new HudHomeScraper({ states: ['CA'], inventoryUrl: HUD_REO_LAYER, maxPagesPerState: 1, pageSize: 10 });
  arc.requestText = async url => {
    arcUrls.push(new URL(url));
    return JSON.stringify({ features: [], exceededTransferLimit: false });
  };
  await arc.fetchStateHudHomes('CA', 4);
  assert.equal(arcUrls[0].searchParams.get('resultOffset'), '30');
});

test('DataGrid does not mark a resumed or partially fetched jurisdiction complete through HTML fallback', async () => {
  const value = new HudHomeScraper({ states: ['CA'], maxPagesPerState: 2, pageSize: 10 });
  let requests = 0;
  let fallback = false;
  value.requestText = async () => {
    requests += 1;
    if (requests === 1) return JSON.stringify({ aaData: Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, address: `${i} Main` })), iTotalRecords: 20 });
    throw new Error('page failed');
  };
  value.fetchStateHtml = async () => { fallback = true; return []; };
  await assert.rejects(value.fetchStateHudHomes('CA', 1), /page failed/);
  assert.equal(fallback, false);
});

test('HUD refuses excessive page offsets and already exhausted cursors', async () => {
  const initial = scraper({}, async state => stateResult(state, { truncated: true, nextPage: 2 }));
  await initial.scrapeFeed();
  const cursor = JSON.parse(Buffer.from(initial.lastRunReport.nextContinuationToken, 'base64url'));
  for (const [next, reason] of [
    [{ ...cursor, nextPages: { CA: 1_000_001 } }, /malformed/],
    [{ ...cursor, completedStates: ['CA', 'TX'], nextPages: {} }, /exhausted/],
  ]) {
    const value = scraper({}, async () => { assert.fail('invalid cursor must not fetch'); });
    value.setCheckpoint({ continuationToken: Buffer.from(JSON.stringify(next)).toString('base64url') });
    await assert.rejects(value.scrapeFeed(), reason);
  }
});

test('DataGrid counts publisher rows and parser rejections separately', async () => {
  const value = new HudHomeScraper({ states: ['CA'], maxPagesPerState: 1 });
  value.fetchDataGridPage = async () => ({ items: [{ valid: true }, { valid: false }], hasMore: false });
  value.mapJsonItem = row => row.valid ? { id: 'HUD-TEST' } : null;
  const result = await value.fetchStateHudHomes('CA');
  assert.equal(result.sourceRows, 2);
  assert.equal(result.malformedRows, 1);
  assert.equal(result.listings.length, 1);
  assert.equal(result.pagesFetched, 1);
});

test('HTML fallback leaves unobserved publisher and rejection counts unknown', async () => {
  const value = new HudHomeScraper({ states: ['CA'] });
  value.fetchDataGridPage = async () => { throw new Error('DataGrid unavailable'); };
  value.fetchStateHtml = async () => [{ id: 'HUD-TEST' }];
  const result = await value.fetchStateHudHomes('CA');
  assert.equal(result.usedHtmlFallback, true);
  assert.equal(result.sourceRows, null);
  assert.equal(result.malformedRows, null);
});
