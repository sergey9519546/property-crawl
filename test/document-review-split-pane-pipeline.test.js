'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, test } = require('node:test');

const { standardizeEmailNoticeListing } = require('../server/sources/email-notices');
const { DocumentVault, defaultVault } = require('../server/storage/document-vault');
const route = require('../server/routes/document-review');
const { enumerateListingDocuments } = route;

const TEST_TOKEN = 'split-pane-pipeline-test-token';

function makeReq({ method = 'GET', url = '/api/document-review', body = null, headers = {}, authenticated = true } = {}) {
  const listeners = { data: [], end: [], close: [], error: [] };
  const authHeaders = authenticated
    ? { authorization: `Bearer ${TEST_TOKEN}` }
    : {};
  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json', ...authHeaders, ...headers },
    socket: { destroy() { /* noop */ } },
    on(event, handler) { (listeners[event] ||= []).push(handler); return req; },
  };
  process.nextTick(() => {
    if (body !== null) {
      listeners.data.forEach(h => h(typeof body === 'string' ? Buffer.from(body) : Buffer.from(JSON.stringify(body))));
    }
    listeners.end.forEach(h => h());
  });
  return req;
}

function makeRes() {
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; res.headers['content-type'] = 'application/json'; return res; },
    end(chunk) { if (chunk !== undefined) res.body = res.body === null ? chunk : res.body; return res; },
  };
  return res;
}

let tmpStore;
let tmpVaultDir;
let customVault;

beforeEach(() => {
  process.env.SCRAPER_ADMIN_TOKEN = TEST_TOKEN;
  delete process.env.PROPERTY_OPERATOR_SECRET;
  tmpStore = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-review-pipeline-')), 'reviews.json');
  tmpVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-vault-pipeline-'));
  customVault = new DocumentVault({ vaultDir: tmpVaultDir });
  route._resetForTests({ storePath: tmpStore, env: { ...process.env, NODE_ENV: 'test' } });
});

afterEach(() => {
  route._resetForTests({ storePath: null, env: { ...process.env, NODE_ENV: 'test' } });
  delete process.env.SCRAPER_ADMIN_TOKEN;
  try {
    fs.rmSync(tmpVaultDir, { recursive: true, force: true });
  } catch (_) {}
});

test('standardizeEmailNoticeListing produces document evidence with rawText, evidenceSpans, and vault archival', () => {
  const rawNotice = `NOTICE OF SHERIFF'S SALE
Case No. 2026-CV-4491
Bank of America, N.A. vs. Jane Doe
Judgment: $185,000.00
Opening Bid: $120,000.00
Sale Date: 2026-11-15 10:00 AM
Parcel ID: 042-881-992
Property Address: 742 Evergreen Terrace, Springfield, OH 45501`;

  const evidenceSpans = {
    caseNumber: { quote: '2026-CV-4491', start: 35, end: 47, verified: true },
    plaintiff: { quote: 'Bank of America, N.A.', start: 48, end: 69, verified: true },
    defendant: { quote: 'Jane Doe', start: 74, end: 82, verified: true },
    judgment: { quote: '$185,000.00', start: 93, end: 104, verified: true },
    openingBid: { quote: '$120,000.00', start: 118, end: 129, verified: true },
  };

  const parsed = {
    case_number: '2026-CV-4491',
    plaintiff_or_seller: 'Bank of America, N.A.',
    defendant: 'Jane Doe',
    judgment_amount: 185000,
    opening_bid: 120000,
    sale_date: '2026-11-15T10:00:00Z',
    property_address: '742 Evergreen Terrace, Springfield, OH 45501',
    city: 'Springfield',
    county: 'Clark',
    state: 'OH',
    zip: '45501',
    evidence_spans: evidenceSpans,
    confidence_score: 0.95,
  };

  const meta = {
    state: 'OH',
    rawSnippet: rawNotice,
    emailId: 'msg-999',
    emailSubject: 'Legal Notice Publication - 2026-CV-4491',
    sender: 'legalnotices@ohiocan.org',
  };

  const listing = standardizeEmailNoticeListing(parsed, meta);

  assert.ok(listing.id.startsWith('email-notice-oh-'));
  assert.equal(listing.openingBid, 120000);
  assert.equal(listing.judgment, 185000);
  assert.equal(listing.defendant, 'Jane Doe');
  assert.equal(listing.plaintiff, 'Bank of America, N.A.');

  const docs = listing.provenance?.sourceFacts?.documents;
  assert.ok(Array.isArray(docs), 'provenance.sourceFacts.documents must be an array');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].title, 'Statutory Legal Notice Evidence - 2026-CV-4491');
  assert.equal(docs[0].rawText, rawNotice);
  assert.deepEqual(docs[0].evidenceSpans, evidenceSpans);
  assert.equal(docs[0].confidenceScore, 0.95);

  // Check that defaultVault stored the rawSnippet
  const vaulted = defaultVault.getDocumentSync(`reviews/${encodeURIComponent(listing.id)}.txt`);
  assert.ok(vaulted, 'Document should be stored in defaultVault');
  assert.equal(vaulted.data.toString('utf8'), rawNotice);
});

