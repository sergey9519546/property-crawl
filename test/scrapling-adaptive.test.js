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
  assert.equal(isIdentityField('openingBid'), false, 'openingBid must not be an identity field');

  assert.ok(isPresentationField('openingBid'), 'openingBid must be a presentation field');
  assert.ok(isPresentationField('saleDateText'), 'saleDateText must be a presentation field');
  assert.ok(isPresentationField('occupancyStatus'), 'occupancyStatus must be a presentation field');
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

test('presentation fields adaptively relocate on DOM class drift', () => {
  const html = `
    <div class="auction-summary">
      <div class="case-id">CASE-12345</div>
      <div class="price-bubble">Opening Bid: $74,500.00</div>
      <div class="calendar-chip">Sale Date: October 24, 2026</div>
      <div class="property-tag">Status: Occupied</div>
    </div>
  `;

  const tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapling-cache-'));

  try {
    const result = extractWithAdaptiveFallback(html, 'county-auction', {
      caseNumber: {
        selector: '.case-id',
        extractor: () => 'CASE-12345',
      },
      openingBid: {
        selector: '.legacy-price-tag', // old selector that fails
        extractor: () => null,
      },
      saleDateText: {
        selector: '.legacy-date-badge', // old selector that fails
        extractor: () => null,
      },
      occupancyStatus: {
        selector: '.legacy-occ', // old selector that fails
        extractor: () => null,
      },
    }, { cacheDir: tmpCacheDir, persistSelectors: true });

    assert.equal(result.identityPassed, true);
    assert.equal(result.fields.caseNumber, 'CASE-12345');
    assert.equal(result.fields.openingBid, '74500.00');
    assert.equal(result.fields.saleDateText, 'October 24, 2026');
    assert.equal(result.fields.occupancyStatus, 'occupied');
    assert.equal(result.relocations.length, 3, 'Should record 3 adaptive relocations');

    // Verify selector cache store was saved
    const store = loadSelectorStore('county-auction', tmpCacheDir);
    assert.equal(store.sourceKey, 'county-auction');
    assert.ok(store.selectors.openingBid);
    assert.equal(store.relocations.length, 3);
  } finally {
    fs.rmSync(tmpCacheDir, { recursive: true, force: true });
  }
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
  assert.equal(result.error, 'FETCH_WATERFALL_EXHAUSTED');
});
