'use strict';

// test/routes/saved-searches.test.js
//
// Integration tests for the saved-searches + alerts HTTP surface.
// Exercises CRUD, run-now, and alert match listing/mark-read using
// an in-memory stub database. No Postgres required.

const assert = require('node:assert/strict');
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
    async listAlertMatches(userId, { onlyUnread = false, limit = 100 } = {}) {
      const out = [];
      for (const m of matches.values()) {
        if (m.userId !== userId) continue;
        if (onlyUnread && m.readAt) continue;
        out.push({ ...m });
      }
      out.sort((a, b) => (b.matchedAt || '').localeCompare(a.matchedAt || ''));
      return out.slice(0, Math.max(1, Math.min(500, limit)));
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