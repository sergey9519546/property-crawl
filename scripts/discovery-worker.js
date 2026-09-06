'use strict';
const crypto = require('node:crypto');
const db = require('../server/db/client');
const scheduler = require('../server/scrapers/scheduler');
const { createDiscoveryStore } = require('../server/discovery/store');
const { sourcesForWave } = require('../server/discovery/contracts');

async function run({ wave = process.env.DISCOVERY_WAVE || 'wave1', canarySource = null } = {}) {
  if (process.env.DISCOVERY_MODE !== 'advanced' || !db.isPg) throw new Error('Discovery worker requires DISCOVERY_MODE=advanced and PostgreSQL');
  const store=createDiscoveryStore(db), sourceIds=canarySource?[canarySource]:(await store.promotedSources()).filter(x=>sourcesForWave(wave).includes(x));
  if(!sourceIds.length)return {skipped:true,reason:'no_promoted_sources'};
  const owner=`worker:${process.pid}:${crypto.randomUUID()}`, leases=[];
  for(const source of sourceIds){const key=`discovery:source:${source}`;if(await store.acquireLease(key,owner,300))leases.push(key);}
  if(!leases.length)return {skipped:true,reason:'source_leases_held'};
  const runnable=sourceIds.filter(source=>leases.includes(`discovery:source:${source}`)); let leaseHealthy=true;
  const heartbeat=setInterval(async()=>{for(const key of leases)if(!await store.renewLease(key,owner,300))leaseHealthy=false;},120000); heartbeat.unref();
  try { await store.failAbandonedRuns(); if(!leaseHealthy)throw new Error('Discovery lease lost');const result=await scheduler.runAll({sourceIds:runnable,trigger:canarySource?'discovery_canary':'discovery_worker'});if(canarySource){const sr=result.sourceResults?.find(x=>x.sourceId===canarySource);await store.recordCanary(canarySource,{clean:Boolean(sr&&!sr.error&&!sr.observationError&&sr.accepted>0&&sr.report?.truncated!==true&&sr.report?.complete!==false),scope:{mode:'configured'}});}return result; }
  finally { clearInterval(heartbeat); for(const key of leases)await store.releaseLease(key,owner); }
}
async function main(args=process.argv.slice(2)){
  const canaryAt=args.indexOf('--canary'),promoteAt=args.indexOf('--promote'),once=args.includes('--once')||canaryAt>=0;
  if(promoteAt>=0){if(!args[promoteAt+1])throw new Error('--promote requires source');console.log(await createDiscoveryStore(db).promoteSource(args[promoteAt+1]));return;}
  let stopping=false;const stop=()=>{stopping=true;};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  do{console.log(JSON.stringify(await run({canarySource:canaryAt>=0?args[canaryAt+1]:null})));if(once||stopping)break;await new Promise(resolve=>{const timer=setTimeout(resolve,Math.max(900000,Number(process.env.DISCOVERY_INTERVAL_MS)||21600000));const wake=()=>{clearTimeout(timer);resolve();};process.once('SIGTERM',wake);process.once('SIGINT',wake);});}while(!stopping);
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.pool?.end());
module.exports={main,run};
