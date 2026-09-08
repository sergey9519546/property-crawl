'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDiscoveryStore, hash } = require('../server/discovery/store');

async function migrateLegacy(database, directory, apply = false) {
  const root = path.resolve(directory);
  const report = { mode: apply ? 'applied' : 'dry_run', files: [], hunts: 0, baselines: 0, events: 0, snapshots: 0, jobs: 0 };
  if (apply && !database?.pool) throw new Error('PostgreSQL is required for legacy migration');
  if (apply) await require('./discovery-migrate').migrate(database.pool);
  for (const [kind, name] of [['hunts','saved-hunts.json'],['observations','source-observations.json'],['jobs','collection-jobs.json']]) {
    const file = path.join(root,name);
    if (!fs.existsSync(file)) continue;
    const body = fs.readFileSync(file,'utf8'), payload = JSON.parse(body);
    const digest = crypto.createHash('sha256').update(body).digest('hex');
    report.files.push({kind,name,sha256:digest,originalPreserved:true});
    if (kind === 'hunts') {
      require('../server/intelligence/hunt-store').assertStoreShape(payload);
      for (const hunt of payload.hunts) {
        report.hunts++;
        if (apply) await database.pool.query(`INSERT INTO discovery_hunts(id,name,enabled,version,criteria,criteria_hash,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,
        [hunt.id,hunt.name,hunt.enabled,hunt.version,hunt.criteria,hunt.criteriaHash,hunt.createdAt,hunt.updatedAt]);
      }
      for (const [huntId, baseline] of Object.entries(payload.baselines)) for (const [identity, row] of Object.entries(baseline.records)) {
        report.baselines++;
        if (apply) await database.pool.query(`INSERT INTO discovery_hunt_baselines(hunt_id,identity_key,hunt_version,source_key,source_record_id,observed_at,evaluation)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[huntId,identity,baseline.huntVersion,row.sourceId,row.recordId,row.observedAt,row]);
      }
      for (const event of payload.events) {
        report.events++;
        if (apply) await database.pool.query(`INSERT INTO discovery_hunt_events(id,hunt_id,identity_key,event_type,evidence,detected_at)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[event.id,event.huntId,event.identityKey,event.type,event,event.detectedAt]);
      }
    } else if (kind === 'observations') {
      if (payload.version !== 1 || !payload.records || !payload.runs || !Array.isArray(payload.signals)) throw new Error('Invalid legacy observations');
      const store = apply ? createDiscoveryStore(database) : null;
      const runs = new Map();
      for (const record of Object.values(payload.records)) for (const snapshot of [...(record.history || []), record.latest].filter(Boolean)) {
        if (!snapshot.recordId || !snapshot.source || !Number.isFinite(Date.parse(snapshot.observedAt))) throw new Error('Invalid legacy snapshot identity/timestamp');
        report.snapshots++;
        if (store) {
          if (!runs.has(snapshot.source)) runs.set(snapshot.source,await store.beginRun({sourceKey:snapshot.source,trigger:'legacy_import',idempotencyKey:`legacy:${digest}`,scope:{kind:'legacy_history',sha256:digest}}));
          await store.appendSnapshot({runId:runs.get(snapshot.source).id,sourceKey:snapshot.source,sourceRecordId:snapshot.recordId,
            observedAt:snapshot.observedAt,rawPayload:snapshot,provenance:{origin:'legacy_import',sourceUrl:snapshot.sourceUrl,originalPath:file},observations:snapshot.fields || {}});
        }
      }
      for (const run of runs.values()) await store.finishRun(run.id,{status:'complete',accepted:report.snapshots});
    } else {
      if (payload.version !== 1 || !Array.isArray(payload.jobs)) throw new Error('Invalid legacy jobs');
      for (const job of payload.jobs) {
        report.jobs++;
        if (apply) await database.pool.query(`INSERT INTO discovery_jobs(id,kind,status,source_keys,payload,result,error_message,created_at,started_at,completed_at,idempotency_scope_hash,stages,errors)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) ON CONFLICT(id) DO NOTHING`,
        [job.id,job.kind || 'property', ['running','queued'].includes(job.status)?'failed':job.status,job.sourceIds || [],
          {...job,migrationNote:'Original retained; incomplete legacy jobs require a fresh trigger.'},job.result || null,
          ['running','queued'].includes(job.status)?'Interrupted legacy job preserved; not replayed automatically':null,
          job.createdAt,job.startedAt || null,job.completedAt || null,hash({legacyDigest:digest,jobId:job.id}),job.stages || {},JSON.stringify(job.errors || [])]);
      }
    }
    if (apply) await database.pool.query('INSERT INTO discovery_legacy_imports(content_sha256,kind,original_path,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[digest,kind,file,payload]);
  }
  return report;
}
if(require.main===module){
  const index=process.argv.indexOf('--directory');
  const apply=process.argv.includes('--apply');
  const database=apply?require('../server/db/client'):null;
  migrateLegacy(database,index>=0?process.argv[index+1]:'.cache',apply).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(database?.pool)await database.pool.end();});
}
module.exports={migrateLegacy};
