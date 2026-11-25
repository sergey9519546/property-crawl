'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDocumentReviewStore } = require('../server/intelligence/document-review-store');
const { handleDocumentReview } = require('../server/routes/document-review');

function fakePool(existing = []) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT id, payload(?:, content_hash)? FROM document_reviews/i.test(sql)) {
        return {
          rows: existing.map((r) => ({
            id: r.id,
            payload: JSON.stringify(r.payload),
          })),
        };
      }
      return { rows: [] };
    },
  };
}

test('document-review store uses PostgreSQL backend when pool is provided', async () => {
  const pool = fakePool([{
    id: 'L-1~0',
    payload: { status: 'approved', revision: 1, listingId: 'L-1', reviewer: 'op' },
  }]);
  const store = createDocumentReviewStore({ pool, storePath: null, env: { NODE_ENV: 'test' } });
  assert.equal(store.backend, 'postgres');
  await store.loadPg();
  assert.equal(store.map.get('L-1~0').status, 'approved');
  store.map.set('L-2~0', { status: 'rejected', revision: 2, listingId: 'L-2', reviewer: 'op', notes: 'x' });
  const ok = await store.persistAsync();
  assert.equal(ok, true);
  const upserts = pool.queries.filter((q) => /INSERT INTO document_reviews/i.test(q.sql));
  assert.equal(upserts.length, 1);
  assert.match(upserts[0].sql, /UNNEST\(/i);
  const ids = upserts[0].params[0];
  assert.ok(Array.isArray(ids));
  assert.ok(ids.includes('L-2~0'));
  assert.ok(ids.includes('L-1~0'));
});

test('document-review PG store reset clears document_reviews and tracks PG errors', async () => {
  const pool = fakePool([{
    id: 'L-1~0',
    payload: { status: 'approved', revision: 1, listingId: 'L-1', reviewer: 'op' },
  }]);
  const store = createDocumentReviewStore({ pool, storePath: null, env: { NODE_ENV: 'test' } });
  await store.loadPg();
  assert.equal(store.map.size, 1);
  assert.equal(await store.resetAsync(), true);
  assert.equal(store.map.size, 0);
  assert.ok(pool.queries.some((q) => /DELETE FROM document_reviews/i.test(q.sql)));

  const failingPool = {
    async query(sql) {
      if (/INSERT INTO document_reviews/i.test(sql)) {
        throw new Error('pg write boom');
      }
      return { rows: [] };
    },
  };
  const failStore = createDocumentReviewStore({ pool: failingPool, storePath: null, env: { NODE_ENV: 'test' } });
  failStore.map.set('L-ERR~0', { status: 'approved', revision: 1, listingId: 'L-ERR' });
  failStore.persist();
  await failStore.flushPg();
  assert.equal(failStore.persistError, 'pg write boom');
});

test('document-review file store remains backend=file without pool', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-pg-file-'));
  const store = createDocumentReviewStore({ storePath: path.join(dir, 'r.json'), env: { NODE_ENV: 'development' } });
  assert.equal(store.backend, 'file');
  assert.equal(typeof store.persist(), 'boolean');
});

test('handleDocumentReview hydrates PG store once on first authenticated request', async () => {
  const pool = fakePool([{
    id: 'L-PG-1~0',
    payload: { status: 'approved', revision: 3, listingId: 'L-PG-1', reviewer: 'op', notes: 'verified' },
  }]);
  const env = { NODE_ENV: 'test', SCRAPER_ADMIN_TOKEN: 'op-secret-token' };
  const makeRes = () => {
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
    };
    return res;
  };
  const req1 = { method: 'GET', url: '/api/document-review?hydrate=false', headers: { authorization: 'Bearer op-secret-token' } };
  const req2 = { method: 'GET', url: '/api/document-review?hydrate=false', headers: { authorization: 'Bearer op-secret-token' } };
  const res1 = makeRes();
  const res2 = makeRes();

  await Promise.all([
    handleDocumentReview(req1, res1, { env, database: { pool, listListings: async () => ({ listings: [] }) } }),
    handleDocumentReview(req2, res2, { env, database: { pool, listListings: async () => ({ listings: [] }) } }),
  ]);

  assert.equal(res1.statusCode, 200);
  assert.equal(res2.statusCode, 200);
  assert.equal(res1.body.total, 1);
  assert.equal(res1.body.reviews[0].id, 'L-PG-1~0');
  assert.equal(res1.body.reviews[0].review.status, 'approved');
  const pgSelects = pool.queries.filter((q) => /SELECT id, payload/i.test(q.sql));
  assert.equal(pgSelects.length, 1);
});

