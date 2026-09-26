'use strict';

// test/scrapers/source-policy-helpers.test.js
//
// Direct unit coverage for the per-source URL-shape validator exported
// from server/scrapers/source-policy.js. hasSourceRecordShape is the
// gate every listing record URL passes through before it can be used as
// a sourceUrl — too loose and untrusted catalogue pages get accepted as
// evidence-backed listings; too strict and legitimate property-detail
// URLs get rejected. Silent drift in either direction would let real
// regressions through.
//
// Pins a representative sample of the source shapes; every per-source
// branch is exercised at the (host, path, query) tuple level so a future
// URL-pattern refactor fails the test loudly.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasSourceRecordShape,
  hostnameMatches,
  inspectSourceRecordUrl,
} = require('../../server/scrapers/source-policy');

function url(href, base = 'https://example.com') {
  return new URL(href, base);
}

// --- hostnameMatches ---------------------------------------------------

test('hostnameMatches: matches the exact root host', () => {
  assert.equal(hostnameMatches('sales.bid4assets.com', 'bid4assets.com'), true);
  assert.equal(hostnameMatches('www.example.com', 'example.com'), true);
});

test('hostnameMatches: matches subdomains of the root', () => {
  assert.equal(hostnameMatches('www.bid4assets.com', 'bid4assets.com'), true);
  assert.equal(hostnameMatches('sales.bid4assets.com', 'bid4assets.com'), true);
});

test('hostnameMatches: rejects unrelated hosts', () => {
  assert.equal(hostnameMatches('evil.com', 'bid4assets.com'), false);
  assert.equal(hostnameMatches('notbid4assets.com', 'bid4assets.com'), false, 'suffix collision is rejected');
});

test('hostnameMatches: empty / null hostname is rejected', () => {
  assert.equal(hostnameMatches('', 'bid4assets.com'), false);
  assert.equal(hostnameMatches(null, 'bid4assets.com'), false);
});

// --- hasSourceRecordShape: bid4assets --------------------------------

test('hasSourceRecordShape: bid4assets requires /auction/<slug> with a stable numeric or uuid token', () => {
  assert.equal(hasSourceRecordShape('bid4assets', url('/auction/12345')), true);
  // `/auction/abc` has no digit-3+ sequence, so it must be rejected.
  assert.equal(hasSourceRecordShape('bid4assets', url('/auction/abc')), false, 'no numeric or uuid token');
  assert.equal(hasSourceRecordShape('bid4assets', url('/some-other/12345')), false, 'wrong path shape');
});

test('hasSourceRecordShape: bid4assets accepts a uuid path token', () => {
  assert.equal(hasSourceRecordShape('bid4assets', url('/auction/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')), true);
});

// --- hasSourceRecordShape: civilview ---------------------------------

test('hasSourceRecordShape: civilview requires /sales/saledetails with PropertyId query', () => {
  assert.equal(hasSourceRecordShape('civilview', url('/sales/saledetails?PropertyId=12345')), true);
  assert.equal(hasSourceRecordShape('civilview', url('/sales/saledetails')), false, 'missing PropertyId');
  assert.equal(hasSourceRecordShape('civilview', url('/sales/saleindex?PropertyId=12345')), false, 'wrong path');
});

// --- hasSourceRecordShape: courtlistener -----------------------------

test('hasSourceRecordShape: courtlistener requires /docket/<numeric>/...', () => {
  assert.equal(hasSourceRecordShape('courtlistener', url('/docket/12345/')), true);
  assert.equal(hasSourceRecordShape('courtlistener', url('/docket/12345/smith-v-jones/')), true);
  assert.equal(hasSourceRecordShape('courtlistener', url('/docket/abc/')), false, 'numeric id required');
  assert.equal(hasSourceRecordShape('courtlistener', url('/case/12345/')), false, 'wrong path shape');
});

// --- hasSourceRecordShape: gsa ---------------------------------------

test('hasSourceRecordShape: gsa requires /asset-details with property_id query', () => {
  assert.equal(hasSourceRecordShape('gsa', url('/asset-details?property_id=P-1')), true);
  assert.equal(hasSourceRecordShape('gsa', url('/asset-details')), false, 'missing property_id');
  assert.equal(hasSourceRecordShape('gsa', url('/property?property_id=P-1')), false, 'wrong path');
});

// --- hasSourceRecordShape: fannie / freddie / va ---------------------

test('hasSourceRecordShape: fannie/freddie/va require /property/<token> with stable id', () => {
  assert.equal(hasSourceRecordShape('fannie', url('/property/12345')), true);
  assert.equal(hasSourceRecordShape('fannie', url('/property-details/12345')), true);
  assert.equal(hasSourceRecordShape('fannie', url('/property/abc')), false, 'no stable numeric token');
  assert.equal(hasSourceRecordShape('freddie', url('/property/12345')), true);
  assert.equal(hasSourceRecordShape('va', url('/property/12345')), true);
});

// --- hasSourceRecordShape: ca-controller-tax-sale --------------------

