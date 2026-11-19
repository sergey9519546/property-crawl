'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DatabaseClient, buildCompsCandidatesSql } = require('../../server/db/client');
const { collectPlanNodes, runSpatialSoak } = require('../../scripts/postgis-spatial-soak');

test('buildCompsCandidatesSql splits ST_DWithin(geog) from geog IS NULL lat/lng fallback via UNION ALL', () => {
  const sql = buildCompsCandidatesSql({ idCondition: 'AND id != $8' });

  assert.match(sql, /geog_matches\s+AS\s*\(/i);
  assert.match(sql, /latlng_fallback\s+AS\s*\(/i);
  assert.match(sql, /UNION\s+ALL/i);
  assert.match(sql, /AND\s+geog\s+IS\s+NOT\s+NULL\s+AND\s+ST_DWithin\(geog/i);
  assert.match(sql, /AND\s+geog\s+IS\s+NULL\s+AND\s+latitude\s+BETWEEN\s+\$4\s+AND\s+\$5\s+AND\s+longitude\s+BETWEEN\s+\$6\s+AND\s+\$7/i);

  // Ensure ST_DWithin is never OR'd with latitude BETWEEN in the same WHERE predicate
  const geogBranch = sql.split(/latlng_fallback\s+AS/i)[0];
  assert.equal(/latitude\s+BETWEEN/i.test(geogBranch), false, 'geog_matches branch must not reference latitude BETWEEN');
  assert.equal(/\bOR\s*\(\s*geog\s+IS\s+NULL/i.test(sql), false, 'ST_DWithin must not be OR-ed with geog IS NULL');
});

test('getCompsCandidatesNative uses split UNION ALL spatial query and preserves parameter binding', async () => {
  const queries = [];
  const client = new DatabaseClient({ NODE_ENV: 'test' });
  client.isPg = true;
  client.pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };

  await client.getCompsCandidatesNative({ id: 'prop-1', lat: 29.76, lng: -95.37, state: 'TX' }, { radiusKm: 8 });
  assert.equal(queries.length, 2); // spatial query (0 rows) -> state fallback
  assert.match(queries[0].sql, /UNION\s+ALL/i);
  assert.equal(/\bOR\s*\(\s*geog\s+IS\s+NULL/i.test(queries[0].sql), false);
  assert.equal(queries[0].params.length, 8);
  assert.equal(queries[0].params[7], 'prop-1');
});

test('collectPlanNodes extracts GIST index scan nodes from EXPLAIN JSON plan', () => {
  const samplePlan = {
    'Node Type': 'Limit',
    Plans: [
      {
        'Node Type': 'Append',
        Plans: [
          {
            'Node Type': 'Index Scan',
            'Relation Name': 'listings',
            'Index Name': 'idx_listings_geog',
            'Actual Total Time': 0.42,
            'Actual Rows': 12,
          },
        ],
      },
    ],
  };
  const nodes = collectPlanNodes(samplePlan);
  assert.equal(nodes.some((n) => n.indexName === 'idx_listings_geog' && n.nodeType === 'Index Scan'), true);
});

test(
  'PostGIS spatial soak verifies idx_listings_geog GIST Index Scan against live PG',
  { skip: !process.env.DISCOVERY_TEST_DATABASE_URL && 'DISCOVERY_TEST_DATABASE_URL not set' },
  async () => {
    const report = await runSpatialSoak({
      connectionString: process.env.DISCOVERY_TEST_DATABASE_URL,
      iterations: 5,
    });
    assert.equal(report.ok, true);
    assert.equal(report.usesGeogGistIndex, true, 'Expected PostgreSQL to use idx_listings_geog GIST index');
  }
);
