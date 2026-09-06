'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { archiveListing } = require('../scripts/discovery-import');
const { requireWorkspaceIdentity } = require('../server/security/workspace-identity');

const manifest = { observedAt:'2026-09-05T09:08:00Z', observedAtBasis:'attachment author snapshot time', inputs:{catalog:{sha256:'a'.repeat(64)}} };
function raw() { return { listingId:'a1cVO00000B7fZtYAJ',auctionProgram:'TPS',
  foreclosureSaleDate:'2026-09-16T00:00:00',tpsSaleTime:'11:00 AM',
  propertyInfo:{propertyId:'publisher-property',address:'749 Portola Ave',city:'Glendale',state:'CA',postalCode:'91206',
    websiteUrl:'https://www.servicelinkauction.com/property-details/749-portola-ave'},
  listingStatus:{isAuctionClosed:true,statusText:'Auction is Closed'}, customDetail:{of_bids__c:'10.0'},
  documents:[{title:'Property report',url:'https://www.servicelinkauction.com/auction-documents/report.pdf'}] }; }

test('archive import keeps capture time, identity and unknown transaction proof',()=>{
  const listing=archiveListing(raw(),manifest);
  assert.equal(listing.id,'servicelink:a1cVO00000B7fZtYAJ');
  assert.equal(listing.sourceObservedAt,manifest.observedAt);
  assert.equal(listing.fetchedAt,manifest.observedAt);
  assert.equal(listing.provenance.origin,'archive');
  assert.equal(listing.provenance.liveVerified,false);
  assert.equal(listing.transactionOutcome,null);
  assert.equal(listing.saleTimezone,null);
  assert.equal(listing.provenance.sourceFacts.bidCountReliability,'not_established');
  assert.equal(listing.provenance.sourceFacts.sourceReportedBidCount,'10.0');
  assert.equal(listing.documents.length,1);
  assert.equal(listing.openingBid,null);
});
test('archive parser rejects missing identity without generating a replacement',()=>{
  assert.equal(archiveListing({...raw(),listingId:null},manifest),null);
});

function response(){return {statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};}
test('private identity rejects forged user IDs and missing credentials',()=>{
  const res=response();
  assert.equal(requireWorkspaceIdentity({headers:{'x-user-id':'victim'},url:'/api/alerts?userId=victim'},res,{SCRAPER_ADMIN_TOKEN:'test-secret'}),null);
  assert.equal(res.statusCode,401);
});
test('private identity derives from server workspace, not supplied selectors',()=>{
  const res=response();
  const identity=requireWorkspaceIdentity({headers:{authorization:'Bearer test-secret','x-user-id':'victim'}},res,{SCRAPER_ADMIN_TOKEN:'test-secret',PROPERTY_WORKSPACE_ID:'research'});
  assert.equal(identity,'workspace:research');
});
test('unconfigured workspace fails closed',()=>{
  const res=response();
  assert.equal(requireWorkspaceIdentity({headers:{}},res,{}),null);
  assert.equal(res.statusCode,503);
});
