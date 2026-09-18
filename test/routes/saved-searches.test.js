'use strict';

// test/routes/saved-searches.test.js
//
// Integration tests for the saved-searches + alerts HTTP surface.
// Exercises CRUD, run-now, and alert match listing/mark-read using
// an in-memory stub database. No Postgres required.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Ensure workspace identity gate passes in tests (the routes call requireWorkspaceIdentity).
// Force a clean module load after we set the token so the gate sees it.
process.env.PROPERTY_WORKSPACE_ID = process.env.PROPERTY_WORKSPACE_ID || 'operator';
process.env.SCRAPER_ADMIN_TOKEN = 'test-secret';

delete require.cache[require.resolve('../../server/security/workspace-identity')];
delete require.cache[require.resolve('../../server/routes/saved-searches')];

const { createSavedSearchesHandler, validateFilters } = require('../../server/routes/saved-searches');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function makeReq(method = 'GET', path = '/', body = null) {
  return { method, url: path, headers: { authorization: 'Bearer test-secret' }, body };
}

function stubDb() {
  const searches = new Map();
  const matches = new Map();
  let idSeq = 1;

  return {
    _matches: matches, // exposed for tests that need to control timestamps
    async listSavedSearches(userId, { includeInactive = false } = {}) {
      const out = [];
      for (const s of searches.values()) {
        if (s.userId !== userId) continue;
        if (!includeInactive && !s.isActive) continue;
        out.push({ ...s });
      }
      out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return out;
    },
    async createSavedSearch(userId, { label, filters }) {
      const id = `srch_${idSeq++}`;
      const rec = {
        id,
        userId,
        label: label || null,
        filters,
        isActive: true,
        lastRunAt: null,
        lastMatchCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      searches.set(id, rec);
      return { ...rec };
    },
    async getSavedSearchById(userId, id) {
      const s = searches.get(id);
      return s && s.userId === userId ? { ...s } : null;
    },
    async updateSavedSearch(userId, id, updates) {
      const s = searches.get(id);
      if (!s || s.userId !== userId) return null;
      if (typeof updates.label === 'string') s.label = updates.label;
      if (typeof updates.isActive === 'boolean') s.isActive = updates.isActive;
      if (updates.filters && typeof updates.filters === 'object') s.filters = updates.filters;
      s.updatedAt = new Date().toISOString();
      return { ...s };
    },
    async deleteSavedSearch(userId, id) {
      const s = searches.get(id);
      if (!s || s.userId !== userId) return false;
      searches.delete(id);
      for (const [mid, m] of matches) {
        if (m.searchId === id) matches.delete(mid);
      }
      return true;
    },
    async recordAlertMatches(userId, searchId, listingIds) {
      const created = [];
      // Seed a search record if not present so recordAlertMatches doesn't fail
      if (!searches.has(searchId)) {
        const nowIso = new Date().toISOString();
        searches.set(searchId, {
          id: searchId, userId, label: null, filters: {},
          isActive: true, lastRunAt: null, lastMatchCount: 0,
          createdAt: nowIso, updatedAt: nowIso
        });
      }
      for (const lid of listingIds) {
        const key = `${searchId}:${lid}`;
        if ([...matches.values()].some(m => m.searchId === searchId && m.listingId === lid)) continue;
        const rec = {
          id: `m_${idSeq++}`,
          searchId,
          userId,
          listingId: lid,
          matchedAt: new Date().toISOString(),
          readAt: null
        };
        matches.set(rec.id, rec);
        created.push({ ...rec });
      }
      const s = searches.get(searchId);
      if (s) {
        s.lastRunAt = new Date().toISOString();
        s.lastMatchCount = created.length;
      }
      return created;
    },
    async listAlertMatches(userId, { onlyUnread = false, limit = 50, cursor } = {}) {
      this.lastListLimit = limit; // capture for limit-cap assertions
      const out = [];
      for (const m of matches.values()) {
        if (m.userId !== userId) continue;
        if (onlyUnread && m.readAt) continue;
        out.push({ ...m });
      }
      out.sort((a, b) => (b.matchedAt || '').localeCompare(a.matchedAt || ''));

      if (cursor) {
        const sepIdx = cursor.indexOf('|');
        if (sepIdx > 0) {
          const cursorDate = cursor.slice(0, sepIdx);
          const cursorId = cursor.slice(sepIdx + 1);
          const pivot = out.findIndex(
            (m) => m.matchedAt === cursorDate && m.id === cursorId
          );
          if (pivot >= 0) {
            out.splice(0, pivot + 1);
          }
        }
      }

      const effectiveLimit = Math.max(1, Math.min(200, limit));
      const hasMore = out.length > effectiveLimit;
      const page = hasMore ? out.slice(0, effectiveLimit) : out;
      const nextCursor = hasMore && page.length > 0
        ? `${page[page.length - 1].matchedAt}|${page[page.length - 1].id}`
        : null;

      return { matches: page, nextCursor };
    },
    async markAlertMatchesRead(userId, matchIds) {
      let n = 0;
      for (const id of matchIds) {
        const m = matches.get(id);
        if (m && m.userId === userId && !m.readAt) {
          m.readAt = new Date().toISOString();
          n++;
        }
      }
      return n;
    },
    async getListings() {
      // Minimal pool for /:id/run tests
      return {
        listings: [
          { id: 'L-TX-1', state: 'TX', source: 'treasury', openingBid: 40000, dealScore: 80, propType: 'Single Family' },
          { id: 'L-CA-1', state: 'CA', source: 'hud', openingBid: 90000, dealScore: 40 }
        ]
      };
    }
  };
}

const workspaceUser = 'workspace:operator';

test('saved-searches: POST creates, GET lists, PATCH updates, DELETE removes', async () => {
  const db = stubDb();
  const handler = createSavedSearchesHandler({ database: db }).handleSavedSearches;

  // create
  const res1 = makeRes();
  await handler(makeReq('POST', '/api/saved-searches', { label: 'TX cheap', filters: { states: ['TX'], maxBid: 60000 } }), res1, new URL('http://localhost/api/saved-searches'));
  assert.equal(res1.statusCode, 201);
  const created = res1.body;
  assert.ok(created && created.id);
  assert.equal(created.label, 'TX cheap');

  // list
  const res2 = makeRes();
  await handler(makeReq('GET', '/api/saved-searches'), res2, new URL('http://localhost/api/saved-searches'));
  assert.equal(res2.statusCode, 200);
  assert.ok(Array.isArray(res2.body.searches));
  assert.equal(res2.body.searches.length, 1);

  // patch
  const res3 = makeRes();
  await handler(makeReq('PATCH', `/api/saved-searches/${created.id}`, { isActive: false }), res3, new URL(`http://localhost/api/saved-searches/${created.id}`));
  assert.equal(res3.statusCode, 200);
  assert.equal(res3.body.isActive, false);

  // delete
  const res4 = makeRes();
  await handler(makeReq('DELETE', `/api/saved-searches/${created.id}`), res4, new URL(`http://localhost/api/saved-searches/${created.id}`));
  assert.equal(res4.statusCode, 200);
  assert.equal(res4.body.success, true);
});

test('saved-searches: GET /:id/run executes against pool and records matches', async () => {
  const db = stubDb();
  const handlers = createSavedSearchesHandler({ database: db });
  const handler = handlers.handleSavedSearches;

  // seed a search
  const resCreate = makeRes();
  await handler(makeReq('POST', '/api/saved-searches', { label: 'TX', filters: { states: ['TX'] } }), resCreate, new URL('http://localhost/api/saved-searches'));
  const id = resCreate.body.id;

  const resRun = makeRes();
  await handler(makeReq('GET', `/api/saved-searches/${id}/run`), resRun, new URL(`http://localhost/api/saved-searches/${id}/run`));
  assert.equal(resRun.statusCode, 200);
  assert.ok(resRun.body.newMatches >= 0);
  assert.ok(resRun.body.scanned > 0);
});

test('alerts/matches: GET lists, POST mark_read works', async () => {
  const db = stubDb();
  const handlers = createSavedSearchesHandler({ database: db });

  // create search + force a match record via internal path
  const resCreate = makeRes();
  await handlers.handleSavedSearches(makeReq('POST', '/api/saved-searches', { label: 'all', filters: { states: ['TX'] } }), resCreate, new URL('http://localhost/api/saved-searches'));
  const sid = resCreate.body.id;

  // simulate a match by calling record directly
  await db.recordAlertMatches(workspaceUser, sid, ['L-TX-1']);

  // list
  const resList = makeRes();
  await handlers.handleAlertMatches(makeReq('GET', '/api/alerts/matches'), resList, new URL('http://localhost/api/alerts/matches'));
  assert.equal(resList.statusCode, 200);
  assert.ok(resList.body.count >= 1);

  const matchId = resList.body.matches[0].id;

  // mark read
  const resMark = makeRes();
  await handlers.handleAlertMatches(makeReq('POST', '/api/alerts/matches', { action: 'mark_read', matchIds: [matchId] }), resMark, new URL('http://localhost/api/alerts/matches'));
  assert.equal(resMark.statusCode, 200);
  assert.ok(resMark.body.markedRead >= 1);
});

test('validateFilters rejects bad shapes', () => {
  assert.equal(validateFilters(null).ok, false);
  assert.equal(validateFilters({ states: 'TX' }).ok, false);
  assert.equal(validateFilters({ minScore: 'bad' }).ok, false);
  assert.equal(validateFilters({ states: ['TX'] }).ok, true);
});

// ---------------------------------------------------------------------------
// Cursor pagination tests
// ---------------------------------------------------------------------------

test('alerts/matches cursor: first page returns nextCursor', async () => {
  const db = stubDb();
  const handlers = createSavedSearchesHandler({ database: db });

  // Seed 5 matches with distinct matchedAt timestamps
  const base = new Date('2026-09-17T12:00:00Z');
  for (let i = 0; i < 5; i++) {
    await db.recordAlertMatches(workspaceUser, 'srch_1', [`listing-${i}`]);
  }
  // Patch timestamps to make ordering deterministic (spread 1min apart)
  let idx = 0;
  for (const [, m] of db._matches) {
    m.matchedAt = new Date(base.getTime() + idx * 60_000).toISOString();
    idx++;
  }

  const res = makeRes();
  await handlers.handleAlertMatches(
    makeReq('GET', '/api/alerts/matches?limit=2'),
    res,
    new URL('http://localhost/api/alerts/matches?limit=2')
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 2);
  assert.ok(res.body.nextCursor !== null, 'first page should have a nextCursor');
});

test('alerts/matches cursor: second page has no overlap with first', async () => {
  const db = stubDb();
  const handlers = createSavedSearchesHandler({ database: db });

  for (let i = 0; i < 5; i++) {
    await db.recordAlertMatches(workspaceUser, 'srch_1', [`listing-${i}`]);
  }
  const base = new Date('2026-09-17T12:00:00Z');
  let idx = 0;
  for (const [, m] of db._matches) {
    m.matchedAt = new Date(base.getTime() + idx * 60_000).toISOString();
    idx++;
  }

  // Page 1
  const page1Url = new URL('http://localhost/api/alerts/matches?limit=2');
  const res1 = makeRes();
  await handlers.handleAlertMatches(
    makeReq('GET', page1Url.toString()),
    res1,
    page1Url
  );
  assert.equal(res1.statusCode, 200);
  const page1Ids = res1.body.matches.map(m => m.id);
  const cursor1 = res1.body.nextCursor;
  assert.ok(cursor1, 'should have nextCursor');

  // Page 2 — construct URL without double-encoding the cursor
  const page2Url = new URL('http://localhost/api/alerts/matches');
  page2Url.searchParams.set('limit', '2');
  page2Url.searchParams.set('cursor', cursor1);
  const res2 = makeRes();
  await handlers.handleAlertMatches(
    makeReq('GET', page2Url.toString()),
    res2,
    page2Url
  );
  assert.equal(res2.statusCode, 200);
  const page2Ids = res2.body.matches.map(m => m.id);

  const overlap = page1Ids.filter(id => page2Ids.includes(id));
  assert.equal(overlap.length, 0, `pages must not overlap, got overlap: ${overlap}`);
});

test('alerts/matches cursor: malformed cursor returns 400', async () => {
  const db = stubDb();
  const handlers = createSavedSearchesHandler({ database: db });
  await db.recordAlertMatches(workspaceUser, 'srch_1', ['listing-1']);

  for (const bad of ['not-a-cursor', '!!!', 'abc_', '2026-13-45T99:99Z_abc']) {
    const res = makeRes();
    await handlers.handleAlertMatches(
      makeReq('GET', `/api/alerts/matches?cursor=${encodeURIComponent(bad)}`),
      res,
      new URL(`http://localhost/api/alerts/matches?cursor=${encodeURIComponent(bad)}`)
    );
    assert.equal(res.statusCode, 400, `expected 400 for cursor="${bad}", got ${res.statusCode}`);
    assert.ok(res.body.error, 'error field should be present');
  }
});

test('alerts/matches cursor: end-of-list returns nextCursor null', async () => {
  const db = stubDb();
  const handlers = createSavedSearchesHandler({ database: db });

  for (let i = 0; i < 3; i++) {
    await db.recordAlertMatches(workspaceUser, 'srch_1', [`listing-${i}`]);
  }
  const base = new Date('2026-09-17T12:00:00Z');
  let idx = 0;
  for (const [, m] of db._matches) {
    m.matchedAt = new Date(base.getTime() + idx * 60_000).toISOString();
    idx++;
  }

  // Fetch all 3 in one page — no more pages
  const res = makeRes();
  await handlers.handleAlertMatches(
    makeReq('GET', '/api/alerts/matches?limit=10'),
    res,
    new URL('http://localhost/api/alerts/matches?limit=10')
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 3);
  assert.equal(res.body.nextCursor, null, 'last page must have nextCursor null');
});

test('alerts/matches cursor: no cursor returns first page (backward compat)', async () => {
  const db = stubDb();
  const handlers = createSavedSearchesHandler({ database: db });
  await db.recordAlertMatches(workspaceUser, 'srch_1', ['listing-1']);

  const res = makeRes();
  await handlers.handleAlertMatches(
    makeReq('GET', '/api/alerts/matches'),
    res,
    new URL('http://localhost/api/alerts/matches')
  );
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.matches));
  assert.equal(res.body.count, 1);
});

