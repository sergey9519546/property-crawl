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
