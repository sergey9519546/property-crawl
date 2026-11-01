'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  IDENTITY_FIELDS,
  PRESENTATION_FIELDS,
  isIdentityField,
  isPresentationField,
  loadSelectorStore,
  saveSelectorStore,
  relocatePresentationSelector,
  extractWithAdaptiveFallback,
  runSpaCaptureWithProfile,
  spaProfileConfig,
} = require('../server/scrapers/scrapling-runner');

const { FULL_TIER_ORDER, TIER_ORDER, waterfallFetch } = require('../server/scrapers/fetch-strategy');

test('Scrapling runner enforces strict field classification', () => {
  assert.ok(isIdentityField('caseNumber'), 'caseNumber must be an identity field');
  assert.ok(isIdentityField('parcelId'), 'parcelId must be an identity field');
  assert.ok(isIdentityField('apn'), 'apn must be an identity field');
  assert.equal(isIdentityField('openingBid'), true, 'money requires deterministic extraction');

  assert.equal(isPresentationField('openingBid'), false);
  assert.equal(isPresentationField('saleDateText'), false);
  assert.equal(isPresentationField('occupancyStatus'), false);
  assert.equal(isPresentationField('caseNumber'), false, 'caseNumber must not be a presentation field');
});

test('identity fields strictly fail closed and never relocate adaptively', () => {
  const html = `
    <div class="card">
      <span class="docket-ref">D-2026-994</span>
      <span class="random-id">CASE-8888</span>
    </div>
  `;

  // Direct relocation query on identity field returns null
  const relocated = relocatePresentationSelector(html, 'caseNumber');
  assert.equal(relocated, null, 'Identity fields must never be adaptively relocated');

  // extractWithAdaptiveFallback fails closed on missing identity field
  const result = extractWithAdaptiveFallback(html, 'test-source', {
    caseNumber: {
      selector: '.primary-case-id',
      extractor: () => null, // simulated failure of primary selector
    },
    openingBid: {
      selector: '.price',
      extractor: () => null,
    },
  }, { persistSelectors: false });

  assert.equal(result.identityPassed, false, 'Identity check must fail when identity selector fails');
  assert.equal(result.fields.caseNumber, null);
});

test('frozen presentation fallbacks do not relocate money, dates or occupancy', () => {
  const result = extractWithAdaptiveFallback('<span class="bedrooms">3 beds</span><div>Opening Bid: $74,500.00</div>', 'county-auction', {
    caseNumber: {selector:'.case-id',extractor:()=> 'CASE-12345'},
    openingBid: {selector:'.old-price',extractor:()=>null},
    saleDateText: {selector:'.old-date',extractor:()=>null},
    occupancyStatus: {selector:'.old-occupancy',extractor:()=>null},
    beds: {selector:'.old-beds',extractor:()=>null},
  }, {persistSelectors:false});
  assert.equal(result.identityPassed,false);
  assert.equal(result.fields.caseNumber,'CASE-12345');
  assert.equal(result.fields.openingBid,null);
  assert.equal(result.fields.saleDateText,null);
  assert.equal(result.fields.occupancyStatus,null);
  assert.equal(result.fields.beds,3);
  assert.equal(result.relocations.length,1);
});

test('SPA profile config defines verified portal endpoints and capture patterns', () => {
  assert.equal(spaProfileConfig.version, 1);
  assert.ok(spaProfileConfig.sources.fannie);
  assert.equal(spaProfileConfig.sources.fannie.capturePattern, '*search-service*');
  assert.ok(spaProfileConfig.sources.freddie);
  assert.equal(spaProfileConfig.sources.freddie.capturePattern, '*propertysearch*');
  assert.ok(spaProfileConfig.sources.va);
  assert.equal(spaProfileConfig.sources.va.capturePattern, '*properties*');
  assert.ok(spaProfileConfig.sources.bid4assets);
  assert.ok(spaProfileConfig.sources.realauction);
});

test('waterfall fetch exposes FULL_TIER_ORDER and includes spa-xhr tier', () => {
  assert.deepEqual(TIER_ORDER, ['native', 'scrapling-http', 'fail-closed']);
  assert.deepEqual(FULL_TIER_ORDER, ['native', 'scrapling-http', 'spa-xhr', 'fail-closed']);
});

test('waterfall fetch handles disabled SPA XHR gracefully', async () => {
  const result = await waterfallFetch({
    url: 'https://example.gov/list',
    sourceKey: 'unsupported-source',
    nativeFetch: async () => null,
    enableSpaXhr: false,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.tier, 'fail-closed');
  assert.equal(result.tier, 'fail-closed');
  assert.equal(result.error, 'FETCH_WATERFALL_EXHAUSTED');
});

test('BaseScraper exposes extractWithAdaptiveFallback, runSpiderBatch, and requestTextWithWaterfall', async () => {
  const BaseScraper = require('../server/scrapers/base');
  const scraper = new BaseScraper({
    name: 'TestAdaptiveScraper',
    sourceKey: 'sheriff',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/html']]),
      text: async () => '<html><body><div class="case">CV-2026-100</div><div>Opening Bid: $88,000</div></body></html>',
    }),
  });

  assert.equal(typeof scraper.extractWithAdaptiveFallback, 'function');
  assert.equal(typeof scraper.runSpiderBatch, 'function');
  assert.equal(typeof scraper.requestTextWithWaterfall, 'function');

  const wf = await scraper.requestTextWithWaterfall('https://cuyahoga.sheriffsaleauction.ohio.gov/index.cfm?zaction=AUCTION&zmethod=PREVIEW');
  assert.equal(wf.ok, true);
  assert.equal(wf.tier, 'native');

  const adaptive = scraper.extractWithAdaptiveFallback(wf.html, {
    caseNumber: { selector: '.case', extractor: () => 'CV-2026-100' },
    openingBid: { selector: '.missing-bid', extractor: () => null },
  }, { persistSelectors: false });
  assert.equal(adaptive.identityPassed, false);
  assert.equal(adaptive.fields.openingBid, null);
});

test('relocatePresentationSelector never matches deposit or judgment as opening bid', () => {
  const depositOnlyHtml = `
    <div class="card">
      <span class="deposit">Required Deposit: $5,000.00</span>
      <span class="judgment">Final Judgment Amount: $120,000.00</span>
    </div>
  `;
  const relocated = relocatePresentationSelector(depositOnlyHtml, 'openingBid');
  assert.equal(relocated, null, 'Deposit or judgment amount must not be extracted as opening bid');
});

test('BaseScraper.requestText fails closed on bot challenge and never escalates to waterfall', async () => {
  const BaseScraper = require('../server/scrapers/base');
  const { ScraperResponseError } = require('../server/scrapers/circuit-breaker');

  let waterfallCalled = false;
  const scraper = new BaseScraper({
    name: 'BotChallengeTestScraper',
    sourceKey: 'sheriff',
    fetchImpl: async () => {
      throw new ScraperResponseError('Cloudflare bot challenge detected', {
        status: 403,
        haltScraper: true,
      });
    },
  });

  await assert.rejects(
    async () => {
      await scraper.requestText('https://cuyahoga.sheriffsaleauction.ohio.gov/test', {
        useWaterfall: true,
      });
    },
    (err) => {
      assert.ok(err.haltScraper, 'Error must retain haltScraper: true');
      return true;
    }
  );
});
