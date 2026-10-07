'use strict';

// test/routes/neighborhoods-coverage.test.js
//
// /api/neighborhoods publishes the top `limit` buckets while reporting
// `scanned: <rows read>` and `truncated: false`. `truncated` describes the
// STORE READ -- and the store read was complete. Nothing in the payload says
// that the result itself is a slice.
//
// Measured against the live store:
//
//   rows read          9,831
//   rows bucketed      9,772   (59 have no zip and no city/state)
//   buckets in total   5,815
//   returned by default  100   covering 869 listings -- 8.8%
//
// So a reader sees a complete-looking payload describing 1.2% of the
// neighbourhoods and 8.8% of the inventory, with the one field that sounds
// like a completeness guarantee reading false.
//
// This is the same defect the auction calendar had: a slice published with
// counters that describe something else. The scanAllListings disclosure fixed
// the read; it could not have caught this, because the read was never the
// problem.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { createNeighborhoodsHandler } = require('../../server/routes/neighborhoods');

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(n, v) { this.headers[n] = v; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return v; },
  };
}

// Many zip codes, each with a handful of listings, so the bucket count is far
// larger than any limit the route accepts.
function widePool(zipCount = 400, perZip = 3) {
  const rows = [];
  for (let z = 0; z < zipCount; z += 1) {
    for (let i = 0; i < perZip; i += 1) {
      rows.push({
        id: `L-${z}-${i}`,
        source: 'treasury',
        state: 'TX',
        zip: String(10000 + z),
        city: 'Austin',
        address: `${z} ${i} Test St`,
        openingBid: 10000 + z * 100 + i,
        sourceObservedAt: new Date().toISOString(),
      });
    }
  }
  return rows;
}

function stubDb(pool) {
  return {
    async getListings({ limit = 1000, offset = 0 } = {}) {
      return { total: pool.length, listings: pool.slice(offset, offset + limit) };
    },
  };
}

async function invoke(handler, query = '') {
  const res = response();
  await handler(
    { method: 'GET', url: `/api/neighborhoods${query}`, headers: {} },
    res,
    new URL(`http://localhost/api/neighborhoods${query}`),
  );
  return res;
}

test('a sliced bucket list says how many buckets and listings it left out', async () => {
  const pool = widePool(); // 400 buckets, 1,200 rows
  const handler = createNeighborhoodsHandler({
    database: stubDb(pool),
    env: {},
    now: () => Date.parse('2026-10-07T12:00:00.000Z'),
  });

  const res = await invoke(handler, '?limit=10');
  assert.equal(res.statusCode, 200);

  assert.equal(res.body.neighborhoods.length, 10, 'limit is honoured');
  assert.equal(res.body.bucketsTotal, 400, 'the payload must say how many buckets exist');
  assert.equal(res.body.bucketsReturned, 10);
  assert.equal(res.body.bucketsTruncated, true, 'slicing the result is truncation');

  assert.equal(res.body.listingsBucketed, pool.length, 'rows that fell into a bucket');
  assert.equal(res.body.listingsCovered, 30, 'rows inside the ten returned buckets');
  assert.equal(res.body.listingsNotCovered, pool.length - 30);
  assert.equal(res.body.rowsWithoutNeighborhoodKey, 0);
});

test('a store read that was complete does not imply a result that was complete', async () => {
  // The exact trap: `truncated` stays false because the READ was whole, so a
  // reader who checks only that field concludes nothing was dropped.
  const handler = createNeighborhoodsHandler({
    database: stubDb(widePool()),
    env: {},
    now: () => Date.parse('2026-10-07T12:00:00.000Z'),
  });

  const res = await invoke(handler);
  assert.equal(res.body.truncated, false, 'the store read genuinely was complete');
  assert.equal(res.body.scanned, res.body.availableTotal);

  assert.equal(res.body.bucketsTruncated, true);
  assert.ok(
    res.body.listingsNotCovered > 0,
    'a payload can be complete to read and still omit most of the inventory, '
      + 'so it has to say how much it covers',
  );
});

test('counting rows that could not be bucketed is reported, not hidden', async () => {
  const pool = widePool(10, 2); // 10 buckets, 20 rows
  pool.push({ id: 'NO-ZIP', source: 'treasury', state: 'TX', address: 'Somewhere' });

  const handler = createNeighborhoodsHandler({
    database: stubDb(pool),
    env: {},
    now: () => Date.parse('2026-10-07T12:00:00.000Z'),
  });

  const res = await invoke(handler);
  assert.equal(res.body.rowsWithoutNeighborhoodKey, 1,
    'a listing with neither zip nor city is dropped by the bucketer and must be counted');
  assert.equal(res.body.listingsBucketed, 20);
  assert.equal(res.body.bucketsTotal, 10);
  assert.equal(res.body.bucketsTruncated, false, 'every bucket was returned');
});

test.after(() => { /* temp dirs are never created: this suite uses stubs only */ });