test('document-review PG store reloads after writes, enforces optimistic revision 409, and never fabricates confidenceScore or OH state', async (t) => {
  const { startEmbeddedPostgres } = require('../server/db/pglite-pool');
  const pgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-rev-pg-'));
  const pg = await startEmbeddedPostgres({ dataDir: pgDir });
  t.after(async () => {
    await pg.pool.end();
    fs.rmSync(pgDir, { recursive: true, force: true });
  });

  const route = require('../server/routes/document-review');
  route._resetForTests({ pool: pg.pool, storePath: null, env: { NODE_ENV: 'test' } });
  t.after(() => route._resetForTests({ pool: null, storePath: null, env: { NODE_ENV: 'test' } }));

  const env = { NODE_ENV: 'test', SCRAPER_ADMIN_TOKEN: 'op-secret-token' };
  const makeRes = () => ({
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  });
  const makePostReq = (body) => {
    const listeners = { data: [], end: [] };
    const req = {
      method: 'POST',
      url: '/api/document-review',
      headers: { 'content-type': 'application/json', authorization: 'Bearer op-secret-token' },
      socket: { destroy() {} },
      on(ev, fn) { (listeners[ev] ||= []).push(fn); return req; },
    };
    process.nextTick(() => {
      listeners.data.forEach((fn) => fn(Buffer.from(JSON.stringify(body))));
      listeners.end.forEach((fn) => fn());
    });
    return req;
  };

  // Hydration must NOT fabricate confidenceScore from dealScore / 100
  const dbWithListing = {
    isPg: true,
    pool: pg.pool,
    getListings: async () => ({
      listings: [{
        id: 'L-CONF-1',
        dealScore: 85,
        provenance: { sourceFacts: { documents: [{ url: 'https://example.com/notice.pdf', title: 'Notice' }] } },
      }],
    }),
  };
  const getHydrateRes = makeRes();
  await handleDocumentReview(
    { method: 'GET', url: '/api/document-review', headers: { authorization: 'Bearer op-secret-token' } },
    getHydrateRes,
    { env, database: dbWithListing }
  );
  assert.equal(getHydrateRes.statusCode, 200);
  assert.equal(getHydrateRes.body.reviews[0].extractedFields.confidenceScore, null);

  // First POST creates revision 1 and must NOT default missing state to 'OH'
  const post1Res = makeRes();
  await handleDocumentReview(
    makePostReq({ listingId: 'L-CONF-1', documentIndex: 0, status: 'approved', reviewer: 'op-1', notes: 'verified' }),
    post1Res,
    { env, database: dbWithListing }
  );
  assert.equal(post1Res.statusCode, 200);
  assert.equal(post1Res.body.review.revision, 1);
  assert.equal(post1Res.body.listing.state, null);

  // Stale revision POST must return 409 Conflict
  const conflictRes = makeRes();
  await handleDocumentReview(
    makePostReq({ listingId: 'L-CONF-1', documentIndex: 0, status: 'rejected', revision: 0, reviewer: 'op-2', notes: 'stale' }),
    conflictRes,
    { env, database: dbWithListing }
  );
  assert.equal(conflictRes.statusCode, 409);

  // Direct external PG update must be visible on subsequent GET (loadPg not cached forever)
  await pg.pool.query(
    `UPDATE document_reviews SET status = 'rejected', revision = 2, payload = jsonb_set(payload, '{status}', '"rejected"') WHERE id = $1`,
    ['L-CONF-1~0']
  );
  const getAfterExternalRes = makeRes();
  await handleDocumentReview(
    { method: 'GET', url: '/api/document-review?hydrate=false', headers: { authorization: 'Bearer op-secret-token' } },
    getAfterExternalRes,
    { env, database: dbWithListing }
  );
  assert.equal(getAfterExternalRes.statusCode, 200);
  assert.equal(getAfterExternalRes.body.reviews[0].review.status, 'rejected');
});
