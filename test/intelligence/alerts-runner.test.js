'use strict';

// test/intelligence/alerts-runner.test.js
//
// Tests for server/intelligence/alerts-runner.js — the orchestration
// glue that wires the saved-search predicate to the DB. The function
// is called from the post-ingest hook in server/scrapers/scheduler.js
// after every scraping cycle, so a regression here means new listings
// silently stop surfacing in the alerts UI.

const assert = require('node:assert/strict');
const test = require('node:test');

const { runAlertsForUser } = require('../../server/intelligence/alerts-runner');

const NOW_MS = Date.parse('2026-09-16T12:00:00.000Z');

function listing(overrides = {}) {
  return {
    id: 'L1',
    source: 'treasury',
    state: 'TX',
    city: 'Bruni',
    sqft: 1500,
    propType: 'Single Family',
    openingBid: 50000,
    mid: 100000,
    dealScore: 75,
    occupancy: 'Vacant',
    seniorLienRisk: 'low',
    redemptionWarning: 'standard',
    ...overrides
  };
}

function search(overrides = {}) {
  // The predicate in server/intelligence/saved-search-alerts.js reads
  // each filter field either top-level (search.states) or under a
  // nested `filters` blob (search.filters.states). The DB stores the
  // user's filter set under `filters`, so we mirror that production
  // shape here by default.
  const base = {
    id: overrides.id || 'S1',
    label: overrides.label || 'TX single family under 100k',
    userId: 'workspace:operator',
    isActive: true,
    filters: { states: ['TX'], propTypes: ['Single Family'], maxBid: 100000 }
  };
  return Object.assign(base, overrides);
}

// Build an in-memory stub that emulates the DB contract the runner
// needs: listSavedSearches, recordAlertMatches. We track every record
// call so we can assert persistence semantics.
function makeStubDb(searches = []) {
  const calls = { recordAlertMatches: [] };
  const stored = { searches: new Map(), alertMatches: [] };
  for (const s of searches) stored.searches.set(s.id, s);

  return {
    calls,
    async listSavedSearches(userId, opts = {}) {
      const includeInactive = opts.includeInactive === true;
      return [...stored.searches.values()].filter((s) => {
        if (!s.userId || s.userId !== userId) return false;
        if (!includeInactive && !s.isActive) return false;
        return true;
      });
    },
    async recordAlertMatches(userId, searchId, listingIds) {
      calls.recordAlertMatches.push({ userId, searchId, listingIds });
      const out = [];
      const nowIso = new Date(NOW_MS).toISOString();
      for (const listingId of listingIds) {
        if (stored.alertMatches.some((m) => m.searchId === searchId && m.listingId === listingId)) continue;
        const record = {
          id: `M-${stored.alertMatches.length + 1}`,
          searchId,
          userId,
          listingId,
          matchedAt: nowIso,
          readAt: null
        };
        stored.alertMatches.push(record);
        out.push(record);
      }
      return out;
    },
    _stored: stored
  };
}

test('runAlertsForUser: matches listings that satisfy every active search', async () => {
  const searches = [
    search({ id: 'S1', filters: { states: ['TX'] } }),
    search({ id: 'S2', filters: { sources: ['treasury'] } })
  ];
  const db = makeStubDb(searches);
  const listings = [
    listing({ id: 'A', source: 'treasury', state: 'TX' }),
    listing({ id: 'B', source: 'treasury', state: 'CA' }),
    listing({ id: 'C', source: 'irs', state: 'TX' })
  ];
  const result = await runAlertsForUser({ userId: 'workspace:operator', listings, database: db });
  // A: matches S1+S2 (TX + treasury); B: matches S2 (treasury); C: matches S1 (TX)
  const s1Calls = db.calls.recordAlertMatches.filter((c) => c.searchId === 'S1').flatMap((c) => c.listingIds);
  const s2Calls = db.calls.recordAlertMatches.filter((c) => c.searchId === 'S2').flatMap((c) => c.listingIds);
  assert.deepEqual(s1Calls.sort(), ['A', 'C']);
  assert.deepEqual(s2Calls.sort(), ['A', 'B']);
  assert.equal(result.userId, 'workspace:operator');
  assert.equal(result.searches, 2);
  assert.equal(result.totalNewMatches, 4);
  assert.equal(result.results.length, 2);
});

test('runAlertsForUser: inactive searches are skipped', async () => {
  const db = makeStubDb([
    search({ id: 'S1', isActive: false }),
    search({ id: 'S2', isActive: true })
  ]);
  const listings = [listing({ id: 'A', state: 'TX' })];
  const result = await runAlertsForUser({ userId: 'workspace:operator', listings, database: db });
  assert.equal(result.searches, 1, 'only the active search counts');
  const calledIds = db.calls.recordAlertMatches.map((c) => c.searchId);
  assert.deepEqual(calledIds, ['S2']);
});

test('runAlertsForUser: returns skipped=listings_empty for an empty batch', async () => {
  const db = makeStubDb([search()]);
  const result = await runAlertsForUser({ userId: 'workspace:operator', listings: [], database: db });
  assert.equal(result.skipped, 'listings_empty');
  assert.equal(result.totalNewMatches, 0);
  assert.equal(db.calls.recordAlertMatches.length, 0);
});

