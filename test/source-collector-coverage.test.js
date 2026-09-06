'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { HudHomeScraper } = require('../server/scrapers/hud');

function response(status, body) {
  return { status, headers: new Headers(), text: async () => body };
}

function hudRow(caseNumber, city = 'Columbus') {
  return {
    caseNumber,
    state: 'OH',
    address: `${caseNumber.slice(-3)} Main Street`,
    city,
    zip: '43215',
    listPrice: 105000,
    bedrooms: 3,
    bathrooms: 2,
    propertyType: 'Single Family'
  };
}

test('HUD traverses bounded DataGrid pages using the publisher aaData and total-record schema', async () => {
  const requested = [];
  const scraper = new HudHomeScraper({
    states: ['OH'], pageSize: 2, maxPagesPerState: 3, stateConcurrency: 1,
    sleep: async () => {},
    fetchImpl: async (url) => {
      requested.push(url);
      const page = new URL(url).searchParams.get('pageNo');
      if (page === '1') return response(200, JSON.stringify({ aaData: [hudRow('411-100001'), hudRow('411-100002')], iTotalRecords: 3 }));
      if (page === '2') return response(200, JSON.stringify({ aaData: [hudRow('411-100003')], iTotalRecords: 3 }));
      throw new Error(`unexpected page ${page}`);
    }
  });

  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 3);
  assert.deepEqual(requested.map((url) => new URL(url).searchParams.get('pageNo')), ['1', '2']);
  assert.equal(scraper.lastRunReport.outcome, 'success');
  assert.equal(scraper.lastRunReport.pagesFetched, 2);
  assert.equal(scraper.lastRunReport.listingsEmitted, 3);
  assert.ok(listings.every((listing) => listing.source === 'hud' && listing.sourceUrl.includes('caseNumber=')));
});

test('HUD reports a valid zero-row publisher response as empty, without disguising a failure', async () => {
  const scraper = new HudHomeScraper({
    states: ['OH', 'TX'], maxPagesPerState: 2, stateConcurrency: 1, sleep: async () => {},
    fetchImpl: async () => response(200, JSON.stringify({ aaData: [], iTotalRecords: 0 }))
  });

  assert.deepEqual(await scraper.scrapeFeed(), []);
  assert.equal(scraper.lastRunReport.outcome, 'empty');
  assert.equal(scraper.lastRunReport.statesEmpty, 2);
  assert.equal(scraper.lastRunReport.statesFailed, 0);
});

test('HUD surfaces an upstream failure and records it instead of returning an empty inventory', async () => {
  const scraper = new HudHomeScraper({
    states: ['OH'], maxPagesPerState: 1, stateConcurrency: 1, sleep: async () => {},
    fetchImpl: async () => response(503, 'maintenance window')
  });

  await assert.rejects(scraper.scrapeFeed(), (error) => error.code === 'HUD_UPSTREAM_UNAVAILABLE');
  assert.equal(scraper.lastRunReport.outcome, 'failed');
  assert.equal(scraper.lastRunReport.statesFailed, 1);
  assert.equal(scraper.lastRunReport.statesEmpty, 0);
  assert.match(scraper.lastRunReport.failures[0].error, /DataGrid and HTML fallback both failed/);
});

test('HUD does not fall back after a bot challenge and keeps the failure visible', async () => {
  let requests = 0;
  const scraper = new HudHomeScraper({
    states: ['OH'], maxPagesPerState: 1, stateConcurrency: 1, sleep: async () => {},
    fetchImpl: async () => { requests += 1; return response(200, 'Attention Required! | Cloudflare'); }
  });

  await assert.rejects(scraper.scrapeFeed(), (error) => error.code === 'HUD_UPSTREAM_UNAVAILABLE');
  assert.equal(requests, 1);
  assert.equal(scraper.lastRunReport.outcome, 'failed');
  assert.match(scraper.lastRunReport.failures[0].error, /WAF bot challenge/i);
});
