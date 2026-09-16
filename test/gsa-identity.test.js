'use strict';

// See gsa-scrapling-integration.test.js for why this override is required.
// The robots guard at the top of scrapeFeed is intentional in production;
// tests that stub fetch methods opt into the bypass.
process.env.SCRAPER_RESPECT_ROBOTS = '0';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GsaSurplusScraper } = require('../server/scrapers/gsa');

const scraper = new GsaSurplusScraper({ useScrapling: false });

test('GSA identity accepts established publisher sale-number formats', () => {
  assert.deepEqual(scraper.publisherIdentifiers('<p>Sale Number: 726LA058501</p>', '41'), {
    saleNo: '726LA058501',
    caseNo: '',
    recordId: '726LA058501',
    identityBasis: 'sale_number',
    rejectedCandidates: []
  });
  assert.equal(scraper.publisherIdentifiers('<p>Sale Number: 126RI034401</p>', '27').recordId, '126RI034401');
  assert.equal(scraper.publisherIdentifiers('<p>Sale Number: FIXTURE123.</p>', '27').recordId, 'FIXTURE123');
});

test('GSA identity rejects Block prose and preserves it as conflict evidence', () => {
  const result = scraper.publisherIdentifiers('<p>Sale Number: Block 3 is offered separately.</p>', '43');
  assert.equal(result.recordId, '43');
  assert.equal(result.identityBasis, 'property_id');
  assert.deepEqual(result.rejectedCandidates, [{ field: 'saleNumber', value: 'Block' }]);
});

test('GSA identity prefers a valid sale number, then case number, then property_id', () => {
  assert.equal(scraper.publisherIdentifiers('Case Number: CASE-9001 Sale Number: Block', '43').recordId, 'CASE-9001');
  assert.equal(scraper.publisherIdentifiers('Case Number: OLD-100 Sale Number: NEW-200', '43').recordId, 'NEW-200');
  assert.equal(scraper.publisherIdentifiers('No numbered publisher identifier', '43').recordId, '43');
});

test('GSA detail emits property_id identity and rejected candidate provenance offline', async () => {
  const native = new GsaSurplusScraper({ useScrapling: false });
  native.fetchText = async () => `<input name="tour_property_address" value="149 West Broad Street">
    <input name="tour_property_city" value="Bridgeton">
    <input name="tour_property_state" value="New Jersey">
    <input name="tour_property_zipcode" value="08302">
    <p>Sale Number: Block 3 is offered separately.</p>`;
  const listing = await native.fetchDetail('43', 50000);
  assert.equal(listing.id, 'GSA-43');
  assert.equal(listing.provenance.recordId, '43');
  assert.equal(listing.provenance.sourceFacts.identityBasis, 'property_id');
  assert.deepEqual(listing.provenance.sourceFacts.rejectedIdentifierCandidates, [{ field: 'saleNumber', value: 'Block' }]);
});
