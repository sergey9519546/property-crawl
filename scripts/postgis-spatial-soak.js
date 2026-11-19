'use strict';

/**
 * scripts/postgis-spatial-soak.js
 *
 * Verifies that getCompsCandidatesNative's PostGIS radius query uses the
 * idx_listings_geog GIST index on the geog_matches branch (without falling back
 * to a Seq Scan caused by OR-ing latitude/longitude bounds) and measures
 * query latency across repeated iterations.
 */

const { buildCompsCandidatesSql } = require('../server/db/client');

function collectPlanNodes(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  out.push({
    nodeType: node['Node Type'] || null,
    relationName: node['Relation Name'] || null,
    indexName: node['Index Name'] || null,
    cteName: node['CTE Name'] || null,
    subplanName: node['Subplan Name'] || null,
    actualTotalTime: node['Actual Total Time'] ?? null,
    actualRows: node['Actual Rows'] ?? null,
  });
  if (Array.isArray(node.Plans)) {
    for (const child of node.Plans) {
      collectPlanNodes(child, out);
    }
  }
  return out;
}

async function runSpatialSoak(options = {}) {
  const connectionString =
    options.connectionString ||
    process.env.DISCOVERY_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    '';
  if (!connectionString) {
    throw new Error('DISCOVERY_TEST_DATABASE_URL or DATABASE_URL is required for PostGIS spatial soak');
  }

  const lat = Number.isFinite(options.lat) ? options.lat : 29.7604;
  const lng = Number.isFinite(options.lng) ? options.lng : -95.3698;
  const radiusKm = Number.isFinite(options.radiusKm) ? options.radiusKm : 8;
  const iterations = Math.max(1, Number(options.iterations) || 10);

  const radiusMeters = radiusKm * 1000.0;
  const latDelta = radiusKm / 111.0;
  const latRad = (lat * Math.PI) / 180.0;
  const lngDelta = radiusKm / (111.0 * Math.max(0.1, Math.cos(latRad)));
  const params = [
    lng,
    lat,
    radiusMeters,
    lat - latDelta,
    lat + latDelta,
    lng - lngDelta,
    lng + lngDelta,
  ];

  const sql = buildCompsCandidatesSql({ idCondition: '' });
  const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;

  const pool = options.pool || new (require('pg').Pool)({ connectionString });
  const shouldEnd = !options.pool;
  try {
    const explainRes = await pool.query(explainSql, params);
    const planRoot = explainRes.rows?.[0]?.['QUERY PLAN']?.[0]?.Plan || null;
    const nodes = collectPlanNodes(planRoot);
    const usesGeogGistIndex = nodes.some(
      (n) =>
        n.indexName === 'idx_listings_geog' &&
        (n.nodeType === 'Index Scan' || n.nodeType === 'Bitmap Index Scan' || n.nodeType === 'Index Only Scan')
    );

    const timingsMs = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      await pool.query(sql, params);
      timingsMs.push(performance.now() - t0);
    }
    const sorted = [...timingsMs].sort((a, b) => a - b);
    const p50Ms = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;

    return {
      ok: true,
      iterations,
      usesGeogGistIndex,
      p50Ms: Math.round(p50Ms * 100) / 100,
      p95Ms: Math.round(p95Ms * 100) / 100,
      nodes,
    };
  } finally {
    if (shouldEnd) {
      await pool.end().catch(() => {});
    }
  }
}

if (require.main === module) {
  runSpatialSoak()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.usesGeogGistIndex) {
        console.warn('[postgis-spatial-soak] Warning: idx_listings_geog was not selected by planner (table may be tiny or index missing).');
      }
    })
    .catch((err) => {
      console.error('[postgis-spatial-soak] Failed:', err?.message || err);
      process.exitCode = 1;
    });
}

module.exports = {
  collectPlanNodes,
  runSpatialSoak,
};
