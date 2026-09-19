'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FannieMaeScraper } = require('../server/scrapers/fannie');
const { FreddieMacScraper } = require('../server/scrapers/freddie');
const { VaReoScraper } = require('../server/scrapers/va');
const { UsMarshalsScraper } = require('../server/scrapers/marshals');
const { SheriffSaleScraper } = require('../server/scrapers/sheriff');
const { createRunReport, finalizeRunReport, recordUnitFailure, recordUnitSuccess, looksLikeClientRenderedShell, applyEmptyInventoryHonesty } = require('../server/scrapers/run-report');

function withEnv(overrides, body) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = body();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test('SPA shell HTML is not treated as verified empty inventory', () => {
  const spa = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
  assert.equal(looksLikeClientRenderedShell(spa), true);
  assert.equal(looksLikeClientRenderedShell('<div class="property-card">1 Main St</div>'), false);

  const report = createRunReport('fannie', {});
  report.statesRequested = ['TX'];
  recordUnitSuccess(report, 'TX', 0);
  finalizeRunReport(report, { emitted: 0 });
  assert.equal(report.outcome, 'empty');
  assert.throws(
    () => applyEmptyInventoryHonesty(report, { emitted: 0, htmlSamples: [spa], sourceKey: 'fannie' }),
    /client-rendered|not verified empty|SOURCE_OBSERVATION/i
  );
});

test('Fannie SPA shell HTML fallback throws instead of claiming empty', async () => {
  await withEnv({ FANNIE_STATES: 'OH' }, async () => {
    const scraper = new FannieMaeScraper();
    scraper.fetchStateHomePath = async () => {
      const html = '<html><body><div id="root"></div></body></html>';
      return { listings: [], html };
    };
    await assert.rejects(() => scraper.scrapeFeed(), /SPA_SHELL|client-rendered|SOURCE_OBSERVATION|UPSTREAM/i);
  });
});

test('run-report helper classifies failed / partial / empty / success', () => {
  const failed = createRunReport('x', {});
  failed.statesRequested = ['A', 'B'];
  recordUnitFailure(failed, 'A', new Error('down'));
  recordUnitFailure(failed, 'B', new Error('down'));
  finalizeRunReport(failed, { emitted: 0 });
  assert.equal(failed.outcome, 'failed');

  const partial = createRunReport('x', {});
  partial.statesRequested = ['A', 'B'];
  recordUnitSuccess(partial, 'A', 2);
  recordUnitFailure(partial, 'B', new Error('down'));
  finalizeRunReport(partial, { emitted: 2 });
  assert.equal(partial.outcome, 'partial_failure');

  const empty = createRunReport('x', {});
  empty.statesRequested = ['A'];
  recordUnitSuccess(empty, 'A', 0);
  finalizeRunReport(empty, { emitted: 0 });
  assert.equal(empty.outcome, 'empty');

  const ok = createRunReport('x', {});
  ok.statesRequested = ['A'];
  recordUnitSuccess(ok, 'A', 3);
  finalizeRunReport(ok, { emitted: 3 });
  assert.equal(ok.outcome, 'success');
});

test('Fannie scraper throws and records lastRunReport when every state fails', async () => {
  await withEnv({ FANNIE_STATES: 'OH,TX' }, async () => {
    const scraper = new FannieMaeScraper();
    scraper.fetchStateHomePath = async () => { throw new Error('SPA unreachable'); };
    await assert.rejects(() => scraper.scrapeFeed(), /FANNIE_UPSTREAM_UNAVAILABLE/);
    assert.equal(scraper.lastRunReport.outcome, 'failed');
    assert.equal(scraper.lastRunReport.statesFailed.length, 2);
    assert.equal(scraper.lastRunReport.statesSucceeded.length, 0);
  });
});

test('Freddie scraper reports partial_failure when some states fail', async () => {
  await withEnv({ FREDDIE_STATES: 'OH,TX' }, async () => {
    const scraper = new FreddieMacScraper();
    scraper.fetchStateListings = async (state) => {
      if (state === 'OH') throw new Error('down');
      return [{ id: 'FREDDIE-1', source: 'freddie', state: 'TX', address: '1 Main Street', openingBid: 100000, sourceUrl: 'https://www.homesteps.com/x' }];
    };
    await scraper.scrapeFeed();
    assert.equal(scraper.lastRunReport.outcome, 'partial_failure');
  });
});

