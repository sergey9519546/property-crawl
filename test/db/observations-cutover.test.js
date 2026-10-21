'use strict';

// Guards for the Postgres-only observation cutover (migrations 025 + 027):
// recordSourceRun writes snapshots + run metadata directly to Postgres, the
// /sources view derives change events from snapshot pairs, and health reports
// the store's own facts. The retired JSON file store has no successor path —
// these tests pin that there is none to resurrect. Pure mock-pool tests: no
// database required; live-PG behavior is covered behind
// DISCOVERY_TEST_DATABASE_URL in test/db.test.js-style round-trips.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  importObservationRun,
  loadObservationsFromPg,
  observationStoreStats,
  recordSourceRun,
} = require('../../server/db/observations-persistence');

function mockPool(behavior = {}) {
  const queries = [];
  const pool = {
    queries,
    async query(text, params) {
      queries.push({ text: String(text), params });
      if (behavior.handlerFor) {
        const result = behavior.handlerFor(String(text), params);
        if (result) return result;
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

function listing(overrides = {}) {
  return {
    id: 'CIV-NJ-7-2128964683',
    source: 'civilview',
    state: 'NJ',
    county: 'Bergen',
    address: '19 West Park Avenue, Park Ridge, NJ 07656',
    openingBid: 100000,
    saleDate: '2099-12-31',
    status: 'Status: Active',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    raw: 'SHERIFF SALE NOTICE. 19 West Park Avenue.',
    provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: '2128964683' },
    sourceObservedAt: '2026-10-21T00:00:00.000Z',
    ...overrides,
  };
}

const KNOWN_SOURCE = { rows: [{ '?column?': 1 }], rowCount: 1 };

test('recordSourceRun throws loudly without Postgres — no silent local fallback', async () => {
  await assert.rejects(
    () => recordSourceRun(null, 'civilview', { listings: [] }),
    /require PostgreSQL/,
  );
});

test('recordSourceRun rejects invalid source ids', async () => {
  const pool = mockPool();
  await assert.rejects(
    () => recordSourceRun(pool, 'BAD SOURCE', { listings: [] }),
    /Invalid observation source/,
  );
});

test('recordSourceRun stores advancing snapshots and upserts run metadata', async () => {
  const pool = mockPool({
    handlerFor: (text) => {
      if (/SELECT 1 FROM sources/.test(text)) return KNOWN_SOURCE;
      if (/max\(observed_at\)/.test(text)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO source_observations/.test(text)) return { rows: [], rowCount: 2 };
      return { rows: [], rowCount: 1 };
    },
  });
  const result = await recordSourceRun(pool, 'civilview', {
    listings: [listing(), listing({ id: 'CIV-NJ-7-OTHER', provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: 'OTHER' } })],
    error: null,
    rejectedCount: 0,
    durationMs: 500,
  }, { now: '2026-10-21T00:00:00.000Z' });

  assert.equal(result.accepted, 2);
  assert.equal(result.snapshots.length, 2);
  assert.equal(result.persisted, 2);
  const insert = pool.queries.find((q) => q.text.startsWith('INSERT INTO source_observations'));
  assert.ok(insert, 'snapshots must be inserted');
  assert.match(insert.text, /ON CONFLICT \(id\) DO NOTHING/);
  const runUpsert = pool.queries.find((q) => q.text.includes('source_observation_runs'));
  assert.ok(runUpsert, 'run metadata must be upserted');
  // $1 source, $2 now, $3 accepted, $4 evidence, $5 rejected, $6 error, $7 duration
  assert.deepEqual(runUpsert.params.slice(0, 3), ['civilview', '2026-10-21T00:00:00.000Z', 2]);
  assert.equal(runUpsert.params[5], null, 'a successful run records no error');
  assert.match(runUpsert.text, /runs_count = r\.runs_count \+ 1/);
});

test('recordSourceRun skips snapshots that do not advance the record but still records the run', async () => {
  const pool = mockPool({
    handlerFor: (text) => {
      if (/SELECT 1 FROM sources/.test(text)) return KNOWN_SOURCE;
      if (/max\(observed_at\)/.test(text)) {
        return { rows: [{ record_id: '2128964683', latest_observed_at: new Date('2026-10-22T00:00:00.000Z') }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  });
  const result = await recordSourceRun(pool, 'civilview', {
    listings: [listing()], // captured 2026-10-21, store already has 2026-10-22
    error: null,
    rejectedCount: 0,
    durationMs: 500,
  }, { now: '2026-10-23T00:00:00.000Z' });

  assert.equal(result.accepted, 0, 'a stale capture must not rewrite a newer observation');
  assert.equal(result.persisted, 0);
  assert.equal(pool.queries.some((q) => q.text.startsWith('INSERT INTO source_observations')), false);
  const runUpsert = pool.queries.find((q) => q.text.includes('source_observation_runs'));
  assert.ok(runUpsert, 'the run still happened and must be recorded');
  assert.equal(runUpsert.params[2], 0);
});

test('recordSourceRun on an error run records metadata only — a failed request is never evidence', async () => {
  const pool = mockPool({
    handlerFor: (text) => (/SELECT 1 FROM sources/.test(text) ? KNOWN_SOURCE : { rows: [], rowCount: 1 }),
  });
  const result = await recordSourceRun(pool, 'civilview', {
    listings: [listing()],
    error: 'upstream_timeout',
    rejectedCount: 0,
    durationMs: 900,
  }, { now: '2026-10-21T00:00:00.000Z' });

  assert.equal(result.accepted, 0);
  assert.equal(result.snapshots.length, 0);
  assert.equal(pool.queries.some((q) => q.text.startsWith('INSERT INTO source_observations')), false);
  const runUpsert = pool.queries.find((q) => q.text.includes('source_observation_runs'));
  assert.equal(runUpsert.params[5], 'upstream_timeout');
  assert.match(runUpsert.text, /EXCLUDED\.error IS NULL THEN EXCLUDED\.last_run_at ELSE r\.last_success_at/,
    'the SQL must preserve last_success_at across error runs');
});

test('recordSourceRun skips unknown sources instead of failing the run on the FK', async () => {
  const pool = mockPool({
    handlerFor: (text) => (/SELECT 1 FROM sources/.test(text) ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 0 }),
  });
  const result = await recordSourceRun(pool, 'not-a-source', { listings: [listing()] }, { now: '2026-10-21T00:00:00.000Z' });
  assert.equal(result.accepted, 0);
  assert.equal(result.skipped, 'unknown_source');
  assert.equal(pool.queries.some((q) => q.text.includes('INSERT')), false);
});

test('loadObservationsFromPg returns an empty view without a pool', async () => {
  const view = await loadObservationsFromPg(null);
  assert.deepEqual(view, { runs: {}, records: {}, signals: [], trackedRecords: 0 });
});

test('loadObservationsFromPg derives change events from snapshot pairs and maps run metadata', async () => {
  const pool = mockPool({
    handlerFor: (text) => {
      if (/FROM source_observation_runs/.test(text)) {
        return {
          rows: [{
            source_key: 'civilview', last_run_at: new Date('2026-10-21T00:00:00.000Z'),
            last_success_at: new Date('2026-10-21T00:00:00.000Z'), last_non_empty_at: new Date('2026-10-21T00:00:00.000Z'),
            accepted_count: 3, evidence_count: 0, rejected_count: 1, error: null, duration_ms: 500, runs_count: 7,
          }],
          rowCount: 1,
        };
      }
      if (/count\(\*\)::int AS tracked/.test(text)) {
        return { rows: [{ tracked: 42 }], rowCount: 1 };
      }
      if (/WITH recent AS/.test(text)) {
        return {
          rows: [
            { listing_id: 'CIV-NJ-7-2128964683', source_key: 'civilview', record_id: '2128964683', observed_at: new Date('2026-10-01T00:00:00.000Z'), opening_bid: '100000', sale_date: null, status: 'Status: Active - Postponed', deposit: null, address: '19 West Park Avenue', source_url: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683', state: 'NJ', county: 'Bergen' },
            { listing_id: 'CIV-NJ-7-2128964683', source_key: 'civilview', record_id: '2128964683', observed_at: new Date('2026-10-05T00:00:00.000Z'), opening_bid: '90000', sale_date: null, status: 'Status: Active', deposit: null, address: '19 West Park Avenue', source_url: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683', state: 'NJ', county: 'Bergen' },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  });

  const view = await loadObservationsFromPg(pool);
  assert.equal(view.trackedRecords, 42);
  assert.equal(view.runs.civilview.acceptedCount, 3);
  assert.equal(view.runs.civilview.runs, 7);
  assert.equal(view.runs.civilview.lastRunAt, '2026-10-21T00:00:00.000Z');
  // One postponed -> active transition and one bid drop from the same pair.
  assert.equal(view.signals.length, 2);
  const relist = view.signals.find((signal) => signal.kind === 'returned_to_market');
  assert.ok(relist, 'the shared classifier must run over derived pairs');
  assert.equal(relist.observedAt, '2026-10-05T00:00:00.000Z');
  assert.equal(relist.before, 'Status: Active - Postponed');
  assert.equal(relist.after, 'Status: Active');
  assert.equal(relist.sourceId, 'civilview');
  assert.equal(relist.address, '19 West Park Avenue');
  assert.equal(relist.evidence.length, 2);
  assert.equal(relist.evidence[0].sourceUrl, 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683');
  assert.equal(view.signals.find((signal) => signal.kind === 'bid_reduced').after, 90000);
  assert.match(view.signals[0].id, /^[a-f0-9]{24}$/, 'event ids stay deterministic for idempotent consumers');
});

test('loadObservationsFromPg never serves more than its event cap', async () => {
  const pool = mockPool({
    handlerFor: (text) => {
      if (/FROM source_observation_runs/.test(text)) return { rows: [], rowCount: 0 };
      if (/count\(DISTINCT/.test(text)) return { rows: [{ tracked: 0 }], rowCount: 1 };
      if (/WITH recent AS/.test(text)) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  });
  const view = await loadObservationsFromPg(pool, { signalLimit: 5 });
  assert.deepEqual(view.signals, []);
});

test('observationStoreStats reports the Postgres facts, not a file countdown', async () => {
  assert.equal(await observationStoreStats(null), null, 'without Postgres there is no store to report');
  const pool = mockPool({
    handlerFor: () => ({
      rows: [{
        rows: 1234, tracked_records: 900,
        oldest_observed_at: new Date('2026-09-15T00:00:00.000Z'),
        newest_observed_at: new Date('2026-10-21T00:00:00.000Z'),
        table_bytes: 1048576,
      }],
      rowCount: 1,
    }),
  });
  const stats = await observationStoreStats(pool);
  assert.equal(stats.store, 'postgres');
  assert.equal(stats.rows, 1234);
  assert.equal(stats.trackedRecords, 900);
  assert.equal(stats.oldestObservedAt, '2026-09-15T00:00:00.000Z');
  assert.equal(stats.newestObservedAt, '2026-10-21T00:00:00.000Z');
  assert.equal(stats.tableBytes, 1048576);
  assert.equal(stats.willExceedCeiling, false, 'Postgres history has no file ceiling to hit');
});

test('importObservationRun writes absolute run metadata and never clobbers newer values', async () => {
  const pool = mockPool({
    handlerFor: (text) => (/SELECT 1 FROM sources/.test(text) ? KNOWN_SOURCE : undefined),
  });
  await importObservationRun(pool, 'civilview', {
    lastRunAt: '2026-10-01T00:00:00.000Z', lastSuccessAt: '2026-10-01T00:00:00.000Z',
    lastNonEmptyAt: '2026-10-01T00:00:00.000Z', acceptedCount: 25, evidenceCount: 0,
    rejectedCount: 2, error: 'old upstream error', durationMs: 4000, runs: 50,
  });
  const call = pool.queries.find((query) => query.text.includes('INSERT INTO source_observation_runs'));
  assert.ok(call, 'the import must write the run row');
  assert.match(call.text, /ON CONFLICT \(source_key\) DO UPDATE/);
  assert.match(call.text, /GREATEST\(r\.runs_count, EXCLUDED\.runs_count\)/,
    'a re-import must never shrink the live run count');
  assert.match(call.text, /error = COALESCE\(r\.error, EXCLUDED\.error\)/,
    'a current error beats a historical one');
  assert.equal(call.params[0], 'civilview');
  assert.equal(call.params[9], 50);
});

test('importObservationRun skips unknown sources instead of failing the import on the FK', async () => {
  const pool = mockPool(); // no sources row → unknown_source skip
  const result = await importObservationRun(pool, 'ghost-source', { runs: 9 });
  assert.equal(result.imported, false);
  assert.equal(result.skipped, 'unknown_source');
  assert.equal(pool.queries.some((query) => query.text.includes('INSERT')), false);
});

test('importObservationRun ignores malformed input', async () => {
  const pool = mockPool();
  assert.equal((await importObservationRun(null, 'civilview', { runs: 1 })).imported, false);
  assert.equal((await importObservationRun(pool, 'civilview', null)).imported, false);
  assert.equal(pool.queries.length, 0);
});
