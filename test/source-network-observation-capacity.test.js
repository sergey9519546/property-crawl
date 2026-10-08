'use strict';

// test/source-network-observation-capacity.test.js
//
// /api/health reports the observation store's capacity, and an operator who
// needs to act on it is looking at /sources -- not at a JSON endpoint. The
// Source Radar page is where a collector would notice that change detection
// has gone quiet, so that is where the warning belongs.
//
// Without it, the page keeps rendering as though nothing were wrong right up
// until loadObservations starts throwing and every source flips to
// history_unavailable.
//
// The claims below are split by what can actually fail:
//   - WIRING is asserted against source text, because source text is the only
//     thing that can prove a page renders a field at all.
//   - BEHAVIOUR is asserted by calling the code. A regex over the source passes
//     just as happily when the require path is wrong and the try/catch quietly
//     degrades the payload to null -- which is exactly the failure this page
//     cannot afford, because a null capacity renders nothing and looks
//     identical to a healthy store.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
const observations = require(path.join(ROOT, 'server', 'sources', 'observations.js'));

// ---------------------------------------------------------------------------
// Detector: does this payload carry a filesystem path?
//
// A payload leaks when it contains a Windows drive designator or an absolute
// unix home path. Self-tested against known cases below, because a detector
// that never fires is indistinguishable from a clean payload and one that
// always fires makes the assertion worthless.
// ---------------------------------------------------------------------------

function leaksFilesystemPath(value) {
  const json = JSON.stringify(value) || '';
  return /[A-Za-z]:\\\\/.test(json)
    || /"(?:\/Users\/|\/home\/[a-z]|\/root\/)/.test(json);
}

test('the path-leak detector fires on a real path and stays quiet on URLs', () => {
  // Known positives -- if these do not fire, the assertion below proves nothing.
  assert.ok(leaksFilesystemPath({ path: 'C:\\Users\\serge\\store.json' }),
    'detector missed a Windows path');
  assert.ok(leaksFilesystemPath({ p: '/home/serge/store.json' }),
    'detector missed a unix home path');
  assert.ok(leaksFilesystemPath({ sourceUrl: 'C:\\cache\\x.json' }),
    'detector missed a path nested in another field');

  // Known negatives -- https URLs contain slashes but are not filesystem paths.
  assert.equal(leaksFilesystemPath({ sourceUrl: 'https://example.com/listing/12' }), false,
    'detector false-positives on an https URL');
  assert.equal(leaksFilesystemPath({ note: 'see /home page in the docs' }), false,
    'detector false-positives on prose mentioning /home');
  assert.equal(leaksFilesystemPath({ bytes: 54358321, usedFraction: 0.81 }), false,
    'detector false-positives on a plain numbers object');
});

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

test('the Source Radar payload actually carries a measured capacity', async () => {
  // Calling the real thing. The previous version of this file only grepped the
  // source, which passes identically when require('./observations') resolves to
  // nothing and the catch swallows it -- the page then renders no warning and
  // reports nothing wrong.
  const payload = await attachDiscoveryCoverage({ sources: [], summary: {} }, { pool: null }, {});
  assert.ok(payload.observationStore,
    'attachDiscoveryCoverage degraded observationStore to null -- the page would '
      + 'render no warning and that is indistinguishable from a healthy store');
  assert.equal(typeof payload.observationStore.bytes, 'number');
  assert.equal(typeof payload.observationStore.capBytes, 'number');
  assert.equal(payload.observationStore.bytes, payload.observationStore.capBytes - payload.observationStore.headroomBytes,
    'bytes, cap and headroom must describe the same store');
});

test('neither public payload leaks the server filesystem path', async () => {
  // path was fine inside the process -- it is useful in a log line and in
  // tests -- but these two objects go straight to any client that can reach the
  // API, and one of them (/sources) is the public page. It carries the OS
  // username and the full deployment layout for no benefit to the reader.
  const payload = await attachDiscoveryCoverage({ sources: [], summary: {} }, { pool: null }, {});
  assert.equal(leaksFilesystemPath(payload.observationStore), false,
    'the Source Radar payload must not carry a filesystem path');

  const publicCapacity = observations.publicObservationStoreCapacity();
  assert.equal(leaksFilesystemPath(publicCapacity), false,
    'the capacity published over HTTP must not carry a filesystem path');
  assert.equal('path' in publicCapacity, false,
    'path is useful internally and has no business on the wire');
});

