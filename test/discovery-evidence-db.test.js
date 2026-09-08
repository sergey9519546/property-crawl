'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {createIsolatedDatabase}=require('./discovery-acceptance-db');const {createDiscoveryStore}=require('../server/discovery/store');const {loadEvidence,readSnapshot,readResearch,saveResearch}=require('../server/discovery/evidence');
let isolated,primary,other,sameAddress,snapshotId;
test.before(async()=>{
 isolated=await createIsolatedDatabase({prefix:'discovery_evidence'});
 primary={id:'evidence-primary',source:'hud',state:'CA',address:'10 Shared Avenue',sourceUrl:'https://hud.example/primary',openingBid:100000,saleDate:'2026-10-01',lifecycleStatus:'scheduled',provenance:{origin:'live',recordId:'record-primary',parcelId:'APN-123',jurisdictionFips:'06037'}};
 other={...primary,id:'evidence-linked',source:'servicelink',sourceUrl:'https://auction.example/linked',openingBid:125000,saleDate:'2026-10-02',lifecycleStatus:'active',provenance:{origin:'archive',recordId:'record-linked',parcelId:'APN-123',jurisdictionFips:'06037'}};
 sameAddress={...primary,id:'evidence-candidate',source:'irs',sourceUrl:'https://irs.example/candidate',provenance:{origin:'live',recordId:'record-candidate',parcelId:'APN-999',jurisdictionFips:'06037'}};
 for(const row of [primary,other,sameAddress])await isolated.pool.query('INSERT INTO listings(id,source_key,state,address,source_url,opening_bid,sale_date,lifecycle_status,status,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[row.id,row.source,row.state,row.address,row.sourceUrl,row.openingBid,row.saleDate,row.lifecycleStatus,'active',row.provenance]);
 const store=createDiscoveryStore(isolated.pool);const run=await store.beginRun({sourceKey:'hud',scope:{test:true}});
 const snap=await store.appendSnapshot({runId:run.id,sourceKey:'hud',sourceRecordId:'record-primary',observedAt:'2026-09-05T10:00:00Z',rawPayload:{sourceUrl:primary.sourceUrl,address:primary.address,openingBid:100000},provenance:{origin:'live',exactSourceUrl:primary.sourceUrl},observations:{openingBid:100000,status:'scheduled'}});snapshotId=snap.id;
 await store.appendSnapshot({runId:run.id,sourceKey:'hud',sourceRecordId:'record-primary',observedAt:'2026-09-06T10:00:00Z',rawPayload:{kind:'closed_result',sourceUrl:primary.sourceUrl,transactionOutcome:'reported closed'},provenance:{origin:'archive',exactSourceUrl:primary.sourceUrl},observations:{transactionOutcome:{value:null,evidenceClass:'unknown'}}});
 await isolated.pool.query("INSERT INTO discovery_media_assets(sha256,bytes,local_path,integrity,display_status,rights) VALUES($1,12,$2,'verified','policy_review_required','not_established')",['a'.repeat(64),'C:/private/archive/photo.jpg']);
 await isolated.pool.query('INSERT INTO discovery_media_links(source_key,source_record_id,sha256,source_url,dataset_sha256) VALUES($1,$2,$3,$4,$5)',['hud','record-primary','a'.repeat(64),'https://cdn.example/photo.jpg','b'.repeat(64)]);
});
test.after(async()=>{if(isolated)await isolated.close();});
test('evidence history preserves exact publisher binding and separates closed summaries',async()=>{
 const evidence=await loadEvidence(isolated.pool,primary);assert.equal(evidence.evidenceTimeline.total,2);assert.deepEqual(evidence.evidenceTimeline.items.map(x=>x.kind).sort(),['closed_result','publisher_record']);
 const raw=await readSnapshot(isolated.pool,primary,snapshotId);assert.equal(raw.recordId,'record-primary');assert.equal(raw.rawValues.openingBid,100000);
 assert.equal(await readSnapshot(isolated.pool,{...primary,provenance:{...primary.provenance,recordId:'different-record'}},snapshotId),null);
});
test('exact parcel and jurisdiction conflicts remain linked while same-address identities stay candidates',async()=>{
 const evidence=await loadEvidence(isolated.pool,primary);assert.deepEqual(evidence.linkedPublisherRecords.map(x=>x.id),['evidence-linked']);assert.deepEqual(evidence.identityCandidates.map(x=>x.id),['evidence-candidate']);assert.ok(evidence.publisherConflicts.some(x=>x.field==='openingBid'));
});
test('media evidence does not expose local paths and research survives service calls',async()=>{
 const evidence=await loadEvidence(isolated.pool,primary);assert.equal(evidence.mediaEvidence.assets.length,1);assert.equal(Object.hasOwn(evidence.mediaEvidence.assets[0],'localPath'),false);assert.doesNotMatch(JSON.stringify(evidence),/private.archive/);
 const key='c'.repeat(64);await saveResearch(isolated.pool,primary.id,key,{parcel:'verified'});assert.deepEqual((await readResearch(isolated.pool,primary.id,key)).result,{parcel:'verified'});
});
