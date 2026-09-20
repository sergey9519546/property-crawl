'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDocumentReviewStore } = require('../server/intelligence/document-review-store');
const route = require('../server/routes/document-review');

function makeReq(body) {
  const listeners = { data: [], end: [], close: [], error: [] };
  const req = {
    method: 'POST',
    url: '/api/document-review',
    headers: { authorization: 'Bearer lock-token', 'content-type': 'application/json' },
    socket: { destroy() {} },
    body,
    on(event, handler) { (listeners[event] ||= []).push(handler); return req; },
  };
  process.nextTick(() => { listeners.end.forEach((h) => h()); });
  return req;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    setHeader() { return res; },
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; },
  };
  return res;
}

test('document-review store persist fails closed when lock is held', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-review-lock-'));
  const storePath = path.join(dir, 'reviews.json');
  const store = createDocumentReviewStore({ storePath, env: { NODE_ENV: 'development' } });
  store.map.set('L-1', { status: 'approved', revision: 1 });
  assert.equal(store.persist(), true);
  // Hold the lock as another writer would.
  const lockPath = `${storePath}.lock`;
  fs.writeFileSync(lockPath, 'held');
  assert.equal(store.persist(), false);
  fs.unlinkSync(lockPath);
  assert.equal(store.persist(), true);
});

test('failed persist rolls back in-memory review so GET cannot lie', async () => {
  process.env.SCRAPER_ADMIN_TOKEN = 'lock-token';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-review-rollback-'));
  const storePath = path.join(dir, 'reviews.json');
  route._resetForTests({ storePath, env: { ...process.env, NODE_ENV: 'development' } });
  fs.writeFileSync(`${storePath}.lock`, 'held');
  const res = makeRes();
  await route.handleDocumentReview(
    makeReq({ listingId: 'L-ROLLBACK', status: 'approved', reviewer: 'op', notes: 'ok' }),
    res,
    { database: { getListings: async () => ({ listings: [] }) } }
  );
  assert.equal(res.statusCode, 503);
  assert.equal(route._getStore().map.has('L-ROLLBACK'), false);
  const getRes = makeRes();
  await route.handleDocumentReview(
    { method: 'GET', url: '/api/document-review?hydrate=false', headers: { authorization: 'Bearer lock-token' }, socket: { destroy() {} }, on() { return this; } },
    getRes,
    { database: { getListings: async () => ({ listings: [] }) } }
  );
  assert.equal(getRes.statusCode, 200);
  assert.equal((getRes.body.reviews || []).some((r) => r.listingId === 'L-ROLLBACK'), false);
  fs.unlinkSync(`${storePath}.lock`);
  route._resetForTests({ storePath: null, env: { ...process.env, NODE_ENV: 'test' } });
  delete process.env.SCRAPER_ADMIN_TOKEN;
});

test('HTTP POST rejects illegal terminal->pending transition', async () => {
  process.env.SCRAPER_ADMIN_TOKEN = 'lock-token';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-review-http-trans-'));
  const storePath = path.join(dir, 'reviews.json');
  route._resetForTests({ storePath, env: { ...process.env, NODE_ENV: 'development' } });
  const ok = makeRes();
  await route.handleDocumentReview(
    makeReq({ listingId: 'L-T', status: 'approved', reviewer: 'op', notes: 'ok' }),
    ok,
    { database: { getListings: async () => ({ listings: [] }) } }
  );
  assert.equal(ok.statusCode, 200);
  const bad = makeRes();
  await route.handleDocumentReview(
    makeReq({ listingId: 'L-T', status: 'pending' }),
    bad,
    { database: { getListings: async () => ({ listings: [] }) } }
  );
  assert.equal(bad.statusCode, 422);
  assert.match(bad.body.error, /state:/);
  route._resetForTests({ storePath: null, env: { ...process.env, NODE_ENV: 'test' } });
  delete process.env.SCRAPER_ADMIN_TOKEN;
});
