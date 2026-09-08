'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TreasuryForfeitureScraper } = require('../server/scrapers/treasury');
const { IrsSeizedScraper } = require('../server/scrapers/irs');
const { UsdaResalesScraper } = require('../server/scrapers/usda');
const { GsaSurplusScraper } = require('../server/scrapers/gsa');
const { HudHomeScraper } = require('../server/scrapers/hud');

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
  assert.deepEqual(irs.lastRunReport.scope, { endpoint: '/auction/items', realEstateCardsDiscovered: 2 });
});

test('USDA and GSA declare the publisher-discovered scope and never use fixtures', async () => {
  const usda = bypassRetries(new UsdaResalesScraper());
  usda.fetchText = async () => '<select id="stateCode"><option value="13">GA</option></select>';
  usda.searchState = async () => [];
  await usda.scrapeFeed();
  assert.equal(usda.lastRunReport.complete, true);
  assert.deepEqual(usda.lastRunReport.scope.inventoryStates, ['13']);
  assert.equal(usda.lastRunReport.fixtureFallbackUsed, false);

  const gsa = bypassRetries(new GsaSurplusScraper());
  gsa.fetchText = async () => '<a href="/asset-details/?property_id=7">Property</a>';
  gsa.fetchDetail = async () => null;
  await gsa.scrapeFeed();
  assert.equal(gsa.lastRunReport.complete, true);
  assert.equal(gsa.lastRunReport.recordsRejected, 1);
  assert.deepEqual(gsa.lastRunReport.scope, { endpoint: '/our-listing', propertyIdsDiscovered: 1 });
});

test('HUD configured jurisdiction and page caps are explicitly truncated', () => {
  const hud = new HudHomeScraper({ states: ['CA', 'TX'], maxStates: 1, maxPagesPerState: 1, pageSize: 10 });
  const report = hud.createRunReport(hud.states.slice(0, hud.maxStates));
  assert.equal(report.truncated, true);
  assert.deepEqual(report.scope, { endpoint: '/Home/DataGrid', states: ['CA'], pageSize: 10, maxPagesPerState: 1 });
});
