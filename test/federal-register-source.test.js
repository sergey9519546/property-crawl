'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadStore } = require('../server/sources/store');
const {
  MAX_PER_PAGE,
  buildFederalRegisterUrl,
  collectFederalNotices,
  isExactFederalRegisterDocumentUrl,
} = require('../server/sources/federal-register');

const NOW = '2026-09-05T12:00:00.000Z';

function temporaryStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'federal-register-source-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'intake.json');
}

test('queries the fixed official API and queues both disposition and non-offer notices for review', async (t) => {
  const storePath = temporaryStore(t);
  let requestedUrl;
  const payload = {
    count: 3,
    results: [
      {
        document_number: '2026-12345',
        title: 'Notice of Proposed Sale of Federal Real Property',
        abstract: 'The agency announces a public sale of surplus real property.',
        publication_date: '2026-09-04',
        type: 'Notice',
        agencies: [{ name: 'General Services Administration', raw_name: 'General Services Administration' }],
        html_url: 'https://www.federalregister.gov/documents/2026/09/04/2026-12345/proposed-sale',
        json_url: 'https://www.federalregister.gov/documents/2026/09/04/2026-12345/proposed-sale.json',
      },
      {
        document_number: '2026-23456',
        title: 'Agency Real Property Advisory Committee Meeting',
        abstract: 'The committee will discuss a real property management report.',
        publication_date: '2026-09-03',
        type: 'Notice',
        agencies: [{ name: 'Department of the Interior' }],
        html_url: 'https://www.federalregister.gov/documents/2026/09/03/2026-23456/advisory-committee-meeting',
      },
      {
        document_number: '2026-34567',
        title: 'Invalid location must not be admitted',
        html_url: 'https://example.test/documents/2026-34567',
      },
    ],
  };

  const result = await collectFederalNotices({
    storePath,
    now: NOW,
    perPage: MAX_PER_PAGE,
    daysBack: 30,
    request: async (url) => {
      requestedUrl = new URL(url);
      return JSON.stringify(payload);
    },
  });

  assert.equal(requestedUrl.origin, 'https://www.federalregister.gov');
  assert.equal(requestedUrl.pathname, '/api/v1/documents.json');
  assert.equal(requestedUrl.searchParams.get('conditions[term]'), 'real property');
  assert.equal(requestedUrl.searchParams.get('conditions[publication_date][gte]'), '2026-08-06');
  assert.equal(requestedUrl.searchParams.get('conditions[type][]'), 'NOTICE');
  assert.equal(requestedUrl.searchParams.get('per_page'), '20');
  assert.equal(result.found, 3);
  assert.equal(result.submitted, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.references.map((item) => item.classification), [
    'possible_real_property_disposition',
    'real_property_notice_requires_review',
  ]);

  const queued = loadStore(storePath).records;
  assert.equal(queued.length, 2);
  assert.ok(queued.every((record) => record.sourceId === 'federal-register'));
  assert.ok(queued.every((record) => record.status === 'needs_review'));
  assert.ok(queued.every((record) => record.kind === 'json'));
  assert.ok(queued.every((record) => record.original.records[0].inventoryStatus === 'notice_only_not_an_active_property_listing'));
  assert.equal(queued[1].original.records[0].classification, 'real_property_notice_requires_review');

  const repeated = await collectFederalNotices({
    storePath,
    now: NOW,
    request: async () => JSON.stringify(payload),
  });
  assert.equal(repeated.deduplicated, 2);
  assert.equal(loadStore(storePath).records.length, 2);
});

test('uses fetchTextWithPolicy with a fixed public endpoint when supplied a fetch implementation', async (t) => {
  const storePath = temporaryStore(t);
  let calledUrl;
  const result = await collectFederalNotices({
    storePath,
    now: NOW,
    perPage: 1,
    fetchImpl: async (url) => {
      calledUrl = new URL(url);
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(calledUrl.origin, 'https://www.federalregister.gov');
  assert.equal(calledUrl.pathname, '/api/v1/documents.json');
  assert.equal(result.submitted, 0);
});

test('bounds query values and admits only Federal Register document references', () => {
  const url = new URL(buildFederalRegisterUrl({ perPage: 20, daysBack: 366, now: NOW }));
  assert.equal(url.searchParams.get('per_page'), '20');
  assert.equal(url.searchParams.get('conditions[publication_date][gte]'), '2025-09-04');
  assert.equal(isExactFederalRegisterDocumentUrl('https://www.federalregister.gov/documents/2026/09/04/2026-12345/example'), true);
  assert.equal(isExactFederalRegisterDocumentUrl('http://www.federalregister.gov/documents/2026/example'), false);
  assert.equal(isExactFederalRegisterDocumentUrl('https://www.federalregister.gov.evil.test/documents/2026/example'), false);
});
