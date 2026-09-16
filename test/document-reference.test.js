'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDocumentReferences,
  isHttpUrl,
  ALLOWED_KINDS
} = require('../server/scrapers/document-reference');

test('isHttpUrl accepts http and https with no credentials', () => {
  assert.equal(isHttpUrl('https://example.com/docket/1/'), true);
  assert.equal(isHttpUrl('http://example.com/'), true);
  assert.equal(isHttpUrl('https://user:pass@example.com/'), false);
  assert.equal(isHttpUrl('ftp://example.com/'), false);
  assert.equal(isHttpUrl('not-a-url'), false);
  assert.equal(isHttpUrl(null), false);
  assert.equal(isHttpUrl(undefined), false);
});

test('ALLOWED_KINDS exposes the documented kinds', () => {
  assert.ok(ALLOWED_KINDS.has('docket'));
  assert.ok(ALLOWED_KINDS.has('feature'));
  assert.ok(ALLOWED_KINDS.has('parcel'));
  assert.ok(ALLOWED_KINDS.has('filings'));
  assert.ok(ALLOWED_KINDS.has('detail'));
  assert.ok(ALLOWED_KINDS.has('reference'));
  assert.equal(ALLOWED_KINDS.has('sale-bill'), false);
});

test('buildDocumentReferences returns a normalized list with observedAt and accessState defaults', () => {
  const observedAt = '2026-09-15T12:00:00.000Z';
  const refs = buildDocumentReferences([
    { kind: 'docket', url: 'https://www.courtlistener.com/docket/123/', label: 'Docket 123' }
  ], { observedAt });
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, 'docket');
  assert.equal(refs[0].url, 'https://www.courtlistener.com/docket/123/');
  assert.equal(refs[0].label, 'Docket 123');
  assert.equal(refs[0].observedAt, observedAt);
  assert.equal(refs[0].accessState, 'public');
});

test('buildDocumentReferences drops entries with unknown kinds, missing URLs, or non-HTTP URLs', () => {
  const refs = buildDocumentReferences([
    { kind: 'sale-bill', url: 'https://example.com/x' }, // unknown kind
    { kind: 'docket', url: null },                         // missing url
    { kind: 'docket', url: 'ftp://example.com/' },        // non-http
    { kind: 'feature', url: 'https://example.com/feature/1' }, // valid
    null,                                                   // not an object
    'string-entry'                                          // not an object
  ]);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, 'feature');
});

test('buildDocumentReferences uses the provided fallback when observedAt is missing per-entry', () => {
  const refs = buildDocumentReferences([
    { kind: 'reference', url: 'https://example.com/' }
  ], { now: () => '2026-09-15T13:00:00.000Z' });
  assert.equal(refs[0].observedAt, '2026-09-15T13:00:00.000Z');
});

test('buildDocumentReferences truncates labels longer than 200 characters', () => {
  const longLabel = 'A'.repeat(500);
  const refs = buildDocumentReferences([{ kind: 'docket', url: 'https://example.com/', label: longLabel }]);
  assert.ok(refs[0].label.length <= 200);
});

test('CourtListener sourceFacts.documents surfaces a docket reference for each emitted record', async () => {
  const { CourtListenerScraper } = require('../server/scrapers/courtlistener');
  const scraper = new CourtListenerScraper({
    apiKey: 'test',
    apiRoot: 'https://example.test/api/rest/v4',
    docketUrlRoot: 'https://example.test/docket'
  });
  const observedAt = '2026-09-15T12:00:00.000Z';
  const result = {
    docket_id: 12345,
    docketNumber: '1:25-cv-00001',
    court: 'test-court',
    court_id: 'test-court',
    dateFiled: '2026-01-15',
    caseName: 'Test v. Test',
    pacer_case_id: null
  };
  const listing = scraper.mapDocket(result, { queryUrl: 'https://example.test/api/rest/v4/search?q=foreclosure', observedAt });
  assert.ok(listing);
  const docs = listing.provenance.sourceFacts.documents;
  assert.ok(Array.isArray(docs));
  assert.equal(docs.length, 1);
  assert.equal(docs[0].kind, 'docket');
  assert.match(docs[0].url, /^https:\/\/example\.test\/docket\/12345\//);
  assert.match(docs[0].label, /CourtListener docket 1:25-cv-00001/);
});

test('FL DOR cadastral sourceFacts.documents surfaces feature + parcel references', () => {
  const { FlDorCadastralScraper } = require('../server/scrapers/fl-dor-cadastral');
  const scraper = new FlDorCadastralScraper({ serviceRoot: 'https://services9.arcgis.test/feature/0' });
  const observedAt = '2026-09-15T12:00:00.000Z';
  const feature = {
    attributes: {
      OBJECTID: 9999,
      PARCEL_ID: '12-34-56-0000-0000',
      PHY_ADDR1: '1 Test Lane',
      PHY_CITY: 'TESTVILLE',
      PHY_ZIPCD: '32601',
      CO_NO: 12,
      ASMNT_YR: 2026,
      JUST_VALUE: 250000,
      DOR_UC: '0100',
      PA_UC: '0100'
    }
  };
  const listing = scraper.mapFeature(feature, { queryUrl: 'https://services9.arcgis.test/feature/0/query?where=1=1', observedAt });
  assert.ok(listing);
  const docs = listing.provenance.sourceFacts.documents;
  assert.ok(Array.isArray(docs));
  assert.equal(docs.length, 2);
  const kinds = docs.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ['feature', 'parcel']);
  assert.ok(docs.some((d) => d.kind === 'feature' && d.url.includes('/9999')));
  assert.ok(docs.some((d) => d.kind === 'parcel' && /12-34-56/.test(d.label || '')));
});
