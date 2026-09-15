'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TreasuryForfeitureScraper } = require('../server/scrapers/treasury');
const { IrsSeizedScraper } = require('../server/scrapers/irs');
const { UsdaResalesScraper } = require('../server/scrapers/usda');
const { GsaSurplusScraper } = require('../server/scrapers/gsa');
const { HudHomeScraper } = require('../server/scrapers/hud');
const { sanitizeRunReport } = require('../server/discovery/run-report');

function bypassRetries(scraper) { scraper.executeWithRetry = (operation) => operation(); scraper.crawlJitter = async () => {}; return scraper; }

test('Treasury and IRS detail failures make an otherwise bounded index sweep incomplete', async () => {
  const treasury = bypassRetries(new TreasuryForfeitureScraper());
  treasury.fetchText = async () => '<a href="one.shtml">One</a><a href="two.shtml">Two</a>';
  treasury.fetchDetail = async (slug) => slug === 'one.shtml' ? { id: 'one' } : Promise.reject(new Error('detail failed'));
  await treasury.scrapeFeed();
  assert.equal(treasury.lastRunReport.complete, false);
  assert.equal(treasury.lastRunReport.recordsDiscovered, 2);
  assert.equal(treasury.lastRunReport.fixtureFallbackUsed, false);

  const irs = bypassRetries(new IrsSeizedScraper());
  irs.fetchText = async () => '<a href="/ad/one" rel="bookmark"><span class="treas-page-title">House one</span></a><a href="/ad/two" rel="bookmark"><span class="treas-page-title">House two</span></a>';
  irs.fetchDetail = async (slug) => slug === 'one' ? { id: 'one' } : Promise.reject(new Error('detail failed'));
  await irs.scrapeFeed();
  assert.equal(irs.lastRunReport.fullSweepComplete, false);
  assert.deepEqual(irs.lastRunReport.scope, { endpoint: '/auction/items', filters: { assetClass: 'real_estate' } });
});

test('USDA and GSA declare the publisher-discovered scope and never use fixtures', async () => {
  const usda = bypassRetries(new UsdaResalesScraper());
  usda.fetchText = async () => '<select id="stateCode"><option value="13">Georgia</option></select>';
  usda.searchState = async () => [];
  await usda.scrapeFeed();
  assert.equal(usda.lastRunReport.complete, true);
  assert.deepEqual(usda.lastRunReport.discoveredStates, ['GA']);
  assert.deepEqual(usda.lastRunReport.discoveredStateOptions, ['13']);
  assert.deepEqual(usda.lastRunReport.statesCompleted, ['GA']);
  assert.deepEqual(usda.lastRunReport.completedStateOptions, ['13']);
  assert.equal(usda.lastRunReport.sourceRows, 0);
  assert.equal(usda.lastRunReport.malformedRows, 0);
  assert.equal(usda.lastRunReport.fixtureFallbackUsed, false);
  const coverage = sanitizeRunReport(usda.lastRunReport, { accepted: 0, ingestionRejected: 0 });
  assert.deepEqual(coverage.jurisdictions.codes, {
    discovered: ['GA'], attempted: ['GA'], completed: ['GA']
  });
  assert.equal(coverage.jurisdictions.failed, 0);
  assert.equal(coverage.counts.parserRejected, 0);

  const gsa = bypassRetries(new GsaSurplusScraper());
  gsa.fetchText = async () => '<a href="/asset-details/?property_id=7">Property</a>';
  gsa.fetchDetail = async () => null;
  await gsa.scrapeFeed();
  assert.equal(gsa.lastRunReport.complete, true);
  assert.equal(gsa.lastRunReport.recordsRejected, 1);
  assert.deepEqual(gsa.lastRunReport.scope, { endpoint: '/our-listing', filters: { assetClass: 'real_estate' } });
});

test('USDA refuses to certify an unrecognized national search page as empty inventory', async () => {
  const usda = bypassRetries(new UsdaResalesScraper());
  usda.fetchText = async () => '<html><h1>Temporarily unavailable</h1></html>';
  await assert.rejects(
    () => usda.scrapeFeed(),
    (error) => error.code === 'USDA_SEARCH_SCHEMA_UNRECOGNIZED'
  );
  assert.equal(usda.lastRunReport, null);
});

test('USDA treats a missing state result table as an incomplete publisher sweep', async () => {
  const usda = bypassRetries(new UsdaResalesScraper());
  let requests = 0;
  usda.fetchText = async () => {
    requests += 1;
    return requests === 1
      ? '<select id="stateCode"><option value="13">Georgia</option></select>'
      : '<html><h1>Search results unavailable</h1></html>';
  };
  await usda.scrapeFeed();
  assert.equal(usda.lastRunReport.complete, false);
  assert.equal(usda.lastRunReport.fullSweepComplete, false);
  assert.equal(usda.lastRunReport.statesFailed, 1);
  assert.deepEqual(usda.lastRunReport.discoveredStates, ['GA']);
  assert.deepEqual(usda.lastRunReport.statesCompleted, []);
  assert.match(usda.lastRunReport.failures[0].error, /no property summary table/);
});

test('USDA fails closed on malformed or duplicate publisher jurisdiction options', () => {
  const usda = new UsdaResalesScraper();
  assert.deepEqual(
    usda.parseStateOptions('<select id="stateCode"><option value="13">Georgia (2)</option></select>'),
    [{ code: '13', label: 'Georgia (2)', state: 'GA' }]
  );
  assert.throws(
    () => usda.parseStateOptions('<select id="stateCode"><option value="bad">Georgia</option></select>'),
    (error) => error.code === 'USDA_SEARCH_SCHEMA_UNRECOGNIZED'
  );
  assert.throws(
    () => usda.parseStateOptions('<select id="stateCode"><option value="13">Georgia</option><option value="13">Georgia</option></select>'),
    (error) => error.code === 'USDA_SEARCH_SCHEMA_UNRECOGNIZED'
  );
});

test('HUD configured jurisdiction and page caps are explicitly truncated', () => {
  const hud = new HudHomeScraper({ states: ['CA', 'TX'], maxStates: 1, maxPagesPerState: 1, pageSize: 10, inventoryUrl: 'https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1/query' });
  const report = hud.createRunReport(hud.states.slice(0, hud.maxStates));
  assert.equal(report.truncated, true);
  assert.deepEqual(report.scope, { endpoint: 'https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1/query', states: ['CA'], pageSize: 10, filters: { caseStepNumber: 6 }, maxPagesPerState: 1 });
});
