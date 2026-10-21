'use strict';

// test/db/native-aggregations.test.js
//
// Verification suite for database-native aggregations:
//   - getNeighborhoodStatsNative
//   - getSingleNeighborhoodStatsNative
//   - getAuctionCalendarNative
//   - getSourceInventoryAggregatesNative
//   - getCompsCandidatesNative
//   - getListingsByParcelKeyNative

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseClient } = require('../../server/db/client');

function createInMemoryClient() {
  return new DatabaseClient({
    env: {
      ...process.env,
      PROPERTY_INVENTORY_BACKEND: 'memory',
      NODE_ENV: 'test'
    }
  });
}

test('getNeighborhoodStatsNative (in-memory mode) aggregates buckets correctly', async () => {
  const client = createInMemoryClient();
  const result = await client.getNeighborhoodStatsNative({
    maxAgeDays: 365,
    limit: 10
  });

  assert.equal(result.truncated, false);
  assert.ok(result.bucketsTotal > 0, 'Discloses positive bucketsTotal');
  assert.ok(result.listingsBucketed > 0, 'Discloses positive listingsBucketed');
  assert.ok(result.neighborhoods.length <= 10, 'Honors limit parameter');
  assert.ok(result.neighborhoods.length > 0, 'Returns neighborhoods');

  const top = result.neighborhoods[0];
  assert.ok(top.key, 'Bucket has key');
  assert.ok(top.count >= 1, 'Bucket has positive count');
  assert.ok(top.sources && typeof top.sources === 'object', 'Bucket has sources');
  assert.ok(top.propTypes && typeof top.propTypes === 'object', 'Bucket has propTypes');
});

test('getSingleNeighborhoodStatsNative (in-memory mode) returns null for non-existent neighborhood', async () => {
  const client = createInMemoryClient();
  const result = await client.getSingleNeighborhoodStatsNative('zip', '00000', {
    maxAgeDays: 365
  });

  assert.equal(result, null, 'Unknown zip returns null');
});

test('getAuctionCalendarNative (in-memory mode) groups listings by week', async () => {
  const client = createInMemoryClient();
  const result = await client.getAuctionCalendarNative({
    windowDays: 60
  });

  assert.equal(result.truncated, false);
  assert.ok(Array.isArray(result.weeks), 'Weeks is an array');
  assert.ok(result.scanned > 0, 'Discloses positive scanned total');
  assert.ok(typeof result.dropped.noDate === 'number', 'Discloses dropped counts');
});

test('getSourceInventoryAggregatesNative (in-memory mode) returns per-source tally map', async () => {
  const client = createInMemoryClient();
  const counts = await client.getSourceInventoryAggregatesNative();

  assert.ok(counts instanceof Map);
  assert.ok(counts.size > 0, 'Source tally map is populated');
  // Check that at least one known source has valid entries
  const firstSource = Array.from(counts.keys())[0];
  const entry = counts.get(firstSource);
  assert.ok(entry.observedRecords > 0, 'Has positive observedRecords');
  assert.ok(entry.states instanceof Set, 'States is a Set');
});

test('getNeighborhoodStatsNative (PostgreSQL mode) executes SQL CTE aggregation', async () => {
  const queries = [];
  const client = new DatabaseClient({ NODE_ENV: 'test' });
  client.isPg = true;
  client.pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('buckets_total')) {
        return {
          rows: [{ scanned: 100, listings_bucketed: 95, buckets_total: 10 }]
        };
      }
      return {
        rows: [
          {
            kind: 'zip',
            key: '77001',
            label: '77001',
            count: 5,
            medianOpeningBid: 85000,
            meanOpeningBid: 86000,
            medianSqft: 1650,
            medianDealScore: 75,
            medianDiscount: 0.35,
            sources: { hud: 3, treasury: 2 },
            propTypes: { 'Single Family': 5 }
          }
        ]
      };
    }
  };

  const result = await client.getNeighborhoodStatsNative({
    maxAgeDays: 180,
    limit: 50,
    state: 'TX',
    nowMs: Date.parse('2026-10-15T00:00:00.000Z')
  });

  assert.equal(queries.length, 2, 'Ran meta query and buckets query');
  assert.ok(queries[0].sql.includes('buckets_total'), 'Ran meta count');
  assert.ok(queries[1].sql.includes('PERCENTILE_CONT(0.5) WITHIN GROUP'), 'Executed native percentiles');
  assert.equal(queries[1].params[1], 'TX', 'Passed state filter');
  assert.equal(queries[1].params[2], 50, 'Passed limit param');

  assert.equal(result.scanned, 100);
  assert.equal(result.bucketsTotal, 10);
  assert.equal(result.neighborhoods.length, 1);
  assert.equal(result.neighborhoods[0].key, '77001');
  assert.equal(result.neighborhoods[0].medianOpeningBid, 85000);
});

test('getAuctionCalendarNative (PostgreSQL mode) executes window-ranked week aggregation', async () => {
  const queries = [];
  const client = new DatabaseClient({ NODE_ENV: 'test' });
  client.isPg = true;
  client.pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('dropped_no_date')) {
        return {
          rows: [{ scanned: 500, dropped_no_date: 5, dropped_outside: 20, dropped_state: 0 }]
        };
      }
      return {
        rows: [
          {
            week_start: '2026-11-02T00:00:00.000Z',
            count: 12,
            medianOpeningBid: 110000,
            medianDealScore: 74,
            sources: { hud: 8, sheriff: 4 },
            propTypes: { 'Single Family': 12 },
            sample: [{ id: 'sample-1', address: '123 Test St', openingBid: 95000, dealScore: 80 }]
          }
        ]
      };
    }
  };

  const result = await client.getAuctionCalendarNative({
    windowDays: 30,
    startMs: Date.parse('2026-11-01T00:00:00.000Z'),
    nowMs: Date.parse('2026-11-01T00:00:00.000Z')
  });

  assert.equal(queries.length, 2, 'Ran meta query and week aggregation');
  assert.ok(queries[1].sql.includes("DATE_TRUNC('week'"), 'Executed DATE_TRUNC');
  assert.ok(queries[1].sql.includes('PERCENTILE_CONT(0.5)'), 'Executed native percentile');
  assert.equal(result.scanned, 500);
  assert.equal(result.dropped.noDate, 5);
  assert.equal(result.weeks.length, 1);
  assert.equal(result.weeks[0].weekLabel, 'Nov 2–8');
});

test('getCompsCandidatesNative executes bounded geospatial query', async () => {
  const queries = [];
  const client = new DatabaseClient({ NODE_ENV: 'test' });
  client.isPg = true;
  client.pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return {
        rows: [
          {
            id: 'comp-1',
            source_key: 'hud',
            state: 'TX',
            city: 'Houston',
            latitude: 29.761,
            longitude: -95.368,
            opening_bid: 90000,
            deal_score: 80
          }
        ]
      };
    }
  };

  const target = {
    id: 'target-1',
    lat: 29.7604,
    lng: -95.3698,
    state: 'TX'
  };

  const result = await client.getCompsCandidatesNative(target, { radiusKm: 10 });
  assert.equal(queries.length, 1);
  assert.ok(queries[0].sql.includes('latitude BETWEEN $1 AND $2'));
  assert.ok(queries[0].sql.includes('longitude BETWEEN $3 AND $4'));
  assert.equal(result.pool.length, 1);
  assert.equal(result.pool[0].id, 'comp-1');
});
