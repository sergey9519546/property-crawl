'use strict';
const crypto = require('node:crypto');
const { DEFAULT_MAX_AGE_SECONDS, workerHealthStatus } = require('./worker-health');
const { assertJobClaim, withJobFence } = require('./job-fence');

function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])); return value; }
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function collectionJobId(){return `job_${crypto.randomBytes(12).toString('hex')}`;}
function jsonValue(value,fallback){if(value==null)return fallback;if(typeof value==='string'){try{return JSON.parse(value);}catch{return fallback;}}return value;}
function requirePool(pool) { if (!pool?.query) throw new Error('Discovery persistence requires PostgreSQL'); return pool; }

const PROMOTION_EVIDENCE_SQL = `rollout.clean_canary_runs>=2 AND rollout.configured_scope<>'{}'::jsonb
  AND (SELECT count(*) FROM discovery_source_runs run
    WHERE run.source_key=rollout.source_key AND run.status='complete'
      AND run.accepted_count>0 AND run.rejected_count=0
      AND run.scope=rollout.configured_scope
      AND run.scope_hash=rollout.canary_scope_hash
      AND run.coverage->'complete'='true'::jsonb
      AND run.coverage->'fullSweepComplete'='true'::jsonb
      AND run.coverage->'truncated'='false'::jsonb
      AND run.coverage->'acquisitionScope'=rollout.configured_scope)>=2`;

