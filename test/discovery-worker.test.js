'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {claimNextEligibleJob,dueSources,run,waitForInterval}=require('../scripts/discovery-worker');

test('dedicated worker excludes canary and unpromoted queued jobs',async()=>{
  const calls=[];const store={pool:{async query(sql,values){calls.push([sql,values]);return {rows:[{id:'job_safe'}]};}},async claimJob(id,owner,ttl){return {id,owner,ttl};}};
  const claimed=await claimNextEligibleJob(store,'worker-1',['servicelink','treasury']);
  assert.equal(claimed.id,'job_safe');assert.match(calls[0][0],/trigger<>'discovery_canary'/);assert.deepEqual(calls[0][1],[['servicelink','treasury']]);
});

test('recurring worker selects only promoted sources whose own cadence is due',async()=>{
  const store={pool:{async query(){return {rows:[
    {source_key:'servicelink',last_complete:new Date(Date.now()-5*3600000).toISOString()},
    {source_key:'treasury',last_complete:new Date(Date.now()-13*3600000).toISOString()},
  ]};}}};
  assert.deepEqual(await dueSources(store,['servicelink','treasury','gsa']),['treasury','gsa']);
});

test('an explicit canary creates and claims only its requested source job',async()=>{
  const calls=[];const job={id:'job_0123456789abcdef01234567',sourceIds:['servicelink'],trigger:'discovery_canary'};
  const store={async failAbandonedRuns(){},async promotedSources(){throw new Error('canary must not inspect promotions');},async claimNextJob(){throw new Error('canary must not drain unrelated queue');},async createOrReuseJob(input){calls.push(['create',input]);return job;},async claimJob(id){calls.push(['claim',id]);return job;},async renewJobClaim(){return true;},async recordCanary(source,value){calls.push(['canary',source,value]);}};
  const coordinator={async execute(){return {result:{sourceResults:[{sourceId:'servicelink',accepted:1,runId:'00000000-0000-0000-0000-000000000001',report:{scope:{endpoint:'/feed'},complete:true,fullSweepComplete:true,truncated:false}}]}};}};
  const prior=process.env.DISCOVERY_MODE;process.env.DISCOVERY_MODE='advanced';
  try{await run({canarySource:'servicelink',database:{isPg:true},collector:{collectionCoordinator:coordinator},discoveryStore:store});}finally{if(prior===undefined)delete process.env.DISCOVERY_MODE;else process.env.DISCOVERY_MODE=prior;}
  assert.deepEqual(calls[0][1].sourceIds,['servicelink']);assert.equal(calls[1][0],'claim');assert.equal(calls[2][1],'servicelink');
});

test('worker interval removes signal listeners when its timer completes',async()=>{
  const signals=new EventEmitter();await waitForInterval(1,signals);assert.equal(signals.listenerCount('SIGTERM'),0);assert.equal(signals.listenerCount('SIGINT'),0);
});

test('recurring main retries a transient database failure and completes the next iteration',async()=>{
  const signals=new EventEmitter(),events=[];let calls=0;
  await require('../scripts/discovery-worker').main([],{signalTarget:signals,runIteration:async()=>{calls++;if(calls===1){const error=new Error('temporary');error.code='ECONNRESET';throw error;}return {ok:true};},wait:async()=>events.push('wait'),continueRunning:()=>calls<2,logger:{log:value=>events.push(value),error:(...value)=>events.push(value)}});
  assert.equal(calls,2);assert.equal(events.filter(value=>value==='wait').length,1);assert.match(events.at(-1),/"ok":true/);
});

test('once mode and nontransient program errors reject without retry',async()=>{
  const signals=new EventEmitter(),transient=new Error('temporary');transient.code='ECONNRESET';
  await assert.rejects(()=>require('../scripts/discovery-worker').main(['--once'],{signalTarget:signals,runIteration:async()=>{throw transient;},logger:{log(){},error(){}}}),/temporary/);
  let waits=0;await assert.rejects(()=>require('../scripts/discovery-worker').main([],{signalTarget:signals,runIteration:async()=>{throw new Error('bad configuration');},wait:async()=>waits++,logger:{log(){},error(){}}}),/bad configuration/);assert.equal(waits,0);
});