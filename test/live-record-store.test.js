const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadLiveRecords, mergeLiveRecords } = require('../server/db/live-record-store');
const { parseOptions } = require('../scripts/collect-source');

test('collection CLI enforces finite coverage bounds and explicit options', () => {
  assert.deepEqual(parseOptions(['--state', 'PA', '--counties', '3', '--limit', '36', '--new-first']), { targetState: 'PA', maxCounties: 3, maxDetailPages: 36, newFirst: true });
  for (const args of [['--limit', '121'], ['--counties', '0'], ['--state', 'all'], ['--limit'], ['--force']]) assert.throws(() => parseOptions(args));
});

test('concurrent writers fail safely without altering another writer lock or records', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-live-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'records.json');
  fs.writeFileSync(target + '.lock', 'another writer');
  assert.throws(() => mergeLiveRecords(target, [record()]), /locked by another writer/);
  assert.equal(fs.readFileSync(target + '.lock', 'utf8'), 'another writer');
  assert.equal(fs.existsSync(target), false);
});

function record(overrides = {}) {
  return {
    id: 'CIV-NJ-7-1234', source: 'civilview', state: 'NJ',
    address: '19 West Park Avenue, Park Ridge, NJ 07656',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=1234',
    raw: 'Published sale record for 19 West Park Avenue.',
    sourceObservedAt: '2026-09-04T12:00:00Z',
    provenance: { origin: 'live', recordKind: 'source_record', observed: true, publisher: 'CivilView', recordId: '1234' },
    ...overrides,
  };
}

test('durable live store survives reload and does not accept fixtures or older observations', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-live-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'records.json');
  assert.deepEqual(loadLiveRecords(target), []);
  assert.equal(mergeLiveRecords(target, [record()]).accepted, 1);
  assert.equal(loadLiveRecords(target).length, 1);
  assert.equal(mergeLiveRecords(target, [record({ sourceObservedAt: '2026-01-01T00:00:00Z' })]).accepted, 0);
  assert.equal(loadLiveRecords(target)[0].sourceObservedAt, '2026-09-04T12:00:00Z');
  assert.equal(mergeLiveRecords(target, [record({ provenance: { fixture: true } })]).rejected, 1);
  assert.equal(loadLiveRecords(target).length, 1);
  assert.deepEqual(fs.readdirSync(directory), ['records.json']);
});

test('a corrupt live store is never silently overwritten', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-live-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'records.json');
  fs.writeFileSync(target, '{incomplete');
  assert.throws(() => mergeLiveRecords(target, [record()]));
  assert.equal(fs.readFileSync(target, 'utf8'), '{incomplete');
});