test('alerts/matches: limit is capped at max (200)', async () => {
  const db = stubDb();
  const handlers = createSavedSearchesHandler({ database: db });
  await db.recordAlertMatches(workspaceUser, 'srch_1', ['listing-1']);

  // A request asking for far more than the max should be clamped to 200
  // before it reaches the DB layer.
  const res = makeRes();
  await handlers.handleAlertMatches(
    makeReq('GET', '/api/alerts/matches?limit=9999'),
    res,
    new URL('http://localhost/api/alerts/matches?limit=9999')
  );
  assert.equal(res.statusCode, 200);
  assert.equal(db.lastListLimit, 200, 'route must clamp limit to max 200');
});

test('alerts/matches: default limit applied when limit param missing/invalid', async () => {
  const db = stubDb();
  const handlers = createSavedSearchesHandler({ database: db });
  await db.recordAlertMatches(workspaceUser, 'srch_1', ['listing-1']);

  for (const path of ['/api/alerts/matches', '/api/alerts/matches?limit=abc', '/api/alerts/matches?limit=-5']) {
    const res = makeRes();
    await handlers.handleAlertMatches(makeReq('GET', path), res, new URL(`http://localhost${path}`));
    assert.equal(res.statusCode, 200);
    assert.equal(db.lastListLimit, 50, `default 50 expected for ${path}`);
  }
});

