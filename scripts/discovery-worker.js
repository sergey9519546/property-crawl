'use strict';
const crypto = require('node:crypto');
const db = require('../server/db/client');
const scheduler = require('../server/scrapers/scheduler');
const { createDiscoveryStore, hash } = require('../server/discovery/store');
const { collectionScope } = require('../server/scrapers/collection-scope');
const { sourcesForWave } = require('../server/discovery/contracts');
const { SOURCE_CATALOG } = require('../server/sources/catalog');
const { requireCollectionStorage, inspectCollectionStorage } = require('../server/discovery/storage-health');

const cadenceByAdapter = new Map(SOURCE_CATALOG.filter(source=>source.adapterKey).map(source=>[source.adapterKey,source.workflow.cadenceHours]));
function leaseLostError(message='Discovery job lease lost'){const error=new Error(message);error.code='DISCOVERY_JOB_LEASE_LOST';return error;}
async function dueSources(store,sourceIds,now=Date.now()){
  if(!sourceIds.length)return [];
  const result=await store.pool.query("SELECT source_key,MAX(completed_at) AS last_complete FROM discovery_source_runs WHERE source_key=ANY($1) AND status='complete' GROUP BY source_key",[sourceIds]);
  const completed=new Map(result.rows.map(row=>[row.source_key,Date.parse(row.last_complete)]));
  return sourceIds.filter(sourceId=>{const last=completed.get(sourceId);return !Number.isFinite(last)||now-last>=(cadenceByAdapter.get(sourceId)||24)*3600000;});
}
async function claimNextEligibleJob(store,owner,sourceIds){
  if(!sourceIds.length)return null;
  const candidate=await store.pool.query("SELECT id FROM discovery_jobs WHERE (status='queued' OR (status='running' AND lease_expires_at<NOW())) AND trigger<>'discovery_canary' AND source_keys<@$1::text[] ORDER BY created_at LIMIT 1",[sourceIds]);
  return candidate.rows[0] ? store.claimJob(candidate.rows[0].id,owner,300) : null;
}

async function promotedSourcesWithinScope(store,collector,wave){
  if(typeof store.promotedSourceScopes!=='function')throw new Error('Discovery worker requires authoritative promoted source scopes');
  const allowedWave=new Set(sourcesForWave(wave)),scrapers=new Map((collector.realScrapers||[]).map(scraper=>[scraper.sourceKey,scraper])),eligible=[],rejected=[];
  for(const rollout of await store.promotedSourceScopes()){
    const sourceKey=rollout?.sourceKey;
    if(!allowedWave.has(sourceKey))continue;
    const configured=rollout?.scope,current=collectionScope(scrapers.get(sourceKey));
    if(!configured||typeof configured!=='object'||Array.isArray(configured)||!Object.keys(configured).length){rejected.push({sourceKey,code:'MISSING_CONFIGURED_SCOPE'});continue;}
    if(!rollout.scopeHash||hash(configured)!==rollout.scopeHash){rejected.push({sourceKey,code:'INCONSISTENT_SCOPE_EVIDENCE'});continue;}
    if(!current||hash(current)!==rollout.scopeHash){rejected.push({sourceKey,code:'COLLECTOR_SCOPE_MISMATCH'});continue;}
    const checkpoint=await store.getCheckpoint(sourceKey);
    if(checkpoint&&checkpoint.scopeHash!==rollout.scopeHash){rejected.push({sourceKey,code:'CHECKPOINT_SCOPE_MISMATCH'});continue;}
    eligible.push(sourceKey);
  }
  return {eligible,rejected};
}

