'use strict';
const { workerHealthStatus, withExpiredJobSignal, collectionDegraded } = require('./discovery/worker-health');
const { inspectCollectionStorage } = require('./discovery/storage-health');
const REQUIRED_TABLES=['listings','discovery_source_runs','discovery_snapshots','discovery_observations','discovery_checkpoints','discovery_jobs','discovery_leases','discovery_source_rollouts','discovery_hunts','discovery_hunt_baselines','discovery_hunt_events','discovery_listing_revision','discovery_media_references','discovery_media_assets','discovery_media_links','discovery_atlas_sources','discovery_public_record_research','discovery_worker_health'];
async function probeDiscoveryDatabase(pool) {
  if(!pool?.query)throw new Error('PostgreSQL is not configured');
  const requiredJobCols = ['id','idempotency_scope_hash','lease_owner','lease_expires_at'];
  let row;
  try {
    const result = await pool.query(`SELECT
      EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis,
      (SELECT coalesce(jsonb_agg(c.relname),'[]'::jsonb)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) AND c.relkind IN ('r','p','v','m','f')) AS tables,
      (SELECT coalesce(jsonb_agg(a.attname),'[]'::jsonb)
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND c.relname='discovery_jobs' AND a.attname=ANY($2::text[]) AND NOT a.attisdropped) AS job_cols,
      EXISTS(
        SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND c.relname='discovery_source_runs' AND a.attname='coverage' AND NOT a.attisdropped
      ) AS has_coverage_col,
      (SELECT row_to_json(w) FROM (SELECT * FROM discovery_worker_health WHERE worker_key='wave1' LIMIT 1) w) AS worker,
      (SELECT jsonb_build_object(
        'queued', count(*) FILTER (WHERE status='queued')::int,
        'expired', count(*) FILTER (WHERE status='running' AND lease_expires_at<NOW())::int
      ) FROM discovery_jobs) AS backlog`, [REQUIRED_TABLES, requiredJobCols]);
    row = result.rows[0];
  } catch (err) {
    if (err && (err.code === '42P01' || err.code === '42703')) {
      const diag = await pool.query(`SELECT
        EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis,
        (SELECT coalesce(jsonb_agg(table_name),'[]'::jsonb) FROM information_schema.tables
          WHERE table_schema=current_schema() AND table_name=ANY($1::text[])) AS tables`, [REQUIRED_TABLES]);
      const drow = diag.rows[0];
      const missing = REQUIRED_TABLES.filter(name => !drow.tables.includes(name));
      if (missing.length) throw new Error(`Required discovery tables are missing: ${missing.join(', ')}`);
    }
    throw err;
  }
  const missing=REQUIRED_TABLES.filter(name=>!row.tables.includes(name));
  if(missing.length)throw new Error(`Required discovery tables are missing: ${missing.join(', ')}`);
  const missingJobCols = requiredJobCols.filter(c => !(row.job_cols || []).includes(c));
  if (missingJobCols.length) throw new Error(`column "${missingJobCols[0]}" does not exist`);
  if (!row.has_coverage_col) throw new Error('column "coverage" does not exist');
  const health=row.worker||null,status=workerHealthStatus(health);
  const backlogCounts={queued:row.backlog?.queued||0,expiredRunning:row.backlog?.expired||0};
  return {postgis:row.postgis,tables:row.tables,collectionHealth:{status,degraded:collectionDegraded(status,backlogCounts),lastSeenAt:health?.last_seen_at||null,lastLoopStatus:health?.last_loop_status||null,currentJobId:health?.current_job_id||null,backlog:backlogCounts}};
}

/**
 * Readiness policy for the discovery brain. This helper is intentionally
 * dependency-injected so the API process can check its real database client
 * without making the quality gate depend on a particular DB implementation.
 */
async function discoveryReadiness(options = {}) {
  const env = options.env || process.env;
  const result = {
    ready: false,
    mode: env.DATABASE_URL ? 'advanced' : 'demo',
    checks: {},
    limitations: [],
  };

  if (!env.DATABASE_URL) {
    result.checks.database = { ready: false, reason: 'DATABASE_URL is not configured' };
    result.collectionHealth={status:'disabled',degraded:false,lastSeenAt:null,lastLoopStatus:null,currentJobId:null,backlog:{queued:0,expiredRunning:0}};
    result.limitations.push('Demo/in-memory mode cannot provide durable discovery state, leases, or production completeness.');
    return result;
  }

  if (typeof options.databaseProbe !== 'function') {
    result.checks.database = { ready: false, reason: 'database probe is unavailable' };
    return result;
  }

  try {
    const details = await options.databaseProbe();
    result.checks.database = { ready: true, ...(details && typeof details === 'object' ? details : {}) };
    result.collectionHealth=withExpiredJobSignal(details?.collectionHealth||{status:'not_started',degraded:false,lastSeenAt:null,lastLoopStatus:null,currentJobId:null,backlog:{queued:0,expiredRunning:0}});
    const requiredTables = ['listings', 'discovery_source_runs', 'discovery_snapshots', 'discovery_checkpoints', 'discovery_jobs', 'discovery_leases'];
    const missing = requiredTables.filter((name) => details?.tables && !details.tables.includes(name));
    if (missing.length) throw new Error(`required discovery tables are missing: ${missing.join(', ')}`);
    if (details?.postgis === false) throw new Error('PostGIS extension is unavailable');
    result.checks.storage = (options.storageProbe || (() => inspectCollectionStorage({ env })))();
    result.ready = result.checks.storage.ready === true;
  } catch (error) {
    result.checks.database = {
      ready: false,
      reason: String(error?.message || error || 'database probe failed').slice(0, 240),
    };
  }
  return result;
}

module.exports = { discoveryReadiness, probeDiscoveryDatabase, REQUIRED_TABLES };