test('runAlertsForUser: returns skipped=userId_missing when userId is missing', async () => {
  const db = makeStubDb([search()]);
  const result = await runAlertsForUser({ listings: [listing()], database: db });
  assert.equal(result.skipped, 'userId_missing');
  assert.equal(result.totalNewMatches, 0);
});

test('runAlertsForUser: returns skipped=database_missing when no DB is wired', async () => {
  const result = await runAlertsForUser({ userId: 'workspace:operator', listings: [listing()], database: null });
  assert.equal(result.skipped, 'database_missing');
  assert.equal(result.totalNewMatches, 0);
});

test('runAlertsForUser: a non-array listings input is treated as empty', async () => {
  const db = makeStubDb([search()]);
  const result = await runAlertsForUser({ userId: 'workspace:operator', listings: null, database: db });
  assert.equal(result.skipped, 'listings_empty');
});

test('runAlertsForUser: returns searches=0 when the user has no saved searches', async () => {
  const db = makeStubDb([]);
  const result = await runAlertsForUser({
    userId: 'workspace:operator',
    listings: [listing()],
    database: db
  });
  assert.equal(result.searches, 0);
  assert.equal(result.totalNewMatches, 0);
  assert.equal(result.results.length, 0);
  assert.equal(result.skipped, null);
});

test('runAlertsForUser: searches from a different user are skipped (workspace isolation)', async () => {
  const db = makeStubDb([
    search({ id: 'OTHER', userId: 'workspace:other' }),
    search({ id: 'MINE', userId: 'workspace:operator' })
  ]);
  const result = await runAlertsForUser({
    userId: 'workspace:operator',
    listings: [listing()],
    database: db
  });
  const calledIds = db.calls.recordAlertMatches.map((c) => c.searchId);
  assert.deepEqual(calledIds, ['MINE']);
  assert.equal(result.searches, 1);
});

test('runAlertsForUser: idempotent re-runs do not double-count matches', async () => {
  const db = makeStubDb([search({ id: 'S1', filters: { states: ['TX'] } })]);
  const listings = [listing({ id: 'A', state: 'TX' })];
  const first = await runAlertsForUser({ userId: 'workspace:operator', listings, database: db });
  assert.equal(first.totalNewMatches, 1);
  const second = await runAlertsForUser({ userId: 'workspace:operator', listings, database: db });
  assert.equal(second.totalNewMatches, 0, 'second run is a no-op for the same listing');
});

test('runAlertsForUser: results array only includes searches with new matches', async () => {
  const db = makeStubDb([
    search({ id: 'S1', filters: { states: ['TX'] } }),
    search({ id: 'S2', filters: { sources: ['irs'] } })
  ]);
  const result = await runAlertsForUser({
    userId: 'workspace:operator',
    listings: [listing({ id: 'A', state: 'TX', source: 'treasury' })],
    database: db
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].searchId, 'S1');
  assert.equal(result.results[0].newMatches, 1);
});

test('runAlertsForUser: aggregate counts match across the batch', async () => {
  const db = makeStubDb([
    search({ id: 'S1', filters: { states: ['TX'] } }),
    search({ id: 'S2', filters: { states: ['CA'] } })
  ]);
  const listings = [
    listing({ id: 'A', state: 'TX' }),
    listing({ id: 'B', state: 'CA' }),
    listing({ id: 'C', state: 'NY' })
  ];
  const result = await runAlertsForUser({
    userId: 'workspace:operator',
    listings,
    database: db
  });
  // A → S1 (TX). B → S2 (CA). C → no match (NY in neither).
  assert.equal(result.totalNewMatches, 2);
  const s1New = result.results.find((r) => r.searchId === 'S1')?.newMatches;
  const s2New = result.results.find((r) => r.searchId === 'S2')?.newMatches;
  assert.equal(s1New, 1, 'only A matches S1');
  assert.equal(s2New, 1, 'only B matches S2');
});

test('runAlertsForUser: accepts the production-shape filter blob from the DB', async () => {
  // The DB stores the user's filter set inside a `filters` JSONB column.
  // The runner must pass that record straight to the predicate without
  // flattening, otherwise real saves never match anything.
  const db = makeStubDb([
    search({ id: 'S1', filters: { states: ['TX'], maxBid: 100000 } })
  ]);
  const listings = [
    listing({ id: 'A', state: 'TX', openingBid: 50000 }),
    listing({ id: 'B', state: 'TX', openingBid: 200000 }),
    listing({ id: 'C', state: 'CA', openingBid: 50000 })
  ];
  const result = await runAlertsForUser({
    userId: 'workspace:operator',
    listings,
    database: db
  });
  assert.equal(result.totalNewMatches, 1, 'only A satisfies TX + maxBid=100000');
  assert.equal(result.results[0].searchId, 'S1');
});

test('runAlertsForUser: flat-shape searches (used by older tests) still work', async () => {
  // Backward-compat: the predicate also accepts `{states: [...]}` flat
  // for tests that build ad-hoc searches. The runner must not break.
  const db = makeStubDb([
    search({ id: 'S1', filters: undefined, states: ['TX'], propTypes: undefined, maxBid: undefined })
  ]);
  const listings = [listing({ id: 'A', state: 'TX' })];
  const result = await runAlertsForUser({ userId: 'workspace:operator', listings, database: db });
  assert.equal(result.totalNewMatches, 1);
});