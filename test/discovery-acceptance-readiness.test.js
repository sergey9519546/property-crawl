'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {discoveryReadiness}=require('../server/discovery-readiness');
test('advanced readiness fails without a live probe',async()=>{const value=await discoveryReadiness({env:{DATABASE_URL:'configured'}});assert.equal(value.ready,false);});
test('advanced readiness checks required tables and PostGIS',async()=>{const value=await discoveryReadiness({env:{DATABASE_URL:'configured'},databaseProbe:async()=>({postgis:true,tables:['listings','discovery_source_runs','discovery_snapshots','discovery_checkpoints','discovery_jobs','discovery_leases']})});assert.equal(value.ready,true);});
test('advanced readiness rejects incomplete schema',async()=>{const value=await discoveryReadiness({env:{DATABASE_URL:'configured'},databaseProbe:async()=>({postgis:false,tables:['listings']})});assert.equal(value.ready,false);assert.match(value.checks.database.reason,/missing|PostGIS/);});

// The original version of this test asserted that a worker health payload with
// `backlog.expiredRunning: 1` was passed through untouched. It looked like
// coverage of the degraded/ready interaction and was actually the defect: the
// payload it used already had `degraded:true`, so the readiness layer never had
// to look at the backlog it was handed. That is how a pipeline with a job frozen
// at 'running' under a dead lease shipped `degraded:false, ready:true` -- the
// one signal that detects a wedged collector, counted and then discarded.
//
// The additive policy is kept, because it is correct: a wedged collector must
// not make the API report not-ready and take a working process out of service.
// What is corrected is the flag, and the fixture now uses the state that
// actually used to occur -- a worker checking in on time, healthy by its own
// heartbeat, with an abandoned job behind it.
test('worker degradation is additive and does not make a healthy database unready',async()=>{const collectionHealth={status:'healthy',degraded:false,lastSeenAt:new Date().toISOString(),lastLoopStatus:'idle',currentJobId:null,backlog:{queued:2,expiredRunning:1}};const value=await discoveryReadiness({env:{DATABASE_URL:'configured'},databaseProbe:async()=>({postgis:true,tables:['listings','discovery_source_runs','discovery_snapshots','discovery_checkpoints','discovery_jobs','discovery_leases'],collectionHealth})});assert.equal(value.ready,true);assert.deepEqual(value.collectionHealth,{...collectionHealth,degraded:true});});

test('an expired job lease is reported as degradation, not as a healthy worker',async()=>{const value=await discoveryReadiness({env:{DATABASE_URL:'configured'},databaseProbe:async()=>({postgis:true,tables:['listings','discovery_source_runs','discovery_snapshots','discovery_checkpoints','discovery_jobs','discovery_leases'],collectionHealth:{status:'healthy',degraded:false,lastSeenAt:new Date().toISOString(),lastLoopStatus:'idle',currentJobId:null,backlog:{queued:0,expiredRunning:1}}})});assert.equal(value.collectionHealth.degraded,true);assert.equal(value.ready,true,'degradation is reported, the API stays up');});

test('a healthy worker with no abandoned job is not degraded',async()=>{const value=await discoveryReadiness({env:{DATABASE_URL:'configured'},databaseProbe:async()=>({postgis:true,tables:['listings','discovery_source_runs','discovery_snapshots','discovery_checkpoints','discovery_jobs','discovery_leases'],collectionHealth:{status:'healthy',degraded:false,lastSeenAt:new Date().toISOString(),lastLoopStatus:'idle',currentJobId:null,backlog:{queued:3,expiredRunning:0}}})});assert.equal(value.collectionHealth.degraded,false);});