async function run({ wave = process.env.DISCOVERY_WAVE || 'wave1', canarySource = null, database=db, collector=scheduler, discoveryStore=null, storageProbe=inspectCollectionStorage } = {}) {
  if (process.env.DISCOVERY_MODE !== 'advanced' || !database.isPg) throw new Error('Discovery worker requires DISCOVERY_MODE=advanced and PostgreSQL');
  requireCollectionStorage(storageProbe);
  const store=discoveryStore||createDiscoveryStore(database), scopePolicy=canarySource?{eligible:[canarySource],rejected:[]}:await promotedSourcesWithinScope(store,collector,wave),sourceIds=scopePolicy.eligible;
  const owner=`worker:${process.pid}:${crypto.randomUUID()}`, coordinator=collector.collectionCoordinator,workerKey=wave;
  const scopeDetails=scopePolicy.rejected.length?{scopeRejections:scopePolicy.rejected}:{};
  await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:'starting',details:scopeDetails});
  if(!coordinator)throw new Error('Discovery worker requires the collection coordinator');
  await store.failAbandonedRuns();
  let job;
  if(canarySource){const queued=await store.createOrReuseJob({sourceIds:[canarySource],trigger:'discovery_canary',idempotencyKey:`canary:${canarySource}:${crypto.randomUUID()}`});job=await store.claimJob(queued.id,owner,300);}
  else{if(!sourceIds.length){await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:'no_promoted_sources',details:scopeDetails});return {skipped:true,reason:'no_promoted_sources',scopeRejections:scopePolicy.rejected};}job=await claimNextEligibleJob(store,owner,sourceIds);if(!job){const due=await dueSources(store,sourceIds);if(!due.length){await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:'no_sources_due',details:scopeDetails});return {skipped:true,reason:'no_sources_due',scopeRejections:scopePolicy.rejected};}const key=`recurring:${wave}:${due.join(',')}:${new Date().toISOString().slice(0,13)}`;const queued=await store.createOrReuseJob({sourceIds:due,trigger:'discovery_worker',idempotencyKey:key});job=await store.claimJob(queued.id,owner,300);}}
  if(!job)return {skipped:true,reason:'collection_jobs_claimed'};
  await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:'running',currentJobId:job.id,details:scopeDetails});
  let leaseHealthy=true,heartbeatBusy=false;
  const heartbeat=setInterval(async()=>{if(heartbeatBusy)return;heartbeatBusy=true;try{if(!await store.renewJobClaim(job.id,owner,300))leaseHealthy=false;else await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:'running',currentJobId:job.id,details:scopeDetails});}catch{leaseHealthy=false;}finally{heartbeatBusy=false;}},120000);heartbeat.unref();
  try {if(!leaseHealthy)throw leaseLostError();const result=await coordinator.execute(job.id,{sourceIds:job.sourceIds,trigger:job.trigger},{owner});if(!leaseHealthy)throw leaseLostError('Discovery job lease lost during collection');if(canarySource){const sr=result?.result?.sourceResults?.find(x=>x.sourceId===canarySource)||result?.sourceResults?.find(x=>x.sourceId===canarySource);const scope=sr?.report?.scope;const clean=Boolean(scope&&sr&&!sr.error&&!sr.observationError&&sr.accepted>0&&sr.report?.complete===true&&sr.report?.fullSweepComplete===true&&sr.report?.truncated!==true);await store.recordCanary(canarySource,{clean,scope:scope||{source:canarySource,incomplete:true},runId:sr?.runId||null});}return scopePolicy.rejected.length?{...result,scopeRejections:scopePolicy.rejected}:result;}
  finally {clearInterval(heartbeat);try{await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:leaseHealthy?'idle':'lease_lost',details:scopeDetails});}catch{}}
}
function waitForInterval(ms,signalTarget=process){return new Promise(resolve=>{let settled=false;const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);signalTarget.removeListener('SIGTERM',finish);signalTarget.removeListener('SIGINT',finish);resolve();};const timer=setTimeout(finish,ms);signalTarget.once('SIGTERM',finish);signalTarget.once('SIGINT',finish);});}
async function main(args=process.argv.slice(2),dependencies={}){
  const runIteration=dependencies.runIteration||run,wait=dependencies.wait||waitForInterval,logger=dependencies.logger||console,continueRunning=dependencies.continueRunning||(()=>true),signalTarget=dependencies.signalTarget||process;
  const canaryAt=args.indexOf('--canary'),promoteAt=args.indexOf('--promote'),once=args.includes('--once')||canaryAt>=0;
  if(promoteAt>=0){if(!args[promoteAt+1])throw new Error('--promote requires source');console.log(await createDiscoveryStore(db).promoteSource(args[promoteAt+1]));return;}
  let stopping=false;const stop=()=>{stopping=true;};signalTarget.once('SIGTERM',stop);signalTarget.once('SIGINT',stop);
  do{
    try{logger.log(JSON.stringify(await runIteration({canarySource:canaryAt>=0?args[canaryAt+1]:null})));}
    catch(error){
      if(once||!['ECONNREFUSED','ECONNRESET','ETIMEDOUT','08001','08006','57P01','57P02','57P03','DISCOVERY_STORAGE_LOW','DISCOVERY_STORAGE_UNAVAILABLE'].includes(error.code))throw error;
      logger.error('[DiscoveryWorker] transient iteration failure:',error.code);
    }
    if(once||stopping||!continueRunning())break;const configured=Number(process.env.DISCOVERY_POLL_MS)||30000;await wait(Math.max(5000,Math.min(300000,configured)));
  }while(!stopping);
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.pool?.end());
module.exports={claimNextEligibleJob,dueSources,leaseLostError,main,promotedSourcesWithinScope,run,waitForInterval};
