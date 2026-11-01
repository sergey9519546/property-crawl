'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),zlib=require('node:zlib');
const {queryHarrisClerk}=require('../server/scrapers/adapters/harris-clerk-query');
const {parseHarrisClerkHtml,parseHarrisClerkNotice}=require('../server/scrapers/adapters/harris-clerk-foreclosure');
const {inspectSourceRecordUrl}=require('../server/scrapers/source-policy');
const {TrusteeSaleScraper}=require('../server/scrapers/trustee');
const {recordSnapshot,readSnapshot}=require('../server/scrapers/discovery-snapshots');
const {createEvidenceBackup,verifyEvidenceBackup,restoreEvidenceBackup}=require('../scripts/evidence-backup');
const {evidenceStorageStatus,assertEvidenceStorage}=require('../server/discovery/evidence-storage');
const {waitForHealth}=require('../scripts/production-health');
const captured=fs.readFileSync(path.join(__dirname,'fixtures/recorder/harris-2026-11-captured.html'),'utf8');
const form='<input type="hidden" name="__VIEWSTATE" value="fixture"><input type="hidden" name="__EVENTVALIDATION" value="fixture">'+
 '<select name="ctl00$ContentPlaceHolder1$ddlYear"><option value="2026">2026</option></select>'+
 '<select name="ctl00$ContentPlaceHolder1$ddlMonth"><option value="11">November</option></select>';
function fakeQuery(){const calls=[];let posts=0;return {calls,requestText:async(url,init)=>{calls.push({url,init});if(url.endsWith('/robots.txt'))return 'User-agent: *\nAllow: /';if(init?.method==='POST' && ++posts===2)return form+captured;return form;}};}

test('captured Harris grid retains actual document links and dates without invented property facts',()=>{
 const records=parseHarrisClerkHtml(captured);assert.equal(records.length,2);
 assert.equal(records[0].fileNumber,'FRCL-2026-5654');assert.equal(records[0].saleDate,'2026-11-03');assert.equal(records[0].postingDate,'2026-08-06');
 assert.match(records[0].sourceUrl,/^https:\/\/www\.cclerk\.hctx\.net\/Applications\/WebSearch\/ViewECdocs\.aspx\?ID=/);
 assert.equal(inspectSourceRecordUrl('trustee',records[0].sourceUrl).isValid,true);
 for(const row of records){assert.equal(row.evidenceOnly,true);for(const field of ['situsAddress','apn','openingBid','assessed','estLow','estHigh','earliestEligibleSaleDate'])assert.equal(row[field],null);}
 assert.equal(inspectSourceRecordUrl('trustee','https://www.cclerk.hctx.net/Applications/WebSearch/ViewECdocs.aspx?ID=x').isValid,false);
 assert.equal(inspectSourceRecordUrl('trustee',records[0].sourceUrl.replace('www.cclerk.hctx.net','attacker.invalid')).isValid,false);
 assert.equal(parseHarrisClerkHtml(captured.replace(/href="ViewECdocs[^\"]+"/g,'href="javascript:void(0)"')).length,0);
 assert.equal(parseHarrisClerkNotice('File #: fixture\nSale Date: 02/30/2026').saleDate,null);
});

test('Harris query submits refreshed form state and reports bounded results as incomplete',async()=>{
 const transport=fakeQuery();const query=await queryHarrisClerk({...transport,year:2026,month:11});
 assert.equal(query.publishedTotal,840);assert.equal(query.collected,2);assert.equal(query.truncated,true);assert.equal(query.complete,false);
 const posts=transport.calls.filter(c=>c.init?.method==='POST');assert.equal(posts.length,2);
 assert.equal(new URLSearchParams(posts[0].init.body).get('ctl00$ContentPlaceHolder1$ddlMonth'),'Select -');
 assert.equal(new URLSearchParams(posts[1].init.body).get('ctl00$ContentPlaceHolder1$ddlMonth'),'11');
});

