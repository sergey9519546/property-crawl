'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DatabaseClient } = require('../../server/db/client');
const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
const { migrate } = require('../../scripts/discovery-migrate');
const { DiscoveryStore } = require('../../server/discovery/store');
const discovery = require('../../server/discovery/query');
const { probeDiscoveryDatabase } = require('../../server/discovery-readiness');
const { recomputeTriageForListings } = require('../../server/db/observations-persistence');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('036 migration, lock-free revision sequence, GROUPING SETS 8-facet + 0-row parity, single-RTT readiness, batched snapshot & triage', { timeout: 120_000 }, async () => {
  const dataDir = makeTempDir('hotfix-regression-pg-');
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    try {
      await migrate(embedded.pool);
      const pg = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });
      assert.equal(await pg.verifyConnection(), true);
      pg.inMemoryData.listings = [];

      // 1. Sequence & expression indexes exist after migration 036
      const idxRes = await embedded.pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'listings' AND indexname = ANY($1::text[])`,
        [['idx_listings_lower_state_bid', 'idx_listings_lower_state_county']],
      );
      assert.equal(idxRes.rows.length, 2, '036 must create state+bid and state+county expression indexes');

      // Simulate concurrent writer that incremented sequence without acquiring advisory singleton update lock
      const beforeOut = await discovery.search(pg, discovery.queryFromUrl(new URL('http://localhost/api/listings?limit=1')));
      const beforeRev = Number(beforeOut.revision);
      await embedded.pool.query(`SELECT setval('discovery_listing_revision_seq', $1, TRUE)`, [beforeRev + 25]);
      const aheadOut = await discovery.search(pg, discovery.queryFromUrl(new URL('http://localhost/api/listings?limit=1')));
      const seqAheadRev = Number(aheadOut.revision);
      assert.ok(seqAheadRev >= beforeRev + 25, 'pgRevision must observe sequence progress even without singleton row update');

      // 2. Single-RTT readiness probe
      const readinessSql = [];
      const spiedProbePool = {
        query: async (sql, params) => {
          readinessSql.push(String(sql));
          return embedded.pool.query(sql, params);
        },
      };
      const probeOut = await probeDiscoveryDatabase(spiedProbePool);
      assert.equal(readinessSql.length, 1, 'probeDiscoveryDatabase must execute in 1 SQL round trip when schema is healthy');
      assert.equal(probeOut.postgis, true);
      assert.ok(Array.isArray(probeOut.tables) && probeOut.tables.length > 0);

      // Missing table diagnostics still throw clean missing-tables error
      const missingPool = {
        query: async (sql) => {
          if (sql.includes('pg_class')) {
            const err = new Error('relation "discovery_jobs" does not exist');
            err.code = '42P01';
            throw err;
          }
          return { rows: [{ postgis: true, tables: ['listings'] }] };
        },
      };
      await assert.rejects(() => probeDiscoveryDatabase(missingPool), /Required discovery tables are missing:/);

      // 3. Seed diverse listings including literal 'unknown', blank strings, NULLs, multiple sources
      const fixtures = [
        {
          id: 'hf:1', source: 'hud', state: 'NJ', county: 'Hudson', city: 'Jersey City', zip: '07302',
          address: '100 First St, Jersey City, NJ 07302', propType: 'Single Family', openingBid: 120000,
          estLow: 250000, estHigh: 290000, saleDate: '2026-12-20', occupancy: 'Occupied',
          status: 'active', auctionProgram: 'HUD TPS', lifecycleStatus: 'active',
          provenance: { origin: 'live', observed: true, publisher: 'HUD', recordId: 'HF-1', sourceFacts: { auctionProgram: 'HUD TPS' } },
          sourceObservedAt: '2026-11-10T10:00:00.000Z',
        },
        {
          id: 'hf:2', source: 'civilview', state: 'NJ', county: 'Bergen', city: 'Hackensack', zip: '07601',
          address: '200 Main St, Hackensack, NJ 07601', propType: 'unknown', openingBid: 180000,
          estLow: 300000, estHigh: 350000, saleDate: '2026-12-25', occupancy: '',
          status: 'unknown', auctionProgram: null, lifecycleStatus: null,
          provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: 'HF-2' },
          sourceObservedAt: '2026-11-10T10:00:00.000Z',
        },
        {
          id: 'hf:3', source: 'gsa', state: 'CA', county: 'Los Angeles', city: 'Los Angeles', zip: '90049',
          address: '300 Oak Ave, Los Angeles, CA 90049', propType: '', openingBid: null,
          saleDate: null, occupancy: 'unknown', status: 'active', auctionProgram: null, lifecycleStatus: 'active',
          provenance: { origin: 'snapshot', observed: false, publisher: 'GSA', recordId: 'HF-3' },
          sourceObservedAt: '2026-11-10T10:00:00.000Z',
        },
        {
          id: 'hf:4', source: 'treasury', state: 'NJ', county: 'Hudson', city: 'Hoboken', zip: '07030',
          address: '400 Park Ave, Hoboken, NJ 07030', propType: null, openingBid: 95000,
          estLow: 210000, estHigh: 240000, saleDate: '2026-12-18', occupancy: null,
          status: 'sold', auctionProgram: 'Treasury RP', lifecycleStatus: 'sold',
          provenance: { origin: 'live', observed: true, publisher: 'Treasury', recordId: 'HF-4' },
          sourceObservedAt: '2026-11-10T10:00:00.000Z',
        },
      ];

      const memory = new DatabaseClient({ env: { ...process.env, PROPERTY_INVENTORY_BACKEND: 'memory', NODE_ENV: 'test' }, liveCachePath: null, workspaceStorePath: null });
      memory.inMemoryData.listings = [];
      for (const item of fixtures) {
        await pg.createListing(item);
        await memory.createListing(item);
      }
      assert.equal(await pg.hasAcceleratedDiscovery({ forceRefresh: true }), true);

      const normalizeFacets = (f) => Object.fromEntries(
        Object.entries(f || {}).map(([k, arr]) => [
          k,
          [...arr].sort((a, b) => (b.count - a.count) || String(a.value).localeCompare(String(b.value))),
        ]),
      );

      // 8-facet query parity + low query count + GROUPING SETS verification
      const capturedSearchSql = [];
      const origPoolQuery = embedded.pool.query.bind(embedded.pool);
      embedded.pool.query = async (sql, params) => {
        capturedSearchSql.push(String(sql));
        return origPoolQuery(sql, params);
      };
      try {
        const all8Url = 'http://localhost/api/listings?status=all&limit=50&facets=state,county,source,type,program,lifecycle,occupancy,freshness';
        const fromPg = await discovery.search(pg, discovery.queryFromUrl(new URL(all8Url)));
        const fromMem = await discovery.search(memory, discovery.queryFromUrl(new URL(all8Url)));
        assert.equal(fromPg.total, fromMem.total);
        assert.deepEqual(normalizeFacets(fromPg.facets), normalizeFacets(fromMem.facets));
        assert.ok(capturedSearchSql.some((s) => s.includes('GROUP BY GROUPING SETS')), 'multi-facet query must use single-scan GROUPING SETS');
        assert.ok(capturedSearchSql.length <= 4, `expected <= 4 SQL queries for 8-facet search, got ${capturedSearchSql.length}`);

        // 0-row filter parity
        const zeroUrl = 'http://localhost/api/listings?state=ZZ&facets=state,county,source,type,program,lifecycle,occupancy,freshness';
        const zeroPg = await discovery.search(pg, discovery.queryFromUrl(new URL(zeroUrl)));
        assert.equal(zeroPg.total, 0);
        assert.deepEqual(zeroPg.listings, []);
        for (const key of ['state', 'county', 'source', 'type', 'program', 'lifecycle', 'occupancy', 'freshness']) {
          assert.deepEqual(zeroPg.facets[key], []);
        }
      } finally {
        embedded.pool.query = origPoolQuery;
      }

      // 4. Batched appendSnapshot (1 CTE inside transaction instead of 1+N observation round trips)
      const store = new DiscoveryStore(embedded.pool);
      const runRow = await store.beginRun({ sourceKey: 'hud', trigger: 'test', scope: { state: 'NJ' } });
      const snapQueries = [];
      const origConnect = embedded.pool.connect.bind(embedded.pool);
      embedded.pool.connect = async () => {
        const client = await origConnect();
        const origClientQuery = client.query.bind(client);
        client.query = async (sql, params) => {
          if (!/^(BEGIN|COMMIT|ROLLBACK)$/.test(String(sql).trim())) snapQueries.push(String(sql));
          return origClientQuery(sql, params);
        };
        return client;
      };
      let snap1, snap2;
      try {
        const obs = {};
        for (let i = 0; i < 12; i++) obs[`field_${i}`] = { value: `val_${i}`, evidenceClass: 'publisher_reported' };
        snap1 = await store.appendSnapshot({
          runId: runRow.id,
          sourceKey: 'hud',
          sourceRecordId: 'HF-1',
          observedAt: '2026-11-10T10:00:00.000Z',
          rawPayload: { hello: 'world' },
          provenance: { origin: 'live' },
          observations: obs,
        });
        assert.equal(snapQueries.length, 1, `appendSnapshot with 12 observations must execute 1 batched CTE, got ${snapQueries.length}`);
        snap2 = await store.appendSnapshot({
          runId: runRow.id,
          sourceKey: 'hud',
          sourceRecordId: 'HF-1',
          observedAt: '2026-11-10T10:00:00.000Z',
          rawPayload: { hello: 'world' },
          provenance: { origin: 'live' },
          observations: obs,
        });
      } finally {
        embedded.pool.connect = origConnect;
      }
      assert.equal(snap2.id, snap1.id);
      const obsCount = Number((await embedded.pool.query('SELECT count(*)::int AS c FROM discovery_observations WHERE snapshot_id = $1', [snap1.id])).rows[0].c);
      assert.equal(obsCount, 12);

      // 5. Batched recomputeTriageForListings (<= 2 SQL queries + IS DISTINCT FROM / > 6h skip on re-run)
      const triageQueries = [];
      const spiedTriagePool = {
        query: async (sql, params) => {
          triageQueries.push(String(sql));
          return embedded.pool.query(sql, params);
        },
      };
      const triaged1 = await recomputeTriageForListings(spiedTriagePool, fixtures);
      assert.equal(triaged1.evaluated, 4);
      assert.equal(triaged1.updated, 4);
      assert.equal(triageQueries.length, 2, `recomputeTriageForListings must execute 1 batch SELECT + 1 batch UPDATE, got ${triageQueries.length}`);

      const triaged2 = await recomputeTriageForListings(spiedTriagePool, fixtures);
      assert.equal(triaged2.evaluated, 4);
      assert.equal(triaged2.updated, 0, 'recomputeTriageForListings within 6h with unchanged scores must skip redundant writes');

      // Insert real source_observations (bid reduction) and prove batch LATERAL matches forceRowUpdates: true
      await embedded.pool.query(
        `INSERT INTO source_observations(id, listing_id, source_key, record_id, observed_at, opening_bid, status)
         VALUES
           ('obs-hf1-1', 'hf:1', 'hud', 'HF-1', '2026-11-01T00:00:00Z', 160000, 'active'),
           ('obs-hf1-2', 'hf:1', 'hud', 'HF-1', '2026-11-08T00:00:00Z', 120000, 'active')
         ON CONFLICT (id) DO NOTHING`,
      );
      const triagedWithObs = await recomputeTriageForListings(spiedTriagePool, fixtures);
      assert.equal(triagedWithObs.evaluated, 4);
      assert.ok(triagedWithObs.updated >= 1, 'bid reduction signal in source_observations must bump hf:1 triage_priority');
      const batchTp = Number((await embedded.pool.query(`SELECT triage_priority FROM listings WHERE id = 'hf:1'`)).rows[0].triage_priority);
      await embedded.pool.query(`UPDATE listings SET triage_priority = NULL WHERE id = 'hf:1'`);
      await recomputeTriageForListings(embedded.pool, fixtures, { forceRowUpdates: true });
      const rowTp = Number((await embedded.pool.query(`SELECT triage_priority FROM listings WHERE id = 'hf:1'`)).rows[0].triage_priority);
      assert.equal(batchTp, rowTp, 'batch LATERAL triage score must equal per-row forceRowUpdates score');

      // Aborted signal short-circuits pgSearch before hitting PG
      const ac = new AbortController();
      ac.abort();
      await assert.rejects(
        () => discovery.search(pg, discovery.queryFromUrl(new URL('http://localhost/api/listings?limit=5')), { signal: ac.signal }),
        (err) => err && err.status === 499,
      );

      // 6. createListing passes same transactional client to getListingById on stale partial refresh
      const clientQueries = [];
      const staleRejectionClient = {
        async query(sql, params) {
          clientQueries.push(String(sql));
          if (String(sql).includes('INSERT INTO listings')) {
            return { rows: [], rowCount: 0 };
          }
          if (String(sql).includes('FROM listings WHERE id = $1')) {
            assert.equal(params[0], 'hf:1');
            return { rows: [{ id: 'hf:1', source: 'hud', state: 'NJ', address: '100 First St' }] };
          }
          throw new Error(`Unexpected query on client: ${sql}`);
        },
      };
      const strictPoolDb = new DatabaseClient({
        pool: {
          async query() {
            throw new Error('pool.query must not be called while inside transactional client (self-deadlock regression)');
          },
        },
        liveCachePath: null,
        workspaceStorePath: null,
      });
      const retained = await strictPoolDb.createListing(
        { id: 'hf:1', source: 'hud', state: 'NJ', address: '100 First St', sourceObservedAt: '2026-10-01T00:00:00.000Z' },
        { client: staleRejectionClient },
      );
      assert.equal(retained.id, 'hf:1');
      assert.equal(clientQueries.length, 2);
    } finally {
      await embedded.pool.end().catch(() => {});
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Web-First semaphore prioritizes interactive HTTP queries and caps background DB concurrency', async () => {
  const db = new DatabaseClient({
    env: { ...process.env, PROPERTY_INVENTORY_BACKEND: 'memory', NODE_ENV: 'test', DATABASE_BG_MAX: '2' },
    liveCachePath: null,
    workspaceStorePath: null,
  });

  // 1. Background task yields while an interactive web query is active
  const order = [];
  db.enterWebQuery();
  const bgPromise = db.runBackgroundDbTask(async () => {
    order.push('bg-ran');
  }, { maxWebWaitMs: 2000 });
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(order, [], 'background DB task must yield while web query is active');
  order.push('web-finished');
  db.leaveWebQuery();
  await bgPromise;
  assert.deepEqual(order, ['web-finished', 'bg-ran']);

  // 2. Concurrent background tasks never exceed _maxBgDbConcurrency (2)
  let inFlight = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 6 }, () => db.runBackgroundDbTask(async () => {
      inFlight += 1;
      if (inFlight > peak) peak = inFlight;
      await new Promise((r) => setTimeout(r, 15));
      inFlight -= 1;
    })),
  );
  assert.equal(peak, 2, `background concurrency exceeded cap 2 (observed ${peak})`);
});

test('Scheduler onSourceRun skips assessor backfill on failed or empty runs', async () => {
  const scheduler = require('../../server/scrapers/scheduler');
  const backfillMod = require('../../server/enrichment/assessor-backfill');
  const origBackfill = backfillMod.backfillAssessorRolls;
  let backfillCalls = 0;
  backfillMod.backfillAssessorRolls = async () => {
    backfillCalls += 1;
    return { harvested: 0, persisted: 0, njEnriched: 0, notFound: 0, failed: 0 };
  };
  const prevEnable = scheduler.enableAssessorBackfill;
  scheduler.enableAssessorBackfill = true;
  scheduler._lastAssessorBackfillAt = 0;
  scheduler._assessorBackfillInFlight = false;
  try {
    await scheduler.onSourceRun('hud', { error: null, listings: [], accepted: 0, total: 0 });
    await scheduler.onSourceRun('hud', { error: 'upstream 503', listings: [{ id: 'x:1' }], accepted: 0, total: 1 });
    assert.equal(backfillCalls, 0, 'failed or empty runs must never trigger assessor backfill');
  } finally {
    backfillMod.backfillAssessorRolls = origBackfill;
    scheduler.enableAssessorBackfill = prevEnable;
  }
});