class DiscoveryStore {
  constructor(pool) { this.pool = requirePool(pool); this.requiresJobFence = true; }
  async beginRun({ sourceKey, trigger = 'manual', scope = {}, idempotencyKey = null, jobId = null }, options = {}) {
    return withJobFence(this.pool, options, sourceKey, async client => {
      const scopeHash = hash(scope); const r = await client.query("INSERT INTO discovery_source_runs(source_key,trigger,scope,scope_hash,status,idempotency_key,discovery_job_id) VALUES($1,$2,$3,$4,'running',$5,$6) ON CONFLICT(source_key,idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET source_key=EXCLUDED.source_key RETURNING *", [sourceKey, trigger, scope, scopeHash, idempotencyKey, jobId]); return r.rows[0];
    });
  }
  async appendSnapshot({ runId, sourceKey, sourceRecordId, observedAt, rawPayload, provenance = {}, observations = {} }, options = {}) {
    const payloadSha256 = hash(rawPayload); const client = options.client || await this.pool.connect(); const ownsTransaction=!options.client;
    try { if(ownsTransaction) await client.query('BEGIN'); let r = await client.query('INSERT INTO discovery_snapshots(run_id,source_key,source_record_id,observed_at,payload_sha256,raw_payload,provenance) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_key,source_record_id,observed_at,payload_sha256) DO NOTHING RETURNING *', [runId,sourceKey,sourceRecordId,observedAt,payloadSha256,rawPayload,provenance]);
      if (!r.rows[0]) r=await client.query('SELECT * FROM discovery_snapshots WHERE source_key=$1 AND source_record_id=$2 AND observed_at=$3 AND payload_sha256=$4',[sourceKey,sourceRecordId,observedAt,payloadSha256]);
      for (const [field,item] of Object.entries(observations)) { const wrapped=item&&typeof item==='object'&&!Array.isArray(item)&&Object.hasOwn(item,'value'); const value=wrapped?item.value:item; const evidenceClass=wrapped&&item.evidenceClass?item.evidenceClass:'publisher_reported'; await client.query('INSERT INTO discovery_observations(snapshot_id,field_name,value,evidence_class) VALUES($1,$2,$3,$4) ON CONFLICT(snapshot_id,field_name) DO NOTHING', [r.rows[0].id,field,JSON.stringify(value===undefined?null:value),evidenceClass]); }
      if(ownsTransaction) await client.query('COMMIT'); return r.rows[0]; } catch(e){ if(ownsTransaction) await client.query('ROLLBACK'); throw e; } finally { if(ownsTransaction) client.release(); }
  }
  async finishRun(id, result, options = {}) {
    return withJobFence(this.pool, options, null, async client => {
      const status = ['complete','partial','failed'].includes(result.status) ? result.status : 'failed'; const coverage=result.coverage&&typeof result.coverage==='object'&&!Array.isArray(result.coverage)?result.coverage:{};
      const r=await client.query('UPDATE discovery_source_runs SET status=$2,completed_at=NOW(),discovered_count=$3,accepted_count=$4,rejected_count=$5,error_message=$6,coverage=$7::jsonb WHERE id=$1 AND ($8::text IS NULL OR discovery_job_id=$8) RETURNING *',[id,status,result.discovered||0,result.accepted||0,result.rejected||0,result.error?String(result.error).slice(0,500):null,JSON.stringify(coverage),options.jobId||null]); return r.rows[0];
    });
  }
  async ingestSnapshot(input, projector, options = {}) { const client=await this.pool.connect(); try { await client.query('BEGIN'); await assertJobClaim(client,options,input.sourceKey); const snapshot=await this.appendSnapshot(input,{client}); if(typeof projector==='function') await projector(client,snapshot); await assertJobClaim(client,options,input.sourceKey); await client.query('COMMIT'); return snapshot; } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();} }
  async getCheckpoint(sourceKey) { const r=await this.pool.query('SELECT cursor,scope_hash AS "scopeHash",updated_at AS "updatedAt" FROM discovery_checkpoints WHERE source_key=$1',[sourceKey]); return r.rows[0]||null; }
  async saveCheckpoint(sourceKey, cursor, scope = {}, options = {}) {
    return withJobFence(this.pool, options, sourceKey, async client => {
      const r=await client.query('INSERT INTO discovery_checkpoints(source_key,cursor,scope_hash) VALUES($1,$2,$3) ON CONFLICT(source_key) DO UPDATE SET cursor=EXCLUDED.cursor,scope_hash=EXCLUDED.scope_hash,updated_at=NOW() RETURNING *',[sourceKey,cursor,hash(scope)]); return r.rows[0];
    });
  }
  async acquireLease(key, ownerId, ttlSeconds=300) { const r=await this.pool.query("INSERT INTO discovery_leases(lease_key,owner_id,expires_at) VALUES($1,$2,NOW()+make_interval(secs=>$3)) ON CONFLICT(lease_key) DO UPDATE SET owner_id=EXCLUDED.owner_id,expires_at=EXCLUDED.expires_at,updated_at=NOW() WHERE discovery_leases.expires_at<NOW() OR discovery_leases.owner_id=EXCLUDED.owner_id RETURNING lease_key",[key,ownerId,Math.max(10,Math.min(3600,ttlSeconds))]); return r.rowCount===1; }
  async renewLease(key,ownerId,ttlSeconds=300){const r=await this.pool.query('UPDATE discovery_leases SET expires_at=NOW()+make_interval(secs=>$3),updated_at=NOW() WHERE lease_key=$1 AND owner_id=$2 AND expires_at>NOW() RETURNING lease_key',[key,ownerId,Math.max(10,Math.min(3600,ttlSeconds))]);return r.rowCount===1;}
  async releaseLease(key,ownerId){const r=await this.pool.query('DELETE FROM discovery_leases WHERE lease_key=$1 AND owner_id=$2',[key,ownerId]);return r.rowCount===1;}
  async failAbandonedRuns(maxAgeSeconds=3600){const r=await this.pool.query("UPDATE discovery_source_runs r SET status='failed',completed_at=NOW(),error_message='worker lease expired before completion' WHERE r.status='running' AND r.started_at<NOW()-make_interval(secs=>$1) AND (r.discovery_job_id IS NULL OR NOT EXISTS(SELECT 1 FROM discovery_jobs j WHERE j.id=r.discovery_job_id AND j.status='running' AND j.lease_expires_at>NOW())) RETURNING r.id",[Math.max(60,maxAgeSeconds)]);return r.rows.map(x=>x.id);}
  async recordWorkerHealth(workerKey,{workerId,lastLoopStatus=null,currentJobId=null,details={}}){await this.pool.query("INSERT INTO discovery_worker_health(worker_key,worker_id,last_seen_at,last_loop_status,current_job_id,details) VALUES($1,$2,NOW(),$3,$4,$5::jsonb) ON CONFLICT(worker_key) DO UPDATE SET worker_id=EXCLUDED.worker_id,last_seen_at=NOW(),last_loop_status=EXCLUDED.last_loop_status,current_job_id=EXCLUDED.current_job_id,details=EXCLUDED.details",[workerKey,workerId,lastLoopStatus,currentJobId,JSON.stringify(details)]);}
  async collectionHealth(workerKey='wave1',staleSeconds=DEFAULT_MAX_AGE_SECONDS){const [health,backlog]=await Promise.all([this.pool.query('SELECT * FROM discovery_worker_health WHERE worker_key=$1',[workerKey]),this.pool.query("SELECT count(*) FILTER(WHERE status='queued')::int queued,count(*) FILTER(WHERE status='running' AND lease_expires_at<NOW())::int expired FROM discovery_jobs")]);const row=health.rows[0],counts=backlog.rows[0];const status=workerHealthStatus(row,Date.now(),staleSeconds);return {status,degraded:status!=='healthy',lastSeenAt:row?.last_seen_at||null,lastLoopStatus:row?.last_loop_status||null,currentJobId:row?.current_job_id||null,backlog:{queued:counts.queued||0,expiredRunning:counts.expired||0}};}  async recordCanary(sourceKey, { clean, scope = null, runId = null }) {
    const scoped = scope && typeof scope === 'object' && !Array.isArray(scope) && Object.keys(scope).length > 0;
    if (clean && !scoped) throw new Error('Canary scope must describe the complete publisher slice');
    const scopeHash = scoped ? hash(scope) : null;
    let verifiedClean = false;
    if (clean && scoped && typeof runId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
      const evidence = await this.pool.query(`SELECT id FROM discovery_source_runs
        WHERE id=$1::uuid AND source_key=$2 AND status='complete'
          AND accepted_count>0 AND rejected_count=0
          AND scope=$3::jsonb AND scope_hash=$4
          AND coverage->'complete'='true'::jsonb
          AND coverage->'fullSweepComplete'='true'::jsonb
          AND coverage->'truncated'='false'::jsonb
          AND coverage->'acquisitionScope'=$3::jsonb`, [runId, sourceKey, JSON.stringify(scope), scopeHash]);
      verifiedClean = evidence.rowCount === 1;
    }
    const result = await this.pool.query(`INSERT INTO discovery_source_rollouts
      (source_key,state,clean_canary_runs,configured_scope,canary_scope_hash,last_clean_run_id)
      VALUES($1,'canary',$2,$3,$4,CASE WHEN $2=1 THEN $5::uuid ELSE NULL END)
      ON CONFLICT(source_key) DO UPDATE SET
        state=CASE
          WHEN $2=0 THEN discovery_source_rollouts.state
          WHEN discovery_source_rollouts.canary_scope_hash=$4 AND discovery_source_rollouts.state='promoted' THEN 'promoted'
          ELSE 'canary' END,
        promoted_at=CASE
          WHEN $2=0 OR discovery_source_rollouts.canary_scope_hash=$4 THEN discovery_source_rollouts.promoted_at
          ELSE NULL END,
        clean_canary_runs=CASE
          WHEN $2=0 THEN discovery_source_rollouts.clean_canary_runs
          WHEN discovery_source_rollouts.canary_scope_hash IS DISTINCT FROM $4 THEN 1
          WHEN discovery_source_rollouts.last_clean_run_id=$5::uuid THEN discovery_source_rollouts.clean_canary_runs
          ELSE discovery_source_rollouts.clean_canary_runs+1 END,
        configured_scope=CASE WHEN $2=1 THEN $3 ELSE discovery_source_rollouts.configured_scope END,
        canary_scope_hash=CASE WHEN $2=1 THEN $4 ELSE discovery_source_rollouts.canary_scope_hash END,
        last_clean_run_id=CASE WHEN $2=1 THEN $5::uuid ELSE discovery_source_rollouts.last_clean_run_id END,
        updated_at=NOW()
      RETURNING *`, [sourceKey, verifiedClean ? 1 : 0, verifiedClean ? scope : {}, verifiedClean ? scopeHash : null, verifiedClean ? runId : null]);
    return result.rows[0];
  }
  async promoteSource(sourceKey) {
    const result = await this.pool.query(`UPDATE discovery_source_rollouts rollout
      SET state='promoted',promoted_at=NOW(),updated_at=NOW()
      WHERE rollout.source_key=$1 AND ${PROMOTION_EVIDENCE_SQL}
      RETURNING rollout.*`, [sourceKey]);
    if (!result.rows[0]) throw new Error('Source needs configured scope and two clean durable canary runs');
    return result.rows[0];
  }
  async promotedSources(){const r=await this.pool.query(`SELECT source_key FROM discovery_source_rollouts rollout WHERE state='promoted' AND ${PROMOTION_EVIDENCE_SQL}`);return r.rows.map(x=>x.source_key);}
  async promotedSourceScopes() {
    const result = await this.pool.query(`SELECT source_key,configured_scope,canary_scope_hash FROM discovery_source_rollouts rollout WHERE state='promoted' AND ${PROMOTION_EVIDENCE_SQL}`);
    return result.rows.map(row => ({sourceKey: row.source_key, scope: row.configured_scope, scopeHash: row.canary_scope_hash}));
  }
  async sourceRolloutStatuses() {
    const result = await this.pool.query(`SELECT rollout.source_key,rollout.state,
      rollout.clean_canary_runs,rollout.configured_scope,rollout.canary_scope_hash,
      rollout.promoted_at,(${PROMOTION_EVIDENCE_SQL}) AS evidence_qualified,
      (rollout.state='promoted' AND (${PROMOTION_EVIDENCE_SQL})) AS approved
      FROM discovery_source_rollouts rollout ORDER BY rollout.source_key`);
    return result.rows.map(row => ({
      sourceKey: row.source_key,
      state: row.state,
      cleanRuns: Number(row.clean_canary_runs) || 0,
      configuredScope: row.configured_scope,
      scopeHash: row.canary_scope_hash,
      promotedAt: row.promoted_at,
      evidenceQualified: row.evidence_qualified === true,
      approved: row.approved === true,
    }));
  }
  async createOrReuseJob(input={}){const key=input.idempotencyKey||null,id=collectionJobId(),sources=[...new Set((input.sourceIds||[]).map(String))].sort(),payload=input.payload||{},kind=input.kind||'property',trigger=input.trigger||'manual',scopeHash=hash({kind,trigger,sourceIds:sources,payload});const stages={collection:{status:'queued'},inventory:{status:'queued'},observations:{status:'queued'},hunts:{status:'queued'},cases:{status:'queued'}};const r=await this.pool.query("INSERT INTO discovery_jobs(id,idempotency_key,idempotency_scope_hash,kind,trigger,status,source_keys,payload,stages) VALUES($1,$2,$3,$4,$5,'queued',$6,$7::jsonb,$8::jsonb) ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key WHERE discovery_jobs.idempotency_scope_hash=EXCLUDED.idempotency_scope_hash RETURNING *",[id,key,scopeHash,kind,trigger,sources,JSON.stringify(payload),JSON.stringify(stages)]);if(!r.rows[0])throw new Error('Idempotency key is already bound to a different collection scope');return this.jobRow(r.rows[0]);}
  jobRow(row){if(!row)return null;return {id:row.id,idempotencyKey:row.idempotency_key,kind:row.kind,trigger:row.trigger,sourceIds:row.source_keys,status:row.status,revision:row.revision,createdAt:row.created_at,startedAt:row.started_at,completedAt:row.completed_at,leaseOwner:row.lease_owner||null,leaseExpiresAt:row.lease_expires_at||null,attemptCount:row.attempt_count||0,stages:jsonValue(row.stages,{}),errors:jsonValue(row.errors,[]),result:jsonValue(row.result,null)};}
  async claimJob(id,ownerId,ttlSeconds=300){const r=await this.pool.query("UPDATE discovery_jobs SET status='running',lease_owner=$2,lease_expires_at=NOW()+make_interval(secs=>$3),started_at=coalesce(started_at,NOW()),attempt_count=attempt_count+1,revision=revision+1 WHERE id=$1 AND (status='queued' OR (status='running' AND lease_expires_at<NOW())) RETURNING *",[id,ownerId,Math.max(10,Math.min(3600,ttlSeconds))]);return this.jobRow(r.rows[0]);}
  async claimNextJob(ownerId,ttlSeconds=300){const r=await this.pool.query("WITH candidate AS (SELECT id FROM discovery_jobs WHERE status='queued' OR (status='running' AND lease_expires_at<NOW()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE discovery_jobs j SET status='running',lease_owner=$1,lease_expires_at=NOW()+make_interval(secs=>$2),started_at=coalesce(j.started_at,NOW()),attempt_count=j.attempt_count+1,revision=j.revision+1 FROM candidate WHERE j.id=candidate.id RETURNING j.*",[ownerId,Math.max(10,Math.min(3600,ttlSeconds))]);return this.jobRow(r.rows[0]);}
  async renewJobClaim(id,ownerId,ttlSeconds=300){const r=await this.pool.query("UPDATE discovery_jobs SET lease_expires_at=NOW()+make_interval(secs=>$3),revision=revision+1 WHERE id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>NOW() RETURNING id",[id,ownerId,Math.max(10,Math.min(3600,ttlSeconds))]);return r.rowCount===1;}
  async getJob(id){const r=await this.pool.query('SELECT * FROM discovery_jobs WHERE id=$1',[id]);return this.jobRow(r.rows[0]);}
  async listJobs(limit=50){const bounded=Math.max(1,Math.min(50,Number(limit)||50));const r=await this.pool.query('SELECT * FROM discovery_jobs ORDER BY created_at DESC LIMIT $1',[bounded]);const total=Number((await this.pool.query('SELECT count(*)::int AS count FROM discovery_jobs')).rows[0].count);return {items:r.rows.map(x=>this.jobRow(x)),total};}
  async updateJob(id,update={},options={}){const current=await this.getJob(id);if(!current)throw new Error('Collection job was not found');const stages={...(current.stages&&typeof current.stages==='object'?current.stages:{})},errors=Array.isArray(current.errors)?[...current.errors]:[];if(update.stage)stages[update.stage.name]={...(stages[update.stage.name]||{}),...update.stage.value,updatedAt:new Date().toISOString()};if(update.error)errors.push({stage:update.error.stage||'collection',message:String(update.error.message||update.error).slice(0,500),at:new Date().toISOString()});const result=update.result===undefined?null:JSON.stringify(update.result);const r=await this.pool.query('UPDATE discovery_jobs SET status=coalesce($2,status),stages=$3::jsonb,errors=$4::jsonb,result=coalesce($5::jsonb,result),started_at=CASE WHEN $6 AND started_at IS NULL THEN NOW() ELSE started_at END,completed_at=CASE WHEN $7 THEN NOW() ELSE completed_at END,revision=revision+1 WHERE id=$1 AND ($8::text IS NULL OR (lease_owner=$8 AND lease_expires_at>NOW())) RETURNING *',[id,update.status||null,JSON.stringify(stages),JSON.stringify(errors),result,Boolean(update.started),Boolean(update.completed),options.ownerId||null]);if(!r.rows[0]&&options.ownerId)throw new Error('Collection job lease was lost; refusing stale update');return this.jobRow(r.rows[0]);}
}
module.exports={DiscoveryStore,hash,createDiscoveryStore:(database)=>new DiscoveryStore(database.pool||database)};
