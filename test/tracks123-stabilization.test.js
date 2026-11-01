'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {executeDag, DagOrchestrator} = require('../server/swarm/dag-orchestrator');
const {computePublicBenchmarkConsensus} = require('../server/enrichment/public-benchmark-consensus');
const {ScraperTelemetry} = require('../server/scrapers/telemetry');
const {computeDomStructureHash} = require('../server/scrapers/drift-detector');
const {recordSnapshot,readSnapshot,verifiedSnapshotReceipt} = require('../server/scrapers/discovery-snapshots');
const ledger = require('../server/discovery/evidence-ledger');
const {extractWithAdaptiveFallback} = require('../server/scrapers/scrapling-runner');
const {SelectorStore} = require('../server/scrapers/selector-store');
function temporary(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tracks123-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('DAG has no invented location, acreage, rent, violations or title result',async()=>{
  const result=await executeDag({address:'500 W Temple St, Los Angeles, CA 99999',state:'CA',zip:'99999'});
  for(const key of ['lat','lng','fips','lotAcres','fmr2br','openViolations','demolitionOrders','superLienFlag','riskScore']) assert.equal(result.context[key],null,key);
  assert.equal(result.context.dossier.codeEnforcement.openViolations,null);
  assert.equal(result.context.dossier.coordinates.lat,null);
  const supplied=await executeDag({address:'Observed location',lat:34,lng:-118,state:'CA',zip:'90012'});
  assert.equal(supplied.context.lat,34);assert.equal(supplied.context.lng,-118);
  assert.equal(supplied.context.fips,null);
});
test('required DAG failure blocks all descendants and timeout aborts provider work',async()=>{
  let ran=false;
  const result=await executeDag({address:'Observed address'},{handlers:{geocode:async()=>{throw Error('offline');},dossier_synthesis:async()=>{ran=true;return {dossier:{}};}}});
  assert.equal(result.success,false);assert.equal(ran,false);
  assert.equal(result.telemetry.nodeDiagnostics.dossier_synthesis.status,'skipped');
  let aborted=false;
  const timed=await executeDag({address:'Observed address'},{nodeTimeoutMs:10,handlers:{hpi_benchmark:async(ctx,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));}))}});
  assert.equal(aborted,true);assert.ok(timed.telemetry.failedNodes.includes('hpi_benchmark'));
  const invalid=await new DagOrchestrator({handlers:{geocode:async()=>({lat:null,lng:0,fips:null})}}).executeDag({address:'x'});
  assert.equal(invalid.success,false);
});
test('unknown assessment year or unobserved state HPI never yields a trajectory',()=>{
  const input={state:'FL',zip:'99999',parcel:{assessedValue:{total:200000,land:null,improvement:null}}};
  let result=computePublicBenchmarkConsensus(input);
  assert.equal(result.assessedTrajectory,null);assert.equal(result.assessorRoll.landValue,null);assert.equal(result.assessorRoll.improvementValue,null);
  assert.ok(result.unobservedReasons.some(r=>/assessment year/i.test(r)));
  result=computePublicBenchmarkConsensus({...input,assessmentYear:2020});
  assert.equal(result.assessedTrajectory,null);assert.ok(!result.sourcesAvailable.includes('fhfa_hpi'));
  assert.equal(result.estLow,null);assert.equal(result.dealScore,null);
  assert.equal(computePublicBenchmarkConsensus({...input,parcel:{...input.parcel,status:'candidate'}}).assessorRoll,null);
});

