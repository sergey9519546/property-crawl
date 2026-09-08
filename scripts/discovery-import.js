'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ServiceLinkScraper } = require('../server/scrapers/servicelink');
const { createDiscoveryStore, hash } = require('../server/discovery/store');
const ARCHIVE_PROJECTION_VERSION = 2;

async function* records(file) {
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try { for await (const line of lines) if (line.trim()) yield JSON.parse(line); }
  finally { lines.close(); input.destroy(); }
}

function archiveListing(raw, manifest, scraper = new ServiceLinkScraper()) {
  const listing = scraper.toListing(raw, manifest.observedAt);
  if (!listing) return null;
  listing.provenance = { ...listing.provenance, origin: 'archive', observed: true,
    liveVerified: false, captureTimeBasis: manifest.observedAtBasis,
    datasetSha256: manifest.inputs.catalog.sha256, snapshotKind: 'imported_snapshot', archiveProjectionVersion: ARCHIVE_PROJECTION_VERSION,
    sourceFacts: { ...listing.provenance.sourceFacts,
      saleTime: raw.tpsSaleTime || null, saleTimezone: null,
      documents: Array.isArray(raw.documents) ? raw.documents : [],
      imageReferences: Array.isArray(raw.images) ? raw.images : [],
      transactionOutcome: null, bidCountReliability: 'not_established',
      sourceReportedBidCount: raw.customDetail?.of_bids__c ?? null } };
  listing.auctionProgram = raw.auctionProgram || null;
  listing.transactionOutcome = null;
  listing.saleTime = raw.tpsSaleTime || null;
  listing.saleTimezone = null;
  listing.saleLocation = raw.tpsSaleLocation || null;
  listing.documents = raw.documents || [];
  listing.sourceObservedAt = manifest.observedAt;
  listing.fetchedAt = manifest.observedAt;
  return listing;
}

async function batchFile(file, size, callback) {
  let batch = [];
  for await (const item of records(file)) {
    batch.push(item);
    if (batch.length >= size) { await callback(batch); batch = []; }
  }
  if (batch.length) await callback(batch);
}

