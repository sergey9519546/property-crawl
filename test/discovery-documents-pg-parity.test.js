'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const query = require('../server/discovery/query');

const databaseUrl = process.env.DISCOVERY_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
let pool;

// Prefer an external server when one is configured, but do not require one.
// PGlite is Postgres compiled to WASM, so this suite can check the real SQL
// semantics in-process rather than skipping itself in every default run - which
// is exactly what let pgWhere compare 'maricopa' to 'Maricopa' while the
// in-memory matcher lowercased both sides. A guard that only proves itself when
// an operator exports a variable is not a guard.
before(async () => {
  if (databaseUrl) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    return;
  }
  const { PGlite } = require('@electric-sql/pglite');
  const pglite = new PGlite();
  await pglite.query('SELECT 1');
  pool = {
    query: (sql, params) => pglite.query(sql, params),
    end: async () => { await pglite.close(); },
  };
});
after(async () => { if (pool) await pool.end(); });

const documentStates = {
  missing: undefined,
  empty: [],
  positive: [{ id: 'doc-1' }],
  malformed: { id: 'not-an-array' },
};

function expectedDocumentState(column, sourceState, mediaState) {
  if (column === true || sourceState === 'positive' || mediaState === 'positive') return true;
  if (column === false || sourceState === 'empty' || mediaState === 'empty') return false;
  return null;
}

const documentCases = [];
for (const column of [null, true, false]) {
  for (const sourceState of Object.keys(documentStates)) {
    for (const mediaState of Object.keys(documentStates)) {
      const provenance = {};
      if (sourceState !== 'missing') provenance.sourceFacts = { documents: documentStates[sourceState] };
      if (mediaState !== 'missing') provenance.media = { documents: documentStates[mediaState] };
      documentCases.push({
        id: String(column) + '-' + sourceState + '-' + mediaState,
        hasDocuments: column,
        provenance,
        expected: expectedDocumentState(column, sourceState, mediaState),
      });
    }
  }
}

for (const bucket of ['true', 'false', 'unknown']) test(`Postgres ${bucket} document bucket matches explicit dual-container semantics`, async () => {
  const expectedValue = bucket === 'unknown' ? null : bucket === 'true';
  const expected = documentCases.filter((item) => item.expected === expectedValue).map((item) => item.id).sort();
  const filter = query.queryFromUrl(new URL(`http://localhost/api/listings?hasDocuments=${bucket}`));
  const memory = documentCases.filter((item) => query.matches(item, filter)).map((item) => item.id).sort();
  assert.deepEqual(memory, expected, 'memory query must match the stated tri-state contract');
  const where = query.pgWhere(filter);
  const values = documentCases.map((item, index) => `($${where.params.length + index * 3 + 1},$${where.params.length + index * 3 + 2}::boolean,$${where.params.length + index * 3 + 3}::jsonb)`).join(',');
  const params = [...where.params, ...documentCases.flatMap((item) => [item.id, item.hasDocuments, JSON.stringify(item.provenance)])];
  const result = await pool.query(`WITH listings(id,has_documents,provenance) AS (VALUES ${values}) SELECT id FROM listings${where.sql} ORDER BY id`, params);
  assert.deepEqual(result.rows.map((row) => row.id), expected, 'Postgres query must match the stated tri-state contract');
});

test('Postgres program and lifecycle fallbacks match canonical memory semantics', async () => {
  const rows = [
    { id: 'fallback', auctionProgram: null, lifecycleStatus: '', status: 'active', provenance: { sourceFacts: { auctionProgram: 'HUD REO' } } },
    { id: 'other', auctionProgram: 'Other', lifecycleStatus: 'closed', status: 'active', provenance: {} },
  ];
  const filter = query.queryFromUrl(new URL('http://localhost/api/listings?program=HUD%20REO&lifecycle=active'));
  const expected = rows.filter((row) => query.matches(row, filter)).map((row) => row.id);
  const where = query.pgWhere(filter);
  const values = rows.map((row, index) => `($${where.params.length + index * 6 + 1},$${where.params.length + index * 6 + 2},$${where.params.length + index * 6 + 3},$${where.params.length + index * 6 + 4},$${where.params.length + index * 6 + 5},$${where.params.length + index * 6 + 6}::jsonb)`).join(',');
  const params = [...where.params, ...rows.flatMap((row) => [row.id, row.auctionProgram, row.lifecycleStatus, row.status, null, JSON.stringify(row.provenance)])];
  const result = await pool.query(`WITH listings(id,auction_program,lifecycle_status,status,occupancy,provenance) AS (VALUES ${values}) SELECT id FROM listings${where.sql} ORDER BY id`, params);
  assert.deepEqual(result.rows.map((row) => row.id), expected);
});

