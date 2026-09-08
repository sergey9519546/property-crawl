'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { Pool } = require('pg');
const query = require('../server/discovery/query');

const databaseUrl = process.env.DISCOVERY_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
let pool;

before(() => { if (databaseUrl) pool = new Pool({ connectionString: databaseUrl, max: 1 }); });
after(async () => { if (pool) await pool.end(); });

for (const bucket of ['true', 'false', 'unknown']) test(`Postgres ${bucket} document bucket matches canonical memory semantics`, { skip: !databaseUrl }, async () => {
  const cases = [];
  for (const column of [null, true, false]) for (const documents of ['missing', 'empty', 'nonempty']) {
    const provenance = documents === 'missing' ? {} : { sourceFacts: { documents: documents === 'empty' ? [] : [{ id: 'doc-1' }] } };
    cases.push({ id: `${column}-${documents}`, hasDocuments: column, provenance });
  }
  const filter = query.queryFromUrl(new URL(`http://localhost/api/listings?hasDocuments=${bucket}`));
  const expected = cases.filter((item) => query.matches({ ...item, id: item.id }, filter)).map((item) => item.id).sort();
  const where = query.pgWhere(filter);
  const values = cases.map((item, index) => `($${where.params.length + index * 3 + 1},$${where.params.length + index * 3 + 2}::boolean,$${where.params.length + index * 3 + 3}::jsonb)`).join(',');
  const params = [...where.params, ...cases.flatMap((item) => [item.id, item.hasDocuments, JSON.stringify(item.provenance)])];
  const result = await pool.query(`WITH listings(id,has_documents,provenance) AS (VALUES ${values}) SELECT id FROM listings${where.sql} ORDER BY id`, params);
  assert.deepEqual(result.rows.map((row) => row.id), expected);
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
