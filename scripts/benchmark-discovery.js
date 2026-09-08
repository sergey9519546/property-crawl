'use strict';
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createIsolatedDatabase, seedListings, testDatabaseUrl } = require('../test/discovery-acceptance-db');
const discovery = require('../server/discovery/query');
const { DatabaseClient } = require('../server/db/client');
const RECORDS=Number(process.env.DISCOVERY_BENCH_RECORDS||100000),READERS=Number(process.env.DISCOVERY_BENCH_READERS||10),ITERATIONS=Number(process.env.DISCOVERY_BENCH_ITERATIONS||20);
function percentile(values,p){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]||0;}
async function runPostgresBenchmark(options={}){
 if(!Number.isInteger(RECORDS)||RECORDS<100000)throw new Error('DISCOVERY_BENCH_RECORDS must be at least 100000');
 if(!Number.isInteger(READERS)||READERS<10)throw new Error('DISCOVERY_BENCH_READERS must be at least 10');
 const isolated=await createIsolatedDatabase({url:options.url||testDatabaseUrl(),prefix:'discovery_benchmark',max:READERS+4});
 try{const loadStarted=performance.now();await seedListings(isolated.pool,RECORDS);await isolated.pool.query('ANALYZE listings');const loadMs=performance.now()-loadStarted;
  const database=new DatabaseClient({env:{NODE_ENV:'test'}});database.pool=isolated.pool;database.isPg=true;
  const searches=Array.from({length:READERS},(_,i)=>discovery.queryFromUrl(new URL(`http://localhost/api/listings?state=${['ca','fl','tx','oh'][i%4]}&q=main&limit=50&facets=source,type`)));
  const mapQuery=discovery.queryFromUrl(new URL('http://localhost/api/listings/map?bbox=-125,24,-66,56&limit=200'));
  await Promise.all(searches.map(q=>discovery.search(database,q)));await discovery.map(database,mapQuery);
  const searchBatchSamples=[],mapBatchSamples=[],searchRequestSamples=[],mapRequestSamples=[];
  const timed=async(operation,samples)=>{const started=performance.now();const value=await operation();samples.push(performance.now()-started);return value;};
  for(let round=0;round<ITERATIONS;round++){let started=performance.now();const results=await Promise.all(searches.map(q=>timed(()=>discovery.search(database,q),searchRequestSamples)));if(results.some(r=>r.listings.length!==50))throw new Error('Benchmark search returned an incomplete page');searchBatchSamples.push(performance.now()-started);started=performance.now();const maps=await Promise.all(Array.from({length:READERS},()=>timed(()=>discovery.map(database,mapQuery),mapRequestSamples)));if(maps.some(r=>!r.features.length))throw new Error('Benchmark map returned no features');mapBatchSamples.push(performance.now()-started);}
  const cpus=os.cpus();const report={mode:'postgres-postgis-isolated',records:RECORDS,concurrentReaders:READERS,iterations:ITERATIONS,loadMs,searchP95Ms:percentile(searchBatchSamples,.95),mapP95Ms:percentile(mapBatchSamples,.95),searchRequestP95Ms:percentile(searchRequestSamples,.95),mapRequestP95Ms:percentile(mapRequestSamples,.95),latencyDefinition:'Batch p95 is wall time until all 10 concurrent requests complete; request p95 is across all 200 individual requests.',searchTargetMs:1000,mapTargetMs:1500,hardware:{platform:process.platform,arch:process.arch,node:process.version,cpu:cpus[0]?.model||'unknown',logicalCpus:cpus.length,totalMemoryBytes:os.totalmem()}};report.passed=report.searchP95Ms<=report.searchTargetMs&&report.mapP95Ms<=report.mapTargetMs;return report;
 }finally{await isolated.close();}
}
async function main(){const report=await runPostgresBenchmark();const output=path.resolve(process.env.DISCOVERY_BENCH_REPORT||'.cache/discovery-benchmark-report.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,`${JSON.stringify(report,null,2)}\n`,'utf8');console.log(JSON.stringify({...report,reportPath:output},null,2));if(!report.passed)process.exitCode=1;}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={percentile,runPostgresBenchmark};
