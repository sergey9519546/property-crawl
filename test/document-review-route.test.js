const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const handleDocumentReview = require('../server/routes/document-review');
const { REVIEW_STATES } = require('../server/intelligence/document-review');

function makeReq({ method = 'POST', url = '/api/document-review', body = null, headers = {} } = {}) {
  const listeners = { data: [], end: [], close: [], error: [] };
  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers },
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

beforeEach(() => {
  handleDocumentReview._resetForTests();
});

afterEach(() => {
  handleDocumentReview._resetForTests();
});

test('GET /api/document-review with no reviews returns empty list and zero counts', async () => {
  const req = makeReq({ method: 'GET' });
  const res = makeRes();
  await handleDocumentReview(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    total: 0,
    byStatus: { pending: 0, approved: 0, rejected: 0, needs_more: 0 },
    reviews: [],
  });
});

test('POST /api/document-review with invalid JSON returns 400', async () => {
  const req = makeReq({ method: 'POST', body: 'not-json' });
  const res = makeRes();
  await handleDocumentReview(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /invalid JSON body/);
});

test('POST /api/document-review without listingId returns 400', async () => {
  const req = makeReq({ method: 'POST', body: { status: 'approved', reviewer: 'op-7', notes: 'ok' } });
  const res = makeRes();
  await handleDocumentReview(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /listingId is required/);
});

test('POST /api/document-review with valid approval returns the new review', async () => {
  const req = makeReq({ method: 'POST', body: { listingId: 'CIV-NJ-1', documentIndex: 0, status: 'approved', reviewer: 'op-7', notes: 'looks fine' } });
  const res = makeRes();
  await handleDocumentReview(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.listingId, 'CIV-NJ-1');
  assert.equal(res.body.review.status, REVIEW_STATES.APPROVED);
  assert.equal(res.body.review.reviewer, 'op-7');
  assert.equal(res.body.review.notes, 'looks fine');
  assert.equal(res.body.review.priorStatus, REVIEW_STATES.PENDING);
});

test('POST /api/document-review advances from pending to approved and increments revision', async () => {
  // First: create the review by approving directly
  const req1 = makeReq({ method: 'POST', body: { listingId: 'CIV-NJ-1', status: 'approved', reviewer: 'op-7', notes: 'ok' } });
  const res1 = makeRes();
  await handleDocumentReview(req1, res1);
  const initialReview = res1.body.review;
  assert.equal(initialReview.revision, 1);
  assert.equal(initialReview.priorStatus, REVIEW_STATES.PENDING);

  // Then: re-confirm — should preserve revision and reviewedAt
  const req2 = makeReq({ method: 'POST', body: { listingId: 'CIV-NJ-1', status: 'approved', reviewer: 'op-7', notes: 'confirmed' } });
  const res2 = makeRes();
  await handleDocumentReview(req2, res2);
  assert.equal(res2.body.review.revision, 1);
  assert.equal(res2.body.review.notes, 'confirmed');
  assert.equal(res2.body.review.priorStatus, REVIEW_STATES.PENDING);

  // Then: transition to rejected — should increment revision
  const req3 = makeReq({ method: 'POST', body: { listingId: 'CIV-NJ-1', status: 'rejected', reviewer: 'op-7', notes: 'actually wrong' } });
  const res3 = makeRes();
  await handleDocumentReview(req3, res3);
  assert.equal(res3.body.review.revision, 2);
  assert.equal(res3.body.review.status, REVIEW_STATES.REJECTED);
  assert.equal(res3.body.review.priorStatus, REVIEW_STATES.APPROVED);
});

test('POST /api/document-review without reviewer for terminal status returns 422', async () => {
  const req = makeReq({ method: 'POST', body: { listingId: 'CIV-NJ-1', status: 'approved', notes: 'ok' } });
  const res = makeRes();
  await handleDocumentReview(req, res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /reviewer:/);
});

test('POST /api/document-review without note for rejected returns 422', async () => {
  const req = makeReq({ method: 'POST', body: { listingId: 'CIV-NJ-1', status: 'rejected', reviewer: 'op-7' } });
  const res = makeRes();
  await handleDocumentReview(req, res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /note:/);
});

