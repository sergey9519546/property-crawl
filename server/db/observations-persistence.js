'use strict';

// server/db/observations-persistence.js
//
// PostgreSQL persistence for the source-observation pipeline (migration 025).
// The filesystem store in server/sources/observations.js remains the
// operational store; these functions mirror it into the `source_observations`
// table so history survives store compaction and becomes queryable:
//
//   - persistSourceObservations: called from the ingest path (scheduler /
//     source-network route) with the exact snapshots that advanced a record.
//     Rows are immutable and idempotent (ON CONFLICT DO NOTHING), keyed by
//     source + record + observedAt.
//   - loadObservationsForRecord: rebuilds the evaluator-shaped
//     { records, signals } view for one listing by replaying the same
//     compareSnapshots diff the filesystem pipeline uses, so PostgreSQL and
//     the JSON store can never classify the same history differently.
//   - updateTriagePriority: write-through refresh for listings.triage_priority.
//     The score is recomputed on every evaluation; persisting the just-
//     computed value keeps the column current exactly when anyone looked at
//     it. A score computed while the observation history was unreadable is
//     never persisted — a degraded-view score is not a fact about the listing.

const crypto = require('node:crypto');
const { compareSnapshots } = require('../sources/observations');

const MAX_ROWS_PER_STATEMENT = 200;

function observationRowId(sourceId, recordId, observedAt) {
  return crypto.createHash('sha256').update(`${sourceId}\n${recordId}\n${observedAt}`).digest('hex');
}

function recordKeyFor(source, recordId) {
  return crypto.createHash('sha256').update(`${source}\n${recordId}`).digest('hex');
}

