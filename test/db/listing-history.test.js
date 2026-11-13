'use strict';

// test/db/listing-history.test.js
//
// Tests for the listing-history DB methods on server/db/client.js:
//   - recordListingHistorySnapshots(listings)
//   - getListingHistory(listingIds)
//
// The price-drop detector reads the most-recent prior snapshot per
// listing. Snapshots are idempotent on (listing_id, source_observed_at)
// so re-running the same scrape does not create duplicate history rows.

const assert = require('node:assert/strict');
const test = require('node:test');

const db = require('../../server/db/client');

function listing(overrides = {}) {
  return {
    id: 'L1',
    source: 'treasury',
    state: 'TX',
    openingBid: 50000,
    mid: 100000,
    dealScore: 70,
    sourceObservedAt: '2026-09-01T12:00:00.000Z',
    ...overrides
  };
}

// --- recordListingHistorySnapshots ----------------------------------------

test('recordListingHistorySnapshots: empty / non-array input returns 0', async () => {
  assert.equal(await db.recordListingHistorySnapshots(null), 0);
  assert.equal(await db.recordListingHistorySnapshots([]), 0);
});

test('recordListingHistorySnapshots: records a snapshot per listing', async () => {
  const recorded = await db.recordListingHistorySnapshots([
    listing({ id: 'A', openingBid: 50000 }),
    listing({ id: 'B', openingBid: 80000, sourceObservedAt: '2026-09-02T12:00:00.000Z' }),
    listing({ id: 'C', openingBid: 120000, sourceObservedAt: '2026-09-03T12:00:00.000Z' })
  ]);
  assert.equal(recorded, 3);

  const history = await db.getListingHistory(['A', 'B', 'C']);
  assert.equal(history.size, 3);
  assert.equal(history.get('A').openingBid, 50000);
  assert.equal(history.get('B').openingBid, 80000);
  assert.equal(history.get('C').openingBid, 120000);
});

test('recordListingHistorySnapshots: idempotent on (listing_id, source_observed_at)', async () => {
  const listing1 = listing({ id: 'IDEMP', openingBid: 50000 });
  await db.recordListingHistorySnapshots([listing1]);
  // Same id + same sourceObservedAt → no new snapshot, but the
  // existing snapshot is preserved.
  const recorded = await db.recordListingHistorySnapshots([listing1]);
  assert.equal(recorded, 0, 'duplicate snapshot is rejected by the unique constraint');

  const history = await db.getListingHistory(['IDEMP']);
  // Only one snapshot exists for IDEMP
  assert.equal(history.size, 1);
});

test('recordListingHistorySnapshots: same listing id with two different observed_at creates two snapshots', async () => {
  await db.recordListingHistorySnapshots([listing({ id: 'TWO', openingBid: 50000, sourceObservedAt: '2026-09-01T12:00:00.000Z' })]);
  await db.recordListingHistorySnapshots([listing({ id: 'TWO', openingBid: 40000, sourceObservedAt: '2026-09-15T12:00:00.000Z' })]);

  const history = await db.getListingHistory(['TWO']);
  // getListingHistory returns the most-recent snapshot (40000), not the
  // earliest (50000). The price-drop detector then compares current vs 40000.
  assert.equal(history.get('TWO').openingBid, 40000);
});

test('recordListingHistorySnapshots: listings without sourceObservedAt are skipped', async () => {
  const recorded = await db.recordListingHistorySnapshots([
    listing({ id: 'WITH_DATE' }),
    listing({ id: 'NO_DATE', sourceObservedAt: null }),
    listing({ id: 'NO_DATE2', sourceObservedAt: undefined }),
    listing({ id: 'EMPTY_DATE', sourceObservedAt: '' })
  ]);
  assert.equal(recorded, 1, 'only the listing with a sourceObservedAt is recorded');
  const history = await db.getListingHistory(['WITH_DATE', 'NO_DATE', 'NO_DATE2', 'EMPTY_DATE']);
  assert.ok(history.has('WITH_DATE'));
  assert.equal(history.has('NO_DATE'), false);
  assert.equal(history.has('NO_DATE2'), false);
  assert.equal(history.has('EMPTY_DATE'), false);
});

test('recordListingHistorySnapshots: listings without id are skipped', async () => {
  const recorded = await db.recordListingHistorySnapshots([
    listing({ id: null }),
    listing({ id: undefined }),
    listing({ id: '' })
  ]);
  assert.equal(recorded, 0);
});

test('recordListingHistorySnapshots: provenance.observedAt is used as a fallback', async () => {
  const recorded = await db.recordListingHistorySnapshots([
    listing({ id: 'PROV', sourceObservedAt: null, provenance: { observedAt: '2026-09-10T00:00:00.000Z' } })
  ]);
  assert.equal(recorded, 1);
  const history = await db.getListingHistory(['PROV']);
  assert.equal(history.get('PROV').sourceObservedAt, '2026-09-10T00:00:00.000Z');
});

// --- getListingHistory ------------------------------------------------------

test('getListingHistory: empty / non-array input returns empty Map', async () => {
  const m1 = await db.getListingHistory(null);
  const m2 = await db.getListingHistory([]);
  assert.ok(m1 instanceof Map);
  assert.equal(m1.size, 0);
  assert.equal(m2.size, 0);
});

