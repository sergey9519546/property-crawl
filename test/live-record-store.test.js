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

test('a complete source run retires records that disappeared from that source only', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-live-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'records.json');
  const civilviewA = record({ id: 'CIV-NJ-7-1001', sourceObservedAt: '2026-09-01T00:00:00Z' });
  const civilviewB = record({ id: 'CIV-NJ-7-1002', sourceObservedAt: '2026-09-01T00:00:00Z' });
  const otherSource = record({
    id: 'TREAS-NY-QUE-9001', source: 'treasury', sourceObservedAt: '2026-09-01T00:00:00Z',
    sourceUrl: 'https://www.treasury.gov/auctions/treasury/rp/9001.shtml',
    provenance: { origin: 'live', recordKind: 'source_record', observed: true, publisher: 'Treasury', recordId: '9001' },
  });
  assert.equal(mergeLiveRecords(target, [civilviewA, civilviewB, otherSource]).accepted, 3);

  // Complete civilview run sees only A (B disappeared). A stays, B is retired.
  // Other-source record is untouched because its source key is different.
  const result = mergeLiveRecords(target, [record({ id: 'CIV-NJ-7-1001', sourceObservedAt: '2026-09-08T00:00:00Z' })],
    { sourceKey: 'civilview', runCompleted: true });
  assert.equal(result.accepted, 1);
  assert.equal(result.retired, 1);
  const retained = loadLiveRecords(target);
  assert.deepEqual(retained.map((r) => r.id).sort(), ['CIV-NJ-7-1001', 'TREAS-NY-QUE-9001']);
});

test('a partial or failed run never retires records, even for the same source', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-live-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'records.json');
  const a = record({ id: 'CIV-NJ-7-2001', sourceObservedAt: '2026-09-01T00:00:00Z' });
  const b = record({ id: 'CIV-NJ-7-2002', sourceObservedAt: '2026-09-01T00:00:00Z' });
  assert.equal(mergeLiveRecords(target, [a, b]).accepted, 2);

  // No runCompleted flag — defensive default: do not retire.
  const noFlag = mergeLiveRecords(target, [record({ id: 'CIV-NJ-7-2001', sourceObservedAt: '2026-09-08T00:00:00Z' })],
    { sourceKey: 'civilview' });
  assert.equal(noFlag.retired, 0);
  assert.equal(loadLiveRecords(target).length, 2);

  // runCompleted: false — explicit partial: do not retire.
  const partial = mergeLiveRecords(target, [record({ id: 'CIV-NJ-7-2001', sourceObservedAt: '2026-09-08T00:00:00Z' })],
    { sourceKey: 'civilview', runCompleted: false });
  assert.equal(partial.retired, 0);
  assert.equal(loadLiveRecords(target).length, 2);

  // runCompleted: true but no sourceKey — do not retire (no scope).
  const noScope = mergeLiveRecords(target, [record({ id: 'CIV-NJ-7-2001', sourceObservedAt: '2026-09-08T00:00:00Z' })],
    { runCompleted: true });
  assert.equal(noScope.retired, 0);
  assert.equal(loadLiveRecords(target).length, 2);
});
