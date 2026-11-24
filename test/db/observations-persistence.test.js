'use strict';

// test/db/observations-persistence.test.js
//
// Contract tests for server/db/observations-persistence.js — the migration
// 025 wiring that mirrors the source-observation pipeline into PostgreSQL.
// A fake pool pins the SQL contract (idempotency, parameterization) and the
// evaluator integration pins that PostgreSQL-replayed history classifies
// identically to the filesystem store.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const {
  compactPgObservations,
  loadObservationsForRecord,
  persistSourceObservations,
  recordSourceRun,
  recomputeTriageForListings,
  slimSnapshotForRawPayload,
  updateTriagePriority,
} = require('../../server/db/observations-persistence');
const { evaluateOpportunitySignals } = require('../../server/intelligence/signals');

function snapshot(overrides = {}) {
  return {
    listingId: 'CIV-NJ-7-2128964683',
    recordId: '2128964683',
    observedAt: '2026-10-01T00:00:00.000Z',
    noticeExcerpt: 'Official record excerpt',
    noticeSha256: crypto.createHash('sha256').update('Official record excerpt').digest('hex'),
    fields: {
      openingBid: 100000,
      saleDate: '2026-10-01',
      status: 'Status: Active - Postponed',
      deposit: '10% of bid',
      address: '19 West Park Avenue, Park Ridge, NJ 07656',
    },
    ...overrides,
  };
}

function fakePool(handler) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (handler) return handler(text, params, calls.length);
      return { rows: [], rowCount: 0 };
    },
  };
}

