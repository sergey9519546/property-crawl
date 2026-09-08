'use strict';
const crypto = require('node:crypto');
const db = require('../server/db/client');
const scheduler = require('../server/scrapers/scheduler');
const { createDiscoveryStore } = require('../server/discovery/store');
const { sourcesForWave } = require('../server/discovery/contracts');

async function run({ wave = process.env.DISCOVERY_WAVE || 'wave1', canarySource = null, database=db, collector=scheduler, discoveryStore=null } = {}) {
  if (process.env.DISCOVERY_MODE !== 'advanced' || !database.isPg) throw new Error('Discovery worker requires DISCOVERY_MODE=advanced and PostgreSQL');
  const store=discoveryStore||createDiscoveryStore(database), sourceIds=canarySource?[canarySource]:(await store.promotedSources()).filter(x=>sourcesForWave(wave).includes(x));
  const owner=`worker:${process.pid}:${crypto.randomUUID()}`, coordinator=collector.collectionCoordinator;
  if(!coordinator)throw new Error('Discovery worker requires the collection coordinator');
  await store.failAbandonedRuns();
  let job;
  if(canarySource){const queued=await store.createOrReuseJob({sourceIds:[canarySource],trigger:'discovery_canary',idempotencyKey:`canary:${canarySource}:${crypto.randomUUID()}`});job=await store.claimJob(queued.id,owner,300);}
  else{job=await store.claimNextJob(owner,300);if(!job){if(!sourceIds.length)return {skipped:true,reason:'no_promoted_sources'};const key=`recurring:${wave}:${sourceIds.join(',')}:${new Date().toISOString().slice(0,13)}`;const queued=await store.createOrReuseJob({sourceIds,trigger:'discovery_worker',idempotencyKey:key});job=await store.claimJob(queued.id,owner,300);}}
  if(!job)return {skipped:true,reason:'collection_jobs_claimed'};
  let leaseHealthy=true,heartbeatBusy=false;
  const heartbeat=setInterval(async()=>{if(heartbeatBusy)return;heartbeatBusy=true;try{if(!await store.renewJobClaim(job.id,owner,300))leaseHealthy=false;}catch{leaseHealthy=false;}finally{heartbeatBusy=false;}},120000);heartbeat.unref();
  try {if(!leaseHealthy)throw new Error('Discovery job lease lost');const result=await coordinator.execute(job.id,{sourceIds:job.sourceIds,trigger:job.trigger},{owner});if(canarySource){const sr=result?.result?.sourceResults?.find(x=>x.sourceId===canarySource)||result?.sourceResults?.find(x=>x.sourceId===canarySource);const scope=sr?.report?.scope;const clean=Boolean(scope&&sr&&!sr.error&&!sr.observationError&&sr.accepted>0&&sr.report?.complete===true&&sr.report?.fullSweepComplete===true&&sr.report?.truncated!==true);await store.recordCanary(canarySource,{clean,scope:scope||{source:canarySource,incomplete:true},runId:sr?.runId||null});}return result;}
  finally {clearInterval(heartbeat);}
}
function waitForInterval(ms,signalTarget=process){return new Promise(resolve=>{let settled=false;const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);signalTarget.removeListener('SIGTERM',finish);signalTarget.removeListener('SIGINT',finish);resolve();};const timer=setTimeout(finish,ms);signalTarget.once('SIGTERM',finish);signalTarget.once('SIGINT',finish);});}
async function main(args=process.argv.slice(2)){
  const canaryAt=args.indexOf('--canary'),promoteAt=args.indexOf('--promote'),once=args.includes('--once')||canaryAt>=0;
  if(promoteAt>=0){if(!args[promoteAt+1])throw new Error('--promote requires source');console.log(await createDiscoveryStore(db).promoteSource(args[promoteAt+1]));return;}
  let stopping=false;const stop=()=>{stopping=true;};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  do{console.log(JSON.stringify(await run({canarySource:canaryAt>=0?args[canaryAt+1]:null})));if(once||stopping)break;await waitForInterval(Math.max(900000,Number(process.env.DISCOVERY_INTERVAL_MS)||21600000));}while(!stopping);
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.pool?.end());
module.exports={main,run,waitForInterval};