test('robots denial, missing form state and unverified result shells cannot qualify Harris',async()=>{
 let requested=0;
 await assert.rejects(queryHarrisClerk({year:2026,month:11,requestText:async()=>{requested++;return 'User-agent: *\nDisallow: /';}}),/ROBOTS_DENIED/);assert.equal(requested,1);
 await assert.rejects(queryHarrisClerk({year:2026,month:11,requestText:async url=>url.endsWith('robots.txt')?'User-agent: *\nAllow: /':form.replace('__VIEWSTATE','missing')}),/FORM_CHANGED/);
 await assert.rejects(queryHarrisClerk({year:2026,month:11,requestText:async url=>url.endsWith('robots.txt')?'User-agent: *\nAllow: /':form}),/QUERY_UNVERIFIED/);
 const repeated=fakeQuery();let posts=0;
 repeated.requestText=async(url,init)=>{if(url.endsWith('robots.txt'))return 'User-agent: *\nAllow: /';if(init?.method==='POST' && ++posts>=2)return form+captured;return form;};
 await assert.rejects(queryHarrisClerk({...repeated,year:2026,month:11,maxPages:2}),/PAGINATION_REPEATED/);
});

test('actual trustee workflow retains Harris documents and never admits identity-free grid rows',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recorder-qualify-'));
 try{const scraper=new TrusteeSaleScraper({fixtureOnly:false});scraper.fetchText=fakeQuery().requestText;
 const listings=await scraper.scrapeFeed({jurisdiction:'harris',year:2026,month:11,snapshotDir:dir});
 assert.equal(listings.length,0);assert.equal(scraper.lastRunReport.recorderEvidence.capturedDocuments,2);
 assert.equal(scraper.lastRunReport.recorderEvidence.listingQualified,false);assert.equal(scraper.lastRunReport.recorderEvidence.queryComplete,false);
 assert.equal(scraper.lastRunReport.complete,false);assert.equal(scraper.lastRunReport.fullSweepComplete,false);assert.equal(scraper.lastRunReport.outcome,'evidence_only');
 assert.equal(readSnapshot({sourceKey:'trustee',recordId:'FRCL-2026-5654',snapshotDir:dir}).raw.rawPayload.saleDate,'2026-11-03');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Maricopa policy failure remains failed and prevents search requests',async()=>{
 const scraper=new TrusteeSaleScraper({fixtureOnly:false});const urls=[];
 scraper.fetchText=async url=>{urls.push(url);throw new Error('HTTP 403 policy unavailable');};
 assert.deepEqual(await scraper.scrapeFeed({jurisdiction:'maricopa',docType:'NOTICE OF TRUSTEE SALE'}),[]);
 assert.equal(urls.length,1);assert.match(urls[0],/\/robots.txt$/);assert.equal(scraper.lastRunReport.outcome,'failed');assert.equal(scraper.lastRunReport.complete,false);
});

