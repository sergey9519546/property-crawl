'use strict';

// test/db/listings-scan.test.js
//
// scanAllListings is the one way to read the whole store. It exists because
// five call sites had each invented their own fixed cap:
//
//   auction-calendar   limit: 1000     reported 28 of 3,417 auctions
//   neighborhoods      limit: 1000     no disclosure at all
//   saved-searches     limit: 1000     "scanned: 1000" read as coverage
//   watchlist-comps    limit: 1000     comps from an arbitrary slice
//   source-network     limit: 10000    fine at 9,831 rows, silent at 10,001
//
// One implementation means the next caller cannot forget to disclose.

const assert = require('node:assert/strict');
const test = require('node:test');

const { scanAllListings } = require('../../server/db/listings-scan');

function pagedDb(pool, { reportTotal = true, maxPage = Infinity } = {}) {
  const calls = [];
  return {
    calls,
    async getListings(filters = {}) {
      const off = Number(filters.offset) || 0;
      const lim = Number(filters.limit) || 0;
      calls.push({ limit: lim, offset: off, sort: filters.sort });
      const capped = Math.min(lim, maxPage);
      return {
        total: reportTotal ? pool.length : undefined,
        listings: pool.slice(off, off + capped)
      };
    }
  };
}

function pool(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `L${String(i).padStart(5, '0')}` }));
}

test('reads the entire store across pages', async () => {
  const rows = pool(2500);
  const db = pagedDb(rows);
  const result = await scanAllListings(db);

  assert.equal(result.pool.length, 2500);
  assert.equal(result.scanned, 2500);
  assert.equal(result.availableTotal, 2500);
  assert.equal(result.truncated, false);
});

test('requests a total order so offset paging cannot skip or repeat a row', async () => {
  const db = pagedDb(pool(2500));
  await scanAllListings(db);
  for (const call of db.calls) {
    assert.equal(call.sort, 'date',
      'every page must use the same total-order sort');
    assert.equal(call.offset % 1000, 0, 'offsets must advance by whole pages');
  }
});

test('a backend that reports no total is read to end-of-stream', async () => {
  const rows = pool(2500);
  const db = pagedDb(rows, { reportTotal: false });
  const result = await scanAllListings(db);

  assert.equal(result.scanned, 2500);
  assert.equal(result.availableTotal, null, 'no reported size means no claim about one');
  assert.equal(result.truncated, false, 'we read until the stream ended, so nothing was left out');
});

test('a backend that caps page size below pageSize still terminates and reports it', async () => {
  // Backend yields 100 rows per call forever, but says the store holds 2,500.
  const rows = pool(2500);
  const db = pagedDb(rows, { maxPage: 100 });
  const result = await scanAllListings(db, {}, { pageSize: 100 });

  assert.equal(result.scanned, 2500);
  assert.equal(result.truncated, false);
});

test('a store larger than the reader is told so, not quietly shortened', async () => {
  const rows = pool(1000);
  const db = {
    async getListings(filters = {}) {
      const off = Number(filters.offset) || 0;
      return { total: 9831, listings: rows.slice(off, off + 1000) };
    }
  };
  const result = await scanAllListings(db);

  assert.equal(result.scanned, 1000);
  assert.equal(result.availableTotal, 9831);
  assert.equal(result.truncated, true);
});

test('maxRows stops the walk and reports truncation rather than looping', async () => {
  let calls = 0;
  const db = {
    async getListings(filters = {}) {
      calls += 1;
      return { total: 10_000_000, listings: pool(1000).map((r, i) => ({ id: `${calls}-${i}` })) };
    }
  };
  const result = await scanAllListings(db, {}, { maxRows: 5000 });

  assert.equal(result.scanned, 5000);
  assert.equal(result.truncated, true, 'hitting maxRows is truncation, and must say so');
  assert.ok(calls <= 10, 'the walk stops at the cap');
});

test('a larger pageSize is honoured so a caller can trade queries for rows', async () => {
  const db = pagedDb(pool(30000));
  const result = await scanAllListings(db, {}, { pageSize: 10000 });

  assert.equal(result.scanned, 30000);
  assert.equal(db.calls.length, 3, '30k rows at 10k per page is three round trips');
});

test('an empty store is not an error', async () => {
  const result = await scanAllListings(pagedDb([]));
  assert.deepEqual(result.pool, []);
  assert.equal(result.scanned, 0);
  assert.equal(result.truncated, false);
});

test('a backend returning junk is treated as an empty page, not a crash', async () => {
  const db = { async getListings() { return { total: 5, listings: null }; } };
  const result = await scanAllListings(db);
  assert.deepEqual(result.pool, []);
  assert.equal(result.truncated, true, 'it reported 5 but delivered none, so it was truncated');
});

test('filters are forwarded to every page', async () => {
  const db = pagedDb(pool(2500));
  await scanAllListings(db, { state: 'TX' });
  for (const call of db.calls) {
    assert.ok(call, 'each call is recorded');
  }
  assert.equal(db.calls.length, 3);
});