// The two specific contracts above were found by un-skipping this file. This one
// exists so the NEXT divergence does not have to be found the same way: every
// filter pgWhere can express is run against real SQL and against matches() over
// the same rows, and any disagreement fails.
//
// The rows are built to exercise the awkward shapes - a program that lives only
// in provenance, a blank lifecycle_status, a padded city, a null bid - because
// those are exactly the cases where the two implementations drift apart.
const matrixRows = [
  { id: 'a', address: '1 Oak St', city: 'Phoenix', county: 'Maricopa', state: 'AZ', source: 'servicelink', propType: 'Single Family Home', auctionProgram: 'TPS', lifecycleStatus: 'Status: Active', status: 'ignored', occupancy: 'Vacant', saleDate: '2026-11-01', openingBid: 100000, dealScore: 80, equity: 5000, seniorLienRisk: 'high', redemptionDays: 0, hasDocuments: null, lat: 33.45, lng: -112.07, provenance: { origin: 'live', recordId: 'r-a' } },
  { id: 'b', address: '2 Elm St', city: 'Maricopa', county: 'Maricopa', state: 'az', source: 'hud', propType: 'PUD', auctionProgram: null, lifecycleStatus: '', status: 'Status: Active', occupancy: 'Occupied', saleDate: null, openingBid: null, dealScore: null, equity: null, seniorLienRisk: null, redemptionDays: 30, hasDocuments: true, lat: 33.46, lng: -112.08, provenance: { origin: 'live', recordId: 'r-b', sourceFacts: { auctionProgram: 'HUD REO', documents: [] } } },
  { id: 'c', address: '3 Fir St', city: 'Cook', county: 'Cook', state: 'IL', source: 'usda', propType: 'Land', auctionProgram: 'CWCOT', lifecycleStatus: 'Scheduled', status: 'ignored', occupancy: null, saleDate: '2026-10-15', openingBid: 25000, dealScore: 40, equity: 0, seniorLienRisk: 'low', redemptionDays: null, hasDocuments: false, lat: 41.88, lng: -87.63, provenance: { origin: 'unknown' } },
  { id: 'd', address: '4 Ash St', city: 'Phoenix ', county: 'Maricopa', state: 'AZ', source: 'servicelink', propType: 'Condo', auctionProgram: 'TPS', lifecycleStatus: 'Status: Cancelled', status: 'ignored', occupancy: 'VACANT', saleDate: '2026-12-01', openingBid: 75000, dealScore: 95, equity: 12000, seniorLienRisk: 'high', redemptionDays: 5, hasDocuments: null, lat: 33.47, lng: -112.06, provenance: { origin: 'live', recordId: 'r-d', media: { documents: [{ id: 'doc-d' }] } } },
  { id: 'e', address: '5 Yew St', city: 'Cook', county: 'Cook', state: 'IL', source: 'courtlistener', propType: null, auctionProgram: null, lifecycleStatus: null, status: 'Scheduled', occupancy: 'Occupied', saleDate: '2026-11-20', openingBid: 0, dealScore: 10, equity: null, seniorLienRisk: 'unknown', redemptionDays: 0, hasDocuments: null, lat: 41.90, lng: -87.60, provenance: {} },
];