test('recorder identity links must be captured, never inferred from filing numbers',()=>{
  const maricopa=require('../server/scrapers/adapters/maricopa-recorder');
  const harris=require('../server/scrapers/adapters/harris-clerk-foreclosure');
  assert.equal(harris.getHarrisClerkSearchUrl(),'https://www.cclerk.hctx.net/Applications/WebSearch/FRCL_R.aspx');
  assert.throws(()=>harris.getHarrisClerkSearchUrl({fileNumber:'FC-2026-001001'}),/captured publisher/);
  assert.throws(()=>maricopa.getMaricopaSearchUrl(null,{recordingNumber:'2026-084912'}),/captured publisher/);
  assert.equal(harris.parseHarrisClerkNotice('File #: FC-2026-001001 Posting Date: 10/01/2026').sourceUrl,null);
  assert.equal(maricopa.parseMaricopaRecordRow('Recording #: 2026-084912 Recorded: 10/01/2026').sourceUrl,null);
});
test('DOM alarms survive health and restart, and row count alone is not layout drift',t=>{
  const telemetryPath=path.join(temporary(t),'telemetry.json');
  const telemetry=new ScraperTelemetry({path:telemetryPath});
  const listing={address:'Observed address',openingBid:100,saleDate:'2026-12-01'};
  telemetry.recordRun('source',[listing],1,null,{html:'<table><tr><td>A</td></tr></table>'});
  telemetry.recordRun('source',[listing],1,null,{html:'<article><p>A</p></article>'});
  assert.equal(telemetry.getHealthReport().details.source.driftDetected,true);
  telemetry._saveNow();
  const restarted=new ScraperTelemetry({path:telemetryPath});
  assert.equal(restarted.getHealthReport().details.source.driftDetected,true);
  assert.equal(computeDomStructureHash('<table><tr><td>A</td></tr></table>'),computeDomStructureHash('<table><tr><td>A</td></tr><tr><td>B</td></tr></table>'));
  if(telemetry._saveTimer)clearTimeout(telemetry._saveTimer);
  telemetry.recordRun('source',[],1,null,{});
  assert.equal(telemetry.history.source.driftReport.yieldCollapse,true);
  if(telemetry._saveTimer)clearTimeout(telemetry._saveTimer);
});
test('snapshots retain both observations and exports verify the actual stored hash',async t=>{
  const snapshotDir=temporary(t);
  const first=await recordSnapshot({sourceKey:'hud',recordId:'case-1',html:'<p>first</p>',saveMarkdown:true},{snapshotDir});
  const second=await recordSnapshot({sourceKey:'hud',recordId:'case-1',html:'<p>second</p>',saveMarkdown:true},{snapshotDir});
  assert.notEqual(first.rawPath,second.rawPath);assert.ok(fs.existsSync(first.rawPath));
  assert.deepEqual([first.ledgerBlock.index,second.ledgerBlock.index],[0,1]);
  assert.equal(readSnapshot({sourceKey:'hud',recordId:'case-1',entryHash:first.ledgerBlock.entryHash,snapshotDir}).raw.rawPayload,'<p>first</p>');
  const listing={source:'hud',provenance:{recordId:'case-1',evidenceLedger:{entryHash:second.ledgerBlock.entryHash}}};
  assert.equal(verifiedSnapshotReceipt(listing,{snapshotDir}).entryHash,second.ledgerBlock.entryHash);
  fs.writeFileSync(second.rawPath,'tampered');
  assert.equal(verifiedSnapshotReceipt(listing,{snapshotDir}),null);
  assert.throws(()=>readSnapshot({sourceKey:'../escape',recordId:'x',snapshotDir}),/Invalid/);
});
test('ledger rejects rewrites, truncation and corrupt restart without replacing bytes',async t=>{
  const file=path.join(temporary(t),'ledger.jsonl');
  await ledger.appendLedgerToFile(file,{source:'hud',recordId:'1',payloadSha256:'a'.repeat(64)});
  const existing=fs.readFileSync(file,'utf8');
  assert.throws(()=>ledger.saveLedgerToFile(file,[]),/truncated/);
  assert.equal(fs.readFileSync(file,'utf8'),existing);
  fs.appendFileSync(file,'broken');
  await assert.rejects(ledger.appendLedgerToFile(file,{source:'hud',recordId:'2',payloadSha256:'b'.repeat(64)}),/unreadable/);
  assert.equal(fs.readFileSync(file,'utf8'),existing+'broken');
});
test('separate ledger writer processes serialize without lost blocks',async t=>{
  const file=path.join(temporary(t),'ledger.jsonl');
  const modulePath=path.resolve('server/discovery/evidence-ledger.js');
  await Promise.all(Array.from({length:4},(_,id)=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['-e',"require(process.argv[1]).appendLedgerToFile(process.argv[2],{source:'hud',recordId:process.argv[3],payloadSha256:'a'.repeat(64)}).catch(e=>{console.error(e);process.exitCode=1})",modulePath,file,String(id)],{windowsHide:true,stdio:'pipe'});
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(stderr)));
  })));
  const chain=ledger.loadLedgerFromFile(file);assert.equal(chain.length,4);assert.equal(new Set(chain.map(e=>e.recordId)).size,4);assert.equal(ledger.verifyLedgerChain(chain).valid,true);
});
test('frozen selector candidates run through the real extraction lane and never relocate bids',t=>{
  const selectorStore=new SelectorStore({cacheDir:temporary(t)});
  const result=extractWithAdaptiveFallback('<span class="bedrooms">3 beds</span><span class="price">$100</span>','hud',{beds:{selector:'.old',extractor:()=>null},openingBid:{selector:'.old',extractor:()=>null}},{selectorStore,persistSelectors:false});
  assert.equal(result.fields.beds,3);assert.equal(result.fields.openingBid,null);assert.equal(result.identityPassed,false);
  assert.equal(result.relocations[0].discoveredStrategy,'frozen-presentation-registry');
});
test('low-confidence captured notices enter the operator intake review workflow',async t=>{
  const dir=temporary(t), intakeStorePath=path.join(dir,'intake.json');
  const record=await recordSnapshot({sourceKey:'hud',recordId:'notice',rawPayload:{notice:'Needs review'},metadata:{sourceUrl:'https://www.hudhomestore.gov/Listing/PropertyDetails.aspx?caseNumber=123',confidenceScore:0.4}},{snapshotDir:dir,intakeStorePath});
  assert.match(record.reviewIntakeId,/^intake_/);
  const intake=JSON.parse(fs.readFileSync(intakeStorePath,'utf8'));
  assert.ok(JSON.stringify(intake).includes('needs_review'));
});

