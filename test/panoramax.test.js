'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),{lookupPanoramax}=require('../server/media/panoramax');
function item(overrides={}){return{type:'Feature',id:'picture-1',collection:'sequence-1',geometry:{type:'Point',coordinates:[-74.0001,40.7001]},properties:{datetime:'2026-01-02T03:04:05Z',producer:'Open mapper',license:'CC-BY-SA-4.0','view:azimuth':120,'Xmp.GPano.ProjectionType':'equirectangular'},links:[{rel:'via',href:'https://panoramax.openstreetmap.fr/api/items/picture-1'},{rel:'license',href:'https://spdx.org/licenses/CC-BY-SA-4.0.html'}],...overrides};}
function response(features,headers={}){return new Response(JSON.stringify({type:'FeatureCollection',features}),{status:200,headers:{'content-type':'application/geo+json',...headers}});}
test('fixed bounded catalog query normalizes explicit 360 evidence',async()=>{let request;const result=await lookupPanoramax({lat:40.7,lng:-74},{radiusMeters:75,limit:4,fetchImpl:async(url,init)=>(request={url:new URL(url),init},response([item()]))});assert.equal(request.url.origin,'https://api.panoramax.xyz');assert.equal(request.url.pathname,'/api/search');assert.equal(request.url.searchParams.get('limit'),'4');assert.equal(request.init.redirect,'error');assert.equal(result.available,true);assert.equal(result.candidate.mediaType,'panorama_360');assert.equal(result.candidate.pictureId,'picture-1');assert.equal(result.candidate.collectionId,'sequence-1');assert.equal(result.candidate.license.id,'CC-BY-SA-4.0');assert.equal(result.candidate.attribution.producer,'Open mapper');assert.equal(result.candidate.capturedAt,'2026-01-02T03:04:05.000Z');assert.ok(result.candidate.distanceMeters>0&&result.candidate.distanceMeters<75);});
test('ordinary frames stay separate and STAC links are never fetched',async()=>{let calls=0;const ordinary=item({properties:{datetime:'2026-01-02T03:04:05Z',license:'etalab-2.0'},links:[{rel:'via',href:'https://attacker.invalid/never-fetch'}]}),result=await lookupPanoramax({lat:40.7,lng:-74},{fetchImpl:async()=>{calls++;return response([ordinary]);}});assert.equal(calls,1);assert.equal(result.available,false);assert.equal(result.candidate,null);assert.equal(result.directionalSequences[0].mediaType,'directional_sequence');assert.match(result.reason,/display-licensed 360/);});
test('rejects distant, unlicensed, and unidentified candidates',async()=>{const far=item({geometry:{type:'Point',coordinates:[-74.01,40.71]}}),unlicensed=item({id:'u',properties:{'Xmp.GPano.ProjectionType':'equirectangular'},links:[]}),noSequence=item({id:'n',collection:null}),result=await lookupPanoramax({lat:40.7,lng:-74},{fetchImpl:async()=>response([far,unlicensed,noSequence])});assert.equal(result.available,false);assert.deepEqual(result.panoramas,[]);assert.deepEqual(result.directionalSequences,[]);});
test('hard bounds reject before fetch',async()=>{let fetched=false;const f=async()=>{fetched=true;return response([]);},cases=[[{lat:91,lng:0},{},/latitude/],[{lat:40.7,lng:-74},{radiusMeters:101},/radius/],[{lat:40.7,lng:-74},{limit:11},/result limit/],[{lat:40.7,lng:-74},{timeoutMs:15001},/timeout/],[{lat:40.7,lng:-74},{maximumBytes:1000001},/response byte limit/]];for(const [location,opts,pattern]of cases)await assert.rejects(lookupPanoramax(location,{...opts,fetchImpl:f}),pattern);assert.equal(fetched,false);});
test('fails closed on bad upstream responses',async()=>{const cases=[[new Response('',{status:302}),/HTTP 302/],[new Response('<html>',{status:200,headers:{'content-type':'text/html'}}),/non-JSON/],[new Response('{}',{status:200,headers:{'content-type':'application/json','content-length':'1000001'}}),/byte limit/],[new Response('{',{status:200,headers:{'content-type':'application/json'}}),/JSON/],[new Response('{}',{status:200,headers:{'content-type':'application/json'}}),/feature collection/]];for(const [upstream,pattern]of cases)await assert.rejects(lookupPanoramax({lat:40.7,lng:-74},{fetchImpl:async()=>upstream.clone()}),pattern);});
test('does not invent optional evidence or expose unsafe source URLs',async()=>{const candidate=item({properties:{license:'CC-BY-SA-4.0',field_of_view:360},links:[{rel:'via',href:'http://127.0.0.1/private'}]}),result=await lookupPanoramax({lat:40.7,lng:-74},{fetchImpl:async()=>response([candidate])});assert.equal(result.available,true);assert.equal(result.candidate.capturedAt,null);assert.equal(result.candidate.attribution.producer,null);assert.equal(result.candidate.license.url,null);assert.equal(result.candidate.sourcePage,null);});

test('missing and coerced scalars are rejected or remain unknown',async()=>{
  let fetched=false;
  for(const location of [{lat:null,lng:-74},{lat:'40.7',lng:-74},{lat:false,lng:-74},{lat:40.7,lng:''}])
    await assert.rejects(lookupPanoramax(location,{fetchImpl:async()=>{fetched=true;return response([]);}}),/finite number/);
  assert.equal(fetched,false);
  const candidate=item({properties:{license:'CC-BY-SA-4.0',field_of_view:360,'view:azimuth':null}});
  const result=await lookupPanoramax({lat:40.7,lng:-74},{fetchImpl:async()=>response([candidate])});
  assert.equal(result.candidate.azimuth,null);
});

test('blank IDs and proprietary panoramas are excluded from display candidates',async()=>{
  const blank=item({id:'   '});
  const proprietary=item({id:'private-picture',properties:{license:'proprietary','Xmp.GPano.ProjectionType':'equirectangular'}});
  const result=await lookupPanoramax({lat:40.7,lng:-74},{fetchImpl:async()=>response([blank,proprietary])});
  assert.equal(result.available,false);
  assert.deepEqual(result.panoramas,[]);
  assert.equal(result.panoramicMetadata.length,1);
  assert.equal(result.panoramicMetadata[0].license.displayApproved,false);
});

test('antimeridian and polar boxes remain valid and bounded',async()=>{
  const boxes=[];
  await lookupPanoramax({lat:89.9999,lng:179.9999},{radiusMeters:100,fetchImpl:async(url)=>{
    boxes.push(new URL(url).searchParams.get('bbox').split(',').map(Number));
    return response([]);
  }});
  assert.ok(boxes.length>=1&&boxes.length<=2);
  for(const [west,south,east,north] of boxes){
    assert.ok(west>=-180&&east<=180&&west<=east);
    assert.ok(south>=-90&&north<=90&&south<=north);
  }
});

test('preserves producer attribution from the live federated STAC schema',async()=>{
  const liveShape=item({
    properties:{license:'CC-BY-SA-4.0',field_of_view:90,'geovisio:producer':'motocultrice'},
    providers:[{name:'motocultrice',roles:['producer']},{name:'someone',roles:['licensor']}],
  });
  const result=await lookupPanoramax({lat:40.7,lng:-74},{fetchImpl:async()=>response([liveShape])});
  assert.equal(result.directionalSequences[0].attribution.producer,'motocultrice');
});