async function importStage(stage, options = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8'));
  if (!Number.isFinite(Date.parse(manifest.observedAt))) throw new Error('A valid captured observation timestamp is required');
  const scraper = new ServiceLinkScraper();
  const report = { mode: options.apply ? 'applied' : 'dry_run', ...manifest, accepted: 0, rejected: [], snapshotsWritten: 0, snapshotsReused: 0 };
  let database, store, run;
  const existingSnapshots = new Set(), existingListings = new Set();
  if (options.apply) {
    database = options.database || require('../server/db/client');
    if (!database.pool) throw new Error('Applying an import requires PostgreSQL; demo inventory is never substituted');
    await require('./discovery-migrate').migrate(database.pool);
    store = createDiscoveryStore(database);
    run = await store.beginRun({ sourceKey: 'servicelink', trigger: 'archive_import',
      idempotencyKey: `archive:${manifest.inputs.catalog.sha256}`,
      scope: { kind: 'archive', dataset: manifest.inputs.catalog.sha256, observedAt: manifest.observedAt } });
    const prior = await database.pool.query('SELECT source_record_id,payload_sha256 FROM discovery_snapshots WHERE source_key=$1 AND observed_at=$2', ['servicelink',manifest.observedAt]);
    for (const row of prior.rows) existingSnapshots.add(`${row.source_record_id}:${row.payload_sha256}`);
    const current = await database.pool.query("SELECT id FROM listings WHERE source_key=$1 AND (provenance->>'origin'='live' OR provenance->>'archiveProjectionVersion'=$2)", ['servicelink',String(ARCHIVE_PROJECTION_VERSION)]);
    for (const row of current.rows) existingListings.add(row.id);
  }
  try {
    for await (const raw of records(path.join(stage, 'catalog.jsonl'))) {
      const listing = archiveListing(raw, manifest, scraper);
      if (!listing) { report.rejected.push({ id: raw.listingId || null, reason: 'Missing valid identity, source URL, state, or address' }); continue; }
      report.accepted++;
      if (store) {
        const alreadyImported = existingSnapshots.has(`${raw.listingId}:${hash(raw)}`);
        if (alreadyImported && existingListings.has(listing.id)) { report.snapshotsReused++; continue; }
        await store.ingestSnapshot({ runId: run.id, sourceKey: 'servicelink', sourceRecordId: raw.listingId,
          observedAt: manifest.observedAt, rawPayload: raw, provenance: listing.provenance,
          observations: { auctionProgram: listing.auctionProgram, transactionOutcome: { value: null, evidenceClass: 'unknown' },
            sourceStatus: listing.status, saleDate: listing.saleDate, saleTime: listing.saleTime,
            openingBid: listing.openingBid, address: listing.address, deposit: listing.deposit, documents: listing.documents,
            sourceReportedBidCount: { value: raw.customDetail?.of_bids__c ?? null, evidenceClass: 'unreliable_source_field' } } },
        async client => { const transactionDb = Object.create(database); transactionDb.pool = client; await transactionDb.createListing(listing); });
        report.snapshotsWritten++;
      }
    }
    if (report.accepted + report.rejected.length !== manifest.listings) throw new Error('Catalog row accounting failed');
    if (store) {
      await batchFile(path.join(stage, 'image-references.jsonl'), 500, async rows => {
        const values = rows.map(r => ({ key: hash([r.listingId,r.imageUrl,manifest.inputs.catalog.sha256]), id: r.listingId, url: r.imageUrl, index: Number(r.imageIndex) }));
        await database.pool.query(`INSERT INTO discovery_media_references(reference_key,source_key,source_record_id,source_url,media_index,observed_at,dataset_sha256)
          SELECT x.key,'servicelink',x.id,x.url,x.index,$2,$3 FROM jsonb_to_recordset($1::jsonb) AS x(key text,id text,url text,index integer) ON CONFLICT DO NOTHING`,
        [JSON.stringify(values),manifest.observedAt,manifest.inputs.catalog.sha256]);
      });
      await batchFile(path.join(stage, 'assets.jsonl'), 250, async rows => {
        await database.pool.query(`INSERT INTO discovery_media_assets(sha256,bytes,local_path,integrity,display_status,rights)
          SELECT DISTINCT ON (x.sha256) x.sha256,x.bytes,x."localPath",x.integrity,x."displayStatus",x.rights
          FROM jsonb_to_recordset($1::jsonb) AS x(sha256 text,bytes bigint,"localPath" text,integrity text,"displayStatus" text,rights text)
          ON CONFLICT(sha256) DO UPDATE SET local_path=COALESCE(discovery_media_assets.local_path,EXCLUDED.local_path)`, [JSON.stringify(rows)]);
        await database.pool.query(`INSERT INTO discovery_media_links(source_key,source_record_id,sha256,source_url,dataset_sha256)
          SELECT 'servicelink',x."listingId",x.sha256,x."sourceUrl",$2 FROM jsonb_to_recordset($1::jsonb) AS x("listingId" text,sha256 text,"sourceUrl" text) ON CONFLICT DO NOTHING`,
        [JSON.stringify(rows),manifest.inputs.catalog.sha256]);
      });
      for await (const raw of records(path.join(stage, 'closed-results.jsonl'))) {
        await store.appendSnapshot({ runId: run.id,sourceKey:'servicelink',sourceRecordId:raw.listingId,observedAt:manifest.observedAt,
          rawPayload:{kind:'closed_result',...raw},provenance:{origin:'archive',evidenceClass:'unverified_transaction_result',datasetSha256:manifest.inputs.catalog.sha256},
          observations:{transactionOutcome:{value:null,evidenceClass:'unknown'},reserveMet:{value:raw.anyBidMetReserve,evidenceClass:'unverified_source_summary'}} });
      }
      const atlas = JSON.parse(fs.readFileSync(path.join(stage,'atlas.json'),'utf8'));
      for (const source of atlas.sources) await database.pool.query('INSERT INTO discovery_atlas_sources(id,atlas_id,record,dataset_sha256) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING', [source.id,source.atlasId,source,manifest.inputs.atlas.sha256]);
      for (const row of atlas.ledger) await database.pool.query('INSERT INTO discovery_atlas_ledger(entry_key,record,dataset_sha256) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [hash([manifest.inputs.atlas.sha256,row]),row,manifest.inputs.atlas.sha256]);
      await database.pool.query('INSERT INTO discovery_imports(dataset_sha256,manifest) VALUES($1,$2) ON CONFLICT DO NOTHING',[manifest.inputs.catalog.sha256,manifest]);
      await store.finishRun(run.id,{status:report.rejected.length?'partial':'complete',discovered:manifest.listings,accepted:report.accepted,rejected:report.rejected.length});
    }
    return report;
  } catch (error) {
    if (store) await store.finishRun(run.id,{status:'failed',discovered:manifest.listings,accepted:report.accepted,rejected:report.rejected.length,error:error.message});
    throw error;
  }
}

async function main(argv) {
  const args = {};
  for (let i=0;i<argv.length;i++) { const key=argv[i].replace(/^--/,''); args[key]=['apply','dry-run'].includes(key)?true:argv[++i]; }
  const stage = path.resolve(args.stage || '.cache/discovery-import');
  if (args.catalog) {
    for (const key of ['photos','atlas','observed-at']) if (!args[key]) throw new Error(`--${key} is required with --catalog`);
    const params=[path.join(__dirname,'prepare-discovery-import.py'),'--catalog',args.catalog,'--photos',args.photos,'--atlas',args.atlas,'--observed-at',args['observed-at'],'--output',stage];
    if(args.apply) params.push('--media-dir',path.resolve(args['media-dir'] || '.cache/discovery-media'));
    await new Promise((resolve,reject)=>{const child=spawn(args.python || process.env.PYTHON || 'python',params,{stdio:['ignore','inherit','inherit'],windowsHide:true});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`Attachment preparation exited ${code}`)));});
  }
  const report=await importStage(stage,{apply:args.apply===true});
  fs.writeFileSync(path.join(stage,args.apply?'applied-report.json':'dry-run-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module) main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{const cached=require.cache[require.resolve('../server/db/client')];if(cached?.exports?.pool)await cached.exports.pool.end();});
module.exports={archiveListing,importStage,records};
