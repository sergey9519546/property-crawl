'use strict';
// test/probe-retired-records.test.js
//
// The point of this probe is to NOT be fooled by HTTP 200.
//
// CivilView serves a branded, client-rendered shell with HTTP 200 for property
// ids it no longer publishes. A probe that treats a 200 as "still live" marks
// every dead record fresh and manufactures the exact false evidence this project
// refuses to publish. These tests pin that distinction, including the control:
// a real record must still be recognised as served, or the probe would be
// useless in the other direction - declaring live records dead.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyDetailResponse,
  extractPublisherKey,
  isStale,
  probeRetiredRecords,
  SOURCE_SCRAPERS,
} = require('../scripts/probe-retired-records');

test('a 200 response carrying no record is NOT_SERVED, not served', () => {
  // What the publisher returns for an id that has aged out of the index.
  assert.equal(classifyDetailResponse({ parsed: null }), 'not_served');
  // Even when the shell has real bytes behind it - the classifier only ever
  // sees the parse result, never the status code.
  assert.equal(classifyDetailResponse({ parsed: {}, bytes: 13147 }), 'not_served');
  assert.equal(classifyDetailResponse({ parsed: { address: '' } }), 'not_served');
});

test('a record the publisher really serves is recognised', () => {
  assert.equal(classifyDetailResponse({ parsed: { address: '1 Cranberry Court', id: 'CIV-NJ-8-1' } }), 'served');
});

test('a network or parse fault is reported as an error, never as a dead record', () => {
  assert.equal(classifyDetailResponse({ error: 'timeout' }), 'error');
  assert.equal(classifyDetailResponse({ parsed: null, error: 'parse threw' }), 'error');
});

test('publisher record keys are read from the stored URL, not guessed from the local id', () => {
  assert.equal(
    extractPublisherKey('civilview', 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2150489401'),
    '2150489401',
  );
  assert.equal(
    extractPublisherKey('gsa', 'https://www.gsa.gov/asset-details/?property_id=27'),
    '27',
  );
  assert.equal(
    extractPublisherKey('irs', 'https://www.irs.gov/auction/items/ad/some-listing-slug'),
    'some-listing-slug',
  );
  assert.equal(
    extractPublisherKey('treasury', 'https://treasury.gov/auctions/treasury/rp/realprop/106southbay.shtml'),
    '106southbay.shtml',
  );
  // A URL that carries no key must yield null, never a guess.
  assert.equal(extractPublisherKey('civilview', 'https://example.invalid/', 'CIV-NJ-8-1'), null);
  assert.equal(extractPublisherKey('gsa', null, 'GSA-1'), null);
});

test('only records the publisher has not re-observed are probed', () => {
  // "Still served" is true by definition for a fresh record, so probing the
  // first N of a source would answer a question nobody asked. The stale ones
  // are the subject.
  assert.equal(isStale({ sourceFreshness: { status: 'stale' } }), true);
  assert.equal(isStale({ sourceFreshness: { status: 'current' } }), false);
  assert.equal(isStale({}), true, 'a record with no freshness block was never re-observed');

  const probed = [];
  const fakeScraper = {
    fetchCounties: async () => [{ id: '8', name: 'Monmouth County', state: 'NJ' }],
    fetchCountySummaries: async () => ({ sessionCookie: 's=1' }),
    fetchText: async () => '<div>sale-details-list</div>',
    parseDetailPage: (html, summary) => {
      probed.push(summary.propertyId);
      return { id: 'x', address: '1 Cranberry Court' };
    },
  };
  return probeRetiredRecords({
    source: 'civilview',
    baseUrl: 'http://probe.invalid',
    scraper: fakeScraper,
    staleOnly: true,
    fetchInventory: async () => [
      {
        id: 'CIV-NJ-8-111',
        sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=111',
        sourceFreshness: { status: 'stale' },
      },
      {
        id: 'CIV-NJ-8-222',
        sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=222',
        sourceFreshness: { status: 'current' },
      },
    ],
  }).then((summary) => {
    assert.equal(summary.sampled, 1, 'the fresh record must not be probed');
    assert.deepEqual(probed, ['111']);
  });
});

test('a source with no per-record probe is reported as unsupported, not as "none gone"', () => {
  assert.equal(Object.hasOwn(SOURCE_SCRAPERS, 'courtlistener'), false,
    'CourtListener needs an API key to verify a docket; it must not claim a verdict it cannot reach');
  return probeRetiredRecords({ source: 'courtlistener' }).then((summary) => {
    assert.equal(summary.unsupported, true);
    assert.equal(summary.sampled, 0);
    assert.equal(summary.notServed, 0, 'an unprobed source must not be reported as entirely dead');
  });
});

test('the probe reports served, not-served and errors separately and mutates nothing', async () => {
  const fakeScraper = {
    fetchCounties: async () => [{ id: '8', name: 'Monmouth County', state: 'NJ' }],
    fetchCountySummaries: async () => ({ sessionCookie: 'session=test' }),
    fetchText: async (url) => (url.includes('PropertyId=111')
      ? '<div>sale-details-list</div>'
      : '<div>Sales Web | Tyler Technologies</div>'),
    parseDetailPage: (html) => (html.includes('sale-details-list')
      ? { id: 'CIV-NJ-8-111', address: '1 Cranberry Court' }
      : null),
  };

  const summary = await probeRetiredRecords({
    source: 'civilview',
    baseUrl: 'http://probe.invalid',
    scraper: fakeScraper,
    fetchInventory: async () => [
      {
        id: 'CIV-NJ-8-111',
        sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=111',
      },
      {
        id: 'CIV-NJ-8-222',
        sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=222',
      },
      { id: 'servicelink:not-a-civilview-id', sourceUrl: 'https://example.invalid/x' },
    ],
  });

  assert.equal(summary.sampled, 3);
  assert.equal(summary.served, 1, 'the record the publisher really serves must be counted served');
  assert.equal(summary.notServed, 1, 'the empty shell must not be counted served');
  assert.equal(summary.errored, 1, 'an unparseable identifier is an error, not a dead record');
  assert.equal(summary.served + summary.notServed + summary.errored, summary.sampled);
});

// fetchInventory is the only network dependency; inject it so this suite never
// reaches the publisher.
const originalModule = require.cache[require.resolve('../scripts/probe-retired-records')];
test('inventory is read through an injectable fetch, so the probe is testable offline', () => {
  assert.ok(originalModule, 'the module must load for the injectable-fetch guard');
  assert.equal(typeof require('../scripts/probe-retired-records').fetchInventory, 'function');
});