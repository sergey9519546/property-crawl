'use strict';
const { createHash } = require('node:crypto');
const { compareSnapshots } = require('../sources/observations');

const FIELDS = ['openingBid', 'saleDate', 'status', 'deposit', 'address', 'documents'];
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = (value) => value ? new Date(value).toISOString() : null;
const safeUrl = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; } };

function snapshotView(row, listing) {
  const raw = row.raw_payload || {};
  let normalized = raw;
  if (row.source_key === 'servicelink' && raw.propertyInfo) {
    normalized = new (require('../scrapers/servicelink').ServiceLinkScraper)().toListing(raw, iso(row.observed_at)) || {};
  }
  const values = row.fields || {};
  const fields = Object.fromEntries(FIELDS.map(key => [key, Object.hasOwn(values, key) ? values[key]
    : key === 'status' ? values.sourceStatus ?? values.lifecycleStatus ?? normalized.status ?? null
      : normalized[key] ?? null]));
  return {
    snapshotId: row.id, listingId: listing.id, source: row.source_key, recordId: row.source_record_id,
    sourceUrl: safeUrl(row.provenance?.exactSourceUrl || normalized.sourceUrl || listing.sourceUrl),
    observedAt: iso(row.observed_at), payloadSha256: row.payload_sha256,
    origin: row.provenance?.origin || 'unknown', fields,
    kind: raw.kind === 'closed_result' ? 'closed_result' : 'publisher_record',
    evidenceUrl: `/api/property-intelligence?listingId=${encodeURIComponent(listing.id)}&snapshotId=${row.id}`,
  };
}

async function readSnapshot(pool, listing, snapshotId) {
  const result = await pool.query(`SELECT s.*, coalesce((SELECT jsonb_object_agg(o.field_name,
    jsonb_build_object('value',o.value,'evidenceClass',o.evidence_class))
    FROM discovery_observations o WHERE o.snapshot_id=s.id),'{}'::jsonb) AS observations
    FROM discovery_snapshots s WHERE s.id=$1 AND s.source_key=$2 AND s.source_record_id=$3`,
  [snapshotId, listing.source, String(listing.provenance?.recordId || '')]);
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return { snapshotId: row.id, source: row.source_key, recordId: row.source_record_id,
    observedAt: iso(row.observed_at), payloadSha256: row.payload_sha256,
    provenance: row.provenance, rawValues: row.raw_payload, observations: row.observations };
}