const MATRIX_COLUMNS = [
  'id', 'address', 'city', 'county', 'state', 'source_key', 'prop_type',
  'auction_program', 'lifecycle_status', 'status', 'occupancy', 'sale_date',
  'opening_bid', 'deal_score', 'equity_spread', 'senior_lien_risk',
  'redemption_days', 'has_documents', 'provenance', 'latitude', 'longitude',
];
const matrixValue = (row, column) => ({
  id: row.id,
  address: row.address,
  city: row.city,
  county: row.county,
  state: row.state,
  source_key: row.source,
  prop_type: row.propType,
  auction_program: row.auctionProgram,
  lifecycle_status: row.lifecycleStatus,
  status: row.status,
  occupancy: row.occupancy,
  sale_date: row.saleDate,
  opening_bid: row.openingBid,
  deal_score: row.dealScore,
  equity_spread: row.equity,
  senior_lien_risk: row.seniorLienRisk,
  redemption_days: row.redemptionDays,
  has_documents: row.hasDocuments,
  provenance: JSON.stringify(row.provenance),
  latitude: row.lat,
  longitude: row.lng,
}[column]);

// Without explicit casts Postgres infers every VALUES column from the bound
// parameters and settles on text, so `provenance->'origin'` is an unknown-type
// expression and the whole query is refused.
const MATRIX_CASTS = {
  sale_date: 'date', opening_bid: 'numeric', deal_score: 'numeric',
  equity_spread: 'numeric', redemption_days: 'integer', has_documents: 'boolean',
  provenance: 'jsonb', latitude: 'float8', longitude: 'float8',
};

async function selectInPostgres(filter) {
  const where = query.pgWhere(filter);
  const values = matrixRows.map((row, index) => {
    const start = where.params.length + index * MATRIX_COLUMNS.length + 1;
    return `(${MATRIX_COLUMNS.map((column, offset) => `$${start + offset}${MATRIX_CASTS[column] ? `::${MATRIX_CASTS[column]}` : ''}`).join(',')})`;
  }).join(',');
  const params = [...where.params];
  for (const row of matrixRows) for (const column of MATRIX_COLUMNS) params.push(matrixValue(row, column));
  const result = await pool.query(
    `WITH listings(${MATRIX_COLUMNS.join(',')}) AS (VALUES ${values}) SELECT id FROM listings${where.sql} ORDER BY id`,
    params,
  );
  return result.rows.map((row) => row.id);
}

// Filters whose SQL needs PostGIS (ST_DWithin). The map path is covered by the
// bbox cases below and by the production e2e suite, so they are listed rather
// than silently skipped here.
const matrixFilters = [
  'q=phoenix', 'q=r-a', 'q=hud reo', 'q=oak',
  'state=AZ', 'state=az', 'county=Maricopa', 'county=maricopa',
  'source=servicelink', 'type=Condo', 'type=condo', 'type=unknown',
  'program=TPS', 'program=HUD%20REO', 'program=unknown',
  'lifecycle=Status%3A%20Active', 'lifecycle=Scheduled', 'lifecycle=unknown',
  'occupancy=Vacant', 'occupancy=OCCUPIED', 'occupancy=unknown',
  'freshness=observed', 'freshness=unverified',
  'hasDocuments=true', 'hasDocuments=false', 'hasDocuments=unknown',
  'saleFrom=2026-11-01', 'saleTo=2026-11-15',
  'maxBid=80000', 'minScore=80', 'minEquity=5000',
  'seniorLien=clean', 'seniorLien=risk',
  'redemption=immediate', 'redemption=redemption_active',
  'bbox=-112.2,33.4,-112.0,33.5', 'bbox=-88.0,41.8,-87.0,42.0',
  'state=AZ&county=Maricopa&occupancy=Vacant',
];

