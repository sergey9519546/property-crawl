'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createDocumentReviewStore,
  defaultStorePath,
  STORE_VERSION,
} = require('../server/intelligence/document-review-store');
const handleDocumentReview = require('../server/routes/document-review');
const { enumerateListingDocuments, documentId } = require('../server/routes/document-review');

const TEST_TOKEN = 'document-review-persist-token';

function makeReq({ method = 'POST', url = '/api/document-review', body = null, headers = {}, authenticated = true } = {}) {
  const listeners = { data: [], end: [], close: [], error: [] };
  const authHeaders = authenticated ? { authorization: `Bearer ${TEST_TOKEN}` } : {};
  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json', ...authHeaders, ...headers },
    socket: { destroy() {} },
    on(event, handler) { (listeners[event] ||= []).push(handler); return req; },
  };
  process.nextTick(() => {
    if (body !== null) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      listeners.data.forEach((h) => h(Buffer.from(payload)));
    }
    listeners.end.forEach((h) => h());
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

function emptyDb() {
  return { getListings: async () => ({ listings: [] }) };
}

function listingWithDocs() {
  return {
    getListings: async () => ({
      listings: [{
        id: 'L-1',
        sourceObservedAt: '2026-09-01T00:00:00.000Z',
        provenance: {
          sourceFacts: {
            documents: [
              { title: 'Notice of Sale', url: 'https://example.com/notice.pdf' },
              { title: '', url: '' },
            ],
          },
          media: {
            documents: [
              { title: 'Notice of Sale', url: 'https://example.com/notice.pdf' },
              { title: 'Appraisal', fileUrl: 'https://example.com/appraisal.pdf' },
            ],
          },
        },
      }],
    }),
  };
}

let tmpStore;

test.beforeEach(() => {
  tmpStore = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-review-')), 'reviews.json');
  process.env.SCRAPER_ADMIN_TOKEN = TEST_TOKEN;
  delete process.env.PROPERTY_OPERATOR_SECRET;
  handleDocumentReview._resetForTests({ storePath: tmpStore, env: { ...process.env, NODE_ENV: 'test' } });
});

test.afterEach(() => {
  handleDocumentReview._resetForTests({ storePath: null, env: { ...process.env, NODE_ENV: 'test' } });
  delete process.env.SCRAPER_ADMIN_TOKEN;
});

test('document review store versions and reloads atomically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-review-store-'));
  const storePath = path.join(dir, 'store.json');
  const first = createDocumentReviewStore({ storePath, env: { NODE_ENV: 'development' } });
  first.map.set('L-1~0~https://example.com/a.pdf', {
    status: 'approved',
    notes: 'ok',
    reviewer: 'op-1',
    reviewedAt: '2026-09-19T00:00:00.000Z',
    revision: 1,
    priorStatus: 'pending',
    listingId: 'L-1',
    documentIndex: 0,
    documentUrl: 'https://example.com/a.pdf',
  });
  assert.equal(first.persist(), true);
  const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(raw.version, STORE_VERSION);
  const reloaded = createDocumentReviewStore({ storePath, env: { NODE_ENV: 'development' } });
  assert.equal(reloaded.map.size, 1);
  assert.equal(reloaded.map.get('L-1~0~https://example.com/a.pdf').status, 'approved');
});

test('document review store fails closed on corrupt JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-review-corrupt-'));
  const storePath = path.join(dir, 'store.json');
  fs.writeFileSync(storePath, '{not-json');
  const store = createDocumentReviewStore({ storePath, env: { NODE_ENV: 'development' } });
  assert.equal(store.map.size, 0);
});

test('default store path is null under test env', () => {
  assert.equal(defaultStorePath({ NODE_ENV: 'test' }), null);
  assert.ok(defaultStorePath({ NODE_ENV: 'production' }).endsWith('document-review-store.json'));
});

