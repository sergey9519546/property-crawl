'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { Pool } = require('pg');
const query = require('../server/discovery/query');

const databaseUrl = process.env.DISCOVERY_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
let pool;

before(() => { if (databaseUrl) pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
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

for (const bucket of ['true', 'false', 'unknown']) test(`Postgres ${bucket} document bucket matches explicit dual-container semantics`, { skip: !databaseUrl }, async () => {
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

test('Postgres program and lifecycle fallbacks match canonical memory semantics', { skip: !databaseUrl }, async () => {
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
