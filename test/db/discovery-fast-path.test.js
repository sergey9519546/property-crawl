'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
const { migrate } = require('../../scripts/discovery-migrate');
const { DatabaseClient } = require('../../server/db/client');
const discovery = require('../../server/discovery/query');
const handleListings = require('../../server/routes/listings');

const BOOT_TIMEOUT_MS = 120_000;

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { res.headers[k] = v; },
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; },
    send(data) { res.body = data; return res; },
  };
  return res;
}

function parityFixtures() {
  return [
    {
      id: 'fast:scored-active',
      source: 'hud',
      state: 'NJ',
      county: 'Hudson',
      city: 'Jersey City',
      zip: '07302',
      address: '123 Christopher Street, Jersey City, NJ 07302',
      lat: 40.72,
      lng: -74.05,
      openingBid: 100000,
      estLow: 220000,
      estHigh: 260000,
      dealScore: 88,
      saleDate: '2026-12-20',
      propType: 'Single Family',
      status: 'active',
      auctionProgram: null,
      provenance: {
        origin: 'live',
        observed: true,
        recordId: 'REC-CHRISTOPHER-1',
        sourceFacts: {
          auctionProgram: 'HUD TPS',
          upsetPrice: '100000',
        },
      },
    },
    {
      id: 'fast:tier3-unscored',
      source: 'servicelink',
      state: 'NJ',
      county: 'Hudson',
      city: 'Hoboken',
      zip: '07030',
      address: '45 Christopher Ave, Hoboken, NJ 07030',
      lat: 40.74,
      lng: -74.03,
      openingBid: 150000,
      saleDate: '2026-12-25',
      propType: 'Condo',
      status: 'active',
      provenance: {
        origin: 'seeded',
        recordId: 'REC-22',
      },
    },
    {
      id: 'fast:tier2-upset',
      source: 'civilview',
      state: 'NJ',
      county: 'Essex',
      city: 'Newark',
      zip: '07102',
      address: '78 Main St, Newark, NJ 07102',
      openingBid: null,
      saleDate: '2026-12-28',
      propType: 'Duplex',
      status: 'scheduled',
      provenance: {
        origin: 'live',
        observed: true,
        recordId: 'REC-UPSET-3',
        sourceFacts: { upsetPrice: '90000' },
      },
    },
    {
      id: 'fast:tier1-coords',
      source: 'irs',
      state: 'TX',
      county: 'Harris',
      city: 'Houston',
      zip: '77001',
      address: '9 Oak Ln, Houston, TX 77001',
      openingBid: null,
      lat: 29.76,
      lng: -95.36,
      status: 'active',
      provenance: { origin: 'seeded', recordId: 'REC-100%_PCT' },
    },
    {
      id: 'fast:terminal-outcome',
      source: 'hud',
      state: 'NJ',
      county: 'Hudson',
      city: 'Jersey City',
      zip: '07302',
      address: '88 Sold Way, Jersey City, NJ 07302',
      lat: 40.71,
      lng: -74.04,
      openingBid: 80000,
      estLow: 250000,
      estHigh: 300000,
      dealScore: 95,
      status: 'active',
      provenance: {
        origin: 'live',
        observed: true,
        sourceFacts: { transactionOutcome: 'Sold - 3rd Party' },
      },
    },
    {
      id: 'fast:terminal-lifecycle',
      source: 'treasury',
      state: 'OH',
      county: 'Cuyahoga',
      city: 'Cleveland',
      zip: '44101',
      address: '12 Dismissed Rd, Cleveland, OH 44101',
      openingBid: 50000,
      estLow: 200000,
      estHigh: 220000,
      dealScore: 90,
      status: 'active',
      lifecycleStatus: 'Sold: 3rd Party',
      provenance: { origin: 'seeded' },
    },
  ];
}