function toIsoDate(value) {
  const parsed = Date.parse(String(value || '').slice(0, 10));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function snapshotToRow(sourceId, snapshot) {
  const fields = snapshot && typeof snapshot === 'object' ? snapshot.fields || {} : {};
  const openingBid = Number(fields.openingBid);
  return [
    observationRowId(sourceId, snapshot.recordId, snapshot.observedAt),
    String(snapshot.listingId || '').slice(0, 64),
    sourceId,
    String(snapshot.recordId || '').slice(0, 128),
    snapshot.observedAt,
    Number.isFinite(openingBid) && openingBid > 0 ? openingBid : null,
    toIsoDate(fields.saleDate),
    String(fields.status || '').slice(0, 64) || null,
    fields.deposit != null ? String(fields.deposit) : null,
    fields.address != null ? String(fields.address) : null,
    snapshot.noticeExcerpt != null ? String(snapshot.noticeExcerpt) : null,
    /^[a-f0-9]{64}$/i.test(String(snapshot.noticeSha256 || '')) ? snapshot.noticeSha256 : null,
    JSON.stringify(snapshot),
  ];
}

async function persistSourceObservations(pool, sourceId, snapshots) {
  if (!pool || !sourceId || !Array.isArray(snapshots) || snapshots.length === 0) {
    return { persisted: 0 };
  }
  // source_observations.source_key REFERENCES sources(key). A single unknown
  // source aborts the whole INSERT batch on the foreign-key violation, losing
  // every snapshot in it. Check first and skip the mirror instead.
  const known = await pool.query('SELECT 1 FROM sources WHERE key = $1', [sourceId]);
  if (!known.rows.length) return { persisted: 0, skipped: 'unknown_source' };
  const rows = [];
  for (const snapshot of snapshots) {
    if (!snapshot || !snapshot.recordId || !snapshot.observedAt) continue;
    rows.push(snapshotToRow(sourceId, snapshot));
  }
  if (!rows.length) return { persisted: 0 };

  let persisted = 0;
  for (let offset = 0; offset < rows.length; offset += MAX_ROWS_PER_STATEMENT) {
    const batch = rows.slice(offset, offset + MAX_ROWS_PER_STATEMENT);
    const params = [];
    const values = batch.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    const result = await pool.query(
      `INSERT INTO source_observations
         (id, listing_id, source_key, record_id, observed_at, opening_bid,
          sale_date, status, deposit, address, notice_excerpt, notice_sha256, raw_payload)
       VALUES ${values.join(', ')}
       ON CONFLICT (id) DO NOTHING`,
      params,
    );
    persisted += result.rowCount || 0;
  }
  return { persisted };
}

function rowToSnapshot(row) {
  return {
    listingId: row.listing_id,
    recordId: row.record_id,
    observedAt: row.observed_at instanceof Date ? row.observed_at.toISOString() : String(row.observed_at),
    fields: {
      openingBid: row.opening_bid != null ? Number(row.opening_bid) : null,
      saleDate: row.sale_date instanceof Date ? row.sale_date.toISOString().slice(0, 10) : row.sale_date,
      status: row.status,
      deposit: row.deposit,
      address: row.address,
    },
  };
}

// Rebuilds the { records, signals } shape the evaluator consumes for one
// listing. Change events are regenerated by replaying compareSnapshots over
// the persisted snapshots in observation order — the same classifier the
// ingest path uses — so a relist or bid reduction cannot be classified one
// way in the filesystem store and another way here.
async function loadObservationsForRecord(pool, listing) {
  if (!pool || !listing?.source || !listing?.provenance?.recordId) {
    return { records: {}, signals: [] };
  }
  const result = await pool.query(
    `SELECT listing_id, record_id, observed_at, opening_bid, sale_date, status, deposit, address
       FROM source_observations
      WHERE source_key = $1 AND record_id = $2
      ORDER BY observed_at ASC
      LIMIT 200`,
    [listing.source, String(listing.provenance.recordId)],
  );
  if (!result.rows.length) return { records: {}, signals: [] };

  const snapshots = result.rows.map(rowToSnapshot);
  const signals = [];
  for (let index = 1; index < snapshots.length; index++) {
    for (const change of compareSnapshots(snapshots[index - 1], snapshots[index])) {
      signals.push({
        id: `${observationRowId(listing.source, listing.provenance.recordId, snapshots[index].observedAt)}-${change.field}`.slice(0, 24),
        kind: change.kind,
        field: change.field,
        before: change.before,
        after: change.after,
        listingId: snapshots[index].listingId,
        recordId: String(listing.provenance.recordId),
        observedAt: snapshots[index].observedAt,
      });
    }
  }
  return {
    records: {
      [recordKeyFor(listing.source, listing.provenance.recordId)]: {
        firstObservedAt: snapshots[0].observedAt,
        observations: snapshots.length,
        // All persisted snapshots count as history here: the evaluator
        // compares each against the current live status, so a snapshot that
        // was inactive followed by a live record that is active is a
        // returned-to-market transition even when no newer snapshot exists.
        history: snapshots,
      },
    },
    signals,
  };
}

async function updateTriagePriority(pool, listingId, triagePriority) {
  if (!pool || !listingId || !Number.isInteger(triagePriority) || triagePriority < 0 || triagePriority > 99) {
    return { updated: false };
  }
  // Every write stamps triage_priority_refreshed_at (migration 026): the
  // score is time-dependent (a confirmed sale date passes; events
  // accumulate), so sorting consumers must treat a stale value as unknown
  // rather than as a fresh ranking.
  const result = await pool.query(
    'UPDATE listings SET triage_priority = $1, triage_priority_refreshed_at = NOW() WHERE id = $2',
    [triagePriority, listingId],
  );
  return { updated: (result.rowCount || 0) > 0 };
}

// Ingest-side refresh of the triage_priority cache. The route refreshes the
// column whenever anyone evaluates a listing; this fills the rest at the
// moment their evidence changes, so hunt sorting does not depend on every
// listing having been opened. Best-effort per listing: one bad record never
// aborts the batch.
async function recomputeTriageForListings(pool, listings, options = {}) {
  if (!pool || !Array.isArray(listings) || listings.length === 0) {
    return { evaluated: 0, updated: 0 };
  }
  const evaluate = options.evaluateOpportunitySignals
    || require('../intelligence/signals').evaluateOpportunitySignals;
  const readFileHistory = typeof options.readFileHistory === 'function' ? options.readFileHistory : null;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 500;
  let evaluated = 0;
  let updated = 0;
  for (const listing of listings) {
    if (evaluated >= limit) break;
    if (!listing || typeof listing !== 'object' || !listing.id) continue;
    try {
      let observations = await loadObservationsForRecord(pool, listing);
      // Match the route's fallback: while the durable mirror is still
      // filling, an empty PostgreSQL history must not read as "no history".
      if (!Object.keys(observations.records).length && readFileHistory) {
        try { observations = readFileHistory(); } catch (_) { /* degraded history below */ }
      }
      const evaluation = evaluate(listing, { observations, ...(options.now ? { now: options.now } : {}) });
      evaluated += 1;
      const result = await updateTriagePriority(pool, listing.id, evaluation.triagePriority);
      if (result.updated) updated += 1;
    } catch (_) { /* best-effort: skip the listing */ }
  }
  return { evaluated, updated };
}

module.exports = {
  loadObservationsForRecord,
  persistSourceObservations,
  recomputeTriageForListings,
  updateTriagePriority,
};