// The mirror guards against the source_observations.source_key foreign key:
// an unknown source skips the whole batch instead of aborting it. Tests that
// expect rows to be written must first confirm the source is enrolled.
function enrolledSourcePool(insertResult) {
  return fakePool((text) => {
    if (/^SELECT 1 FROM sources/i.test(text)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    return insertResult;
  });
}

test('persistSourceObservations inserts idempotent, parameterized rows', async () => {
  const pool = enrolledSourcePool({ rows: [], rowCount: 2 });
  const result = await persistSourceObservations(pool, 'civilview', [snapshot()]);

  assert.equal(result.persisted, 2);
  const call = pool.calls[pool.calls.length - 1];
  assert.match(call.text, /INSERT INTO source_observations/);
  assert.match(call.text, /ON CONFLICT \(id\) DO NOTHING/);
  assert.equal(call.params.length, 13);
  const [id, listingId, sourceKey, recordId, observedAt, openingBid, saleDate, status, deposit, address, noticeExcerpt, noticeSha256, rawPayload] = call.params;
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(listingId, 'CIV-NJ-7-2128964683');
  assert.equal(sourceKey, 'civilview');
  assert.equal(recordId, '2128964683');
  assert.equal(observedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(openingBid, 100000);
  assert.equal(saleDate, '2026-10-01');
  assert.equal(status, 'Status: Active - Postponed');
  assert.equal(deposit, '10% of bid');
  assert.equal(address, '19 West Park Avenue, Park Ridge, NJ 07656');
  assert.equal(noticeExcerpt, 'Official record excerpt');
  assert.match(noticeSha256, /^[a-f0-9]{64}$/);
  assert.equal(typeof JSON.parse(rawPayload), 'object');
});

test('persistSourceObservations normalizes unusable values to null and skips invalid snapshots', async () => {
  const pool = enrolledSourcePool({ rows: [], rowCount: 1 });
  const bad = snapshot({
    recordId: 'bad',
    fields: { openingBid: 'not-a-number', saleDate: 'Call county clerk', status: '', deposit: null, address: null },
    noticeSha256: 'short',
  });
  const result = await persistSourceObservations(pool, 'civilview', [bad, null, snapshot({ recordId: null })]);

  assert.equal(result.persisted, 1);
  const insertCalls = pool.calls.filter((c) => /INSERT INTO source_observations/.test(c.text));
  assert.equal(insertCalls.length, 1);
  const call = insertCalls[0];
  const [, , , , , openingBid, saleDate, status, deposit, address, noticeExcerpt, noticeSha256] = call.params;
  assert.equal(openingBid, null);
  assert.equal(saleDate, null);
  assert.equal(status, null);
  assert.equal(deposit, null);
  assert.equal(address, null);
  assert.equal(noticeExcerpt, 'Official record excerpt');
  assert.equal(noticeSha256, null);
});

test('persistSourceObservations batches large runs, guards unknown sources, and no-ops without a pool', async () => {
  const pool = enrolledSourcePool({ rows: [], rowCount: 200 });
  const many = Array.from({ length: 250 }, (_, index) => snapshot({ recordId: `rec-${index}`, observedAt: `2026-10-01T00:0${index}:00.000Z` }));
  const batched = await persistSourceObservations(pool, 'civilview', many);
  assert.equal(batched.persisted, 400);
  assert.equal(pool.calls.filter((c) => /INSERT INTO source_observations/.test(c.text)).length, 2);

  // source_key references sources(key): an unenrolled source skips the
  // mirror instead of aborting the batch on a foreign-key violation.
  const unknown = fakePool(() => ({ rows: [], rowCount: 0 }));
  const skipped = await persistSourceObservations(unknown, 'not-a-source', many);
  assert.deepEqual(skipped, { persisted: 0, skipped: 'unknown_source' });

  const empty = await persistSourceObservations(null, 'civilview', many);
  assert.deepEqual(empty, { persisted: 0 });
  const noRows = await persistSourceObservations(pool, 'civilview', []);
  assert.deepEqual(noRows, { persisted: 0 });
});

test('loadObservationsForRecord replays evaluator-shaped history from persisted rows', async () => {
  const rows = [
    { listing_id: 'CIV-NJ-7-2128964683', record_id: '2128964683', observed_at: new Date('2026-10-01T00:00:00.000Z'), opening_bid: '100000', sale_date: new Date('2026-10-05T00:00:00.000Z'), status: 'Status: Active - Postponed', deposit: null, address: '19 West Park Avenue' },
    { listing_id: 'CIV-NJ-7-2128964683', record_id: '2128964683', observed_at: new Date('2026-10-03T00:00:00.000Z'), opening_bid: '90000', sale_date: new Date('2026-10-05T00:00:00.000Z'), status: 'Status: Active - Postponed', deposit: null, address: '19 West Park Avenue' },
    { listing_id: 'CIV-NJ-7-2128964683', record_id: '2128964683', observed_at: new Date('2026-10-05T00:00:00.000Z'), opening_bid: '90000', sale_date: new Date('2026-10-21T00:00:00.000Z'), status: 'Status: Active', deposit: null, address: '19 West Park Avenue' },
  ];
  const pool = fakePool(() => ({ rows, rowCount: rows.length }));
  const listing = {
    id: 'CIV-NJ-7-2128964683',
    source: 'civilview',
    status: 'Status: Active',
    provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: '2128964683' },
  };

  const observations = await loadObservationsForRecord(pool, listing);
  const recordKey = crypto.createHash('sha256').update('civilview\n2128964683').digest('hex');
  const record = observations.records[recordKey];
  assert.ok(record, 'records must be keyed exactly as the evaluator computes recordKey');
  assert.equal(record.observations, 3);
  assert.equal(record.history.length, 3);

  // Replayed events: bid 100000 -> 90000 is a reduction; postponed -> active
  // is a returned-to-market event (real publisher prose, not enums).
  assert.ok(observations.signals.some((s) => s.kind === 'bid_reduced' && s.before === 100000 && s.after === 90000));
  assert.ok(observations.signals.some((s) => s.kind === 'returned_to_market'));

  // The evaluator must consume the replayed view exactly like the
  // filesystem store: bid reduction supported, relist supported.
  const evaluation = evaluateOpportunitySignals(listing, { observations });
  assert.equal(evaluation.signals.find((s) => s.key === 'bid_reduction').status, 'supported');
  assert.equal(evaluation.signals.find((s) => s.key === 'returned_to_market').status, 'supported');
});

test('loadObservationsForRecord is a no-op without a pool or record identity', async () => {
  assert.deepEqual(await loadObservationsForRecord(null, { source: 'civilview' }), { records: {}, signals: [] });
  const pool = fakePool();
  assert.deepEqual(await loadObservationsForRecord(pool, { provenance: { recordId: 'x' } }), { records: {}, signals: [] });
  assert.equal(pool.calls.length, 0);
});

test('updateTriagePriority writes the clamped score and stamps the refresh time', async () => {
  const pool = fakePool(() => ({ rows: [], rowCount: 1 }));
  const ok = await updateTriagePriority(pool, 'CIV-NJ-7-2128964683', 42);
  assert.deepEqual(ok, { updated: true });
  // Migration 026: every write stamps triage_priority_refreshed_at because
  // the score is time-dependent.
  assert.equal(pool.calls[0].text, 'UPDATE listings SET triage_priority = $1, triage_priority_refreshed_at = NOW() WHERE id = $2');
  assert.deepEqual(pool.calls[0].params, [42, 'CIV-NJ-7-2128964683']);

  assert.deepEqual(await updateTriagePriority(pool, 'X', 100), { updated: false });
  assert.deepEqual(await updateTriagePriority(pool, 'X', -1), { updated: false });
  assert.deepEqual(await updateTriagePriority(pool, 'X', 12.5), { updated: false });
  assert.deepEqual(await updateTriagePriority(null, 'X', 42), { updated: false });
  const missed = fakePool(() => ({ rows: [], rowCount: 0 }));
  assert.deepEqual(await updateTriagePriority(missed, 'MISSING', 42), { updated: false });
});

test('recomputeTriageForListings refreshes persisted scores for advanced listings', async () => {
  // PostgreSQL history returns one bid-reduction event for the listing; the
  // evaluator must score from it and the writer must persist that score.
  const crypto = require('node:crypto');
  const listing = {
    id: 'CIV-NJ-7-2128964683',
    source: 'civilview',
    provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: '2128964683' },
  };
  const dbPool = fakePool(() => ({
    rows: [{
      listing_id: listing.id,
      record_id: '2128964683',
      observed_at: new Date('2026-10-01T00:00:00.000Z'),
      opening_bid: '100000', sale_date: null, status: 'Status: Active', deposit: null, address: null,
    }],
    rowCount: 1,
  }));
  const updates = [];
  const writePool = {
    async query(text, params) {
      if (/^UPDATE listings/.test(text)) { updates.push({ text, params }); return { rows: [], rowCount: 1 }; }
      return dbPool.query(text, params);
    },
  };
  const result = await recomputeTriageForListings(writePool, [listing]);
  assert.equal(result.evaluated, 1);
  assert.equal(result.updated, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].params[1], listing.id);
  assert.ok(updates[0].params[0] >= 0 && updates[0].params[0] <= 99);

  // Degraded view: an empty PostgreSQL history falls back to the filesystem
  // store; an unreadable one must not crash the refresh (best-effort skip).
  const emptyPool = fakePool(() => ({ rows: [], rowCount: 0 }));
  const fallbackRead = () => { throw new Error('store exceeds size limit'); };
  const degraded = await recomputeTriageForListings(emptyPool, [listing], { readFileHistory: fallbackRead });
  assert.equal(degraded.evaluated, 1);

  // Bounds and no-ops.
  assert.deepEqual(await recomputeTriageForListings(null, [listing]), { evaluated: 0, updated: 0 });
  assert.deepEqual(await recomputeTriageForListings(emptyPool, []), { evaluated: 0, updated: 0 });
});

