'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {run,waitForInterval}=require('../scripts/discovery-worker');

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