test('the measured store path is still available internally', () => {
  // Stripping it from the wire must not delete it from the measurement: the
  // number is only meaningful next to the file it was read from.
  const internal = observations.observationStoreCapacity();
  assert.equal(typeof internal.path, 'string');
  assert.ok(path.isAbsolute(internal.path), 'the internal capacity must still name an absolute file');
});

test('a store that does not exist yet reports full headroom, not a crash', () => {
  const missing = observations.publicObservationStoreCapacity({
    filePath: path.join(os.tmpdir(), 'pc-no-such-observations-store.json'),
  });
  assert.equal(missing.exists, false);
  assert.equal(missing.bytes, 0);
  assert.equal(missing.headroomBytes, missing.capBytes, 'an empty store has its full ceiling left');
  assert.equal(missing.estimatedDaysRemaining, null,
    'no measurements means no rate to project from -- not zero days');
  assert.equal(missing.willExceedCeiling, false);
  assert.equal('path' in missing, false, 'the missing-store branch must not leak a path either');
});

test('a readable store measures its rate from when records first appeared', () => {
  // Using runs[*].lastRunAt understates the runway by about half: sources enroll
  // progressively, so run timestamps start well after the store began filling.
  // Under-reporting headroom pushes people to prune early.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-obs-'));
  const file = path.join(dir, 'store.json');
  const base = Date.parse('2026-09-01T00:00:00.000Z');
  const records = {};
  const runs = {};
  for (let i = 0; i < 40; i += 1) {
    records[`r${i}`] = { firstObservedAt: new Date(base + i * 86_400_000).toISOString() };
    runs[`r${i}`] = { lastRunAt: new Date(base + 30 * 86_400_000 + i * 3_600_000).toISOString() };
  }
  fs.writeFileSync(file, JSON.stringify({ version: 1, runs, records, signals: [] }));

  const capacity = observations.observationStoreCapacity({ filePath: file });
  assert.equal(typeof capacity.bytesPerDay, 'number');
  assert.ok(capacity.bytesPerDay > 0, 'a populated store must yield a growth rate');

  // A store whose records span 39 days but whose runs span 29 late days must
  // report the 39-day rate. If this ever regresses to run timestamps the
  // runway roughly halves, which reads as "prune now" when it is not.
  const spanFromRecords = 39;
  const expectedBytesPerDay = capacity.bytes / spanFromRecords;
  const tolerance = expectedBytesPerDay * 0.25;
  assert.ok(
    Math.abs(capacity.bytesPerDay - expectedBytesPerDay) <= tolerance,
    `bytesPerDay ${capacity.bytesPerDay} implies a ${(capacity.bytes / capacity.bytesPerDay).toFixed(1)}-day `
      + `span; the records span ${spanFromRecords} days, so the rate was taken from run timestamps`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Wiring -- source text is the only thing that can prove a page renders a field
// ---------------------------------------------------------------------------

test('the page renders the capacity rather than only fetching it', () => {
  assert.match(
    NETWORK_VIEW,
    /observationStore/,
    'an operator who has to open devtools to learn the store is nearly full '
      + 'has not been warned in any practical sense',
  );
  assert.match(
    NETWORK_VIEW,
    /estimatedDaysRemaining|headroomBytes|willExceedCeiling/,
    'the page must name the number that tells you when to act, not just bytes',
  );
});

test('the warning is visible before the store is full, not only at the ceiling', () => {
  // willExceedCeiling only flips once the store is already over MAX_BYTES, at
  // which point loadObservations throws and every source here reads
  // history_unavailable. The runway is the actionable number, so it has to be
  // the gate on rendering -- not the ceiling being breached.
  const block = NETWORK_VIEW.match(
    /\{data\?\.observationStore\?\.estimatedDaysRemaining[\s\S]{0,240}?<p\b/,
  );
  assert.ok(block, 'the runway must be the condition that decides whether the warning renders');
  assert.doesNotMatch(
    block[0],
    /willExceedCeiling/,
    'the runway warning must not be gated on the ceiling already being exceeded, '
      + 'which is the state where it is too late to act',
  );
});

test('both endpoints publish the same path-free capacity', () => {
  // Two mirrored call sites: fixing one and not the other just moves the leak.
  for (const [name, source] of [['/api/source-network', COVERAGE], ['/api/health', SERVER]]) {
    assert.match(
      source,
      /publicObservationStoreCapacity/,
      `${name} must publish the wire-safe capacity, not the internal one carrying the file path`,
    );
    assert.doesNotMatch(
      source,
      /\(\s*\)\s*=>\s*\{\s*observationStore:\s*observationStoreCapacity\(/,
      `${name} still publishes the internal capacity directly`,
    );
  }
});