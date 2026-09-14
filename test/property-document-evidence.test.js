'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildDocumentEvidence } = require('../server/intelligence/document-evidence');
const { validateListingForIngestion } = require('../server/scrapers/validation');

function listing(documents) {
  const sourceUrl='https://www.servicelinkauction.com/property-details/1-main-street-test-90001-ca-united-states-tps';
  return { id:'servicelink:record-1',source:'servicelink',state:'CA',address:'1 Main St, Test, CA 90001',sourceUrl,sourceObservedAt:'2026-09-12T10:00:00Z',raw:'PUBLIC AUCTION property listing for 1 Main Street, Test, California 90001.',provenance:{origin:'live',observed:true,observedAt:'2026-09-12T10:00:00Z',recordId:'record-1',publisher:'ServiceLink Auction',exactSourceUrl:sourceUrl,sourceFacts:{...(documents===undefined?{}:{documents})}} };
}

test('observed documents retain only publisher labels, safe URLs, access, capture time, and provenance',()=>{
 const evidence=buildDocumentEvidence(listing([{title:'Purchase Agreement',fileUrl:'https://www.servicelinkauction.com/docs/terms.pdf',accessState:'public'},{label:'Bidder package',url:'https://www.servicelinkauction.com/docs/bid.pdf',access:'registration required',observedAt:'2026-09-11T09:00:00Z'}]),{capturedEvidence:true});
 assert.equal(evidence.status,'observed');assert.equal(evidence.count,2);assert.equal(evidence.items[0].label,'Purchase Agreement');assert.equal(evidence.items[0].accessState,'public');assert.equal(evidence.items[0].observedAt,'2026-09-12T10:00:00.000Z');assert.equal(evidence.items[1].accessState,'registration_required');assert.equal(evidence.items[1].observedAt,'2026-09-11T09:00:00.000Z');assert.equal(evidence.items[0].provenance.sourceField,'provenance.sourceFacts.documents[0]');
});

test('explicit empty document evidence is zero while a missing container stays unknown',()=>{
 const empty=buildDocumentEvidence(listing([]),{capturedEvidence:true});assert.equal(empty.status,'none_observed');assert.equal(empty.count,0);assert.deepEqual(empty.items,[]);
 const unknown=buildDocumentEvidence(listing(undefined),{capturedEvidence:true});assert.equal(unknown.status,'unknown');assert.equal(unknown.count,null);assert.deepEqual(unknown.items,[]);
});

test('unverified claims remain unknown and unsafe URLs cannot become links',()=>{
 const unverified=buildDocumentEvidence(listing([{title:'Terms',url:'https://example.test/terms.pdf'}]),{capturedEvidence:false});assert.equal(unverified.status,'unknown');assert.equal(unverified.count,null);
 const observed=buildDocumentEvidence(listing([{title:'Local',url:'file:///private/terms.pdf',accessState:'restricted'}]),{capturedEvidence:true});assert.equal(observed.items[0].url,null);assert.equal(observed.items[0].accessState,'restricted');
});

test('source-fact and media containers are both retained with explicit disagreement',()=>{
 const subject=listing([{title:'Terms',url:'https://www.servicelinkauction.com/docs/terms.pdf'}]);subject.provenance.media={documents:[{title:'Addendum',url:'https://www.servicelinkauction.com/docs/addendum.pdf'}]};
 const evidence=buildDocumentEvidence(subject,{capturedEvidence:true});assert.equal(evidence.count,2);assert.equal(evidence.disagreement,true);assert.deepEqual(evidence.containers,{'provenance.sourceFacts.documents':{count:1},'provenance.media.documents':{count:1}});assert.deepEqual(evidence.items.map(x=>x.provenance.sourceField),['provenance.sourceFacts.documents[0]','provenance.media.documents[0]']);
});

test('default trust evaluation accepts a valid captured publisher record without route-side duplication',()=>{
 const subject=listing([]);assert.deepEqual(validateListingForIngestion(subject).errors,[]);
 const evidence=buildDocumentEvidence(subject,{now:Date.parse('2026-09-12T11:00:00Z')});
 assert.equal(evidence.status,'none_observed');assert.equal(evidence.count,0);
});

test('legacy document aliases retain captured links, labels, and explicit capture timestamps',()=>{
 const evidence=buildDocumentEvidence(listing([{documentName:'Legacy terms',documentURL:'https://www.servicelinkauction.com/docs/legacy.pdf',capturedAt:'2026-09-10T08:00:00Z'}]),{capturedEvidence:true});
 assert.equal(evidence.items[0].label,'Legacy terms');assert.equal(evidence.items[0].url,'https://www.servicelinkauction.com/docs/legacy.pdf');assert.equal(evidence.items[0].observedAt,'2026-09-10T08:00:00.000Z');
});

test('identical dual containers display and count documents once while retaining both provenance paths',()=>{
 const docs=[{documentName:'Terms',documentUrl:'https://www.servicelinkauction.com/docs/terms.pdf'}];const subject=listing(docs);subject.provenance.media={documents:JSON.parse(JSON.stringify(docs))};
 const evidence=buildDocumentEvidence(subject,{capturedEvidence:true});assert.equal(evidence.count,1);assert.equal(evidence.items.length,1);assert.equal(evidence.disagreement,false);assert.deepEqual(evidence.items[0].provenance.sourceFields,['provenance.sourceFacts.documents[0]','provenance.media.documents[0]']);
});

test('large arrays retain declared count and traverse only the bounded display window',()=>{
 const docs=Array.from({length:150},(_,index)=>({documentName:`Document ${index}`,documentUrl:`https://www.servicelinkauction.com/docs/${index}.pdf`}));const evidence=buildDocumentEvidence(listing(docs),{capturedEvidence:true});
 assert.equal(evidence.count,150);assert.equal(evidence.items.length,100);assert.equal(evidence.truncated,true);assert.equal(evidence.items.at(-1).label,'Document 99');
});