test('VA scraper uses configurable base URL and fails closed when all endpoints fail', async () => {
  await withEnv({ VA_REO_BASE_URL: 'https://va-reo.example.test', VA_REO_STATES: 'OH,TX' }, async () => {
    const scraper = new VaReoScraper();
    assert.equal(scraper.baseUrl, 'https://va-reo.example.test');
    scraper.fetchStateListings = async () => { throw new Error('404'); };
    await assert.rejects(() => scraper.scrapeFeed(), /VA_UPSTREAM_UNAVAILABLE/);
    assert.equal(scraper.lastRunReport.outcome, 'failed');
  });
});

test('Marshals scraper records primary failure and does not claim success from empty partner fallback', async () => {
  const scraper = new UsMarshalsScraper();
  scraper.requestText = async () => { throw new Error('403'); };
  scraper.fetchPartnerAuctions = async (report) => {
    if (report) recordUnitFailure(report, 'reallook', new Error('partner blocked'), 'upstream');
    return [];
  };
  await assert.rejects(() => scraper.scrapeFeed(), /USMS_UPSTREAM_UNAVAILABLE/);
  assert.equal(scraper.lastRunReport.outcome, 'failed');
  assert.ok(scraper.lastRunReport.failures.length >= 1);
});

test('Sheriff scraper expands default OH counties and accepts extra enrollment via env', async () => {
  await withEnv({ SHERIFF_EXTRA_COUNTIES: 'Erie:erie.sheriffsaleauction.ohio.gov:OH,NJ-Demo:demo.example.gov:NJ' }, async () => {
    const scraper = new SheriffSaleScraper();
    assert.ok(scraper.counties.length >= 20, 'default OH set expanded for 10x collection');
    assert.ok(scraper.counties.some(c => c.name === 'Montgomery'));
    assert.ok(scraper.counties.some(c => c.name === 'Warren'));
    assert.ok(scraper.counties.some(c => c.name === 'Delaware'));
    assert.ok(scraper.counties.some(c => c.name === 'Erie' && c.state === 'OH'));
    assert.ok(scraper.counties.some(c => c.name === 'NJ-Demo' && c.state === 'NJ'));
  });
});

test('Sheriff parser extracts sale date and appraisal from varied Realauction markup', () => {
  const scraper = new SheriffSaleScraper({ counties: [{ name: 'Franklin', domain: 'franklin.sheriffsaleauction.ohio.gov', state: 'OH' }] });
  const html = `<table>
    <tr class="auction-row sale-row">
      <td>Case # CV-2026-12345</td>
      <td class="address">789 Oak Avenue</td>
      <td>Opening Bid: $45,000</td>
      <td>Appraisal: $120,000</td>
      <td>Sale Date: 03/15/2027</td>
      <td><a href="/Sales/Detail?id=1">detail</a></td>
    </tr>
  </table>`;
  const listings = scraper.parseRealauctionHtml(html, { name: 'Franklin', domain: 'franklin.sheriffsaleauction.ohio.gov', state: 'OH' });
  assert.equal(listings.length, 1);
  assert.equal(listings[0].address, '789 Oak Avenue');
  assert.equal(listings[0].openingBid, 45000);
  assert.equal(listings[0].assessed, 120000);
  assert.equal(listings[0].saleDate, '2027-03-15');
  assert.equal(listings[0].provenance.origin, 'live');
});

test('Sheriff scraper throws when every county fails', async () => {
  const scraper = new SheriffSaleScraper({
    counties: [
      { name: 'Cuyahoga', domain: 'cuyahoga.sheriffsaleauction.ohio.gov', state: 'OH' },
      { name: 'Franklin', domain: 'franklin.sheriffsaleauction.ohio.gov', state: 'OH' },
    ],
  });
  scraper.fetchCountyRealauction = async () => { throw new Error('timeout'); };
  await assert.rejects(() => scraper.scrapeFeed(), /SHERIFF_UPSTREAM_UNAVAILABLE/);
  assert.equal(scraper.lastRunReport.outcome, 'failed');
});
