'use strict';

// server/db/observations-persistence.js
//
// PostgreSQL is the sole operational store for source observation history
// (migration 025) and collection-run metadata (migration 027). The bounded
// JSON file store this layer once mirrored was retired after its history was
// imported by scripts/import-observation-store.js; every reader and writer
// below talks to Postgres only. Without Postgres the observation surfaces
// report unavailability — the same posture the listing API takes
// (server/db/client.js: no inventory is served from a fallback).
//
//   - recordSourceRun: the ingest write path. Validates the run's live
//     listings, snapshots the ones that advance a record, inserts them
//     idempotently into `source_observations`, and upserts the source's run
//     metadata into `source_observation_runs`.
//   - loadObservationsFromRecord / loadObservationsForRecord: evaluator-shaped
//     per-listing history, rebuilt by replaying the same compareSnapshots
//     classifier the write path uses, so no reader can classify a transition
//     differently than the ingest path did.
//   - loadObservationsFromPg: whole-store view ({runs, records, signals}) for
//     the /sources change-detection page. Change events are derived on read
//     from consecutive snapshot pairs — there is no stored event log to fall
//     behind the classifier.
//   - observationStoreStats: Postgres-backed capacity facts for /api/health.
//   - updateTriagePriority: write-through refresh for listings.triage_priority.
//   - recomputeTriageForListings: ingest-time refresh for the listings a run
//     advanced.

const crypto = require('node:crypto');
const { acceptedLiveListings, compareSnapshots, snapshot } = require('../sources/observations');

const MAX_ROWS_PER_STATEMENT = 200;
const EVENT_NEXT_STEP = 'Open the current publisher record and confirm the sale terms before acting.';

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

