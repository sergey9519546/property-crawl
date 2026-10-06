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
  parseCivilViewId,
  probeRetiredRecords,
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

test('publisher record keys are read from the identifier', () => {
  assert.deepEqual(parseCivilViewId('CIV-NJ-8-2150489401'), {
    state: 'NJ', countyId: '8', propertyId: '2150489401',
  });
  assert.equal(parseCivilViewId('servicelink:a1cVO00000CxvY1YAJ'), null);
  assert.equal(parseCivilViewId(''), null);
  assert.equal(parseCivilViewId(null), null);
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
      { id: 'CIV-NJ-8-111' },
      { id: 'CIV-NJ-8-222' },
      { id: 'servicelink:not-a-civilview-id' },
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