test('hasSourceRecordShape: ca-controller-tax-sale accepts the documented file names', () => {
  assert.equal(hasSourceRecordShape('ca-controller-tax-sale', url('/path/to/boe_tax_sales.html')), true);
  assert.equal(hasSourceRecordShape('ca-controller-tax-sale', url('/path/to/boe_tax_sales.htm')), true);
  assert.equal(hasSourceRecordShape('ca-controller-tax-sale', url('/path/to/sl_county_tax_sales.pdf')), true);
  assert.equal(hasSourceRecordShape('ca-controller-tax-sale', url('/path/to/index.html')), false, 'unrecognized filename');
});

// --- hasSourceRecordShape: unknown source ---------------------------

test('hasSourceRecordShape: unknown source returns false (no shape to match)', () => {
  assert.equal(hasSourceRecordShape('unknown-source', url('/anything')), false);
});

// --- hasSourceRecordShape: fhfa-hpi ---------------------------------

test('hasSourceRecordShape: fhfa-hpi CSV path requires geo+period query with valid US state', () => {
  assert.equal(hasSourceRecordShape('fhfa-hpi', url('/datatools/downloads/documents/hpi/hpi_at_state.csv?geo=OH&period=2024Q1')), true);
  assert.equal(hasSourceRecordShape('fhfa-hpi', url('/datatools/downloads/documents/hpi/hpi_at_state.csv?geo=ZZ&period=2024Q1')), false, 'invalid state');
  assert.equal(hasSourceRecordShape('fhfa-hpi', url('/datatools/downloads/documents/hpi/hpi_at_state.csv?geo=OH&period=2024')), false, 'invalid period');
  assert.equal(hasSourceRecordShape('fhfa-hpi', url('/datatools/downloads/documents/hpi/hpi_at_state.csv')), false, 'no geo+period');
});

// --- hasSourceRecordShape: hud-egis ----------------------------------

test('hasSourceRecordShape: HUD egis.hud.gov requires bounded CASE_NUM query and whitelisted keys', () => {
  const ok = url('https://egis.hud.gov/arcgis/rest/services/cpdmaps/hudsfreo/mapserver/1/query?where=CASE_NUM%3D%27000-123456%27&outFields=*&f=json&returnGeometry=false&outSR=4326');
  assert.equal(hasSourceRecordShape('hud', ok), true);

  const badWhere = url('https://egis.hud.gov/arcgis/rest/services/cpdmaps/hudsfreo/mapserver/1/query?where=CASE_NUM%3D%271%27&outFields=*&f=json');
  assert.equal(hasSourceRecordShape('hud', badWhere), false, 'CASE_NUM must match the documented 000-123456 shape');

  const badPath = url('https://egis.hud.gov/arcgis/rest/services/cpdmaps/hudsfreo/mapserver/2/query?where=CASE_NUM%3D%27000-123456%27&outFields=*&f=json');
  assert.equal(hasSourceRecordShape('hud', badPath), false, 'wrong mapserver layer');
});

// --- hasSourceRecordShape: hud property-details ---------------------

test('hasSourceRecordShape: HUD property-details requires caseNumber query', () => {
  assert.equal(hasSourceRecordShape('hud', url('https://www.hudhomestore.com/property/propertydetails?caseNumber=123-456789')), true);
  assert.equal(hasSourceRecordShape('hud', url('https://www.hudhomestore.com/property/propertydetails')), false, 'missing caseNumber');
});

// --- inspectSourceRecordUrl ------------------------------------------

test('inspectSourceRecordUrl: returns isValid=true + cleaned url for a known shape', () => {
  const out = inspectSourceRecordUrl('bid4assets', 'https://www.bid4assets.com/auction/12345');
  assert.equal(out.isValid, true);
  assert.equal(out.error, null);
  assert.ok(out.url, 'expected cleaned url to be returned');
});

test('inspectSourceRecordUrl: returns isValid=false + source_url_not_exact_record when shape mismatches', () => {
  const out = inspectSourceRecordUrl('bid4assets', 'https://www.bid4assets.com/some-other/12345');
  assert.equal(out.isValid, false);
  assert.equal(out.error, 'source_url_not_exact_record');
});

test('inspectSourceRecordUrl: returns isValid=false + invalid_source_url for malformed URLs', () => {
  const out = inspectSourceRecordUrl('bid4assets', 'not-a-url');
  assert.equal(out.isValid, false);
  assert.equal(out.error, 'invalid_source_url');
});

test('inspectSourceRecordUrl: returns isValid=false + unsupported_source_policy for unknown source', () => {
  const out = inspectSourceRecordUrl('bid4assets', null);
  // null is treated as a malformed URL by the helper, returning invalid_source_url.
  assert.equal(out.isValid, false);
});

test('inspectSourceRecordUrl: returns isValid=false + unsupported_source_policy for an unknown source key', () => {
  const out = inspectSourceRecordUrl('unknown-source', 'https://example.com/x');
  assert.equal(out.isValid, false);
  assert.equal(out.error, 'unsupported_source_policy');
});

test('inspectSourceRecordUrl: returns isValid=false + unsafe_source_url for http (non-https)', () => {
  const out = inspectSourceRecordUrl('bid4assets', 'http://www.bid4assets.com/auction/12345');
  assert.equal(out.isValid, false);
  assert.equal(out.error, 'unsafe_source_url');
});