test('POST /api/document-review without body returns 400 listingId required', async () => {
  const req = makeReq({ method: 'POST', body: null });
  const res = makeRes();
  await handleDocumentReview(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /listingId is required/);
});

test('GET /api/document-review?status=pending returns only pending reviews', async () => {
  // Create one approved review and one pending review (with valid input).
  const req1 = makeReq({ method: 'POST', body: { listingId: 'CIV-NJ-1', status: 'approved', reviewer: 'op-7', notes: 'ok' } });
  const res1 = makeRes();
  await handleDocumentReview(req1, res1);
  assert.equal(res1.statusCode, 200);

  // Seed the second review as pending via a state-changing POST then revert
  // its prior status; alternatively just POST with pending (the pure module
  // accepts pending without reviewer).
  const req2 = makeReq({ method: 'POST', body: { listingId: 'CIV-NJ-2', status: 'pending' } });
  const res2 = makeRes();
  await handleDocumentReview(req2, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.review.status, REVIEW_STATES.PENDING);

  // Query pending
  const reqGet = makeReq({ method: 'GET', url: '/api/document-review?status=pending' });
  const resGet = makeRes();
  await handleDocumentReview(reqGet, resGet);
  assert.equal(resGet.body.total, 2);
  assert.equal(resGet.body.byStatus.pending, 1);
  assert.equal(resGet.body.byStatus.approved, 1);
  assert.equal(resGet.body.reviews.length, 1);
  assert.equal(resGet.body.reviews[0].status, REVIEW_STATES.PENDING);
});

test('GET /api/document-review with unknown status returns empty filtered list', async () => {
  const req = makeReq({ method: 'POST', body: { listingId: 'CIV-NJ-1', status: 'approved', reviewer: 'op-7', notes: 'ok' } });
  await handleDocumentReview(req, makeRes());

  const reqGet = makeReq({ method: 'GET', url: '/api/document-review?status=unknown' });
  const resGet = makeRes();
  await handleDocumentReview(reqGet, resGet);
  assert.equal(resGet.body.reviews.length, 0);
  assert.equal(resGet.body.total, 1);
  assert.equal(resGet.body.byStatus.approved, 1);
});

test('GET /api/document-review/:id returns the matching review', async () => {
  const postReq = makeReq({ method: 'POST', body: { listingId: 'CIV-NJ-1', documentIndex: 0, status: 'approved', reviewer: 'op-7', notes: 'ok' } });
  const postRes = makeRes();
  await handleDocumentReview(postReq, postRes);
  const id = postRes.body.id;

  const getReq = makeReq({ method: 'GET', url: `/api/document-review/${id}` });
  const getRes = makeRes();
  await handleDocumentReview(getReq, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.id, id);
  assert.equal(getRes.body.review.status, REVIEW_STATES.APPROVED);
});

test('GET /api/document-review/:id returns 404 when no such review', async () => {
  const req = makeReq({ method: 'GET', url: '/api/document-review/no-such-id' });
  const res = makeRes();
  await handleDocumentReview(req, res);
  assert.equal(res.statusCode, 404);
});

test('unsupported method returns 405', async () => {
  const req = makeReq({ method: 'DELETE' });
  const res = makeRes();
  await handleDocumentReview(req, res);
  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body.allowed, ['GET', 'POST']);
});

test('listingId is whitespace-trimmed and length-capped', async () => {
  // Single rep padded; trim only strips outer whitespace.
  const padded = '  CIV-NJ-1  ';
  const req = makeReq({ method: 'POST', body: { listingId: padded, status: 'approved', reviewer: 'op-7', notes: 'ok' } });
  const res = makeRes();
  await handleDocumentReview(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.listingId, 'CIV-NJ-1');
});

test('listingId longer than MAX_LISTING_ID_LENGTH is truncated', async () => {
  const long = 'A'.repeat(500);
  const req = makeReq({ method: 'POST', body: { listingId: long, status: 'approved', reviewer: 'op-7', notes: 'ok' } });
  const res = makeRes();
  await handleDocumentReview(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.listingId.length, 200);
  assert.equal(res.body.listingId, 'A'.repeat(200));
});
