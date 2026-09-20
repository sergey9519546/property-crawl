'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDocumentReviewStore } = require('../server/intelligence/document-review-store');

function fakePool(existing = []) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT id, payload FROM document_reviews/i.test(sql)) {
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
  assert.ok(upserts.length >= 1);
  const ids = upserts.map((q) => q.params[0]);
  assert.ok(ids.includes('L-2~0'));
  assert.ok(ids.includes('L-1~0'));
});

test('document-review file store remains backend=file without pool', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-pg-file-'));
  const store = createDocumentReviewStore({ storePath: path.join(dir, 'r.json'), env: { NODE_ENV: 'development' } });
  assert.equal(store.backend, 'file');
  assert.equal(typeof store.persist(), 'boolean');
});
