'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {ScraperCircuitBreaker}=require('../server/scrapers/circuit-breaker');
const {fetchTextWithPolicy,safeTransportDetails}=require('../server/scrapers/http');

test('transport failures retain a safe native cause code and hostname',async()=>{
 const cause=Object.assign(new Error('connect EPERM 10.0.0.1:443 with token=secret'),{code:'EPERM'});
 const failure=new TypeError('fetch failed',{cause});
 const breaker=new ScraperCircuitBreaker({failureThreshold:3});
 await assert.rejects(fetchTextWithPolicy('https://egis.hud.gov/private/path?api_key=secret',{fetchImpl:async()=>{throw failure;},circuitBreaker:breaker,maxRetries:1}),error=>{
   assert.equal(error.transportCode,'EPERM');assert.equal(error.hostname,'egis.hud.gov');assert.equal(error.retryable,false);
   assert.match(error.message,/EPERM/);assert.match(error.message,/egis\.hud\.gov/);
   assert.doesNotMatch(error.message,/api_key|secret|private\/path|10\.0\.0\.1/);return true;
 });
});

test('retryable network causes are identified through the cause chain without leaking details',()=>{
 const nested=Object.assign(new Error('socket to credential@example.test failed'),{code:'ENETUNREACH'});
 const detail=safeTransportDetails(new TypeError('fetch failed',{cause:nested}),'https://www.gsa.gov/assets/feed?token=hidden');
 assert.deepEqual({code:detail.transportCode,hostname:detail.hostname,retryable:detail.retryable},{code:'ENETUNREACH',hostname:'www.gsa.gov',retryable:true});
 assert.doesNotMatch(detail.message,/token|hidden|credential/);
});

test('AggregateError child codes remain visible for sandbox-denied egress',()=>{
 const aggregate=new AggregateError([Object.assign(new Error('connect denied'),{code:'EACCES'})],'fetch failed');
 const detail=safeTransportDetails(new TypeError('fetch failed',{cause:aggregate}),'https://realestatesales.gov/our-listing?key=hidden');
 assert.equal(detail.transportCode,'EACCES');assert.equal(detail.hostname,'realestatesales.gov');assert.equal(detail.retryable,false);assert.doesNotMatch(detail.message,/our-listing|hidden/);
});
