'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const route = require('../server/routes/document-review');

function makeReq(body) {
  const listeners = { data: [], end: [], close: [], error: [] };
  const req = {
    method: 'POST',
    url: '/api/document-review',
    headers: { authorization: 'Bearer persist-fail-token', 'content-type': 'application/json' },
    socket: { destroy() {} },
    body,
    on(event, handler) { (listeners[event] ||= []).push(handler); return req; },
  };
  process.nextTick(() => {
    listeners.end.forEach((h) => h());
  });
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

test('POST document-review returns 503 when file store cannot persist', async () => {
  process.env.SCRAPER_ADMIN_TOKEN = 'persist-fail-token';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-review-ro-'));
  const storePath = path.join(dir, 'sub', 'reviews.json');
  // Parent path is a file, so mkdir of dirname will fail on persist.
  fs.writeFileSync(path.join(dir, 'sub'), 'not-a-dir');
  route._resetForTests({ storePath, env: { ...process.env, NODE_ENV: 'development' } });

  const res = makeRes();
  await route.handleDocumentReview(
    makeReq({ listingId: 'L-FAIL', status: 'approved', reviewer: 'op', notes: 'ok' }),
    res,
    { database: { getListings: async () => ({ listings: [] }) } }
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.persisted, false);
  assert.match(res.body.error, /persist/i);
  route._resetForTests({ storePath: null, env: { ...process.env, NODE_ENV: 'test' } });
  delete process.env.SCRAPER_ADMIN_TOKEN;
});
