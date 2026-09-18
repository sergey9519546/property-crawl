'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { waterfallFetch, impersonationEnabled, TIER_ORDER } = require('../server/scrapers/fetch-strategy');

test('fetch strategy tier order is native → scrapling-http → fail-closed', () => {
  assert.deepEqual(TIER_ORDER, ['native', 'scrapling-http', 'fail-closed']);
});

test('impersonation is opt-in via SCRAPLING_FETCH_SOURCES', () => {
  assert.equal(impersonationEnabled('fannie', {}), false);
  assert.equal(impersonationEnabled('fannie', { SCRAPLING_FETCH_SOURCES: 'fannie,va' }), true);
  assert.equal(impersonationEnabled('hud', { SCRAPLING_FETCH_SOURCES: 'fannie,va' }), false);
});

test('waterfall returns native HTML when fetch succeeds', async () => {
  const result = await waterfallFetch({
    url: 'https://example.gov/list',
    sourceKey: 'hud',
    nativeFetch: async () => '<table class="property-row">ok</table>',
  });
  assert.equal(result.ok, true);
  assert.equal(result.tier, 'native');
  assert.match(result.html, /property-row/);
});

test('waterfall fails closed when native fails and impersonation is disabled', async () => {
  const result = await waterfallFetch({
    url: 'https://example.gov/list',
    sourceKey: 'fannie',
    nativeFetch: async () => { throw new Error('SPA shell'); },
    env: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.tier, 'fail-closed');
  assert.equal(result.error, 'FETCH_WATERFALL_EXHAUSTED');
  assert.ok(result.attempts.some((a) => a.tier === 'native' && a.ok === false));
});

test('research doc exists for foolproof scrape upgrades', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const doc = fs.readFileSync(
    path.resolve(__dirname, '../docs/FOOLPROOF_SCRAPE_RESEARCH.md'),
    'utf8'
  );
  assert.match(doc, /Scrapling/);
  assert.match(doc, /capture_xhr|XHR/);
  assert.match(doc, /AutoThrottle|Retry-After/);
  assert.match(doc, /CAPTCHA/);
});
