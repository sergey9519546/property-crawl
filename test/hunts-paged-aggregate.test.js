'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const realQuery=require('../server/discovery/query');
const hunts=require('../server/intelligence/hunts');
const {createHuntsHandler}=require('../server/routes/hunts');
function listing(index){const recordId=String(9000000+index);return{id:`CIV-CA-${recordId}`,source:'civilview',state:'CA',county:'Alameda',city:'Oakland',address:`${index+1} Test Avenue, Oakland, CA`,propType:'Single Family',status:'scheduled',openingBid:100000,saleDate:'2026-10-01',raw:`Official CivilView source record number ${recordId}.`,sourceUrl:`https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${recordId}`,sourceObservedAt:'2026-09-07T18:00:00.000Z',provenance:{origin:'live',observed:true,recordKind:'source_record',publisher:'CivilView',recordId,observedAt:'2026-09-07T18:00:00.000Z'}};}
function response(){return{statusCode:200,body:null,setHeader(){},status(code){this.statusCode=code;return this;},json(value){this.body=value;return value;}};}
test('durable API aggregates pages with one clock and whole-scan notObserved count',async()=>{
 const pages=[Array.from({length:1000},(_,i)=>listing(i)),[listing(1000),listing(1001)]];
 const hunt={id:'hunt_aaaaaaaaaaaaaaaaaaaaaaaa',name:'California',enabled:true,version:1,criteria:{mode:'all',rules:[{field:'state',operator:'eq',value:'CA'}]}};
 const missingKey=hunts.identityKey('civilview','missing-record');let searchCalls=0,clockCalls=0,saved;
 const durable={get:async()=>hunt,baseline:async()=>({huntVersion:1,records:{[missingKey]:{identityKey:missingKey,listingId:'old',sourceId:'civilview',recordId:'missing-record',observedAt:'2026-09-06T18:00:00.000Z',status:'match',snapshot:{},valueHash:'old',evaluationHash:'old',clauseResults:[]}}}),saveEvaluation:async(_hunt,evaluated)=>{saved=evaluated;return evaluated.response;}};
 const discoveryQuery={queryFromUrl:realQuery.queryFromUrl,search:async()=>{const index=searchCalls++;return{listings:pages[index],page:{nextCursor:index===0?'page-2':null}};}};
 const handler=createHuntsHandler({database:{isPg:true},durableStore:durable,discoveryQuery,env:{DISCOVERY_MODE:'advanced',SCRAPER_ADMIN_TOKEN:'secret'},now:()=>{clockCalls++;return clockCalls===1?'2026-09-07T20:00:00.000Z':'2027-01-01T00:00:00.000Z';}});
 const req={method:'POST',url:`/api/hunts/${hunt.id}/evaluate`,headers:{authorization:'Bearer secret'},body:{}};const res=response();
 await handler(req,res,new URL(req.url,'http://localhost'));
 assert.equal(res.statusCode,200);assert.equal(searchCalls,2);assert.equal(clockCalls,1);
 assert.equal(res.body.evaluation.evaluatedAt,'2026-09-07T20:00:00.000Z');
 assert.equal(res.body.evaluation.counts.inventory,1002);assert.equal(res.body.evaluation.counts.accepted,1002);assert.equal(res.body.evaluation.counts.match,1002);assert.equal(res.body.evaluation.counts.notObserved,1);
 assert.equal(res.body.evaluation.results.length,500);assert.equal(res.body.evaluation.resultsTruncated,true);
 assert.equal(Object.keys(saved.baseline.records).length,1003);
});
