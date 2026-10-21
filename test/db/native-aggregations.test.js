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
  assert.ok(queries[1].sql.includes('est_low,'), 'Includes est_low in CTE');
  assert.ok(queries[1].sql.includes('est_high,'), 'Includes est_high in CTE');
  assert.ok(queries[1].sql.includes('ORDER BY sale_date ASC, deal_score DESC'), 'Orders sample rank by sale_date then deal_score');
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
  assert.ok(queries[0].sql.includes('ST_DWithin(geog'));
  assert.ok(queries[0].sql.includes('ST_Distance(geog'));
  assert.ok(queries[0].sql.includes('latitude BETWEEN $4 AND $5'));
  assert.ok(queries[0].sql.includes('AND id != $8'), 'Properly parameterizes target ID exclusion with parameter index');
  assert.equal(queries[0].params[7], 'target-1', 'Passes target ID as 8th parameter');
  assert.equal(result.pool.length, 1);
  assert.equal(result.pool[0].id, 'comp-1');
});

test('getNeighborhoodStatsNative fast-path leverages mv_neighborhood_stats when populated', async () => {
  const queries = [];
  const client = new DatabaseClient({ NODE_ENV: 'test' });
  client.isPg = true;
  client.pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('listings_bucketed')) {
        return { rows: [{ scanned: 20, listings_bucketed: 15, buckets_total: 1 }] };
      }
      return {
        rows: [
          {
            kind: 'zip',
            key: '90210',
            label: '90210',
            count: 15,
            medianOpeningBid: 500000,
            meanOpeningBid: 520000,
            medianSqft: 2800,
            medianDealScore: 82,
            medianDiscount: 0.28,
            sources: { fannie: 10, freddie: 5 },
            prop_types: { 'Single Family': 15 }
          }
        ]
      };
    }
  };

  const result = await client.getNeighborhoodStatsNative({
    maxAgeDays: 365,
    limit: 20
  });

  assert.equal(queries.length, 2, 'Queries MV table and total counts');
  assert.ok(queries[0].sql.includes('FROM mv_neighborhood_stats'), 'Queries materialized view directly');
  assert.equal(result.scanned, 20);
  assert.equal(result.bucketsTotal, 1);
  assert.equal(result.listingsBucketed, 15);
  assert.equal(result.rowsWithoutNeighborhoodKey, 5);
  assert.equal(result.neighborhoods[0].key, '90210');
  assert.equal(result.neighborhoods[0].medianOpeningBid, 500000);
});

test('getCompsCandidatesNative handles target without an existing listing id', async () => {
  const queries = [];
  const client = new DatabaseClient({ NODE_ENV: 'test' });
  client.isPg = true;
  client.pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    }
  };

  const adHocTarget = {
    lat: 34.05,
    lng: -118.25,
    state: 'CA'
  };

  await client.getCompsCandidatesNative(adHocTarget, { radiusKm: 5 });
  assert.equal(queries.length, 2, 'Ran spatial query then state fallback');
  assert.ok(!queries[0].sql.includes('AND id !='), 'Spatial query has no id exclusion when target.id is absent');
  assert.ok(!queries[1].sql.includes('AND id !='), 'State fallback query has no id exclusion when target.id is absent');
  assert.equal(queries[0].params.length, 7, 'Spatial params length is exactly 7 without target.id');
  assert.equal(queries[1].params.length, 1, 'State fallback params length is exactly 1 without target.id');
});

test('getSingleNeighborhoodStatsNative fast-path leverages mv_neighborhood_stats', async () => {
  const queries = [];
  const client = new DatabaseClient({ NODE_ENV: 'test' });
  client.isPg = true;
  client.pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)::int AS count')) {
        return { rows: [{ count: 1200 }] };
      }
      return {
        rows: [
          {
            kind: 'zip',
            key: '90210',
            label: '90210',
            count: 15,
            medianOpeningBid: 500000,
            meanOpeningBid: 520000,
            medianSqft: 2800,
            medianDealScore: 82,
            medianDiscount: 0.28,
            sources: { fannie: 10, freddie: 5 },
            prop_types: { 'Single Family': 15 }
          }
        ]
      };
    }
  };

  const result = await client.getSingleNeighborhoodStatsNative('zip', '90210', { maxAgeDays: 365 });
  assert.ok(result, 'Returns result from MV');
  assert.equal(result.neighborhood.key, '90210');
  assert.equal(result.neighborhood.medianOpeningBid, 500000);
  assert.ok(queries[0].sql.includes('FROM mv_neighborhood_stats'), 'Queries MV by key');
});

test('refreshNeighborhoodStatsMaterializedView executes REFRESH query', async () => {
  const queries = [];
  const client = new DatabaseClient({ NODE_ENV: 'test' });
  client.isPg = true;
  client.pool = {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    }
  };

  const ok = await client.refreshNeighborhoodStatsMaterializedView({ concurrent: true });
  assert.equal(ok, true);
  assert.equal(queries.length, 1);
  assert.ok(queries[0].includes('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_neighborhood_stats'));
});

test('read-replica pool routing directs analytical reads to readPool and mutations to pool', async () => {
  const readQueries = [];
  const writeQueries = [];

  const client = new DatabaseClient({ NODE_ENV: 'test' });
  client.isPg = true;
  client.readPool = {
    async query(sql, params) {
      readQueries.push({ sql, params });
      return { rows: [{ source: 'hud', observed_count: 5, active_states: ['TX'], latest_observed_at: '2026-10-15T00:00:00Z' }] };
    }
  };
  client.pool = {
    async query(sql, params) {
      writeQueries.push({ sql, params });
      return { rows: [] };
    }
  };

  // 1. Analytical read should hit readPool
  await client.getSourceInventoryAggregatesNative();
  assert.equal(readQueries.length, 1, 'Source radar read hit readPool');
  assert.equal(writeQueries.length, 0, 'No write queries executed');

  // 2. Mutation should hit primary pool
  await client.saveDeal('user-1', 'deal-1');
  assert.equal(writeQueries.length, 1, 'saveDeal mutation hit primary pool');
  assert.ok(writeQueries[0].sql.includes('INSERT INTO saved_deals'));
});