function isoOrNull(value) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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
    sourceUrl: row.source_url || null,
    state: row.state || null,
    county: row.county || null,
    fields: {
      openingBid: row.opening_bid != null ? Number(row.opening_bid) : null,
      saleDate: row.sale_date instanceof Date ? new Date(row.sale_date).toISOString().slice(0, 10) : row.sale_date,
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
// way at ingest and another way here.
async function loadObservationsForRecord(pool, listing) {
  if (!pool || !listing?.source || !listing?.provenance?.recordId) {
    return { records: {}, signals: [] };
  }
  const result = await pool.query(
    `SELECT listing_id, record_id, observed_at, opening_bid, sale_date, status, deposit, address,
            raw_payload->>'sourceUrl' AS source_url, raw_payload->>'state' AS state, raw_payload->>'county' AS county
       FROM source_observations
      WHERE source_key = $1 AND record_id = $2
      ORDER BY observed_at ASC, id ASC
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

// Reads the record's most recent observation per record and rejects snapshots
// that do not advance it — the exact gate the retired file store applied, so
// late-arriving stale captures can never rewrite a newer observation.
async function latestObservedAtByRecord(pool, sourceId, recordIds) {
  if (!recordIds.length) return new Map();
  const result = await pool.query(
    `SELECT record_id, max(observed_at) AS latest_observed_at
       FROM source_observations
      WHERE source_key = $1 AND record_id = ANY($2::text[])
      GROUP BY record_id`,
    [sourceId, recordIds],
  );
  return new Map(result.rows.map((row) => [String(row.record_id), new Date(row.latest_observed_at).getTime()]));
}

// Mirrors the retired file store's runs[sourceId] arithmetic exactly,
// including counting accepted-but-not-advancing listings as rejected. The
// prior-dependent fields (last_success_at, last_non_empty_at, runs_count) are
// computed in UPSERT_RUN_SQL so the read-modify-write is a single statement.
function runMetadataParams(sourceId, run, applied, nowIso) {
  return [
    sourceId,
    nowIso,
    applied,
    Math.max(0, Number(run.evidenceCount) || 0),
    Math.max(0, Number(run.rejectedCount) || 0) + (run.listings || []).length - applied,
    run.error ? String(run.error).slice(0, 300) : null,
    Math.max(0, Number(run.durationMs) || 0),
  ];
}

const UPSERT_RUN_SQL = `
  INSERT INTO source_observation_runs AS r
    (source_key, last_run_at, last_success_at, last_non_empty_at, accepted_count,
     evidence_count, rejected_count, error, duration_ms, runs_count, updated_at)
  VALUES ($1, $2,
          CASE WHEN $6::text IS NULL THEN $2 ELSE NULL END,
          CASE WHEN $3 > 0 THEN $2 ELSE NULL END,
          $3, $4, $5, $6, $7, 1, NOW())
  ON CONFLICT (source_key) DO UPDATE SET
    last_run_at = EXCLUDED.last_run_at,
    last_success_at = CASE WHEN EXCLUDED.error IS NULL THEN EXCLUDED.last_run_at ELSE r.last_success_at END,
    last_non_empty_at = CASE WHEN EXCLUDED.accepted_count > 0 THEN EXCLUDED.last_run_at ELSE r.last_non_empty_at END,
    accepted_count = EXCLUDED.accepted_count,
    evidence_count = EXCLUDED.evidence_count,
    rejected_count = EXCLUDED.rejected_count,
    error = EXCLUDED.error,
    duration_ms = EXCLUDED.duration_ms,
    runs_count = r.runs_count + 1,
    updated_at = NOW()`;

// Ingest write path. PostgreSQL only: without a pool this throws, and the
// caller reports a failed collection run — a dead database must never read as
// "no observations recorded".
async function recordSourceRun(pool, sourceId, run, options = {}) {
  if (!pool) throw new Error('Source observations require PostgreSQL (DATABASE_URL is not configured)');
  if (!/^[a-z][a-z0-9_-]{1,79}$/.test(sourceId)) throw new Error('Invalid observation source');
  const nowIso = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  // source_observation_runs.source_key REFERENCES sources(key). An unknown
  // source skips its writes instead of aborting on the foreign key.
  const known = await pool.query('SELECT 1 FROM sources WHERE key = $1', [sourceId]);
  if (!known.rows.length) return { accepted: 0, newSignals: 0, snapshots: [], skipped: 'unknown_source' };

  const acceptedListings = acceptedLiveListings(sourceId, run, nowIso);
  const latestObserved = await latestObservedAtByRecord(pool, sourceId, [...new Set(acceptedListings.map((listing) => String(listing.provenance.recordId)))]);

  // Only snapshots that actually advance the record are stored. An error run
  // stores none: a failed request is never evidence about sale terms.
  const advancing = [];
  if (!run.error) {
    for (const listing of acceptedListings) {
      const current = snapshot(listing);
      const priorMs = latestObserved.get(String(current.recordId));
      if (priorMs !== undefined && Date.parse(current.observedAt) <= priorMs) continue;
      latestObserved.set(String(current.recordId), Date.parse(current.observedAt));
      advancing.push(current);
    }
  }

  const persisted = advancing.length ? await persistSourceObservations(pool, sourceId, advancing) : { persisted: 0 };
  await pool.query(UPSERT_RUN_SQL, runMetadataParams(sourceId, run, advancing.length, nowIso));
  return { accepted: advancing.length, newSignals: null, snapshots: advancing, persisted: persisted.persisted || 0 };
}

// Whole-store view for the /sources change-detection page: run metadata per
// source, the distinct tracked-record count, and the most recent change events
// derived by replaying compareSnapshots over the last two snapshots of the
// most recently active records. Bounded, so the page stays cheap as history
// grows without limit in Postgres.
async function loadObservationsFromPg(pool, options = {}) {
  const empty = { runs: {}, records: {}, signals: [], trackedRecords: 0 };
  if (!pool) return empty;
  const clamp = (value, min, max, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
  };
  const signalLimit = clamp(options.signalLimit, 1, 5000, 2000);
  const recordLimit = clamp(options.recordLimit, 1, 5000, 1000);

  const [runsResult, trackedResult, snapshotsResult] = await Promise.all([
    pool.query(`SELECT source_key, last_run_at, last_success_at, last_non_empty_at,
                       accepted_count, evidence_count, rejected_count, error, duration_ms, runs_count
                  FROM source_observation_runs`),
    pool.query(`SELECT count(*)::int AS tracked FROM (SELECT DISTINCT source_key, record_id FROM source_observations) t`),
    pool.query(
      `WITH recent AS (
         SELECT source_key, record_id, max(observed_at) AS last_seen
           FROM source_observations
          GROUP BY source_key, record_id
          ORDER BY last_seen DESC
          LIMIT $1
       )
       SELECT o.listing_id, o.source_key, o.record_id, o.observed_at,
              o.opening_bid, o.sale_date, o.status, o.deposit, o.address,
              o.raw_payload->>'sourceUrl' AS source_url,
              o.raw_payload->>'state' AS state,
              o.raw_payload->>'county' AS county
         FROM source_observations o
         JOIN recent ON o.source_key = recent.source_key AND o.record_id = recent.record_id
        ORDER BY o.source_key, o.record_id, o.observed_at ASC, o.id ASC`,
      [recordLimit],
    ),
  ]);

  const runs = {};
  for (const row of runsResult.rows) {
    runs[row.source_key] = {
      lastRunAt: isoOrNull(row.last_run_at),
      lastSuccessAt: isoOrNull(row.last_success_at),
      lastNonEmptyAt: isoOrNull(row.last_non_empty_at),
      acceptedCount: Number(row.accepted_count) || 0,
      evidenceCount: Number(row.evidence_count) || 0,
      rejectedCount: Number(row.rejected_count) || 0,
      error: row.error || null,
      durationMs: Number(row.duration_ms) || 0,
      runs: Number(row.runs_count) || 0,
    };
  }

  const events = [];
  let previous = null;
  let previousKey = null;
  for (const row of snapshotsResult.rows) {
    const current = rowToSnapshot(row);
    const key = `${row.source_key}\n${row.record_id}`;
    if (key !== previousKey) { previous = null; previousKey = key; }
    if (previous) {
      for (const change of compareSnapshots(previous, current)) {
        events.push({
          id: crypto.createHash('sha256')
            .update(`${recordKeyFor(row.source_key, row.record_id)}\n${current.observedAt}\n${change.field}`)
            .digest('hex').slice(0, 24),
          sourceId: row.source_key, recordId: String(row.record_id), listingId: current.listingId,
          address: current.fields.address, state: current.state, county: current.county,
          observedAt: current.observedAt,
          ...change,
          evidence: [
            { sourceUrl: previous.sourceUrl, observedAt: previous.observedAt, value: change.before },
            { sourceUrl: current.sourceUrl, observedAt: current.observedAt, value: change.after },
          ],
          nextStep: EVENT_NEXT_STEP,
        });
      }
    }
    previous = current;
  }
  events.sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));

  return {
    runs,
    records: {},
    signals: events.slice(0, signalLimit),
    trackedRecords: Number(trackedResult.rows[0]?.tracked) || 0,
  };
}

// Postgres-backed capacity facts for /api/health. There is no ceiling to
// overflow anymore: history grows by roughly a megabyte a day in rows, which
// Postgres absorbs, so the report states the facts (rows, span, size) instead
// of a countdown to a hard failure that no longer exists.
async function observationStoreStats(pool) {
  if (!pool) return null;
  const result = await pool.query(`
    SELECT count(*)::int AS rows,
           count(DISTINCT (source_key, record_id))::int AS tracked_records,
           min(observed_at) AS oldest_observed_at,
           max(observed_at) AS newest_observed_at,
           pg_total_relation_size('source_observations')::bigint AS table_bytes
      FROM source_observations`);
  const row = result.rows[0];
  if (!row) return null;
  return {
    store: 'postgres',
    rows: Number(row.rows) || 0,
    trackedRecords: Number(row.tracked_records) || 0,
    oldestObservedAt: isoOrNull(row.oldest_observed_at),
    newestObservedAt: isoOrNull(row.newest_observed_at),
    tableBytes: Number(row.table_bytes) || 0,
    willExceedCeiling: false,
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
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 500;
  let evaluated = 0;
  let updated = 0;
  for (const listing of listings) {
    if (evaluated >= limit) break;
    if (!listing || typeof listing !== 'object' || !listing.id) continue;
    try {
      const observations = await loadObservationsForRecord(pool, listing);
      const evaluation = evaluate(listing, { observations, ...(options.now ? { now: options.now } : {}) });
      evaluated += 1;
      const result = await updateTriagePriority(pool, listing.id, evaluation.triagePriority);
      if (result.updated) updated += 1;
    } catch (_) { /* best-effort: skip the listing */ }
  }
  return { evaluated, updated };
}

// One-time import helper for scripts/import-observation-store.js: the legacy
// JSON store predates migration 025's mirror, so its run metadata carries the
// full pre-mirror run count. On conflict the import never clobbers newer
// Postgres truth — it takes the greater count/timestamp and keeps an existing
// error over a historical one. Like the snapshot path, an unknown source is
// skipped instead of aborting on the foreign key.
async function importObservationRun(pool, sourceId, runMeta) {
  if (!pool || !sourceId || !runMeta || typeof runMeta !== 'object') return { imported: false };
  const known = await pool.query('SELECT 1 FROM sources WHERE key = $1', [sourceId]);
  if (!known.rows.length) return { imported: false, skipped: 'unknown_source' };
  await pool.query(
    `INSERT INTO source_observation_runs AS r
       (source_key, last_run_at, last_success_at, last_non_empty_at, accepted_count,
        evidence_count, rejected_count, error, duration_ms, runs_count, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (source_key) DO UPDATE SET
       last_run_at = GREATEST(r.last_run_at, EXCLUDED.last_run_at),
       last_success_at = GREATEST(COALESCE(r.last_success_at, EXCLUDED.last_success_at), COALESCE(EXCLUDED.last_success_at, r.last_success_at)),
       last_non_empty_at = GREATEST(COALESCE(r.last_non_empty_at, EXCLUDED.last_non_empty_at), COALESCE(EXCLUDED.last_non_empty_at, r.last_non_empty_at)),
       accepted_count = GREATEST(r.accepted_count, EXCLUDED.accepted_count),
       evidence_count = GREATEST(r.evidence_count, EXCLUDED.evidence_count),
       rejected_count = GREATEST(r.rejected_count, EXCLUDED.rejected_count),
       error = COALESCE(r.error, EXCLUDED.error),
       duration_ms = GREATEST(r.duration_ms, EXCLUDED.duration_ms),
       runs_count = GREATEST(r.runs_count, EXCLUDED.runs_count),
       updated_at = NOW()`,
    [
      sourceId,
      runMeta.lastRunAt || new Date().toISOString(),
      runMeta.lastSuccessAt || null,
      runMeta.lastNonEmptyAt || null,
      Math.max(0, Number(runMeta.acceptedCount) || 0),
      Math.max(0, Number(runMeta.evidenceCount) || 0),
      Math.max(0, Number(runMeta.rejectedCount) || 0),
      runMeta.error || null,
      Math.max(0, Number(runMeta.durationMs) || 0),
      Math.max(0, Number(runMeta.runs) || 0),
    ],
  );
  return { imported: true };
}

module.exports = {
  importObservationRun,
  loadObservationsForRecord,
  loadObservationsFromPg,
  observationStoreStats,
  persistSourceObservations,
  recordSourceRun,
  recomputeTriageForListings,
  updateTriagePriority,
};