test('slimSnapshotForRawPayload omits noticeExcerpt while preserving snapshot metadata and persistSourceObservations / recordSourceRun keep notice_excerpt column populated', async () => {
  const fullSnap = snapshot({
    source: 'civilview',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    state: 'NJ',
    county: 'Bergen',
    noticeExcerpt: 'SHERIFF SALE NOTICE '.repeat(500),
  });

  const slimmed = slimSnapshotForRawPayload(fullSnap);
  assert.equal('noticeExcerpt' in slimmed, false, 'noticeExcerpt must be omitted from raw_payload clone');
  assert.equal(slimmed.listingId, fullSnap.listingId);
  assert.equal(slimmed.source, fullSnap.source);
  assert.equal(slimmed.sourceUrl, fullSnap.sourceUrl);
  assert.equal(slimmed.observedAt, fullSnap.observedAt);
  assert.equal(slimmed.state, fullSnap.state);
  assert.equal(slimmed.county, fullSnap.county);
  assert.equal(slimmed.recordId, fullSnap.recordId);
  assert.equal(slimmed.noticeSha256, fullSnap.noticeSha256);
  assert.deepEqual(slimmed.fields, fullSnap.fields);

  const pool = enrolledSourcePool({ rows: [], rowCount: 1 });
  await persistSourceObservations(pool, 'civilview', [fullSnap]);
  const insertCall = pool.calls.find((c) => /INSERT INTO source_observations/.test(c.text));
  assert.ok(insertCall);
  const noticeExcerptParam = insertCall.params[10];
  const rawPayloadParam = JSON.parse(insertCall.params[12]);
  assert.equal(noticeExcerptParam, fullSnap.noticeExcerpt, 'notice_excerpt column must remain populated');
  assert.equal('noticeExcerpt' in rawPayloadParam, false, 'raw_payload JSON must not duplicate noticeExcerpt');
  assert.equal(rawPayloadParam.sourceUrl, fullSnap.sourceUrl);
  assert.equal(rawPayloadParam.state, 'NJ');
  assert.equal(rawPayloadParam.county, 'Bergen');

  // Verify pendingRollForward in recordSourceRun also slims raw_payload
  const rawText = 'SHERIFF SALE NOTICE ROLL FORWARD';
  const noticeSha = crypto.createHash('sha256').update(rawText).digest('hex');
  const rollPool = fakePool((text) => {
    if (/SELECT 1 FROM sources/i.test(text)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (/max\(observed_at\)/i.test(text)) {
      return { rows: [{ record_id: '2128964683', latest_observed_at: new Date('2026-10-02T00:00:00.000Z') }], rowCount: 1 };
    }
    if (/FROM source_observations/i.test(text)) {
      return {
        rows: [
          {
            id: 'obs-1', listing_id: 'CIV-NJ-7-2128964683', source_key: 'civilview', record_id: '2128964683',
            observed_at: new Date('2026-10-01T00:00:00.000Z'), opening_bid: '100000', sale_date: '2026-10-01',
            status: 'Status: Active - Postponed', deposit: '10% of bid', address: '19 West Park Avenue, Park Ridge, NJ 07656',
            notice_sha256: noticeSha,
          },
          {
            id: 'obs-2', listing_id: 'CIV-NJ-7-2128964683', source_key: 'civilview', record_id: '2128964683',
            observed_at: new Date('2026-10-02T00:00:00.000Z'), opening_bid: '100000', sale_date: '2026-10-01',
            status: 'Status: Active - Postponed', deposit: '10% of bid', address: '19 West Park Avenue, Park Ridge, NJ 07656',
            notice_sha256: noticeSha,
          },
        ],
        rowCount: 2,
      };
    }
    if (/UPDATE source_observations/i.test(text)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });

  await recordSourceRun(rollPool, 'civilview', {
    listings: [{
      id: 'CIV-NJ-7-2128964683',
      source: 'civilview',
      sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
      state: 'NJ',
      county: 'Bergen',
      openingBid: 100000,
      saleDate: '2026-10-01',
      status: 'Status: Active - Postponed',
      deposit: '10% of bid',
      address: '19 West Park Avenue, Park Ridge, NJ 07656',
      raw: rawText,
      sourceObservedAt: '2026-10-03T00:00:00.000Z',
      provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: '2128964683', noticeSha256: noticeSha },
    }],
    error: null,
    durationMs: 50,
  }, { now: '2026-10-03T00:00:00.000Z' });

  const rollUpdate = rollPool.calls.find((c) => /UPDATE source_observations/i.test(c.text));
  assert.ok(rollUpdate);
  const rolledPayload = JSON.parse(rollUpdate.params[2][0]);
  assert.equal('noticeExcerpt' in rolledPayload, false, 'roll-forward raw_payload must omit noticeExcerpt');
  assert.equal(rolledPayload.sourceUrl, 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683');
});

test('compactPgObservations batches raw_payload noticeExcerpt stripping, runs VACUUM FULL, and falls back to VACUUM ANALYZE on error', async () => {
  let slimCalls = 0;
  const fullPool = fakePool((text) => {
    if (/pg_total_relation_size/i.test(text)) {
      return { rows: [{ total_bytes: slimCalls === 0 ? 262900000 : 42000000 }], rowCount: 1 };
    }
    if (/SELECT id, listing_id/i.test(text)) {
      return { rows: [], rowCount: 0 };
    }
    if (/SET raw_payload = raw_payload - 'noticeExcerpt'/i.test(text)) {
      slimCalls += 1;
      return { rows: [], rowCount: slimCalls === 1 ? 2000 : 145 };
    }
    if (/VACUUM \(FULL, ANALYZE\) source_observations/i.test(text)) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  const report = await compactPgObservations(fullPool, {
    apply: true,
    slimPayloads: true,
    vacuumFull: true,
    source: 'civilview',
  });

  assert.equal(report.slimmedPayloads, 2145);
  assert.equal(report.vacuumMode, 'full');
  assert.equal(slimCalls, 2, 'must loop until batch rowCount < SLIM_BATCH (2000)');
  const slimQuery = fullPool.calls.find((c) => /SET raw_payload = raw_payload - 'noticeExcerpt'/.test(c.text));
  assert.ok(slimQuery);
  assert.deepEqual(slimQuery.params, ['civilview', 2000]);
  assert.ok(fullPool.calls.some((c) => c.text === 'VACUUM (FULL, ANALYZE) source_observations'));

  // Fallback test when VACUUM (FULL, ANALYZE) rejects (e.g. lock timeout or unsupported permission)
  const fallbackPool = fakePool((text) => {
    if (/SELECT id, listing_id/i.test(text)) return { rows: [], rowCount: 0 };
    if (/SET raw_payload = raw_payload - 'noticeExcerpt'/i.test(text)) return { rows: [], rowCount: 12 };
    if (/VACUUM \(FULL, ANALYZE\) source_observations/i.test(text)) {
      throw new Error('canceling statement due to lock timeout');
    }
    if (/VACUUM \(ANALYZE\) source_observations/i.test(text)) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  const fallbackReport = await compactPgObservations(fallbackPool, {
    apply: true,
    slimPayloads: true,
    vacuumFull: true,
  });

  assert.equal(fallbackReport.slimmedPayloads, 12);
  assert.equal(fallbackReport.vacuumMode, 'analyze');
  assert.ok(fallbackPool.calls.some((c) => c.text === 'VACUUM (FULL, ANALYZE) source_observations'));
  assert.ok(fallbackPool.calls.some((c) => c.text === 'VACUUM (ANALYZE) source_observations'));
});