test('every filter pgWhere can express selects the same rows as matches()', async () => {
  const failures = [];
  for (const qs of matrixFilters) {
    const filter = query.queryFromUrl(new URL(`http://localhost/api/listings?${qs}`));
    const memory = matrixRows.filter((row) => query.matches(row, filter)).map((row) => row.id).sort();
    const postgres = (await selectInPostgres(filter)).sort();
    if (JSON.stringify(memory) !== JSON.stringify(postgres)) {
      failures.push(`${qs}\n    memory:   ${JSON.stringify(memory)}\n    postgres: ${JSON.stringify(postgres)}`);
    }
  }
  assert.deepEqual(failures, [], `memory and Postgres disagree on:\n  ${failures.join('\n  ')}`);
});

// The facet-versus-filter sweep that caught the lifecycle drift, turned into a
// standing test that runs against real SQL instead of being repeated by hand.
//
// Two bugs in this family shipped the same way: pgWhere was corrected to use a
// derived expression (lifecycle_status falling back to status; auction_program
// falling back to provenance) so it would agree with matches(), and the FACET
// kept grouping by the bare column. /listings then advertised a count that
// selecting it could not reproduce. Asserting the two string literals in the
// module catches that specific edit; this catches the whole class, including
// any future field, by asking the product its own question twice and comparing.
//
// It drives search(), so the SQL under test is the SQL the workbench runs.
test('every facet bucket the workbench offers can be selected and reproduces its own count', async () => {
  // Only the columns the facet and filter paths touch. listingSelect is set to
  // `id` so the projection stays out of it; pgRevision needs updated_at and the
  // default sort needs deal_score.
  await pool.query(`DROP TABLE IF EXISTS listings`);
  await pool.query(`CREATE TABLE listings (
    id text PRIMARY KEY,
    updated_at timestamptz DEFAULT now(),
    deal_score int,
    state text, county text, city text, address text,
    source_key text, prop_type text, occupancy text,
    auction_program text, lifecycle_status text, status text,
    has_documents boolean, provenance jsonb,
    sale_date date, opening_bid numeric, equity_spread numeric,
    senior_lien_risk text, redemption_days int,
    est_low numeric, est_high numeric,
    latitude float8, longitude float8
  )`);

  // Two rows that differ only where the derived fallbacks bite: one stores the
  // value in its column, the other carries it in provenance / in `status`.
  const seeded = [
    { id: 'col-a', state: 'AZ', county: 'Maricopa', city: 'Phoenix', address: '1 Oak St', source_key: 'servicelink', prop_type: 'Condo', occupancy: 'Vacant', auction_program: 'TPS', lifecycle_status: 'Status: Active', status: 'ignored', has_documents: true, provenance: { origin: 'live', recordId: 'r-a' }, deal_score: 90, sale_date: '2026-11-10', opening_bid: 60000, equity_spread: 5000, senior_lien_risk: 'high', redemption_days: 0, latitude: 33.45, longitude: -112.07 },
    { id: 'prov-b', state: 'AZ', county: 'Maricopa', city: 'Phoenix', address: '2 Elm St', source_key: 'hud', prop_type: 'Condo', occupancy: 'OCCUPIED', auction_program: null, lifecycle_status: '', status: 'Status: Active', has_documents: null, provenance: { origin: 'live', recordId: 'r-b', sourceFacts: { auctionProgram: 'HUD REO' } }, deal_score: 70, sale_date: '2026-11-12', opening_bid: 20000, equity_spread: 1000, senior_lien_risk: 'low', redemption_days: 12, latitude: 33.46, longitude: -112.08 },
  ];
  for (const row of seeded) {
    const keys = Object.keys(row);
    const placeholders = keys.map((_, i) => `$${i + 1}`);
    await pool.query(
      `INSERT INTO listings (${keys.join(',')}) VALUES (${placeholders.join(',')})`,
      keys.map((k) => (k === 'provenance' ? JSON.stringify(row[k]) : row[k])),
    );
  }

  const database = { isPg: true, pool, listingSelect: 'id' };
  // Only the fields the facet allowlist actually serves. hasDocuments is a filter
// with no facet, so it belongs to the matrix above and not to this sweep.
const FIELDS = ['state', 'county', 'source', 'type', 'program', 'lifecycle', 'occupancy', 'freshness'];
  const unfiltered = await query.search(database, query.queryFromUrl(new URL('http://localhost/api/listings')));

  const failures = [];
  for (const field of FIELDS) {
    const withFacets = await query.search(
      database,
      query.queryFromUrl(new URL(`http://localhost/api/listings?facets=${field}&limit=100`)),
    );
    for (const facet of withFacets.facets[field] || []) {
      let selected;
      try {
        selected = await query.search(
          database,
          query.queryFromUrl(new URL(`http://localhost/api/listings?${field}=${encodeURIComponent(facet.value)}&limit=100`)),
        );
      } catch (error) {
        failures.push(`${field}="${facet.value}" advertised by the facet cannot be selected: ${error.message}`);
        continue;
      }
      if (Number(selected.total) !== Number(facet.count)) {
        failures.push(`${field}="${facet.value}" facet says ${facet.count}, selecting it returns ${selected.total}`);
      }
    }
    // Every bucket must also be accounted for in the whole-store count.
    const summed = (withFacets.facets[field] || []).reduce((total, facet) => total + Number(facet.count), 0);
    if (summed !== Number(unfiltered.total)) {
      failures.push(`${field} buckets sum to ${summed}, the store holds ${unfiltered.total}`);
    }
  }
  assert.deepEqual(failures, [], `the workbench offers facet counts it cannot reproduce:\n  ${failures.join('\n  ')}`);
});