async function loadEvidence(pool, listing) {
  const recordId = String(listing.provenance?.recordId || '');
  const [history, media, references, linked, candidates] = await Promise.all([
    pool.query(`SELECT s.*, count(*) OVER()::int AS total,
      min(s.observed_at) OVER() AS first_observed_at,
      coalesce((SELECT jsonb_object_agg(o.field_name,o.value) FROM discovery_observations o WHERE o.snapshot_id=s.id),'{}'::jsonb) AS fields
      FROM discovery_snapshots s WHERE s.source_key=$1 AND s.source_record_id=$2
      ORDER BY s.observed_at DESC,s.id DESC LIMIT 100`, [listing.source,recordId]),
    pool.query(`SELECT a.sha256,a.bytes,a.integrity,a.display_status AS "displayStatus",a.rights,
      l.source_url AS "sourceUrl" FROM discovery_media_links l JOIN discovery_media_assets a ON a.sha256=l.sha256
      WHERE l.source_key=$1 AND l.source_record_id=$2 ORDER BY a.sha256 LIMIT 200`, [listing.source,recordId]),
    pool.query(`SELECT source_url AS url,media_index AS index,observed_at AS "observedAt"
      FROM discovery_media_references WHERE source_key=$1 AND source_record_id=$2 ORDER BY media_index LIMIT 500`, [listing.source,recordId]),
    pool.query(`SELECT id,source_key AS source,provenance->>'recordId' AS "recordId",address,
      source_url AS "sourceUrl",source_observed_at AS "observedAt",opening_bid::float8 AS "openingBid",
      sale_date::text AS "saleDate",lifecycle_status AS "lifecycleStatus",transaction_outcome AS "transactionOutcome",
      discovery_parcel_identity(provenance) AS "parcelId",discovery_parcel_jurisdiction(provenance) AS jurisdiction
      FROM listings WHERE id<>$1 AND discovery_parcel_identity(provenance)=discovery_parcel_identity($2::jsonb)
        AND discovery_parcel_jurisdiction(provenance)=discovery_parcel_jurisdiction($2::jsonb)
        AND length(discovery_parcel_jurisdiction(provenance))>2
        AND discovery_parcel_identity(provenance) NOT IN ('UNKNOWN','N/A','NONE','0')
        AND provenance->>'origin' IN ('live','archive') ORDER BY id LIMIT 100`, [listing.id,listing.provenance || {}]),
    pool.query(`SELECT id,source_key AS source,address,source_url AS "sourceUrl"
      FROM listings WHERE id<>$1 AND state=$2 AND lower(address)=lower($3)
      ORDER BY id LIMIT 20`, [listing.id,listing.state,listing.address]),
  ]);
  const timeline = history.rows.map(row => snapshotView(row,listing));
  // Transaction summaries remain visible but never become listing observations.
  const snapshots = timeline.filter(item => item.kind === 'publisher_record').reverse();
  const signals = [];
  for (let index=1; index<snapshots.length; index++) {
    const previous=snapshots[index-1], current=snapshots[index];
    if (!['live','archive'].includes(previous.origin) || !['live','archive'].includes(current.origin)) continue;
    for (const change of compareSnapshots(previous,current)) signals.push({
      id:digest([previous.snapshotId,current.snapshotId,change.field]).slice(0,24), listingId:listing.id,
      sourceId:listing.source,recordId,observedAt:current.observedAt,...change,
      evidence:[{sourceUrl:previous.sourceUrl,observedAt:previous.observedAt,value:change.before},
        {sourceUrl:current.sourceUrl,observedAt:current.observedAt,value:change.after}],
    });
  }
  const latest=snapshots.at(-1);
  const observations={records:latest?{[digest([listing.source,recordId])]:{
    firstObservedAt:iso(history.rows[0]?.first_observed_at),observations:Number(history.rows[0]?.total || 0),
    latest,history:snapshots.slice(0,-1),
  }}:{},signals:signals.reverse()};
  const facts=listing.provenance?.sourceFacts || {};
  const linkedIds=new Set(linked.rows.map(row=>row.id));
  return { observations,
    evidenceTimeline:{items:timeline,total:Number(history.rows[0]?.total||0),truncated:Number(history.rows[0]?.total||0)>100},
    linkedPublisherRecords:linked.rows.map(row=>({...row,linkBasis:'exact_parcel_and_jurisdiction'})),
    identityCandidates:candidates.rows.filter(row=>!linkedIds.has(row.id)).map(row=>({...row,status:'candidate',linkBasis:'address_requires_review'})),
    publisherConflicts:linked.rows.flatMap(row=>['openingBid','saleDate','lifecycleStatus'].filter(field=>
      listing[field]!=null && row[field]!=null && String(listing[field])!==String(row[field])).map(field=>({field,
      listingValue:listing[field],publisherValue:row[field],listingId:row.id,source:row.source,sourceUrl:row.sourceUrl,observedAt:row.observedAt}))),
    saleMechanics:{program:listing.auctionProgram || facts.auctionProgram || null,
      lifecycle:listing.lifecycleStatus || listing.status || null,transactionOutcome:listing.transactionOutcome || null,
      scheduledDate:listing.saleDate || null,scheduledTime:facts.saleTime || facts.tpsSaleTime || null,
      timeZone:facts.saleTimezone || null,windowStart:facts.auctionRunStartDate || null,windowEnd:facts.auctionRunEndDate || null,
      method:facts.auctionMethod || null,location:facts.tpsSaleLocation || null,openingAmount:listing.openingBid ?? null,
      depositTerms:listing.deposit || null},
    mediaEvidence:{references:references.rows,assets:media.rows.map(({sourceUrl,...row})=>({...row,sourceUrl:safeUrl(sourceUrl)})),
      documents:Array.isArray(facts.documents)?facts.documents:null,displayPolicy:'Only policy-approved assets may be displayed.'},
  };
}

async function readResearch(pool,listingId,key) {
  const result=await pool.query('SELECT result,observed_at FROM discovery_public_record_research WHERE listing_id=$1 AND evidence_hash=$2',[listingId,key]);
  return result.rows[0]?{savedAt:new Date(result.rows[0].observed_at).getTime(),result:result.rows[0].result}:null;
}
async function saveResearch(pool,listingId,key,result) {
  await pool.query(`INSERT INTO discovery_public_record_research(listing_id,evidence_hash,result) VALUES($1,$2,$3)
    ON CONFLICT(listing_id,evidence_hash) DO UPDATE SET result=EXCLUDED.result,observed_at=now()`,[listingId,key,result]);
}
module.exports={loadEvidence,readSnapshot,readResearch,saveResearch};
