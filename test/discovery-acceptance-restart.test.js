'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const {fork}=require('node:child_process');
const {createIsolatedDatabase}=require('./discovery-acceptance-db');const {createDiscoveryStore}=require('../server/discovery/store');
let isolated;
test.before(async()=>{isolated=await createIsolatedDatabase({prefix:'discovery_restart'});});
test.after(async()=>{if(isolated)await isolated.close();});
function claimant(jobId,owner){return fork(path.resolve(__dirname,'discovery-acceptance-claimant.js'),[],{env:{...process.env,DATABASE_URL:process.env.DISCOVERY_TEST_DATABASE_URL||process.env.TEST_DATABASE_URL||process.env.DATABASE_URL,DISCOVERY_TEST_SCHEMA:isolated.schema,DISCOVERY_TEST_JOB_ID:jobId,DISCOVERY_TEST_OWNER:owner},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});}
function firstMessage(child){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('claimant timed out')),5000);child.once('message',value=>{clearTimeout(timer);value.error?reject(new Error(value.error)):resolve(value);});child.once('error',reject);});}
function exited(child){return new Promise(resolve=>child.once('exit',resolve));}
test('a job held by a killed process is reclaimed only after its durable lease expires',{timeout:20000},async()=>{
 const store=createDiscoveryStore(isolated.pool);const job=await store.createOrReuseJob({idempotencyKey:'restart-job',sourceIds:['hud']});
 const first=claimant(job.id,'process-before-crash');assert.deepEqual(await firstMessage(first),{claimed:true});
 assert.equal(await store.claimJob(job.id,'premature-restart',10),null);
 const stopped=exited(first);first.kill();await stopped;
 assert.equal(await store.claimJob(job.id,'immediate-restart',10),null);
 await new Promise(resolve=>setTimeout(resolve,10500));
 const second=claimant(job.id,'process-after-restart');assert.deepEqual(await firstMessage(second),{claimed:true});
 const persisted=await isolated.pool.query('SELECT lease_owner,attempt_count,status FROM discovery_jobs WHERE id=$1',[job.id]);
 assert.equal(persisted.rows[0].lease_owner,'process-after-restart');assert.equal(persisted.rows[0].attempt_count,2);assert.equal(persisted.rows[0].status,'running');
 const stoppedSecond=exited(second);second.kill();await stoppedSecond;
});
