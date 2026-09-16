'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {createPropertyImageService}=require('../server/routes/property-image');

function listing(overrides={}){
  return{id:'LIVE-1',source:'civilview',sourceUrl:'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=12345',sourceObservedAt:'2026-09-12T12:00:00Z',lat:40.7,lng:-74,
    provenance:{origin:'live',observed:true,recordKind:'source_record',publisher:'Publisher',recordId:'record-1',observedAt:'2026-09-12T12:00:00Z'},...overrides};
}
function request(extra=''){return{method:'GET',url:'http://localhost/api/property-image?listingId=LIVE-1&mode=alternatives'+extra,headers:{host:'localhost'}};}
function feature(properties={}){
  return{type:'Feature',id:'picture-1',collection:'sequence-1',geometry:{type:'Point',coordinates:[-74.0001,40.7001]},
    properties:{license:'CC-BY-SA-4.0',field_of_view:360,...properties},links:[{rel:'license',href:'https://spdx.org/licenses/CC-BY-SA-4.0.html'}]};
}
function response(features){return new Response(JSON.stringify({type:'FeatureCollection',features}),{status:200,headers:{'content-type':'application/geo+json'}});}
function service(record,fetchImpl,env={}){return createPropertyImageService({db:{async getListingById(){return record;}},fetchImpl,env});}

test('alternatives needs no Google key and uses only stored source coordinates',async()=>{
  let requested;
  const api=service(listing(),async url=>{requested=new URL(url);return response([feature()]);},{GOOGLE_MAPS_API_KEY:''});
  const result=await api.resolve(request('&lat=1&lng=2'));
  assert.equal(result.status,200);assert.equal(result.body.available,true);assert.equal(result.body.provider,'Panoramax + Mapillary');
  assert.equal(result.body.coordinateBasis,'source_coordinates');
  assert.match(result.body.candidate.viewerUrl,/^https:\/\/api\.panoramax\.xyz\/\?/);
  assert.equal(new URL(result.body.candidate.viewerUrl).searchParams.get('pic'),'picture-1');
  const bbox=requested.searchParams.get('bbox').split(',').map(Number);
  assert.ok(bbox[0]<-74&&bbox[2]>-74&&bbox[1]<40.7&&bbox[3]>40.7);
  assert.doesNotMatch(requested.toString(),/maps\.googleapis|(?:^|[?&])lat=1|(?:^|[?&])lng=2/);
  // Mapillary was queried in parallel and returned not_configured (no
  // token in this fixture); the merged response surfaces the per-provider
  // reason so callers can distinguish a missing key from real coverage.
  assert.equal(result.body.providers.panoramax.available,true);
  assert.match(result.body.providers.mapillary.reason,/not_configured/);
});

test('unverified, archived, derived, and missing source coordinates fail before provider calls',async()=>{
  const cases=[
    listing({provenance:{origin:'snapshot',observed:false}}),
    listing({provenance:{...listing().provenance,origin:'archive'}}),
    listing({provenance:{...listing().provenance,derivedFields:{geocode:{provider:'legacy'}}}}),
    listing({lat:null,lng:null}),
  ];
  for(const record of cases){let fetched=false;const result=await service(record,async()=>{fetched=true;return response([]);}).resolve(request());assert.equal(result.status,422);assert.equal(fetched,false);}
});

test('no imagery and provider errors have distinct truthful results',async()=>{
  const empty=await service(listing(),async()=>response([])).resolve(request());
  assert.equal(empty.status,200);assert.equal(empty.body.available,false);assert.match(empty.body.reason,/No explicitly identified/);
  // A transport-level failure on BOTH providers (network reset) surfaces
  // a 503 with the standard "alternative_provider_unavailable" code. A
  // failure on only one provider is isolated — the other still answers.
  // Mapillary must be given a token here, otherwise its lookup returns a
  // graceful { reason: 'not_configured' } object and the route still has
  // at least one answer, which would surface as 200 instead of 503.
  const failed=await service(listing(),async()=>{throw new TypeError('network reset');},{MAPILLARY_ACCESS_TOKEN:'TEST'}).resolve(request());
  assert.equal(failed.status,503);assert.equal(failed.body.error,'alternative_provider_unavailable');
});

test('directional sequences require an approved display license and requests stay bounded',async()=>{
  const directional=feature({field_of_view:90});
  const proprietary=feature({license:'proprietary',field_of_view:90});
  proprietary.id='private';proprietary.geometry={type:'Point',coordinates:[-74.0002,40.7002]};
  let init,url;
  const result=await service(listing(),async(u,i)=>{url=new URL(u);init=i;return response([directional,proprietary]);},{PANORAMAX_RADIUS_METERS:'999',PANORAMAX_RESULT_LIMIT:'99'}).resolve(request());
  assert.equal(result.body.available,false);assert.equal(result.body.directionalSequences.length,1);
  assert.equal(result.body.directionalSequences[0].pictureId,'picture-1');
  assert.equal(url.origin,'https://api.panoramax.xyz');assert.equal(url.searchParams.get('limit'),'10');
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
});
