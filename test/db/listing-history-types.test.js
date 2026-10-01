'use strict';

// test/db/listing-history-types.test.js
//
// getListingHistory must return the same *value types* on both backends.
//
// listing_history stores opening_bid / mid / deal_score as NUMERIC(14,2) and
// NUMERIC(5,2), and source_observed_at / recorded_at as TIMESTAMPTZ. node-pg
// hands NUMERIC back as a JavaScript **string** and TIMESTAMPTZ back as a
// **Date**. The in-memory branch returns finiteOrNull numbers and ISO strings.
// The Postgres read path used to pass the raw driver values straight through,
// so the same method returned the same keys with different types depending on
// whether DATABASE_URL was set — the invisible-until-production defect class
// this repo keeps hitting.
//
// The fake pool below deliberately returns driver-shaped values (strings for
// NUMERIC, Date for TIMESTAMPTZ) and applies the ::float8 / ::text casts the
// real query asks for, so a regression to the un-cast read fails here without
// needing a live database. test/db/listing-history.test.js covers the same
// method but requires DISCOVERY_TEST_DATABASE_URL/TEST_DATABASE_URL.

const assert = require('node:assert/strict');
const test = require('node:test');

const { DatabaseClient } = require('../../server/db/client');

// The NUMERIC columns as they sit in the table, before any cast.
const RAW_HISTORY_ROW = {
  listing_id: 'L1',
  source_observed_at: new Date('2026-09-01T12:00:00.000Z'),
  opening_bid: '50000.00',
  mid: '100000.00',
  deal_score: '70.00',
  source: 'treasury',
  recorded_at: new Date('2026-09-02T09:30:00.000Z')
};

// A row whose money/score columns are NULL, to pin the null contract.
const RAW_HISTORY_ROW_NULLS = {
  listing_id: 'L2',
  source_observed_at: new Date('2026-09-03T12:00:00.000Z'),
  opening_bid: null,
  mid: null,
  deal_score: null,
  source: null,
  recorded_at: new Date('2026-09-04T09:30:00.000Z')
};

// Emulates the driver faithfully:
//   - the row key is the SQL *alias*, not the underlying column name
//   - a NUMERIC column arrives as a string, a TIMESTAMPTZ column as a Date
//   - ::float8 coerces the numeric string to a number, ::text renders the Date
//     as an ISO string
// If the server stops asking for ::float8 / ::text, the raw driver types flow
// through and the assertions below fail — which is the defect under test.
function fakePool(rows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (!/FROM\s+listing_history/i.test(sql)) {
        throw new Error(`unexpected query in fake pool: ${sql.slice(0, 80)}`);
      }
      // Parse the select list (between SELECT and FROM) so the row keys match
      // what a real driver returns: the alias when one is given, otherwise the
      // column name. "DISTINCT ON (...)" is not part of the select list.
      const selectList = sql
        .replace(/SELECT\s+DISTINCT\s+ON\s*\([^)]*\)/i, 'SELECT')
        .split(/\bFROM\b/i)[0]
        .replace(/^\s*SELECT\s*/i, '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      const out = rows.map((row) => {
        const mapped = {};
        for (const item of selectList) {
          const aliased = item.match(/^(\w+)(::\w+)?\s+AS\s+"(\w+)"$/);
          const bare = item.match(/^(\w+)(::\w+)?$/);
          const m = aliased || bare;
          if (!m) throw new Error(`fake pool cannot parse projection: ${item}`);
          const column = m[1];
          const cast = m[2] || null;
          const key = aliased ? m[3] : column;
          const value = row[column];
          if (cast === '::float8' && value !== null && value !== undefined) {
            mapped[key] = Number(value);
          } else if (cast === '::text' && value instanceof Date) {
            mapped[key] = value.toISOString();
          } else {
            mapped[key] = value;
          }
        }
        return mapped;
      });
      return { rows: out, rowCount: out.length };
    }
  };
}

function pgClient(rows) {
  const pool = fakePool(rows);
  return { client: new DatabaseClient({ pool, env: { NODE_ENV: 'test' } }), pool };
}

const NUMERIC_FIELDS = ['openingBid', 'mid', 'dealScore'];
const TIMESTAMP_FIELDS = ['sourceObservedAt', 'recordedAt'];