test('enumerateListingDocuments extracts rawText and evidenceSpans from listing documents', () => {
  const rawNotice = 'NOTICE OF SHERIFF SALE Case #2026-001';
  const evidenceSpans = { caseNumber: { quote: '2026-001', start: 29, end: 37, verified: true } };

  const listing = {
    id: 'LIST-456',
    raw: 'raw-listing-body',
    provenance: {
      sourceFacts: {
        caseNumber: '2026-001',
        documents: [
          {
            title: 'Sheriff Sale Notice',
            url: 'https://example.com/notices/456.html',
            rawText: rawNotice,
            evidenceSpans,
            confidenceScore: 0.88,
          },
        ],
      },
    },
  };

  const docs = enumerateListingDocuments(listing);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].listingId, 'LIST-456');
  assert.equal(docs[0].documentIndex, 0);
  assert.equal(docs[0].documentUrl, 'https://example.com/notices/456.html');
  assert.equal(docs[0].label, 'Sheriff Sale Notice');
  assert.equal(docs[0].rawText, rawNotice);
  assert.deepEqual(docs[0].evidenceSpans, evidenceSpans);
  assert.equal(docs[0].confidenceScore, 0.88);
});

test('GET /api/document-review returns rawText and extractedFields with verbatim spans', async () => {
  const rawNotice = `SHERIFF SALE NOTICE
Case No. 2026-CV-7712
Defendant: John Smith
Plaintiff: First Horizon Bank
Opening Bid: $95,000.00
Judgment: $140,000.00
Sale Date: 2026-12-01
APN: 12-34-567`;

  const evidenceSpans = {
    caseNumber: { quote: '2026-CV-7712', start: 29, end: 41, verified: true },
    defendant: { quote: 'John Smith', start: 53, end: 63, verified: true },
    plaintiff: { quote: 'First Horizon Bank', start: 75, end: 93, verified: true },
  };

  const mockListing = {
    id: 'L-7712',
    defendant: 'John Smith',
    plaintiff: 'First Horizon Bank',
    openingBid: 95000,
    judgment: 140000,
    saleDate: '2026-12-01',
    apn: '12-34-567',
    dealScore: 85,
    raw: rawNotice,
    provenance: {
      sourceFacts: {
        caseNumber: '2026-CV-7712',
        documents: [
          {
            title: 'Statutory Legal Notice',
            url: 'https://example.com/notice/L-7712',
            rawText: rawNotice,
            evidenceSpans,
            confidenceScore: 0.92,
          },
        ],
      },
    },
  };

  const database = {
    isPg: false,
    getListings: async () => ({ listings: [mockListing] }),
  };

  const req = makeReq({ method: 'GET', url: '/api/document-review?status=pending' });
  const res = makeRes();
  await route.handleDocumentReview(req, res, { database, vault: customVault });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reviews.length, 1);

  const reviewEntry = res.body.reviews[0];
  assert.equal(reviewEntry.listingId, 'L-7712');
  assert.equal(reviewEntry.rawText, rawNotice);
  assert.ok(reviewEntry.extractedFields, 'extractedFields should be present');
  assert.equal(reviewEntry.extractedFields.caseNumber, '2026-CV-7712');
  assert.equal(reviewEntry.extractedFields.defendant, 'John Smith');
  assert.equal(reviewEntry.extractedFields.plaintiff, 'First Horizon Bank');
  assert.equal(reviewEntry.extractedFields.openingBid, 95000);
  assert.equal(reviewEntry.extractedFields.judgmentAmount, 140000);
  assert.equal(reviewEntry.extractedFields.saleDate, '2026-12-01');
  assert.equal(reviewEntry.extractedFields.apn, '12-34-567');
  assert.equal(reviewEntry.extractedFields.confidenceScore, 0.92);
  assert.deepEqual(reviewEntry.extractedFields.evidenceSpans, evidenceSpans);
});

test('POST /api/document-review applies decisions, persists updatedFields, and returns them', async () => {
  const listingId = 'L-DECISION-1';
  const postBody = {
    listingId,
    documentIndex: 0,
    documentUrl: 'https://example.com/notice-1.pdf',
    status: 'approved',
    reviewer: 'operator-chief',
    notes: 'Verified notice against court docket',
    updatedFields: {
      caseNumber: '2026-CV-CORRECTED',
      openingBid: 110000,
      defendant: 'Robert Johnson',
    },
  };

  const postReq = makeReq({ method: 'POST', body: postBody });
  const postRes = makeRes();
  await route.handleDocumentReview(postReq, postRes, { database: { getListings: async () => ({ listings: [] }) }, vault: customVault });

  assert.equal(postRes.statusCode, 200);
  assert.equal(postRes.body.review.status, 'approved');
  assert.equal(postRes.body.persisted, true);
  assert.deepEqual(postRes.body.updatedFields, postBody.updatedFields);

  // Now verify GET /api/document-review returns the updatedFields and merged extractedFields
  const getReq = makeReq({ method: 'GET', url: '/api/document-review' });
  const getRes = makeRes();
  await route.handleDocumentReview(getReq, getRes, { database: { getListings: async () => ({ listings: [] }) }, vault: customVault });

  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.reviews.length, 1);
  const item = getRes.body.reviews[0];
  assert.equal(item.review.status, 'approved');
  assert.equal(item.extractedFields.caseNumber, '2026-CV-CORRECTED');
  assert.equal(item.extractedFields.openingBid, 110000);
  assert.equal(item.extractedFields.defendant, 'Robert Johnson');
});
