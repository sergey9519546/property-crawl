'use strict';
const REQUIRED_TABLES=['listings','discovery_source_runs','discovery_snapshots','discovery_observations','discovery_checkpoints','discovery_jobs','discovery_leases','discovery_source_rollouts','discovery_hunts','discovery_hunt_baselines','discovery_hunt_events','discovery_listing_revision','discovery_media_references','discovery_media_assets','discovery_media_links','discovery_atlas_sources','discovery_public_record_research','discovery_worker_health'];
async function probeDiscoveryDatabase(pool) {
  if(!pool?.query)throw new Error('PostgreSQL is not configured');
  const result=await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis,
    (SELECT coalesce(jsonb_agg(table_name),'[]'::jsonb) FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_name=ANY($1::text[])) AS tables`,[REQUIRED_TABLES]);
  const row=result.rows[0];
  const missing=REQUIRED_TABLES.filter(name=>!row.tables.includes(name));
  if(missing.length)throw new Error(`Required discovery tables are missing: ${missing.join(', ')}`);
  await pool.query('SELECT id,idempotency_scope_hash,lease_owner,lease_expires_at FROM discovery_jobs LIMIT 1');
  const [worker,backlog]=await Promise.all([
    pool.query("SELECT * FROM discovery_worker_health WHERE worker_key='wave1'"),
    pool.query("SELECT count(*) FILTER(WHERE status='queued')::int queued,count(*) FILTER(WHERE status='running' AND lease_expires_at<NOW())::int expired FROM discovery_jobs")
  ]);
  const health=worker.rows[0],stale=!health||Date.now()-Date.parse(health.last_seen_at)>180000;
  return {...row,collectionHealth:{status:!health?'not_started':stale?'stale':'healthy',degraded:stale,lastSeenAt:health?.last_seen_at||null,lastLoopStatus:health?.last_loop_status||null,currentJobId:health?.current_job_id||null,backlog:{queued:backlog.rows[0].queued||0,expiredRunning:backlog.rows[0].expired||0}}};
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
    result.collectionHealth=details?.collectionHealth||{status:'not_started',degraded:true,lastSeenAt:null,lastLoopStatus:null,currentJobId:null,backlog:{queued:0,expiredRunning:0}};
    const requiredTables = ['listings', 'discovery_source_runs', 'discovery_snapshots', 'discovery_checkpoints', 'discovery_jobs', 'discovery_leases'];
    const missing = requiredTables.filter((name) => details?.tables && !details.tables.includes(name));
    if (missing.length) throw new Error(`required discovery tables are missing: ${missing.join(', ')}`);
    if (details?.postgis === false) throw new Error('PostGIS extension is unavailable');
    result.ready = true;
  } catch (error) {
    result.checks.database = {
      ready: false,
      reason: String(error?.message || error || 'database probe failed').slice(0, 240),
    };
  }
  return result;
}

module.exports = { discoveryReadiness, probeDiscoveryDatabase };
