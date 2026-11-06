'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const hunts=require('../server/intelligence/hunts');
const hunt={id:'hunt_aaaaaaaaaaaaaaaaaaaaaaaa',version:1,enabled:true,criteria:{mode:'all',rules:[{field:'state',operator:'eq',value:'NJ'}]}};
function listing(index,overrides={}){const recordId=String(1000000000+index);return {id:`CIV-NJ-${recordId}`,source:'civilview',state:'NJ',county:'Bergen',city:'Park Ridge',address:`${index} Acceptance Avenue`,status:'scheduled',raw:`Official CivilView source record ${recordId}`,sourceUrl:`https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${recordId}`,sourceObservedAt:'2026-09-05T18:00:00.000Z',provenance:{origin:'live',observed:true,recordKind:'source_record',publisher:'CivilView',recordId,observedAt:'2026-09-05T18:00:00.000Z'},...overrides};}
test('a paged durable hunt retains more than 10000 identities and partial pages cannot imply disappearance',{timeout:15000},()=>{
 let baseline=null,evaluated;const records=Array.from({length:10050},(_,i)=>listing(i));
 for(let offset=0;offset<records.length;offset+=1000){evaluated=hunts.evaluateInventory(hunt,records.slice(offset,offset+1000),{now:'2026-09-07T20:00:00.000Z',previousBaseline:baseline,baselineLimit:Infinity,suppressEvents:!baseline});baseline=evaluated.baseline;}
 assert.equal(Object.keys(baseline.records).length,10050);
 const changed=listing(10049,{state:'PA',sourceObservedAt:'2026-09-06T19:00:00.000Z',provenance:{...records[10049].provenance,observedAt:'2026-09-06T19:00:00.000Z'}});
 const partial=hunts.evaluateInventory(hunt,[changed],{now:'2026-09-07T20:00:00.000Z',previousBaseline:baseline,baselineLimit:Infinity});
 assert.equal(Object.keys(partial.baseline.records).length,10050);
 assert.equal(partial.events.filter(event=>event.type==='no_longer_matches').length,1);
 assert.equal(partial.response.counts.notObserved,10049);
});


test('durable hunt writes use bounded batches and keep all 10050 baseline identities', async () => {
 const {PgHuntStore}=require('../server/discovery/hunt-store');
 const calls=[];let released=false;
 const client={query:async(sql,params=[])=>{calls.push({sql,params});return {rows:sql.startsWith('SELECT version')?[{version:1}]:[]};},release(){released=true;}};
 const store=new PgHuntStore({query:async()=>({rows:[]}),connect:async()=>client});
 const records=Object.fromEntries(Array.from({length:10050},(_,i)=>[i.toString(16).padStart(64,'0'),{sourceId:'hud',recordId:String(i),observedAt:'2026-09-07T18:00:00Z'}]));
 await store.saveEvaluation(hunt,{baseline:{huntVersion:1,records},events:[],response:{ok:true}});
 const writes=calls.filter(c=>c.sql.startsWith('INSERT INTO discovery_hunt_baselines'));
 assert.equal(writes.length,21);
 assert.equal(writes.reduce((n,c)=>n+JSON.parse(c.params[2]).length,0),10050);
 assert.ok(writes.every(c=>JSON.parse(c.params[2]).length<=500));
 assert.equal(calls[0].sql,'BEGIN');assert.equal(calls.at(-1).sql,'COMMIT');assert.equal(released,true);
});

test('a failed durable baseline batch rolls back without committing or leaking its connection', async () => {
 const {PgHuntStore}=require('../server/discovery/hunt-store');
 const calls=[];let released=false;
 const client={query:async(sql)=>{calls.push(sql);if(sql.startsWith('INSERT INTO discovery_hunt_baselines'))throw new Error('write control');return {rows:sql.startsWith('SELECT version')?[{version:1}]:[]};},release(){released=true;}};
 const store=new PgHuntStore({query:async()=>({rows:[]}),connect:async()=>client});
 await assert.rejects(store.saveEvaluation(hunt,{baseline:{huntVersion:1,records:{['a'.repeat(64)]:{sourceId:'hud',recordId:'a',observedAt:'2026-09-07T18:00:00Z'}}},events:[],response:{}}),/write control/);
 assert.equal(calls.at(-1),'ROLLBACK');assert.equal(calls.includes('COMMIT'),false);assert.equal(released,true);
});