test('getListingHistory: filters out non-string ids', async () => {
  await db.recordListingHistorySnapshots([listing({ id: 'REAL' })]);
  const history = await db.getListingHistory(['REAL', null, undefined, '', '   ']);
  assert.equal(history.size, 1);
  assert.ok(history.has('REAL'));
});

test('getListingHistory: returns most-recent snapshot when multiple exist', async () => {
  await db.recordListingHistorySnapshots([
    listing({ id: 'M', openingBid: 50000, sourceObservedAt: '2026-08-01T00:00:00.000Z' }),
    listing({ id: 'M', openingBid: 40000, sourceObservedAt: '2026-09-01T00:00:00.000Z' }),
    listing({ id: 'M', openingBid: 30000, sourceObservedAt: '2026-10-01T00:00:00.000Z' })
  ]);
  const history = await db.getListingHistory(['M']);
  assert.equal(history.get('M').openingBid, 30000);
});

test('getListingHistory: returns an empty entry for a listing with no history', async () => {
  const history = await db.getListingHistory(['NEVER_SEEN']);
  assert.equal(history.size, 0);
  assert.equal(history.has('NEVER_SEEN'), false);
});

test('getListingHistory: includes openingBid, mid, dealScore, source', async () => {
  await db.recordListingHistorySnapshots([
    listing({
      id: 'FULL',
      openingBid: 50000,
      mid: 100000,
      dealScore: 75,
      source: 'treasury'
    })
  ]);
  const history = await db.getListingHistory(['FULL']);
  const snap = history.get('FULL');
  assert.equal(snap.openingBid, 50000);
  assert.equal(snap.mid, 100000);
  assert.equal(snap.dealScore, 75);
  assert.equal(snap.source, 'treasury');
  assert.ok(snap.sourceObservedAt);
  assert.ok(snap.recordedAt);
});

test('getListingHistory: with options.prior returns penultimate snapshot', async () => {
  await db.recordListingHistorySnapshots([
    listing({ id: 'DROP_TEST', openingBid: 100000, sourceObservedAt: '2026-08-01T00:00:00.000Z' }),
    listing({ id: 'DROP_TEST', openingBid: 75000, sourceObservedAt: '2026-09-01T00:00:00.000Z' })
  ]);
  const defaultHistory = await db.getListingHistory(['DROP_TEST']);
  assert.equal(defaultHistory.get('DROP_TEST').openingBid, 75000, 'default returns latest');

  const priorHistory = await db.getListingHistory(['DROP_TEST'], { prior: true });
  assert.equal(priorHistory.get('DROP_TEST').openingBid, 100000, 'prior returns penultimate');
});

test('getListingHistory: with options.prior returns empty when only one snapshot exists', async () => {
  await db.recordListingHistorySnapshots([
    listing({ id: 'SINGLE_SNAP', openingBid: 50000, sourceObservedAt: '2026-08-01T00:00:00.000Z' })
  ]);
  const priorHistory = await db.getListingHistory(['SINGLE_SNAP'], { prior: true });
  assert.equal(priorHistory.has('SINGLE_SNAP'), false, 'no prior snapshot exists');
});

test('recordListingHistorySnapshots (pg): batches inserts via UNNEST, deduplicates within batch, and matches getListingHistory', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE listing_history (
      id SERIAL PRIMARY KEY,
      listing_id TEXT NOT NULL,
      source_observed_at TIMESTAMPTZ NOT NULL,
      opening_bid NUMERIC(14, 2),
      mid NUMERIC(14, 2),
      deal_score NUMERIC(5, 2),
      source VARCHAR(64),
      recorded_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(listing_id, source_observed_at)
    );
  `);

  let queryCalls = 0;
  const instrumentedPool = {
    query: (sql, params) => {
      queryCalls += 1;
      return pg.query(sql, params);
    },
  };
  const { DatabaseClient } = require('../../server/db/client');
  const pgClient = new DatabaseClient({ env: { NODE_ENV: 'test' } });
  pgClient.attachPostgres(instrumentedPool, 'pglite');

  const bulk = Array.from({ length: 1050 }, (_, idx) => listing({
    id: `PG-${idx}`,
    openingBid: idx === 0 ? null : 50000 + idx,
    mid: idx === 0 ? null : 100000 + idx,
    dealScore: idx === 0 ? null : 70,
    sourceObservedAt: '2026-09-10T12:00:00.000Z',
  }));
  // Add an in-batch duplicate and a missing-timestamp row that must be ignored cleanly.
  bulk.push(listing({ id: 'PG-1', sourceObservedAt: '2026-09-10T12:00:00.000Z' }));
  bulk.push({ id: 'NO_TS', openingBid: 1000 });

  const recorded = await pgClient.recordListingHistorySnapshots(bulk);
  assert.equal(recorded, 1050);
  assert.ok(queryCalls <= 5, `expected batched UNNEST inserts (<=5 queries), got ${queryCalls}`);

  const duplicateRun = await pgClient.recordListingHistorySnapshots(bulk.slice(0, 50));
  assert.equal(duplicateRun, 0, 're-inserting existing snapshots must stay idempotent');

  const fetched = await pgClient.getListingHistory(['PG-0', 'PG-1']);
  assert.equal(fetched.get('PG-0').openingBid, null);
  assert.equal(fetched.get('PG-1').openingBid, 50001);
});