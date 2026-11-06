'use strict';
const assert=require('node:assert/strict');
const {after,before,test}=require('node:test');
const {PgHuntStore}=require('../server/discovery/hunt-store');
const {createIsolatedDatabase}=require('./discovery-acceptance-db');
const databaseUrl=process.env.DISCOVERY_TEST_DATABASE_URL||process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
let isolated,pool,store;
before(async()=>{
 if(!databaseUrl)return;
 isolated=await createIsolatedDatabase({url:databaseUrl,prefix:'hunt_concurrency',max:4});
 pool=isolated.pool;
 store=new PgHuntStore(pool);
});
after(async()=>{if(isolated)await isolated.close();});
test('concurrent partial patches preserve both fields atomically',{skip:!databaseUrl},async()=>{const hunt=await store.create({name:'Original',enabled:true,criteria:{mode:'all',rules:[{field:'state',operator:'eq',value:'CA'}]}});await Promise.all([store.update(hunt.id,{name:'Renamed'}),store.update(hunt.id,{enabled:false})]);const result=await store.get(hunt.id);assert.equal(result.name,'Renamed');assert.equal(result.enabled,false);});
test('stale evaluation is rejected before baseline or event writes',{skip:!databaseUrl},async()=>{const hunt=await store.create({name:'Versioned',enabled:true,criteria:{mode:'all',rules:[{field:'state',operator:'eq',value:'CA'}]}});await store.update(hunt.id,{criteria:{mode:'all',rules:[{field:'state',operator:'eq',value:'NV'}]}});const record={sourceId:'hud',recordId:'case',observedAt:'2026-09-07T00:00:00Z'};await assert.rejects(store.saveEvaluation(hunt,{baseline:{huntVersion:1,records:{['a'.repeat(64)]:record}},events:[{id:`hevt_${'b'.repeat(24)}`,identityKey:'a'.repeat(64),type:'new_match',detectedAt:'2026-09-07T00:00:00Z'}],response:{}}),error=>error.status===409&&error.code==='HUNT_VERSION_CONFLICT');assert.equal((await pool.query('SELECT count(*)::int n FROM discovery_hunt_baselines')).rows[0].n,0);assert.equal((await pool.query('SELECT count(*)::int n FROM discovery_hunt_events')).rows[0].n,0);});
