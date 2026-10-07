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
