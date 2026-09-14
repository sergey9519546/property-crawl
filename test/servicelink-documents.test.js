'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ServiceLinkScraper, publisherDocuments } = require('../server/scrapers/servicelink');
const { buildDocumentEvidence } = require('../server/intelligence/document-evidence');

const observedAt = '2026-09-12T12:00:00.000Z';
const sourceUrl = 'https://www.servicelinkauction.com/property-details/10-main-street-test-90001-ca-united-states-tps';

function record(documents, include = true) {
  return {
    listingId: 'record-doc-1', auctionProgram: 'TPS',
    propertyInfo: { websiteUrl: sourceUrl, address: '10 Main Street', city: 'Test', county: 'Test', state: 'CA', postalCode: '90001' },
    listingStatus: { statusText: 'Active' },
    ...(include ? { documents } : {})
  };
}

test('ServiceLink preserves observed publisher document aliases and binds them to the listing observation', () => {
  const input = [{ title: 'Property Report', fileUrl: 'https://www.servicelinkauction.com/auction-documents/report.pdf', thumbnailUrl: 'https://www.servicelinkauction.com/assets/images/document_100.png' },
    { documentName: 'Purchase Agreement', documentURL: 'https://www.servicelinkauction.com/auction-documents/agreement.pdf' }];
  const listing = new ServiceLinkScraper().toListing(record(input), observedAt);
  assert.equal(listing.provenance.sourceFacts.documents.length, 2);
  assert.deepEqual(listing.provenance.sourceFacts.documents[0], { title: 'Property Report', fileUrl: input[0].fileUrl, thumbnailUrl: input[0].thumbnailUrl, observedAt });
  assert.deepEqual(listing.provenance.sourceFacts.documents[1], { documentName: 'Purchase Agreement', documentURL: input[1].documentURL, observedAt });
  const evidence = buildDocumentEvidence(listing);
  assert.equal(evidence.status, 'observed');
  assert.equal(evidence.count, 2);
  assert.equal(evidence.items[1].label, 'Purchase Agreement');
  assert.equal(evidence.items[1].url, input[1].documentURL);
  assert.equal(evidence.items[1].observedAt, observedAt);
});

test('ServiceLink distinguishes an explicit empty document array from an absent field', () => {
  const scraper = new ServiceLinkScraper();
  const empty = scraper.toListing(record([]), observedAt);
  const absent = scraper.toListing(record(undefined, false), observedAt);
  assert.deepEqual(empty.provenance.sourceFacts.documents, []);
  assert.equal(Object.hasOwn(absent.provenance.sourceFacts, 'documents'), false);
  assert.equal(buildDocumentEvidence(empty).count, 0);
  assert.equal(buildDocumentEvidence(absent).count, null);
});

test('ServiceLink document capture rejects cross-host and credential-bearing URLs without inventing replacements', () => {
  const documents = publisherDocuments(record([]), sourceUrl, observedAt);
  assert.deepEqual(documents, []);
  const captured = publisherDocuments(record([{ title: 'Terms', fileUrl: 'https://attacker.example/terms.pdf', documentUrl: 'https://user:pass@www.servicelinkauction.com/terms.pdf' }]), sourceUrl, observedAt);
  assert.deepEqual(captured, [{ title: 'Terms', observedAt }]);
});
