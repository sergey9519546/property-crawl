'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const handleListings = require('../../server/routes/listings');
const discovery = require('../../server/discovery/query');

function makeMockRes(acceptEncoding = 'gzip, deflate') {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    writableEnded: false,
    bodyBuf: null,
    jsonPayload: null,
    precompressedUsed: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    on() {},
    off() {},
    removeListener() {},
    status(c) { this.statusCode = c; return this; },
    json(data) {
      this.jsonPayload = data;
      this.writableEnded = true;
    },
    end(buf) {
      this.bodyBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      this.writableEnded = true;
    },
    sendPrecompressedJson({ json, gzip }) {
      this.precompressedUsed = true;
      headers['content-type'] = 'application/json';
      if (/\bgzip\b/i.test(acceptEncoding) && gzip) {
        headers['content-encoding'] = 'gzip';
        headers['vary'] = 'Origin, Accept-Encoding';
        return this.end(gzip);
      }
      return this.end(json);
    },
  };
}

test('GET /api/listings caches precompressed JSON by revision and invalidates on bump', async () => {
  const padding = 'x'.repeat(1600);
  let revCalls = 0;
  let listCalls = 0;
  let currentRev = 'rev-1';
  const db = {
    isPg: true,
    pool: {
      async query(sql) {
        if (/discovery_listing_revision/i.test(sql)) {
          revCalls += 1;
          return { rows: [{ revision: currentRev }] };
        }
        return { rows: [] };
      },
    },
    dataMode: () => 'postgres',
    postgresReachable: true,
    async getListingsNative() {
      listCalls += 1;
      return {
        listings: [{ id: 'LST-1', source: 'sheriff', state: 'OH', county: 'Cuyahoga', address: '1 Main St', notes: padding }],
        total: 1,
        facets: {},
      };
    },
    async getListings() {
      listCalls += 1;
      return {
        listings: [{ id: 'LST-1', source: 'sheriff', state: 'OH', county: 'Cuyahoga', address: '1 Main St', notes: padding }],
        total: 1,
        facets: {},
      };
    },
  };

  // Fallback override for in-memory mock where discovery.search hits getListings/native
  const originalSearch = discovery.search;
  discovery.search = async () => {
    listCalls += 1;
    return {
      listings: [{ id: 'LST-1', source: 'sheriff', state: 'OH', county: 'Cuyahoga', address: '1 Main St', notes: padding, provenance: { observed: true } }],
      total: 1,
      facets: {},
      revision: currentRev,
    };
  };

  try {
    const responseCache = new Map();

    // 1. Cold miss builds response, populates gzip buffer, and serves precompressed
    const res1 = makeMockRes('gzip');
    await handleListings({ method: 'GET', url: '/api/listings?limit=48', headers: { 'accept-encoding': 'gzip' } }, res1, db, { responseCache });
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.precompressedUsed, true);
    assert.equal(res1.headers['content-encoding'], 'gzip');
    const parsed1 = JSON.parse(zlib.gunzipSync(res1.bodyBuf).toString('utf8'));
    assert.equal(parsed1.listings.length, 1);
    assert.equal(listCalls, 1);
    assert.equal(responseCache.size, 1);

    // 2. Warm hit at same revision skips discovery.search and returns cached pre-gzipped bytes
    const res2 = makeMockRes('gzip');
    await handleListings({ method: 'GET', url: '/api/listings?limit=48', headers: { 'accept-encoding': 'gzip' } }, res2, db, { responseCache });
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.precompressedUsed, true);
    assert.equal(listCalls, 1, 'second read at identical revision must hit response cache');
    const parsed2 = JSON.parse(zlib.gunzipSync(res2.bodyBuf).toString('utf8'));
    assert.equal(parsed2.listings[0].id, 'LST-1');

    // 3. Revision bump misses cache and serves fresh payload
    currentRev = 'rev-2';
    const res3 = makeMockRes('');
    await handleListings({ method: 'GET', url: '/api/listings?limit=48', headers: {} }, res3, db, { responseCache });
    assert.equal(res3.statusCode, 200);
    assert.equal(res3.precompressedUsed, true);
    assert.equal(res3.headers['content-encoding'], undefined, 'non-gzip client receives plain JSON');
    assert.equal(listCalls, 2, 'revision bump must bypass stale cache entry');
    const parsed3 = JSON.parse(res3.bodyBuf.toString('utf8'));
    assert.equal(parsed3.revision, 'rev-2');
    assert.ok(revCalls >= 3);
  } finally {
    discovery.search = originalSearch;
  }
});

test('pgRevisionCoalesced shares in-flight Postgres revision queries on the same pool', async () => {
  let queries = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const db = {
    pool: {
      async query() {
        queries += 1;
        await gate;
        return { rows: [{ revision: 'rev-shared' }] };
      },
    },
  };
  const p1 = discovery.pgRevisionCoalesced(db);
  const p2 = discovery.pgRevisionCoalesced(db);
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, 'rev-shared');
  assert.equal(r2, 'rev-shared');
  assert.equal(queries, 1);
});
