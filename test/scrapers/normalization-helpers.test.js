'use strict';

// test/scrapers/normalization-helpers.test.js
//
// Direct unit coverage for the pure helpers exported from
// server/scrapers/normalization.js that have no dedicated test file:
//   - normalizeApn: strips non-alphanumeric, upper-cases, never invents
//   - buildParcelKey: stable `${fips5}-${apn}` join key when 5-digit FIPS
//     is present; stateFips + countyFips composition as a fallback;
//     normalized APN alone when no FIPS at all
//   - mapDistressStage: maps source-key strings to reo / scheduled /
//     pre_foreclosure / tax_sale / unknown with sale-date proximity logic
//
// These helpers back every listing normalization and the discovery join
// query. Silent drift would let two records that look like the same
// parcel get linked or unlinked without explanation.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeApn,
  buildParcelKey,
  mapDistressStage,
} = require('../../server/scrapers/normalization');

// --- normalizeApn -----------------------------------------------------

test('normalizeApn: returns null for null / undefined input', () => {
  assert.equal(normalizeApn(null), null);
  assert.equal(normalizeApn(undefined), null);
});

test('normalizeApn: returns null when the input has no alphanumeric characters', () => {
  // Stripping leaves nothing; the helper refuses to fabricate an APN.
  assert.equal(normalizeApn('---'), null);
  assert.equal(normalizeApn(''), null);
});

test('normalizeApn: keeps letters and digits and upper-cases', () => {
  assert.equal(normalizeApn('abc-123-def'), 'ABC123DEF');
  assert.equal(normalizeApn('12.34.56'), '123456');
  assert.equal(normalizeApn('a 1 b 2'), 'A1B2');
});

test('normalizeApn: coerces non-string inputs via String()', () => {
  assert.equal(normalizeApn(12345), '12345');
  assert.equal(normalizeApn(true), 'TRUE');
});

// --- buildParcelKey ----------------------------------------------------

test('buildParcelKey: returns null when no APN is present (never fabricates a key)', () => {
  assert.equal(buildParcelKey({}), null);
  assert.equal(buildParcelKey({ countyFips: '39035' }), null);
  assert.equal(buildParcelKey({ apn: '' }), null);
  assert.equal(buildParcelKey({ apn: null }), null);
});

test('buildParcelKey: composes `${fips5}-${apn}` when 5-digit county FIPS is present', () => {
  assert.equal(buildParcelKey({ apn: '012-345678', countyFips: '39035' }), '39035-012345678');
});

test('buildParcelKey: composes from stateFips + 3-digit countyFips when countyFips is not 5 digits', () => {
  // stateFips is 2 digits, countyFips is 3 digits → 5-digit FIPS.
  assert.equal(buildParcelKey({ apn: 'ABC', stateFips: '39', countyFips: '035' }), '39035-ABC');
});

test('buildParcelKey: returns just the normalized APN when no usable FIPS is present', () => {
  // No countyFips at all → just APN.
  assert.equal(buildParcelKey({ apn: 'ABC-123' }), 'ABC123');
  // Invalid lengths (countyFips not 5, stateFips not 2 or countyFips not 3) → APN.
  assert.equal(buildParcelKey({ apn: 'ABC', countyFips: 'abc' }), 'ABC');
});

test('buildParcelKey: prefers the 5-digit countyFips branch over the stateFips + countyFips branch', () => {
  // Both shapes would compose "39035"; verify the explicit-5 path is taken
  // and the stateFips value is not concatenated on top.
  assert.equal(buildParcelKey({ apn: 'X', countyFips: '39035', stateFips: '99' }), '39035-X');
});

// --- mapDistressStage --------------------------------------------------

test('mapDistressStage: REO sources map to reo', () => {
  // REO_SOURCES = ['hud', 'fannie', 'freddie', 'va', 'fdic', 'treasury',
  //                'irs', 'gsa', 'landbank', 'landbanksearch', 'usda', ...]
  for (const source of ['hud', 'fannie', 'freddie', 'va', 'fdic', 'treasury', 'irs', 'gsa', 'landbank', 'usda']) {
    assert.equal(mapDistressStage(source), 'reo', `expected reo for ${source}`);
  }
});

test('mapDistressStage: scheduled sources map to scheduled', () => {
  for (const source of ['trustee', 'county-trustee-sale', 'bid4assets']) {
    assert.equal(mapDistressStage(source), 'scheduled', `expected scheduled for ${source}`);
  }
});

test('mapDistressStage: sheriff/civilview within 30 days of saleDate maps to scheduled', () => {
  const tomorrow = new Date(Date.now() + 1 * 86_400_000).toISOString();
  assert.equal(mapDistressStage('sheriff', tomorrow), 'scheduled');
  assert.equal(mapDistressStage('civilview', tomorrow), 'scheduled');
  assert.equal(mapDistressStage('ohio-sheriff-sale', tomorrow), 'scheduled');
});

test('mapDistressStage: sheriff/civilview beyond 30 days maps to pre_foreclosure', () => {
  const farFuture = new Date(Date.now() + 90 * 86_400_000).toISOString();
  assert.equal(mapDistressStage('sheriff', farFuture), 'pre_foreclosure');
});

test('mapDistressStage: sheriff/civilview without saleDate maps to pre_foreclosure', () => {
  assert.equal(mapDistressStage('sheriff', null), 'pre_foreclosure');
  assert.equal(mapDistressStage('civilview'), 'pre_foreclosure');
});

test('mapDistressStage: tax-sale / tax-deed aliases map to tax_sale', () => {
  assert.equal(mapDistressStage('tax_sale'), 'tax_sale');
  assert.equal(mapDistressStage('tax-sale'), 'tax_sale');
  assert.equal(mapDistressStage('tax_sale-list'), 'tax_sale');
  assert.equal(mapDistressStage('tax-deed'), 'tax_sale');
});

test('mapDistressStage: unknown source maps to unknown', () => {
  assert.equal(mapDistressStage('unknown-source'), 'unknown');
  assert.equal(mapDistressStage(''), 'unknown');
  assert.equal(mapDistressStage(null), 'unknown');
  assert.equal(mapDistressStage(undefined), 'unknown');
});

test('mapDistressStage: source comparison is case-insensitive', () => {
  assert.equal(mapDistressStage('HUD'), 'reo');
  assert.equal(mapDistressStage('Sheriff', new Date(Date.now() + 1 * 86_400_000).toISOString()), 'scheduled');
});