test('scheduler commits evidence before inventory and exposes DOM drift without losing publisher history',async t=>{
  const dir=temporary(t), previous=process.env.PROPERTY_EVIDENCE_DIR;
  process.env.PROPERTY_EVIDENCE_DIR=dir;
  t.after(()=>{if(previous===undefined)delete process.env.PROPERTY_EVIDENCE_DIR;else process.env.PROPERTY_EVIDENCE_DIR=previous;});
  const BaseScraper=require('../server/scrapers/base');
  const {IngestionScheduler}=require('../server/scrapers/scheduler');
  let html='<table><tr><td>Notice</td></tr></table>';
  const probe=new BaseScraper({name:'StabilizationProbe',sourceKey:'civilview',fetchImpl:async()=>({ok:true,status:200,headers:new Map([['content-type','text/html']]),text:async()=>html})});
  const sourceUrl='https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683';
  probe.scrapeFeed=async()=>{
    await probe.fetchText(sourceUrl);
    const observedAt=new Date().toISOString();
    return [probe.standardizeListing({id:'CIV-NJ-7-2128964683',source:'civilview',state:'NJ',county:'Bergen',address:'19 West Park Avenue, Park Ridge, NJ 07656',openingBid:100000,raw:'Test-only publisher notice with an explicitly published opening bid.',sourceUrl,sourceObservedAt:observedAt,provenance:{origin:'live',observed:true,publisher:'CivilView',recordId:'2128964683',observedAt}})];
  };
  const writes=[], telemetry=new ScraperTelemetry({persist:false});
  const scheduler=new IngestionScheduler({realScrapers:[probe],database:{createListing:async listing=>{assert.ok(verifiedSnapshotReceipt(listing));writes.push(listing);}},telemetry,networkEnabled:true});
  assert.equal((await scheduler.runAll()).totalIngested,1);
  html='<article><p>Changed layout</p></article>';
  assert.equal((await scheduler.runAll()).totalIngested,1);
  assert.equal(telemetry.getHealthReport().details.StabilizationProbe.driftDetected,true);
  const ledgerFile=path.join(dir,'evidence-ledger.jsonl');
  assert.equal(ledger.loadLedgerFromFile(ledgerFile).length,2);
  fs.appendFileSync(ledgerFile,'corrupt');
  assert.equal((await scheduler.runAll()).totalIngested,0);
  assert.equal(writes.length,2);
  assert.equal(telemetry.getHealthReport().snapshotEvidence.integrity,'unreadable');
});
