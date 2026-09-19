'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCivilViewIndex } = require('../scripts/civilview-counties');
const {
  MARKET_ENROLLMENT,
  resolveCivilViewIds,
  sheriffExtraCountiesEnv,
  hudEnv,
} = require('../config/market-enrollment');

test('CivilView index parser extracts countyId + name + state', () => {
  const html = `
    <a href="/Sales/SalesSearch?countyId=25">Hudson County, NJ</a>
    <a href="/Sales/SalesSearch?countyId=34">Allen County, OH</a>
  `;
  const counties = parseCivilViewIndex(html);
  assert.equal(counties.length, 2);
  assert.equal(counties[0].id, '25');
  assert.equal(counties[0].state, 'NJ');
  assert.equal(counties[1].state, 'OH');
});

test('market enrollment resolves CivilView ids from live index only', () => {
  const live = [
    { id: '10', name: 'Hudson County, NJ', state: 'NJ' },
    { id: '7', name: 'Bergen County, NJ', state: 'NJ' },
    { id: '34', name: 'Allen County, OH', state: 'OH' },
    { id: '51', name: 'Lehigh County, PA', state: 'PA' },
  ];
  const resolved = resolveCivilViewIds(live);
  // Enrollment order follows the CivilView registry, then filters to live ids.
  assert.deepEqual([...resolved.NJ.ids].sort(), ['10', '7']);
  assert.deepEqual(resolved.OH.ids, ['34']);
  assert.deepEqual(resolved.PA.ids, ['51']);
  // Unknown ids never invent enrollment
  assert.deepEqual(resolved.AZ.ids, []);
});

test('sheriff extra enrollment string and HUD careful defaults', () => {
  const extra = sheriffExtraCountiesEnv();
  assert.match(extra, /Portage:portage\.sheriffsaleauction\.ohio\.gov:OH/);
  assert.match(extra, /Greene:green/);
  const hud = hudEnv();
  assert.equal(hud.HUD_MAX_PAGES_PER_STATE, String(MARKET_ENROLLMENT.hud.maxPagesPerState));
  assert.ok(Number(hud.HUD_STATE_CONCURRENCY) <= 3);
});

test('CAPTCHA publishers stay fail-closed in enrollment policy', () => {
  const sources = MARKET_ENROLLMENT.captchaFailClosed.map((item) => item.source);
  assert.ok(sources.includes('bid4assets'));
  assert.ok(sources.includes('landbank'));
  assert.ok(sources.includes('ca-controller-tax-sale'));
  for (const item of MARKET_ENROLLMENT.captchaFailClosed) {
    assert.match(item.reason, /CAPTCHA|Cloudflare|Turnstile|Akamai/i);
  }
});