// ---------------------------------------------------------------------------
// Workspace store (file-backed persistence) tests
// ---------------------------------------------------------------------------

test('workspace-store: write-through persistence round-trip', async () => {
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-store-'));
  const storePath = path.join(tmpDir, 'workspace-store.json');

  // First instance — write a saved search
  const { DatabaseClient } = require('../../server/db/client');
  const db1 = new DatabaseClient({
    workspaceStorePath: storePath,
    liveCachePath: null,
    env: { NODE_ENV: 'test' }
  });
  const created = await db1.createSavedSearch('workspace:operator', {
    label: 'Persistence test',
    filters: { states: ['TX'] }
  });
  assert.ok(created.id);

  // Second instance — read from the same file
  const db2 = new DatabaseClient({
    workspaceStorePath: storePath,
    liveCachePath: null,
    env: { NODE_ENV: 'test' }
  });
  const loaded = await db2.getSavedSearchById('workspace:operator', created.id);
  assert.ok(loaded, 'saved search should survive restart');
  assert.equal(loaded.label, 'Persistence test');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('workspace-store: corrupt file fails closed (empty store, no throw)', async () => {
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-store-corrupt-'));
  const storePath = path.join(tmpDir, 'workspace-store.json');

  // Write garbage
  fs.writeFileSync(storePath, '{ "version": 999, "savedSearches": "not-an-object" }', 'utf8');

  const { DatabaseClient } = require('../../server/db/client');
  const db = new DatabaseClient({
    workspaceStorePath: storePath,
    liveCachePath: null,
    env: { NODE_ENV: 'test' }
  });

  // Should start empty, not throw
  const searches = await db.listSavedSearches('workspace:operator');
  assert.ok(Array.isArray(searches));
  assert.equal(searches.length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('workspace-store: missing file is tolerated', async () => {
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-store-missing-'));
  const storePath = path.join(tmpDir, 'workspace-store.json');
  // File intentionally not created

  const { DatabaseClient } = require('../../server/db/client');
  const db = new DatabaseClient({
    workspaceStorePath: storePath,
    liveCachePath: null,
    env: { NODE_ENV: 'test' }
  });

  const searches = await db.listSavedSearches('workspace:operator');
  assert.ok(Array.isArray(searches));
  assert.equal(searches.length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('workspace-store: alert matches persist across restarts', async () => {
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-store-alerts-'));
  const storePath = path.join(tmpDir, 'workspace-store.json');

  const { DatabaseClient } = require('../../server/db/client');
  const db1 = new DatabaseClient({
    workspaceStorePath: storePath,
    liveCachePath: null,
    env: { NODE_ENV: 'test' }
  });

  const search = await db1.createSavedSearch('workspace:operator', {
    label: 'Alert test',
    filters: { states: ['TX'] }
  });
  await db1.recordAlertMatches('workspace:operator', search.id, ['listing-1', 'listing-2']);

  const db2 = new DatabaseClient({
    workspaceStorePath: storePath,
    liveCachePath: null,
    env: { NODE_ENV: 'test' }
  });
  const matches = await db2.listAlertMatches('workspace:operator', { limit: 10 });
  assert.equal(matches.matches.length, 2);

  // Mark one read in second instance
  await db2.markAlertMatchesRead('workspace:operator', [matches.matches[0].id]);

  // Third instance confirms read state persisted
  const db3 = new DatabaseClient({
    workspaceStorePath: storePath,
    liveCachePath: null,
    env: { NODE_ENV: 'test' }
  });
  const unread = await db3.listAlertMatches('workspace:operator', { onlyUnread: true, limit: 10 });
  assert.equal(unread.matches.length, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});