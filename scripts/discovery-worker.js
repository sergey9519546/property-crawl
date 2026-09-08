'use strict';
const crypto = require('node:crypto');
const db = require('../server/db/client');
const scheduler = require('../server/scrapers/scheduler');
const { createDiscoveryStore } = require('../server/discovery/store');
const { sourcesForWave } = require('../server/discovery/contracts');
const { SOURCE_CATALOG } = require('../server/sources/catalog');

const cadenceByAdapter = new Map(SOURCE_CATALOG.filter(source=>source.adapterKey).map(source=>[source.adapterKey,source.workflow.cadenceHours]));
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

async function run({ wave = process.env.DISCOVERY_WAVE || 'wave1', canarySource = null, database=db, collector=scheduler, discoveryStore=null } = {}) {
  if (process.env.DISCOVERY_MODE !== 'advanced' || !database.isPg) throw new Error('Discovery worker requires DISCOVERY_MODE=advanced and PostgreSQL');
  const store=discoveryStore||createDiscoveryStore(database), sourceIds=canarySource?[canarySource]:(await store.promotedSources()).filter(x=>sourcesForWave(wave).includes(x));
  const owner=`worker:${process.pid}:${crypto.randomUUID()}`, coordinator=collector.collectionCoordinator,workerKey=wave;
  await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:'starting'});
  if(!coordinator)throw new Error('Discovery worker requires the collection coordinator');
  await store.failAbandonedRuns();
  let job;
  if(canarySource){const queued=await store.createOrReuseJob({sourceIds:[canarySource],trigger:'discovery_canary',idempotencyKey:`canary:${canarySource}:${crypto.randomUUID()}`});job=await store.claimJob(queued.id,owner,300);}
  else{if(!sourceIds.length){await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:'no_promoted_sources'});return {skipped:true,reason:'no_promoted_sources'};}job=await claimNextEligibleJob(store,owner,sourceIds);if(!job){const due=await dueSources(store,sourceIds);if(!due.length){await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:'no_sources_due'});return {skipped:true,reason:'no_sources_due'};}const key=`recurring:${wave}:${due.join(',')}:${new Date().toISOString().slice(0,13)}`;const queued=await store.createOrReuseJob({sourceIds:due,trigger:'discovery_worker',idempotencyKey:key});job=await store.claimJob(queued.id,owner,300);}}
  if(!job)return {skipped:true,reason:'collection_jobs_claimed'};
  await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:'running',currentJobId:job.id});
  let leaseHealthy=true,heartbeatBusy=false;
  const heartbeat=setInterval(async()=>{if(heartbeatBusy)return;heartbeatBusy=true;try{if(!await store.renewJobClaim(job.id,owner,300))leaseHealthy=false;else await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:'running',currentJobId:job.id});}catch{leaseHealthy=false;}finally{heartbeatBusy=false;}},120000);heartbeat.unref();
  try {if(!leaseHealthy)throw new Error('Discovery job lease lost');const result=await coordinator.execute(job.id,{sourceIds:job.sourceIds,trigger:job.trigger},{owner});if(canarySource){const sr=result?.result?.sourceResults?.find(x=>x.sourceId===canarySource)||result?.sourceResults?.find(x=>x.sourceId===canarySource);const scope=sr?.report?.scope;const clean=Boolean(scope&&sr&&!sr.error&&!sr.observationError&&sr.accepted>0&&sr.report?.complete===true&&sr.report?.fullSweepComplete===true&&sr.report?.truncated!==true);await store.recordCanary(canarySource,{clean,scope:scope||{source:canarySource,incomplete:true},runId:sr?.runId||null});}return result;}
  finally {clearInterval(heartbeat);try{await store.recordWorkerHealth?.(workerKey,{workerId:owner,lastLoopStatus:leaseHealthy?'idle':'lease_lost'});}catch{}}
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
      if(once||!['ECONNREFUSED','ECONNRESET','ETIMEDOUT','08001','08006','57P01','57P02','57P03'].includes(error.code))throw error;
      logger.error('[DiscoveryWorker] transient iteration failure:',error.code);
    }
    if(once||stopping||!continueRunning())break;const configured=Number(process.env.DISCOVERY_POLL_MS)||30000;await wait(Math.max(5000,Math.min(300000,configured)));
  }while(!stopping);
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.pool?.end());
module.exports={claimNextEligibleJob,dueSources,main,run,waitForInterval};
