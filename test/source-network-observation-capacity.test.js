'use strict';

// test/source-network-observation-capacity.test.js
//
// Observation history lives in Postgres (migrations 025 + 027); the old
// bounded JSON store with its countdown-to-outage banner is gone. What an
// operator still needs on /sources and /api/health is the store's own facts —
// how much history exists, how fresh the newest observation is, how big the
// table is — and the page must never render "healthy" when the store could
// not be read at all.
//
// The claims below are split by what can actually fail:
//   - WIRING is asserted against source text, because source text is the only
//     thing that can prove a page renders a field at all.
//   - BEHAVIOUR is asserted by calling the code. A regex over the source passes
//     just as happily when the require path is wrong and a try/catch quietly
//     degrades the payload to null — which is exactly the failure this page
//     cannot afford, because a null report renders nothing and looks
//     identical to a healthy store.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const COVERAGE = fs.readFileSync(
  path.join(ROOT, 'server', 'sources', 'discovery-coverage.js'), 'utf8',
);
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const NETWORK_VIEW = fs.readFileSync(
  path.join(ROOT, 'src', 'components', 'sources', 'source-network.tsx'), 'utf8',
);

const { attachDiscoveryCoverage } = require(path.join(ROOT, 'server', 'sources', 'discovery-coverage.js'));
const { observationStoreStats } = require(path.join(ROOT, 'server', 'db', 'observations-persistence.js'));

// ---------------------------------------------------------------------------
// Detector: does this payload leak a filesystem path?
//
// The Postgres report has no reason to carry a path; if one ever sneaks in,
// it hands the OS username and deployment layout to any client of a public
// page. Self-tested against known cases, because a detector that never fires
// is indistinguishable from a clean payload.
// ---------------------------------------------------------------------------

function leaksFilesystemPath(value) {
  const json = JSON.stringify(value) || '';
  return /[A-Za-z]:\\\\/.test(json)
    || /"(?:\/Users\/|\/home\/[a-z]|\/root\/)/.test(json);
}

test('the path-leak detector fires on a real path and stays quiet on facts', () => {
  assert.ok(leaksFilesystemPath({ path: 'C:\\Users\\serge\\store.json' }),
    'detector missed a Windows path');
  assert.ok(leaksFilesystemPath({ p: '/home/serge/store.json' }),
    'detector missed a unix home path');
  assert.equal(leaksFilesystemPath({ sourceUrl: 'https://example.com/listing/12' }), false,
    'detector false-positives on an https URL');
  assert.equal(leaksFilesystemPath({ rows: 54358, tableBytes: 54358321 }), false,
    'detector false-positives on a plain numbers object');
});

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

test('the observation report carries the Postgres store facts', async () => {
  const pool = {
    async query(text) {
      return /FROM source_observations/.test(String(text))
        ? {
            rows: [{
              rows: 54358, tracked_records: 900,
              oldest_observed_at: new Date('2026-09-15T00:00:00.000Z'),
              newest_observed_at: new Date('2026-10-21T00:00:00.000Z'),
              table_bytes: 54358321,
            }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    },
  };
  const report = await observationStoreStats(pool);
  assert.ok(report, 'observationStoreStats degraded to null -- the page would render no '
    + 'facts and that is indistinguishable from a healthy store');
  assert.equal(report.store, 'postgres');
  assert.equal(typeof report.rows, 'number');
  assert.equal(typeof report.trackedRecords, 'number');
  assert.equal(report.newestObservedAt, '2026-10-21T00:00:00.000Z');
  assert.equal(report.willExceedCeiling, false, 'Postgres history has no file ceiling to hit');
  assert.equal(leaksFilesystemPath(report), false,
    'the report published over HTTP must not carry a filesystem path');
});

test('without Postgres the page reports no store rather than a fake healthy one', async () => {
  const payload = await attachDiscoveryCoverage({ sources: [], summary: {} }, { pool: null }, {});
  assert.equal(payload.observationStore, null,
    'there is no observation store without Postgres; inventing one would read as healthy');
  assert.equal(payload.storageMode, 'unavailable',
    'the retired demo storage mode must not come back');
});

test('a failed stats read still answers — degraded, not dead', async () => {
  const stats = await observationStoreStats({ async query() { throw new Error('connection refused'); } })
    .then(() => 'resolved', (error) => error);
  // observationStoreStats itself propagates; the page's try/catch degrades to
  // null. Pin the propagation so the route-level catch stays load-bearing.
  assert.ok(stats instanceof Error, 'the stats reader must not swallow query failures');
});

// ---------------------------------------------------------------------------
// Wiring -- source text is the only thing that can prove a page renders a field
// ---------------------------------------------------------------------------

test('the page renders the store facts rather than only fetching them', () => {
  assert.match(
    NETWORK_VIEW,
    /observationStore/,
    'an operator who has to open devtools to learn the store state '
      + 'has not been warned in any practical sense',
  );
  assert.match(
    NETWORK_VIEW,
    /newestObservedAt/,
    'the page must surface observation freshness — a full store of stale rows is not current coverage',
  );
});

test('staleness is the warning that renders before anything looks wrong', () => {
  // Rows alone prove storage, not collection. The actionable number is how
  // long since the newest observation.
  const block = NETWORK_VIEW.match(
    /newestObservedAt\)\) \/ 86_400_000[\s\S]{0,200}?<p/,
  );
  assert.ok(block, 'a days-since-last-observation warning must gate on freshness');
});

test('both endpoints publish the same Postgres-backed observation report', () => {
  // Two mirrored call sites: fixing one and not the other just moves the drift.
  for (const [name, source] of [['/api/source-network', COVERAGE], ['/api/health', SERVER]]) {
    assert.match(
      source,
      /observationStoreStats/,
      `${name} must publish the Postgres-backed observation facts`,
    );
    assert.doesNotMatch(
      source,
      /publicObservationStoreCapacity|loadObservations\(/,
      `${name} still references the retired file-store capacity API`,
    );
  }
});
