'use strict';

// test/db/auction-calendar-native.test.js
//
// getAuctionCalendarNative is the production path for GET /api/auction-calendar.
// It had three defects that no mock-pool test could see, because each only
// exists inside a real PostgreSQL engine:
//
//   1. `GROUP BY ... samp.sample` where `sample` was `json`: PostgreSQL has no
//      equality operator for json, so EVERY call failed with 42883 and the route
//      answered 503 "data service unavailable" against a healthy database.
//   2. Eligibility was `status = 'active'`, which excluded `scheduled` - the very
//      upcoming auctions a calendar exists to show.
//   3. Week buckets were truncated on a timestamptz, so a server whose session
//      timezone is not UTC produced week starts shifted by the UTC offset.
//
// Expectations below are computed by hand from the fixtures, not read back from
// the implementation under test.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
const { migrate } = require('../../scripts/discovery-migrate');
const { DatabaseClient, prepareListingForPersistence } = require('../../server/db/client');

const NOW_MS = Date.parse('2026-10-12T00:00:00Z'); // a Monday
const fixture = (id, over) => ({
  id, source: 'treasury', state: 'PA', county: 'Test', city: 'Testville', zip: '19000',
  address: `${id} Main St`, propType: 'Single Family', status: 'scheduled', ...over,
});

const FIXTURES = [
  // Week of Mon 2026-10-12: A and B  -> count 2, median bid (100000+200000)/2, median score 70
  fixture('cal-a', { saleDate: '2026-10-14', openingBid: 100000, dealScore: 80 }),
  fixture('cal-b', { saleDate: '2026-10-15', openingBid: 200000, dealScore: 60 }),
  // Week of Mon 2026-10-19: F (TX)
  fixture('cal-f', { saleDate: '2026-10-21', openingBid: 50000, dealScore: 90, state: 'TX' }),
  // Terminal statuses are never upcoming
  fixture('cal-closed', { saleDate: '2026-10-16', openingBid: 1, status: 'closed' }),
  fixture('cal-sold', { saleDate: '2026-10-16', openingBid: 1, status: 'sold' }),
  fixture('cal-cancelled', { saleDate: '2026-10-16', openingBid: 1, status: 'cancelled' }),
  // Dropped: no date / outside the 30-day window
  fixture('cal-nodate', { saleDate: null, openingBid: 1 }),
  fixture('cal-far', { saleDate: '2027-06-01', openingBid: 1 }),
];

test('auction calendar native SQL runs on a real engine and returns hand-computed weeks', { timeout: 180_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-embedded-cal-'));
  try {
    const { pool } = await startEmbeddedPostgres({ dataDir });
    try {
      await migrate(pool);
      const db = new DatabaseClient({ pool, liveCachePath: null, workspaceStorePath: null });
      for (const listing of FIXTURES) {
        await db.createListing(prepareListingForPersistence(listing));
        // deal_score is derived on write from value estimates; pin the stored
        // score so the median arithmetic below is exercised against known inputs.
        if (listing.dealScore != null) {
          await pool.query('UPDATE listings SET deal_score = $1 WHERE id = $2', [listing.dealScore, listing.id]);
        }
      }

      // Run under a non-UTC session timezone: week boundaries must not move.
      for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
        await pool.query(`SET TIME ZONE '${tz}'`);
        const result = await db.getAuctionCalendarNative({ windowDays: 30, sampleSize: 3, nowMs: NOW_MS });

        assert.equal(result.weeks.length, 2, `${tz}: two populated weeks`);
        const [w1, w2] = result.weeks;
        assert.equal(w1.weekStart, '2026-10-12T00:00:00.000Z', `${tz}: Monday-start UTC week`);
        assert.equal(w2.weekStart, '2026-10-19T00:00:00.000Z', `${tz}: next Monday-start UTC week`);

        assert.equal(w1.count, 2);
        assert.equal(w1.medianOpeningBid, 150000);
        assert.equal(w1.medianDealScore, 70);
        assert.deepEqual(w1.sources, { treasury: 2 });
        assert.deepEqual(w1.sample.map((s) => s.id), ['cal-a', 'cal-b'], `${tz}: sample ordered by sale date`);
        assert.equal(w1.sample[0].openingBid, 100000);
        assert.equal(w1.sample[0].saleDate, '2026-10-14');

        assert.equal(w2.count, 1);
        assert.deepEqual(w2.sample.map((s) => s.id), ['cal-f']);

        // terminal statuses (closed/sold/cancelled) are not in any bucket
        assert.equal(result.auctionsInWindow, 3);
        // scanned = every non-terminal row: a, b, f, nodate, far
        assert.equal(result.scanned, 5);
        assert.equal(result.dropped.noDate, 1);
        assert.equal(result.dropped.outsideWindow, 1);
      }

      // State filter narrows buckets and is reported as dropped, not silently lost.
      await pool.query("SET TIME ZONE 'UTC'");
      const tx = await db.getAuctionCalendarNative({ windowDays: 30, sampleSize: 3, nowMs: NOW_MS, states: ['tx'] });
      assert.equal(tx.weeks.length, 1);
      assert.equal(tx.weeks[0].count, 1);
      assert.equal(tx.dropped.stateFilter, 2);

      // sampleSize is honoured
      const one = await db.getAuctionCalendarNative({ windowDays: 30, sampleSize: 1, nowMs: NOW_MS });
      assert.equal(one.weeks[0].sample.length, 1);
      assert.equal(one.weeks[0].count, 2, 'count is unaffected by sample size');
    } finally {
      await pool.end();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