test('evidence backup restores both observations and markdown into a new isolated directory',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evidence-drill-'));const source=path.join(dir,'source');
 try{await recordSnapshot({sourceKey:'hud',recordId:'case',html:'<h1>First observation</h1>',saveMarkdown:true},{snapshotDir:source});
 const second=await recordSnapshot({sourceKey:'hud',recordId:'case',html:'<h1>Second observation</h1>',saveMarkdown:true},{snapshotDir:source});
 const archive=createEvidenceBackup({sourceDir:source,outputFile:path.join(dir,'snapshot.json.gz')});assert.equal(archive.entries,2);
 const restored=restoreEvidenceBackup({file:archive.file,targetDir:path.join(dir,'restored'),expectedSha256:archive.sha256});assert.equal(restored.head,second.ledgerBlock.entryHash);
 const read=readSnapshot({sourceKey:'hud',recordId:'case',snapshotDir:restored.targetDir});assert.equal(read.raw.rawPayload,'<h1>Second observation</h1>');assert.match(read.markdown,/Second observation/);
 await recordSnapshot({sourceKey:'hud',recordId:'case',html:'Later'},{snapshotDir:source});assert.equal(verifyEvidenceBackup(archive.file).entries,2);
 assert.throws(()=>createEvidenceBackup({sourceDir:source,outputFile:archive.file}),/EEXIST/);
 assert.throws(()=>restoreEvidenceBackup({file:archive.file,targetDir:restored.targetDir}),/must not already exist/);
 assert.throws(()=>verifyEvidenceBackup(archive.file,'0'.repeat(64)),/Off-host archive digest mismatch/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('tampered, corrupt and path-traversal archives are rejected before restore writes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evidence-reject-'));
 try{const source=path.join(dir,'source');await recordSnapshot({sourceKey:'hud',recordId:'case',html:'retained'},{snapshotDir:source});
 const archive=createEvidenceBackup({sourceDir:source,outputFile:path.join(dir,'good.gz')});const original=JSON.parse(zlib.gunzipSync(fs.readFileSync(archive.file)));
 const rawName=Object.keys(original.files).find(name=>name!=='evidence-ledger.jsonl');original.files[rawName]=Buffer.from('changed').toString('base64');
 const bad=path.join(dir,'bad.gz');fs.writeFileSync(bad,zlib.gzipSync(Buffer.from(JSON.stringify(original))));
 assert.throws(()=>restoreEvidenceBackup({file:bad,targetDir:path.join(dir,'bad-restore')}),/checksum/);assert.equal(fs.existsSync(path.join(dir,'bad-restore')),false);
 original.files['../escape']='YQ==';original.manifest['../escape']={bytes:1,sha256:'invalid'};fs.writeFileSync(bad,zlib.gzipSync(Buffer.from(JSON.stringify(original))));
 assert.throws(()=>verifyEvidenceBackup(bad),/Unsafe|checksum/);
 fs.appendFileSync(path.join(source,'evidence-ledger.jsonl'),'corrupt\n');assert.throws(()=>createEvidenceBackup({sourceDir:source,outputFile:path.join(dir,'refused.gz')}),/unreadable/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('mount verification requires observed storage, rejects ephemeral mounts and symlink escapes',()=>{
 const dir=path.resolve('mount-fixture'),evidence=path.join(dir,'evidence');
 const env={RENDER:'true',PROPERTY_REQUIRE_DURABLE_EVIDENCE:'1',PROPERTY_DURABLE_MOUNT_PATH:dir};
 const mountInfo=`1 0 8:1 / ${dir} rw - ext4 /dev/test rw`;
 const status=evidenceStorageStatus({env,evidenceDir:evidence,mountInfo,realpath:value=>value});assert.equal(status.mountVerified,true);assert.equal(status.backupVerified,false);
 assert.equal(evidenceStorageStatus({env,evidenceDir:evidence,mountInfo:mountInfo.replace('ext4','tmpfs'),realpath:value=>value}).writesBlocked,true);
 assert.equal(evidenceStorageStatus({env,evidenceDir:evidence,mountInfo,realpath:value=>value===evidence?path.resolve('elsewhere'):value}).writesBlocked,true);
 assert.equal(evidenceStorageStatus({env:{RENDER:'true'},evidenceDir:evidence}).durability,'ephemeral_filesystem');
 assert.throws(()=>assertEvidenceStorage({PROPERTY_REQUIRE_DURABLE_EVIDENCE:'1'}),/PROPERTY_EVIDENCE_DIR/);
});

test('cold UI health requests can complete beyond the old 1.5-second probe deadline',async()=>{
 const server=http.createServer((req,res)=>setTimeout(()=>{res.writeHead(200);res.end('{}');},1650));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{assert.equal(await waitForHealth(`http://127.0.0.1:${server.address().port}`,{timeoutMs:4000}),true);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('health retries fail closed on HTTP errors and unreachable services within their total deadline',async()=>{
 const server=http.createServer((req,res)=>{res.writeHead(503);res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{let reason;assert.equal(await waitForHealth(`http://127.0.0.1:${server.address().port}`,{timeoutMs:60,intervalMs:10,onFailure:value=>reason=value}),false);assert.equal(reason,'HTTP 503');}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 assert.equal(await waitForHealth('http://127.0.0.1:1',{timeoutMs:50,intervalMs:10}),false);
});
