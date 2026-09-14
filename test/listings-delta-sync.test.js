// Focused unit test for the /api/listings ?since= delta-sync feature.
//
// The endpoint integration tests in test/server.test.js cover ?since= against
// the full server + db stack. This file isolates the since filter to a
// controlled two-listing fixture so the boundary behavior is deterministic
// and not dependent on whatever the live cache happens to contain.
//
// Strategy:
//   1. Require the discovery module first so we can patch its .search.
//   2. Replace discovery.search with a stub that returns the fixture.
//   3. Require the route handler — it captures the discovery module object,
//      so the stub is honored at call time even though we loaded the handler
//      after patching.
//   4. Invoke the handler with stub req/res and assert the response.

const test = require('node:test');
const assert = require('node:assert/strict');

// Must be loaded BEFORE the route handler so the stub is in place when the
// handler is required. Node caches modules so discovery is the same object
// the handler will reference later.
const discovery = require('../server/discovery/query');
const originalSearch = discovery.search;

const LISTING_NEWER = {
  id: 'DELTA-NEWER',
  source: 'hud',
  state: 'OH',
  city: 'Cleveland',
  address: '1 Newer Record Way, Cleveland, OH 44101',
  sourceObservedAt: '2026-09-01T12:00:00.000Z',
  provenance: {
    origin: 'live',
    observed: true,
    recordKind: 'source_record',
    observedAt: '2026-09-01T12:00:00.000Z',
  },
};

const LISTING_OLDER = {
  id: 'DELTA-OLDER',
  source: 'hud',
  state: 'OH',
  city: 'Cleveland',
  address: '2 Older Record Way, Cleveland, OH 44101',
  sourceObservedAt: '2025-01-01T00:00:00.000Z',
  provenance: {
    origin: 'live',
    observed: true,
    recordKind: 'source_record',
    observedAt: '2025-01-01T00:00:00.000Z',
  },
};

discovery.search = async () => ({
  listings: [LISTING_NEWER, LISTING_OLDER],
  total: 2,
  page: { nextCursor: null, hasMore: false },
});

const handler = require('../server/routes/listings');

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke(url) {
  const req = { url, method: 'GET', headers: {} };
  const res = response();
  await handler(req, res);
  return res;
}

test.after(() => {
  discovery.search = originalSearch;
});

test('?since=<date between the two listings> returns only the newer record', async () => {
  const res = await invoke('/api/listings?since=2026-01-01T00:00:00.000Z');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.delta, true);
  assert.strictEqual(res.body.since, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(res.body.listings.length, 1);
  assert.strictEqual(res.body.listings[0].id, 'DELTA-NEWER');
});

test('?since=<date after both listings> returns an empty delta set', async () => {
  const res = await invoke('/api/listings?since=2030-01-01T00:00:00.000Z');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.delta, true);
  assert.strictEqual(res.body.since, '2030-01-01T00:00:00.000Z');
  assert.strictEqual(res.body.listings.length, 0);
});

test('?since=<date before both listings> returns every record', async () => {
  const res = await invoke('/api/listings?since=2000-01-01T00:00:00.000Z');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.delta, true);
  assert.strictEqual(res.body.listings.length, 2);
  const ids = res.body.listings.map((l) => l.id).sort();
  assert.deepEqual(ids, ['DELTA-NEWER', 'DELTA-OLDER']);
});

test('?since=<garbage> returns 400 with the documented error', async () => {
  const res = await invoke('/api/listings?since=not-a-date');
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /Invalid since parameter/);
});

test('omitting ?since returns every record with no delta fields (backward compat)', async () => {
  const res = await invoke('/api/listings');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.delta, undefined);
  assert.strictEqual(res.body.since, undefined);
  assert.strictEqual(res.body.listings.length, 2);
});