test('POST persists review decisions across process reload', async () => {
  const post = makeReq({
    method: 'POST',
    body: {
      listingId: 'L-9',
      documentIndex: 0,
      documentUrl: 'https://example.com/doc.pdf',
      status: 'approved',
      reviewer: 'operator-1',
      notes: 'verified against publisher',
    },
  });
  const postRes = makeRes();
  await handleDocumentReview.handleDocumentReview(post, postRes, { database: emptyDb() });
  assert.equal(postRes.statusCode, 200);
  assert.equal(postRes.body.review.status, 'approved');
  assert.equal(postRes.body.persisted, true);

  // Simulate restart: new store instance from the same path.
  handleDocumentReview._resetForTests({ storePath: tmpStore, env: { ...process.env, NODE_ENV: 'test' } });
  const store = handleDocumentReview._getStore();
  assert.equal(store.map.size, 1);
  const get = makeReq({ method: 'GET', url: '/api/document-review?hydrate=false' });
  const getRes = makeRes();
  await handleDocumentReview.handleDocumentReview(get, getRes, { database: emptyDb() });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.reviews.length, 1);
  assert.equal(getRes.body.reviews[0].review.status, 'approved');
});

test('GET hydrates pending candidates from listing documents without inventing records', async () => {
  const get = makeReq({ method: 'GET', url: '/api/document-review?status=pending' });
  const getRes = makeRes();
  await handleDocumentReview.handleDocumentReview(get, getRes, { database: listingWithDocs() });
  assert.equal(getRes.statusCode, 200);
  const ids = getRes.body.reviews.map((r) => r.id);
  // Notice appears in both containers with same index+url → one candidate.
  assert.ok(ids.includes(documentId('L-1', 0, 'https://example.com/notice.pdf')));
  // Appraisal only in media container.
  assert.ok(ids.includes(documentId('L-1', 1, 'https://example.com/appraisal.pdf')));
  // Empty document object is not a queue candidate.
  assert.ok(!ids.some((id) => id.includes('~undefined') || id === documentId('L-1', 1, null)));
  assert.equal(getRes.body.hydration.pendingFromListings >= 2, true);
  assert.ok(getRes.body.reviews.every((r) => r.review.status === 'pending'));
});

test('hydrated pending candidates disappear after a stored decision', async () => {
  const id = documentId('L-1', 0, 'https://example.com/notice.pdf');
  const post = makeReq({
    method: 'POST',
    body: {
      listingId: 'L-1',
      documentIndex: 0,
      documentUrl: 'https://example.com/notice.pdf',
      status: 'rejected',
      reviewer: 'operator-1',
      notes: 'publisher URL 404',
    },
  });
  const postRes = makeRes();
  await handleDocumentReview.handleDocumentReview(post, postRes, { database: listingWithDocs() });
  assert.equal(postRes.statusCode, 200);

  const get = makeReq({ method: 'GET', url: '/api/document-review?status=pending' });
  const getRes = makeRes();
  await handleDocumentReview.handleDocumentReview(get, getRes, { database: listingWithDocs() });
  const pendingIds = getRes.body.reviews.map((r) => r.id);
  assert.ok(!pendingIds.includes(id));

  const all = makeReq({ method: 'GET', url: '/api/document-review?hydrate=false' });
  const allRes = makeRes();
  await handleDocumentReview.handleDocumentReview(all, allRes, { database: listingWithDocs() });
  const stored = allRes.body.reviews.find((r) => r.id === id);
  assert.equal(stored.review.status, 'rejected');
});

test('enumerateListingDocuments skips empty objects and requires label or url', () => {
  const docs = enumerateListingDocuments({
    id: 'L-2',
    provenance: { media: { documents: [null, {}, { title: 'Only title' }, { url: 'https://example.com/x.pdf' }] } },
  });
  assert.equal(docs.length, 2);
  assert.equal(docs[0].label, 'Only title');
  assert.equal(docs[0].documentUrl, null);
  assert.equal(docs[1].documentUrl, 'https://example.com/x.pdf');
});

test('anonymous and missing-token paths still fail closed', async () => {
  const anon = makeReq({ method: 'GET', authenticated: false });
  const anonRes = makeRes();
  await handleDocumentReview.handleDocumentReview(anon, anonRes, { database: emptyDb() });
  assert.equal(anonRes.statusCode, 401);

  delete process.env.SCRAPER_ADMIN_TOKEN;
  const noToken = makeReq({ method: 'GET' });
  const noTokenRes = makeRes();
  await handleDocumentReview.handleDocumentReview(noToken, noTokenRes, { database: emptyDb() });
  assert.equal(noTokenRes.statusCode, 503);
});