test('the Postgres read casts NUMERIC columns and timestamps in SQL', async () => {
  const { client, pool } = pgClient([RAW_HISTORY_ROW]);
  await client.getListingHistory(['L1']);
  const sql = pool.calls[0].sql;
  assert.match(sql, /opening_bid::float8/,
    'opening_bid must be cast in SQL, the way LISTING_SELECT casts it');
  assert.match(sql, /deal_score::float8/,
    'deal_score must be cast in SQL, the way LISTING_SELECT casts it');
  assert.match(sql, /mid::float8/, 'mid must be cast in SQL');
  assert.match(sql, /source_observed_at::text/,
    'source_observed_at must be cast to text so the Date is not returned raw');
});

test('the Postgres path returns numbers for money/score and a string timestamp', async () => {
  const { client } = pgClient([RAW_HISTORY_ROW]);
  const history = await client.getListingHistory(['L1']);
  const snap = history.get('L1');

  for (const field of NUMERIC_FIELDS) {
    assert.equal(typeof snap[field], 'number',
      `${field} must be a number on the Postgres path, got ${typeof snap[field]}`);
    assert.equal(Number.isFinite(snap[field]), true, `${field} must be finite`);
  }
  for (const field of TIMESTAMP_FIELDS) {
    assert.equal(typeof snap[field], 'string',
      `${field} must be a string on the Postgres path, got ${typeof snap[field]}`);
    assert.equal(snap[field], new Date(snap[field]).toISOString(),
      `${field} must be an ISO string`);
  }
  assert.equal(typeof snap.listingId, 'string');
  assert.equal(snap.source, 'treasury');
});

test('both backends agree on types and values for the same snapshot', async () => {
  const { client: pg } = pgClient([RAW_HISTORY_ROW]);
  const mem = new DatabaseClient({ env: { NODE_ENV: 'test' } });
  await mem.recordListingHistorySnapshots([{
    id: 'L1',
    source: 'treasury',
    openingBid: 50000,
    mid: 100000,
    dealScore: 70,
    sourceObservedAt: '2026-09-01T12:00:00.000Z'
  }]);

  const fromPg = (await pg.getListingHistory(['L1'])).get('L1');
  const fromMem = (await mem.getListingHistory(['L1'])).get('L1');

  for (const field of NUMERIC_FIELDS) {
    assert.equal(typeof fromPg[field], typeof fromMem[field],
      `${field} type differs between backends`);
    assert.equal(fromPg[field], fromMem[field], `${field} value differs`);
  }
  for (const field of TIMESTAMP_FIELDS) {
    assert.equal(typeof fromPg[field], typeof fromMem[field],
      `${field} type differs between backends`);
  }
  assert.equal(fromPg.sourceObservedAt, fromMem.sourceObservedAt);
  assert.deepEqual(Object.keys(fromPg).sort(), Object.keys(fromMem).sort(),
    'the two backends must return the same keys');
});

test('a NULL money/score is null on both backends, never the string "null" or 0', async () => {
  const { client: pg } = pgClient([RAW_HISTORY_ROW_NULLS]);
  const mem = new DatabaseClient({ env: { NODE_ENV: 'test' } });
  await mem.recordListingHistorySnapshots([{
    id: 'L2',
    source: 'treasury',
    openingBid: null,
    mid: null,
    dealScore: null,
    sourceObservedAt: '2026-09-03T12:00:00.000Z'
  }]);

  const fromPg = (await pg.getListingHistory(['L2'])).get('L2');
  const fromMem = (await mem.getListingHistory(['L2'])).get('L2');
  for (const field of NUMERIC_FIELDS) {
    assert.equal(fromPg[field], null, `PG ${field} must be null, got ${fromPg[field]}`);
    assert.equal(fromMem[field], null, `in-memory ${field} must be null`);
  }
  assert.equal(fromPg.source, null);
});

test('the returned map is still keyed by listing id with an unchanged shape', async () => {
  const { client } = pgClient([RAW_HISTORY_ROW, RAW_HISTORY_ROW_NULLS]);
  const history = await client.getListingHistory(['L1', 'L2']);
  assert.ok(history instanceof Map);
  assert.equal(history.size, 2);
  assert.ok(history.has('L1'));
  assert.ok(history.has('L2'));
  assert.deepEqual(
    Object.keys(history.get('L1')).sort(),
    ['dealScore', 'listingId', 'mid', 'openingBid', 'recordedAt', 'source', 'sourceObservedAt'],
    'the key set is part of the contract and must not change'
  );
});