// Sorting is the same mirrored-pair hazard as faceting, one function over:
// pgSort ordered by the STORED column while the projection returns, and the UI
// shows, the DERIVED one. dealScore is null unless the record has an opening
// amount and an estimate range, so `sort=score` could rank a record by a number
// the API deliberately withholds - and the in-memory matcher, which sorts on
// a.dealScore, would put it elsewhere.
//
// Masked today only because no record in the live store carries a deal_score.
// That is a property of the current data, not of the query.
test('sorting uses the same derived values the API returns', async () => {
  // Same table the facet sweep above builds, cleared so the rows are only these
  // two. est_low/est_high live on that table because sort=score is defined in
  // terms of them.
  await pool.query('DELETE FROM listings');
  // "scored-but-withheld": a stored deal_score of 90, which the projection
  // withholds because there is no estimate range. "genuinely-scored": 50 with
  // the estimate range present, so the projection returns 50.
  for (const row of [
    { id: 'scored-but-withheld', deal_score: 90, opening_bid: 60000, est_low: null, est_high: null, equity_spread: null, sale_date: '2026-11-05' },
    { id: 'genuinely-scored', deal_score: 50, opening_bid: 60000, est_low: 80000, est_high: 100000, equity_spread: 30000, sale_date: '2026-11-10' },
  ]) {
    const keys = Object.keys(row);
    await pool.query(
      `INSERT INTO listings (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
      keys.map((k) => row[k]),
    );
  }

  const database = { isPg: true, pool, listingSelect: 'id, deal_score::float8 AS "dealScore"' };
  const scored = await query.search(database, query.queryFromUrl(new URL('http://localhost/api/listings?sort=score&limit=10')));

  // The projection is what the UI reads. Only the row with an estimate range
  // carries a score; the other is withheld, so it sorts last.
  const derivedScores = { 'scored-but-withheld': null, 'genuinely-scored': 50 };
  assert.deepEqual(
    scored.listings.map((l) => l.id),
    ['genuinely-scored', 'scored-but-withheld'],
    'sort=score must rank by the derived score the API returns, withholding first',
  );
  assert.equal(derivedScores['scored-but-withheld'], null);
});

// "Soonest sale date" has to mean the soonest UPCOMING sale. Plain ascending
// sale_date put every concluded auction ahead of every upcoming one, and the
// inventory has more past sales (2,026) than future (1,906), so the first page
// of this sort was entirely concluded records - while index.html labels the
// option "Soonest sale date" and the served API host renders that page.
test('date sort puts upcoming sales first and concluded ones last', async () => {
  const now = Date.now();
  const iso = (offsetDays) => new Date(now + offsetDays * 86_400_000).toISOString().slice(0, 10);
  await pool.query('DELETE FROM listings');
  for (const row of [
    { id: 'old-concluded', sale_date: iso(-400) },
    { id: 'soon-upcoming', sale_date: iso(3) },
    { id: 'later-upcoming', sale_date: iso(40) },
  ]) {
    await pool.query('INSERT INTO listings (id, sale_date) VALUES ($1, $2)', [row.id, row.sale_date]);
  }
  const database = { isPg: true, pool, listingSelect: 'id, sale_date::text AS "saleDate"' };
  const sorted = await query.search(
    database,
    query.queryFromUrl(new URL('http://localhost/api/listings?sort=date&limit=10')),
  );
  assert.deepEqual(
    sorted.listings.map((l) => l.id),
    ['soon-upcoming', 'later-upcoming', 'old-concluded'],
  );
});

// Pagination is the last major surface the parity matrix does not cover: filters
// decide WHICH rows match, but the cursor decides which of them appear on page
// two. The two backends paginate completely differently - the memory path finds
// the pivot and slices, the SQL path uses a keyset row-comparison - so they can
// disagree about the page boundary while agreeing perfectly about the row set.
//
// The seeded rows are ordered so every sort exercises the tie-break: equal
// deal_score and equal sale_date force the id tie-break to decide, which is
// exactly where an unstable or mismatched boundary drops or repeats a row.
test('paging returns the same rows in the same order on both backends', async () => {
  await pool.query('DELETE FROM listings');
  const rows = [
    { id: 'p1', deal_score: 50, sale_date: '2026-11-01', opening_bid: 100 },
    { id: 'p2', deal_score: 50, sale_date: '2026-11-01', opening_bid: 100 },
    { id: 'p3', deal_score: 50, sale_date: '2026-11-01', opening_bid: 100 },
    { id: 'p4', deal_score: 50, sale_date: '2026-11-01', opening_bid: 100 },
    { id: 'p5', deal_score: 50, sale_date: '2026-11-01', opening_bid: 100 },
    { id: 'p6', deal_score: 50, sale_date: '2026-11-01', opening_bid: 100 },
    { id: 'p7', deal_score: 50, sale_date: '2026-11-01', opening_bid: 100 },
  ];
  for (const row of rows) {
    await pool.query(
      'INSERT INTO listings (id, deal_score, sale_date, opening_bid, source_key) VALUES ($1,$2,$3,$4,$5)',
      [row.id, row.deal_score, row.sale_date, row.opening_bid, 'hud'],
    );
  }
  const memoryDatabase = {
    getListings: async () => ({
      total: rows.length,
      listings: rows.map((r) => ({
        ...r, source: 'hud', state: null, county: null, address: null, propType: null,
        occupancy: null, status: null, lat: null, lng: null, equity: null,
        provenance: { origin: 'live' }, sourceObservedAt: '2026-10-06T00:00:00.000Z',
      })),
    }),
  };
  const pgDatabase = { isPg: true, pool, listingSelect: 'id, deal_score::float8 AS "dealScore", opening_bid::float8 AS "openingBid"' };

  for (const sort of ['score', 'date', 'bid-asc']) {
    const walk = async (database) => {
      const seen = [];
      let cursor;
      for (let page = 0; page < 6; page += 1) {
        const url = new URL(`http://localhost/api/listings?limit=3&sort=${sort}`
          + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''));
        const result = await query.search(database, query.queryFromUrl(url));
        seen.push(...result.listings.map((l) => l.id));
        cursor = result.page.nextCursor;
        if (!cursor) break;
      }
      return seen;
    };
    const memory = await walk(memoryDatabase);
    const postgres = await walk(pgDatabase);
    assert.equal(new Set(postgres).size, postgres.length, `postgres repeated a row paging by ${sort}`);
    assert.deepEqual(postgres, memory, `the two backends page differently under sort=${sort}`);
    assert.equal(postgres.length, rows.length, `sort=${sort} lost rows across pages`);
  }
});
