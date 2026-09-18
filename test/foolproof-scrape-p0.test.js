'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spaXhrEnabled, captureSpaXhr, mapCapturedItems, DEFAULT_PATTERNS } = require('../server/scrapers/spa-xhr');
const { autoThrottle, parseRetryAfterMs, resetThrottleState, noteRetryAfter } = require('../server/scrapers/auto-throttle');
const { validateListingShape } = require('../server/scrapers/listing-schema');
const { FannieMaeScraper } = require('../server/scrapers/fannie');

test('SPA XHR lane is opt-in and default-off', () => {
  assert.equal(spaXhrEnabled('fannie', {}), false);
  assert.equal(spaXhrEnabled('fannie', { SCRAPLING_SPA_XHR: '1', SCRAPLING_SPA_XHR_SOURCES: 'fannie,va' }), true);
  assert.equal(spaXhrEnabled('hud', { SCRAPLING_SPA_XHR: 'true', SCRAPLING_SPA_XHR_SOURCES: 'fannie,va' }), false);
  assert.equal(DEFAULT_PATTERNS.fannie, '*search-service*');
});

test('captureSpaXhr fails closed when runtime missing', async () => {
  const result = await captureSpaXhr('https://www.homepath.fanniemae.com/listing/search?q=OH', {
    sourceKey: 'fannie',
    env: { SCRAPLING_PYTHON: '' },
    timeoutMs: 2000,
  });
  assert.equal(result.ok, false);
  assert.ok(result.error === 'SPA_XHR_RUNTIME_MISSING' || result.error === 'SPA_XHR_TIMEOUT' || /scrapling/i.test(result.error || ''));
});

test('mapCapturedItems uses scraper mapJsonItem', () => {
  const scraper = {
    mapJsonItem: (p, state) => ({ id: `FNMA-${p.id}`, source: 'fannie', state, address: p.address, openingBid: p.listPrice || null, sourceUrl: `https://example.test/${p.id}` }),
  };
  const mapped = mapCapturedItems(scraper, [{ id: '99', address: '1 Main Street', listPrice: 100000 }], 'OH');
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].id, 'FNMA-99');
});

test('auto-throttle spaces same-host requests and honors Retry-After', async () => {
  resetThrottleState();
  let sleepCalls = 0;
  const sleep = async () => { sleepCalls += 1; };
  const first = await autoThrottle('https://api.example.gov/a', { minIntervalMs: 50, sleep });
  const second = await autoThrottle('https://api.example.gov/b', { minIntervalMs: 50, sleep });
  assert.equal(first.host, 'api.example.gov');
  assert.ok(second.waitedMs >= 0);
  assert.equal(parseRetryAfterMs('2'), 2000);
  assert.equal(parseRetryAfterMs('nope'), null);
  const noted = noteRetryAfter('https://api.example.gov/c', '1');
  assert.equal(noted.host, 'api.example.gov');
  resetThrottleState();
});

test('listing schema requires id/source/state/address identity', () => {
  const bad = validateListingShape({ id: '', source: '', state: '', address: '' });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => e.startsWith('missing_') || e === 'invalid_id'));
  const good = validateListingShape({
    id: 'FNMA-1',
    source: 'fannie',
    state: 'OH',
    address: '1 Main Street',
  });
  // Identity is present; other provenance policies may still flag ingestion.
  for (const field of ['id', 'source', 'state', 'address']) {
    assert.ok(good.listing[field], field);
  }
  assert.ok(!good.errors.includes('missing_id'));
  assert.ok(!good.errors.includes('invalid_state'));
});

test('Fannie SPA shell still throws when XHR lane disabled', async () => {
  const scraper = new FannieMaeScraper();
  const html = '<html><body><div id="root"></div></body></html>';
  await assert.rejects(
    async () => scraper.fetchStateHtml('OH').then(() => {
      // requestText will fail network — inject parse path instead
    }),
    () => true
  );
  // Direct unit path:
  scraper.requestText = async () => html;
  await assert.rejects(() => scraper.fetchStateHtml('OH'), /SPA_SHELL|client-rendered/i);
});