function normalizeFacets(facets) {
  const out = {};
  for (const [k, buckets] of Object.entries(facets || {})) {
    out[k] = [...buckets].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  return out;
}

test('accelerated discovery schema, triggers, search parity, explain plan, and autocomplete fast path', { timeout: BOOT_TIMEOUT_MS * 2 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-fast-path-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir });
    await migrate(embedded.pool);
    const pg = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });
    assert.equal(await pg.verifyConnection(), true);
    const memory = new DatabaseClient({
      env: { ...process.env, PROPERTY_INVENTORY_BACKEND: 'memory', NODE_ENV: 'test' },
      liveCachePath: null,
      workspaceStorePath: null,
    });
    memory.inMemoryData.listings = [];

    for (const row of parityFixtures()) {
      await pg.createListing(row);
      await memory.createListing(row);
    }

    assert.equal(typeof pg.hasAcceleratedDiscovery, 'function');
    assert.equal(await pg.hasAcceleratedDiscovery(), true);

    // 1. Index definition check: old 011/033 expression index dropped; search_text trigram GIN present.
    const idxRows = (await embedded.pool.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'listings'`,
    )).rows;
    assert.equal(
      idxRows.some((r) => r.indexname === 'idx_listings_discovery_full_search'),
      false,
      'stale idx_listings_discovery_full_search index must be dropped by migration 034',
    );
    const searchIdx = idxRows.find((r) => r.indexname === 'idx_listings_discovery_search_text_trgm');
    assert.ok(searchIdx, 'idx_listings_discovery_search_text_trgm must exist');
    assert.match(searchIdx.indexdef, /gin/i);
    assert.match(searchIdx.indexdef, /discovery_search_text/);

    // 2. Full parity with in-memory discovery.search across sort, search q, program, and facets.
    const queries = [
      'http://localhost/api/listings?sort=score&limit=50&facets=state,county,source,type,program,lifecycle,occupancy,freshness',
      'http://localhost/api/listings?q=Christopher&limit=12&facets=freshness,program',
      'http://localhost/api/listings?q=REC-CHRISTOPHER-1',
      'http://localhost/api/listings?q=HUD%20TPS',
      'http://localhost/api/listings?q=100%25_&limit=12',
      'http://localhost/api/listings?freshness=observed&facets=freshness',
      'http://localhost/api/listings?program=HUD%20TPS&facets=program',
    ];
    for (const rawUrl of queries) {
      const f = discovery.queryFromUrl(new URL(rawUrl));
      const fromPg = await discovery.search(pg, f);
      const fromMem = await discovery.search(memory, f);
      assert.deepEqual(
        fromPg.listings.map((l) => l.id),
        fromMem.listings.map((l) => l.id),
        `ordered id parity failed for ${rawUrl}`,
      );
      assert.equal(fromPg.total, fromMem.total, `total parity failed for ${rawUrl}`);
      assert.deepEqual(normalizeFacets(fromPg.facets), normalizeFacets(fromMem.facets), `facet parity failed for ${rawUrl}`);
    }

    // 3. Trigger maintenance on UPDATE + O(1) revision bump.
    const revBefore = Number((await embedded.pool.query('SELECT revision FROM discovery_listing_revision WHERE singleton = TRUE')).rows[0].revision);
    await embedded.pool.query(
      `UPDATE listings
         SET status = 'sold',
             provenance = jsonb_set(jsonb_set(provenance, '{origin}', '"live"'), '{recordId}', '"UPDATED-TOKEN-99"')
       WHERE id = 'fast:tier3-unscored'`,
    );
    const revAfter = Number((await embedded.pool.query('SELECT revision FROM discovery_listing_revision WHERE singleton = TRUE')).rows[0].revision);
    assert.ok(revAfter > revBefore, 'revision must increment after listing update');

    // Sync equivalent update in memory and verify parity + search on updated token.
    const memTarget = memory.inMemoryData.listings.find((l) => l.id === 'fast:tier3-unscored');
    memTarget.status = 'sold';
    memTarget.provenance = { ...memTarget.provenance, origin: 'live', recordId: 'UPDATED-TOKEN-99' };

    for (const rawUrl of [
      'http://localhost/api/listings?sort=score&limit=50&facets=freshness,lifecycle',
      'http://localhost/api/listings?q=UPDATED-TOKEN-99',
    ]) {
      const f = discovery.queryFromUrl(new URL(rawUrl));
      const fromPg = await discovery.search(pg, f);
      const fromMem = await discovery.search(memory, f);
      assert.deepEqual(fromPg.listings.map((l) => l.id), fromMem.listings.map((l) => l.id));
      assert.deepEqual(normalizeFacets(fromPg.facets), normalizeFacets(fromMem.facets));
    }

    // 4. Inspect executed SQL on accelerated path: uses discovery_* inline columns + discovery_listing_revision.
    const capturedSql = [];
    const origQuery = embedded.pool.query.bind(embedded.pool);
    embedded.pool.query = async (sql, params) => {
      capturedSql.push(String(sql));
      return origQuery(sql, params);
    };
    try {
      await discovery.search(pg, discovery.queryFromUrl(new URL('http://localhost/api/listings?q=Christopher&limit=12&facets=freshness,program')));
    } finally {
      embedded.pool.query = origQuery;
    }
    assert.ok(capturedSql.some((s) => s.includes('discovery_listing_revision')), 'pgRevision must read discovery_listing_revision');
    const mainSql = capturedSql.find((s) => s.includes('"cursorValue"'));
    assert.ok(mainSql && mainSql.includes('discovery_terminal') && mainSql.includes('discovery_search_text'), 'main SELECT must use accelerated inline columns');
    assert.doesNotMatch(mainSql, /provenance->'sourceFacts'/, 'main sort/search SQL must not detoast provenance->sourceFacts');
    assert.ok(capturedSql.some((s) => s.includes('discovery_is_live') && s.includes('GROUP BY 1')), 'freshness facet must use discovery_is_live');

    // 5. Autocomplete fast path via HTTP handler & discovery.search (PG + memory parity, minimal shape, <= 1 SQL query).
    const acQueries = [];
    embedded.pool.query = async (sql, params) => {
      acQueries.push(String(sql));
      return origQuery(sql, params);
    };
    try {
      const req = { method: 'GET', url: '/api/listings?q=Christopher&limit=12&mode=autocomplete', headers: {} };
      const res = makeRes();
      await handleListings(req, res, pg);
      assert.equal(res.statusCode, 200);
      assert.ok(Array.isArray(res.body.listings) && res.body.listings.length === 2);
      assert.equal(res.body.listings[0].id, 'fast:scored-active');
      assert.deepEqual(Object.keys(res.body.listings[0]).sort(), ['address', 'city', 'county', 'id', 'state', 'zip']);
      assert.equal(acQueries.length, 1, 'autocomplete mode must execute only 1 SELECT query (no count(*) or revision scan)');

      const memReq = { method: 'GET', url: '/api/listings?q=Christopher&limit=12&mode=autocomplete', headers: {} };
      const memRes = makeRes();
      await handleListings(memReq, memRes, memory);
      assert.equal(memRes.statusCode, 200);
      assert.deepEqual(memRes.body.listings, res.body.listings);
    } finally {
      embedded.pool.query = origQuery;
    }

    // 6. Scale EXPLAIN check: with 1,500 rows + ANALYZE, trigram GIN index is planned.
    const fillerValues = [];
    for (let i = 0; i < 1500; i++) {
      fillerValues.push([
        `fill:${i}`,
        'servicelink',
        'OH',
        'Franklin',
        'Columbus',
        '43004',
        `${100 + i} Maple Ave, Columbus, OH 43004`,
        'active',
        '{"origin":"seeded"}',
      ]);
    }
    for (let offset = 0; offset < fillerValues.length; offset += 250) {
      const chunk = fillerValues.slice(offset, offset + 250);
      const placeholders = chunk.map((_, idx) => {
        const b = idx * 9;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9}::jsonb)`;
      }).join(',');
      await embedded.pool.query(
        `INSERT INTO listings (id, source_key, state, county, city, zip, address, status, provenance) VALUES ${placeholders}`,
        chunk.flat(),
      );
    }
    await embedded.pool.query('ANALYZE listings');
    const autocompleteSql =
      `EXPLAIN (COSTS OFF) SELECT id, address, city, county, state, zip FROM listings ` +
      `WHERE discovery_search_text ILIKE '%Christopher Street%' ESCAPE '\\' ` +
      `ORDER BY discovery_terminal ASC, deal_score DESC NULLS LAST, id DESC LIMIT 12`;
    const defaultPlanRows = (await embedded.pool.query(autocompleteSql)).rows
      .map((r) => r['QUERY PLAN'])
      .join('\n');
    assert.match(defaultPlanRows, /discovery_search_text/, `expected planner predicate on inline discovery_search_text:\n${defaultPlanRows}`);
    assert.doesNotMatch(defaultPlanRows, /provenance/, `expected zero provenance TOAST filter in autocomplete plan:\n${defaultPlanRows}`);

    // At ~1.5k small rows Postgres may pick a fast inline Seq Scan under default random_page_cost=4.
    // Disable seqscan inside a transaction to prove pg_trgm + ESCAPE '\\' validly binds to the GIN index.
    const planClient = await embedded.pool.connect();
    let forcedIndexPlan = '';
    try {
      await planClient.query('BEGIN');
      await planClient.query('SET LOCAL enable_seqscan = off');
      forcedIndexPlan = (await planClient.query(autocompleteSql)).rows
        .map((r) => r['QUERY PLAN'])
        .join('\n');
      await planClient.query('COMMIT');
    } finally {
      await planClient.query('ROLLBACK').catch(() => {});
      planClient.release();
    }
    assert.match(forcedIndexPlan, /idx_listings_discovery_search_text_trgm/, `expected planner to bind GIN trigram index:\n${forcedIndexPlan}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('discovery.search falls back cleanly on synthetic Postgres tables without migration 034 or revision table', { timeout: BOOT_TIMEOUT_MS }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-fast-fallback-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir, applySchema: false });
    await embedded.pool.query(`
      CREATE TABLE listings (
        id TEXT PRIMARY KEY,
        source_key TEXT,
        state TEXT,
        county TEXT,
        city TEXT,
        zip TEXT,
        address TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        beds INT,
        baths NUMERIC,
        sqft INT,
        year_built INT,
        prop_type TEXT,
        opening_bid NUMERIC,
        est_low NUMERIC,
        est_high NUMERIC,
        assessed_value NUMERIC,
        equity_spread NUMERIC,
        deal_score INT,
        sale_date DATE,
        plaintiff TEXT,
        defendant TEXT,
        judgment_amount NUMERIC,
        attorney TEXT,
        occupancy TEXT,
        deposit_terms TEXT,
        photo_url TEXT,
        images JSONB,
        source_url TEXT,
        raw_notice TEXT,
        provenance JSONB,
        source_observed_at TIMESTAMPTZ,
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        price NUMERIC,
        listing_date DATE,
        redemption_days INT,
        redemption_warning TEXT,
        senior_lien_risk TEXT,
        senior_lien_warning TEXT,
        cash_to_close NUMERIC,
        cash_to_close_details JSONB,
        status TEXT DEFAULT 'active',
        auction_program TEXT,
        lifecycle_status TEXT,
        transaction_outcome TEXT,
        has_documents BOOLEAN,
        triage_priority INT,
        triage_priority_refreshed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO listings (id, source_key, state, county, city, zip, address, provenance)
      VALUES ('syn:1', 'hud', 'NJ', 'Hudson', 'Jersey City', '07302', '10 Synthetic Way', '{"origin":"live","recordId":"SYN-1"}'::jsonb);
    `);

    const synDb = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });
    assert.equal(await synDb.hasAcceleratedDiscovery(), false);
    const out = await discovery.search(synDb, discovery.queryFromUrl(new URL('http://localhost/api/listings?q=Synthetic&facets=freshness')));
    assert.equal(out.total, 1);
    assert.equal(out.listings[0].id, 'syn:1');
    assert.deepEqual(out.facets.freshness, [{ value: 'observed', count: 1 }]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('frontend Hero requests mode=autocomplete and InteractiveTerminal defers bulk inventory polling on mount', () => {
  const root = path.resolve(__dirname, '..', '..');
  const heroSrc = fs.readFileSync(path.join(root, 'src/components/site/hero.tsx'), 'utf8');
  const terminalSrc = fs.readFileSync(path.join(root, 'src/components/terminal/interactive-terminal.tsx'), 'utf8');

  assert.match(heroSrc, /\/api\/listings\?q=.*mode=autocomplete/, 'Hero must request lightweight mode=autocomplete payload');
  assert.match(terminalSrc, /setTimeout/, 'InteractiveTerminal initial mount load must defer past initial Hero hydration to avoid starving Hero on /');
});

test('start-production grants >= 60s backend liveness budget when Postgres is configured for startup migrations', () => {
  const root = path.resolve(__dirname, '..', '..');
  const startProd = fs.readFileSync(path.join(root, 'scripts/start-production.js'), 'utf8');
  assert.match(startProd, /hasDatabase\s*\?\s*(90000|120000)/, 'Postgres startup liveness window must allow migrations such as 034 to finish without a 10s SIGTERM');
});

test('discovery-migrate retries transient 55P03/40P01 lock errors and fails closed on non-lock SQL errors', async () => {
  const migrationsDir = path.resolve(__dirname, '..', '..', 'server', 'db', 'migrations');
  const firstMigration = fs.readdirSync(migrationsDir).filter((n) => /^\d+.*\.sql$/.test(n)).sort()[0];
  let applyAttempt = 0;
  const queries = [];
  const fakePool = {
    async connect() {
      return {
        async query(text) {
          const sql = String(text);
          queries.push(sql);
          if (sql.includes('SELECT to_regclass')) return { rows: [{ relation: 'listings' }] };
          if (sql.includes('SELECT sha256 FROM discovery_schema_migrations')) return { rows: [] };
          if (sql.includes('CREATE TABLE') || sql.startsWith('SET ') || sql.startsWith('RESET') || sql.startsWith('SELECT pg_advisory') || sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('INSERT INTO discovery_schema_migrations')) {
            return { rows: [] };
          }
          // Fail first attempt on the first migration with PG lock timeout (55P03), succeed after.
          if (queries.filter((q) => q === 'BEGIN').length === 1 && applyAttempt === 0) {
            applyAttempt += 1;
            const err = new Error('canceling statement due to lock timeout');
            err.code = '55P03';
            throw err;
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };

  await migrate(fakePool, { maxLockAttempts: 3, retryDelayMs: 1, lockTimeout: '25s' });
  const inserts = queries.filter((q) => q.startsWith('INSERT INTO discovery_schema_migrations'));
  const migrationFiles = fs.readdirSync(migrationsDir).filter((n) => /^\d+.*\.sql$/.test(n));
  assert.equal(applyAttempt, 1, 'positive control: first attempt hit 55P03 and retried');
  assert.equal(inserts.length, migrationFiles.length, 'all migrations applied cleanly after lock retry');
  assert.ok(queries.includes("SET lock_timeout = '25s'"), 'configured DDL lock timeout is applied');

  // Negative control: persistent 55P03 beyond maxLockAttempts or non-lock SQL error (42703) must still throw with filename prefix.
  const errPool = {
    async connect() {
      return {
        async query(text) {
          const sql = String(text);
          if (sql.includes('SELECT to_regclass')) return { rows: [{ relation: 'listings' }] };
          if (sql.includes('SELECT sha256 FROM discovery_schema_migrations')) return { rows: [] };
          if (sql.includes('CREATE TABLE') || sql.startsWith('SET ') || sql.startsWith('RESET') || sql.startsWith('SELECT pg_advisory') || sql === 'BEGIN' || sql === 'ROLLBACK') {
            return { rows: [] };
          }
          const err = new Error('column missing');
          err.code = '42703';
          throw err;
        },
        release() {},
      };
    },
  };
  await assert.rejects(
    () => migrate(errPool, { maxLockAttempts: 3, retryDelayMs: 1 }),
    { message: new RegExp(`^${firstMigration.replace('.', '\\.')}: column missing`) },
  );

  // Also test persistent 55P03 exhausts retries and throws with filename prefix.
  let persistCalls = 0;
  const persistPool = {
    async connect() {
      return {
        async query(text) {
          const sql = String(text);
          if (sql.includes('SELECT to_regclass')) return { rows: [{ relation: 'listings' }] };
          if (sql.includes('SELECT sha256 FROM discovery_schema_migrations')) return { rows: [] };
          if (sql.includes('CREATE TABLE') || sql.startsWith('SET ') || sql.startsWith('RESET') || sql.startsWith('SELECT pg_advisory') || sql === 'BEGIN' || sql === 'ROLLBACK') {
            return { rows: [] };
          }
          persistCalls += 1;
          const err = new Error('canceling statement due to lock timeout');
          err.code = '55P03';
          throw err;
        },
        release() {},
      };
    },
  };
  await assert.rejects(
    () => migrate(persistPool, { maxLockAttempts: 3, retryDelayMs: 1 }),
    { message: new RegExp(`^${firstMigration.replace('.', '\\.')}: canceling statement due to lock timeout`) },
  );
  assert.equal(persistCalls, 3, 'persistent lock timeout retries exactly maxLockAttempts times');
});

test('pre-034 Postgres upgrades cleanly through split 034 (DDL) and 035 (backfill + GIN index)', { timeout: BOOT_TIMEOUT_MS }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-upgrade-034-035-'));
  try {
    const embedded = await startEmbeddedPostgres({ dataDir, applySchema: false });
    await embedded.pool.query(`
      CREATE TABLE IF NOT EXISTS discovery_listing_revision (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        revision BIGINT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO discovery_listing_revision (singleton, revision) VALUES (TRUE, 1) ON CONFLICT DO NOTHING;
      CREATE TABLE listings (
        id TEXT PRIMARY KEY,
        source_key TEXT,
        state TEXT,
        county TEXT,
        city TEXT,
        zip TEXT,
        address TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        beds INT,
        baths NUMERIC,
        sqft INT,
        year_built INT,
        prop_type TEXT,
        opening_bid NUMERIC,
        est_low NUMERIC,
        est_high NUMERIC,
        assessed_value NUMERIC,
        equity_spread NUMERIC,
        deal_score INT,
        sale_date DATE,
        plaintiff TEXT,
        defendant TEXT,
        judgment_amount NUMERIC,
        attorney TEXT,
        occupancy TEXT,
        deposit_terms TEXT,
        photo_url TEXT,
        images JSONB,
        source_url TEXT,
        raw_notice TEXT,
        provenance JSONB,
        source_observed_at TIMESTAMPTZ,
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        price NUMERIC,
        listing_date DATE,
        redemption_days INT,
        redemption_warning TEXT,
        senior_lien_risk TEXT,
        senior_lien_warning TEXT,
        cash_to_close NUMERIC,
        cash_to_close_details JSONB,
        status TEXT DEFAULT 'active',
        auction_program TEXT,
        lifecycle_status TEXT,
        transaction_outcome TEXT,
        has_documents BOOLEAN,
        triage_priority INT,
        triage_priority_refreshed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE discovery_schema_migrations (
        name text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO listings (id, source_key, state, county, city, zip, address, opening_bid, status, provenance)
      VALUES
        ('upg:active', 'hud', 'NJ', 'Essex', 'Montclair', '07042', '42 Christopher Street', 120000, 'active', '{"origin":"live","recordId":"UPG-1","sourceFacts":{"auctionProgram":"HUD TPS"}}'::jsonb),
        ('upg:sold', 'hud', 'NJ', 'Essex', 'Newark', '07102', '99 Christopher Way', 90000, 'sold', '{"origin":"live","recordId":"UPG-2"}'::jsonb);
    `);

    const migrationsDir = path.resolve(__dirname, '..', '..', 'server', 'db', 'migrations');
    const pre034Files = fs.readdirSync(migrationsDir).filter((n) => /^\d+.*\.sql$/.test(n) && n < '034_').sort();
    const crypto = require('node:crypto');
    for (const name of pre034Files) {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDir, name), 'utf8')).digest('hex');
      await embedded.pool.query('INSERT INTO discovery_schema_migrations(name, sha256) VALUES($1, $2)', [name, digest]);
    }

    const pg = new DatabaseClient({ pool: embedded.pool, liveCachePath: null, workspaceStorePath: null });
    assert.equal(await pg.hasAcceleratedDiscovery({ forceRefresh: true }), false);

    // Apply ONLY 034: columns exist, but index is not yet created -> acceleration gate must remain false.
    const sql034 = fs.readFileSync(path.join(migrationsDir, '034_discovery_fast_search_and_rank.sql'), 'utf8');
    await embedded.pool.query(sql034);
    assert.equal(
      await pg.hasAcceleratedDiscovery({ forceRefresh: true }),
      false,
      'hasAcceleratedDiscovery must stay false between 034 (columns added) and 035 (backfill + GIN index)',
    );

    // Record 034 and let migrate() apply 035 cleanly.
    const d034 = crypto.createHash('sha256').update(sql034).digest('hex');
    await embedded.pool.query('INSERT INTO discovery_schema_migrations(name, sha256) VALUES($1, $2)', ['034_discovery_fast_search_and_rank.sql', d034]);
    await migrate(embedded.pool);

    assert.equal(await pg.hasAcceleratedDiscovery({ forceRefresh: true }), true);
    const backfilled = (await embedded.pool.query(
      "SELECT id, discovery_terminal, discovery_action_tier, discovery_is_live, discovery_program, discovery_search_text FROM listings ORDER BY id",
    )).rows;
    const activeRow = backfilled.find((r) => r.id === 'upg:active');
    const soldRow = backfilled.find((r) => r.id === 'upg:sold');
    assert.equal(activeRow.discovery_terminal, false);
    assert.equal(activeRow.discovery_action_tier, 2);
    assert.equal(activeRow.discovery_is_live, true);
    assert.equal(activeRow.discovery_program, 'HUD TPS');
    assert.match(activeRow.discovery_search_text, /Christopher Street/);
    assert.equal(soldRow.discovery_terminal, true);

    const out = await discovery.search(pg, discovery.queryFromUrl(new URL('http://localhost/api/listings?q=Christopher&status=active')));
    assert.equal(out.total, 1);
    assert.equal(out.listings[0].id, 'upg:active');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
