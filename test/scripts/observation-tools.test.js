'use strict';

// test/scripts/observation-tools.test.js
//
// Unit coverage for the two observation-pipeline CLI tools that the Postgres
// cutover introduced: the one-time legacy-store import and the triage
// resolution measurement. The database-touching paths are exercised by the
// mock-pool suites and the live-PG round-trip; what is unit-tested here is
// the argument surface and the legacy-store reading logic, because a wrong
// default path or a silently ignored flag would import (or measure) the
// wrong thing without any error.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const importer = require('../../scripts/import-observation-store');
const measure = require('../../scripts/measure-triage-resolution');

const temporaryDirectories = [];
function temporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-observation-tools-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'observations.json');
}

afterEach(() => {
  while (temporaryDirectories.length) {
    const target = temporaryDirectories.pop();
    if (target.startsWith(os.tmpdir())) fs.rmSync(target, { recursive: true, force: true });
  }
});

test('import argument parsing: --dry-run and --store, unknown flags rejected', () => {
  assert.deepEqual(importer.parseArgs([]), { dryRun: false, storePath: importer.parseArgs([]).storePath });
  const parsed = importer.parseArgs(['--dry-run', '--store', 'X:\\legacy.json']);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.storePath, 'X:\\legacy.json');
  assert.throws(() => importer.parseArgs(['--apply']), /Unknown option/);
});

test('import store reading: rejects unrecognized shapes, accepts version 1', () => {
  const missing = importer.readLegacyStore(path.join(os.tmpdir(), 'no-such-observation-store.json'));
  assert.equal(missing, null, 'an absent legacy store means nothing to import');
  const file = temporaryStore();
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => importer.readLegacyStore(file), SyntaxError);
  fs.writeFileSync(file, JSON.stringify({ version: 2, records: {} }));
  assert.throws(() => importer.readLegacyStore(file), /Unrecognized/);
  fs.writeFileSync(file, JSON.stringify({ version: 1, runs: {}, records: { r1: { latest: { source: 'hud', recordId: '1', observedAt: '2026-01-01T00:00:00.000Z' } } } }));
  const store = importer.readLegacyStore(file);
  assert.equal(importer.snapshotsForRecord(store.records.r1).length, 1);
});

test('import snapshot extraction: latest plus history, malformed entries dropped', () => {
  const snapshots = importer.snapshotsForRecord({
    history: [
      { source: 'hud', recordId: '1', observedAt: '2026-01-01T00:00:00.000Z' },
      { source: 'hud', recordId: '1' }, // no observedAt — unusable
      null,
    ],
    latest: { source: 'hud', recordId: '1', observedAt: '2026-02-01T00:00:00.000Z' },
  });
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].observedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(snapshots.at(-1).observedAt, '2026-02-01T00:00:00.000Z');
});

test('measure argument parsing: --limit and --json, unknown flags rejected', () => {
  assert.deepEqual(measure.parseArgs([]), { limit: 0, json: false });
  assert.deepEqual(measure.parseArgs(['--limit', '25', '--json']), { limit: 25, json: true });
  assert.throws(() => measure.parseArgs(['--csv']), /Unknown option/);
});

test('measure ratio buckets cover the evaluator evidence classes', () => {
  assert.deepEqual(Object.keys(measure.emptyBuckets()).sort(), ['calculated_ratio', 'macro_housing_index', 'official_parcel_roll']);
});
