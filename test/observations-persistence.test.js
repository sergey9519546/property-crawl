'use strict';

// Guards for the PostgreSQL observation-history mirror and the
// triage_priority refresh strategy (migrations 025 + 026). Pure mock-pool
// tests: no database is required, mirroring the route-level DI tests.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  loadObservationsForRecord,
  persistSourceObservations,
  recomputeTriageForListings,
  updateTriagePriority,
} = require('../server/db/observations-persistence');

function mockPool(behavior = {}) {
  const queries = [];
  const pool = {
    queries,
    async query(text, params) {
      queries.push({ text: String(text), params });
      // handlerFor maps SQL text (and params) to a pg-style result object.
      if (behavior.handlerFor) {
        const result = behavior.handlerFor(String(text), params);
        if (result) return result;
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

function snapshot(overrides = {}) {
  return {
    listingId: 'CIV-NJ-7-2128964683',
    recordId: '2128964683',
    observedAt: '2026-10-11T01:20:46.044Z',
    noticeExcerpt: 'Official CivilView source record.',
    noticeSha256: 'a'.repeat(64),
    fields: { openingBid: 100000, saleDate: '2026-11-01', status: 'Status: Active', deposit: 5000, address: '19 West Park Avenue, Park Ridge, NJ 07656' },
    ...overrides,
  };
}

function listing(overrides = {}) {
  return {
    id: 'CIV-NJ-7-2128964683',
    source: 'civilview',
    state: 'NJ',
    address: '19 West Park Avenue, Park Ridge, NJ 07656',
    openingBid: 100000,
    saleDate: '2099-12-31',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: '2128964683' },
    ...overrides,
  };
}

test('persistSourceObservations skips unknown sources instead of failing the whole batch on the FK', async () => {
  const pool = mockPool({
    handlerFor: (text) => text.startsWith('SELECT 1 FROM sources')
      ? { rows: [], rowCount: 0 }
      : { rows: [], rowCount: 0 },
  });
  const result = await persistSourceObservations(pool, 'not-a-source', [snapshot()]);
  assert.equal(result.persisted, 0);
  assert.equal(result.skipped, 'unknown_source');
  // No INSERT was attempted.
  assert.equal(pool.queries.some((q) => q.text.startsWith('INSERT INTO source_observations')), false);
});

test('persistSourceObservations batch-inserts with idempotent conflict handling for known sources', async () => {
  const pool = mockPool({
    handlerFor: (text) => text.startsWith('SELECT 1 FROM sources')
      ? { rows: [{ '?column?': 1 }], rowCount: 1 }
      : { rows: [], rowCount: 2 },
  });
  const result = await persistSourceObservations(pool, 'civilview', [snapshot(), snapshot({ observedAt: '2026-10-12T01:20:46.044Z' })]);
  assert.equal(result.persisted, 2);
  const insert = pool.queries.find((q) => q.text.startsWith('INSERT INTO source_observations'));
  assert.ok(insert);
  assert.match(insert.text, /ON CONFLICT \(id\) DO NOTHING/);
});

test('updateTriagePriority stamps triage_priority_refreshed_at on every write', async () => {
  const pool = mockPool({ handlerFor: () => ({ rows: [], rowCount: 1 }) });
  const result = await updateTriagePriority(pool, 'CIV-NJ-7-2128964683', 30);
  assert.equal(result.updated, true);
  assert.match(pool.queries[0].text, /triage_priority_refreshed_at = NOW\(\)/);
});

test('updateTriagePriority refuses out-of-range and non-integer scores', async () => {
  const pool = mockPool();
  assert.equal((await updateTriagePriority(pool, 'X', 100)).updated, false);
  assert.equal((await updateTriagePriority(pool, 'X', -1)).updated, false);
  assert.equal((await updateTriagePriority(pool, 'X', 20.5)).updated, false);
  assert.equal(pool.queries.length, 0);
});

test('recomputeTriageForListings evaluates durable history and persists the score', async () => {
  const updates = [];
  const pool = mockPool({
    handlerFor: (text, params) => {
      if (text.startsWith('SELECT')) {
        // Three changes across two snapshots: postponed -> active
        // (returned_to_market) and a bid drop (bid_reduced).
        return {
          rows: [
            { listing_id: 'CIV-NJ-7-2128964683', record_id: '2128964683', observed_at: new Date('2026-10-01T00:00:00.000Z'), opening_bid: '100000', sale_date: null, status: 'Status: Active - Postponed', deposit: null, address: '19 West Park Avenue' },
            { listing_id: 'CIV-NJ-7-2128964683', record_id: '2128964683', observed_at: new Date('2026-10-05T00:00:00.000Z'), opening_bid: '90000', sale_date: null, status: 'Status: Active', deposit: null, address: '19 West Park Avenue' },
          ],
          rowCount: 2,
        };
      }
      if (text.startsWith('UPDATE listings')) {
        updates.push({ text, params });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  });
  const result = await recomputeTriageForListings(pool, [listing()], { now: Date.parse('2026-10-21T00:00:00.000Z') });
  assert.equal(result.evaluated, 1);
  assert.equal(result.updated, 1);
  // Sale date 20 + bid reduction 20 + relist 10 = 50.
  assert.equal(updates[0].params[0], 50);
  assert.equal(updates[0].params[1], 'CIV-NJ-7-2128964683');
});

test('recomputeTriageForListings falls back to the filesystem store while the mirror is empty', async () => {
  const pool = mockPool({
    handlerFor: (text) => text.startsWith('SELECT')
      ? { rows: [], rowCount: 0 }
      : { rows: [], rowCount: 1 },
  });
  let fileHistoryReads = 0;
  const readFileHistory = () => {
    fileHistoryReads += 1;
    return { records: {}, signals: [] };
  };
  const result = await recomputeTriageForListings(pool, [listing()], { readFileHistory });
  assert.equal(fileHistoryReads, 1);
  assert.equal(result.evaluated, 1);
});

test('recomputeTriageForListings is bounded and skips malformed listings', async () => {
  const pool = mockPool({ handlerFor: () => ({ rows: [], rowCount: 0 }) });
  const many = Array.from({ length: 12 }, (_, index) => listing({ id: `L-${index}` }));
  const result = await recomputeTriageForListings(pool, [...many, null, {}], { limit: 5, readFileHistory: () => { throw new Error('unreadable'); } });
  // Limit respected; malformed listings skipped; unreadable history never crashes.
  assert.equal(result.evaluated, 5);
});

test('loadObservationsForRecord replays the shared classifier over persisted prose statuses', async () => {
  const pool = mockPool({
    handlerFor: () => ({
      rows: [
        { listing_id: 'CIV-NJ-7-2128964683', record_id: '2128964683', observed_at: new Date('2026-10-01T00:00:00.000Z'), opening_bid: '100000', sale_date: null, status: 'Status: Active - Postponed', deposit: null, address: '19 West Park Avenue' },
        { listing_id: 'CIV-NJ-7-2128964683', record_id: '2128964683', observed_at: new Date('2026-10-05T00:00:00.000Z'), opening_bid: '100000', sale_date: null, status: 'Status: Active', deposit: null, address: '19 West Park Avenue' },
      ],
      rowCount: 2,
    }),
  });
  const history = await loadObservationsForRecord(pool, listing());
  const relist = history.signals.find((s) => s.kind === 'returned_to_market');
  assert.ok(relist, 'expected a returned_to_market event from the prose transition');
  assert.equal(relist.before, 'Status: Active - Postponed');
  assert.equal(relist.after, 'Status: Active');
  const [recordKey, record] = Object.entries(history.records)[0];
  assert.match(recordKey, /^[a-f0-9]{64}$/);
  assert.equal(record.observations, 2);
  assert.equal(record.history.length, 2);
});
