const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  loadObservations,
  recordSourceRun,
  updateObservations,
} = require('../server/sources/observations');

const temporaryDirectories = [];
const NOW = '2026-09-05T18:00:00.000Z';

function emptyObservations() {
  return { version: 1, runs: {}, records: {}, signals: [] };
}

function listing(overrides = {}) {
  const observedAt = overrides.sourceObservedAt || '2026-09-05T17:00:00.000Z';
  return {
    id: 'CIV-NJ-7-2128964683',
    source: 'civilview',
    state: 'NJ',
    county: 'Bergen',
    city: 'Park Ridge',
    zip: '07656',
    address: '19 West Park Avenue, Park Ridge, NJ 07656',
    openingBid: 100000,
    saleDate: '2026-10-01',
    status: 'scheduled',
    deposit: 5000,
    raw: 'Official CivilView source record for sheriff sale 2128964683.',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    sourceObservedAt: observedAt,
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record',
      publisher: 'CivilView', recordId: '2128964683', observedAt,
    },
    ...overrides,
  };
}

afterEach(() => {
  while (temporaryDirectories.length) {
    const target = temporaryDirectories.pop();
    if (target.startsWith(os.tmpdir())) fs.rmSync(target, { recursive: true, force: true });
  }
});

test('observations reject fixtures and future captures rather than treating them as inventory', () => {
  const data = emptyObservations();
  const fixture = listing({
    id: 'CIV-FIXTURE-1',
    provenance: { origin: 'fixture', observed: false, fixture: true, publisher: 'Fixture', recordId: 'fixture-1' },
  });
  const future = listing({ id: 'CIV-FUTURE-1', sourceObservedAt: '2026-09-06T18:00:00.000Z' });
  future.provenance = { ...future.provenance, recordId: 'future-1', observedAt: future.sourceObservedAt };

  const result = updateObservations(data, 'civilview', {
    listings: [fixture, future], error: null, rejectedCount: 0, durationMs: 10,
  }, { now: NOW });

  assert.equal(result.accepted, 0);
  assert.equal(data.runs.civilview.acceptedCount, 0);
  assert.equal(data.runs.civilview.rejectedCount, 2);
  assert.equal(Object.keys(data.records).length, 0);
});

test('out-of-order and duplicate captures cannot refresh source freshness or overwrite latest evidence', () => {
  const data = emptyObservations();
  updateObservations(data, 'civilview', { listings: [listing()], error: null }, { now: NOW });
  const original = Object.values(data.records)[0].latest;
  const stale = listing({ sourceObservedAt: '2026-09-05T16:00:00.000Z', openingBid: 50000 });
  stale.provenance = { ...stale.provenance, observedAt: stale.sourceObservedAt };

  const staleResult = updateObservations(data, 'civilview', { listings: [stale], error: null }, { now: NOW });
  assert.equal(staleResult.accepted, 0);
  assert.equal(data.runs.civilview.acceptedCount, 0);
  assert.equal(data.runs.civilview.rejectedCount, 1);
  assert.deepEqual(Object.values(data.records)[0].latest, original);

  const duplicateResult = updateObservations(data, 'civilview', { listings: [listing()], error: null }, { now: NOW });
  assert.equal(duplicateResult.accepted, 0);
  assert.equal(duplicateResult.newSignals, 0);
  assert.equal(Object.values(data.records)[0].observations, 1);
});

test('a published bid reduction creates one deduplicated signal with both exact evidence points', () => {
  const data = emptyObservations();
  updateObservations(data, 'civilview', { listings: [listing()], error: null }, { now: NOW });
  const reduced = listing({ sourceObservedAt: '2026-09-05T17:30:00.000Z', openingBid: 90000 });
  reduced.provenance = { ...reduced.provenance, observedAt: reduced.sourceObservedAt };

  const first = updateObservations(data, 'civilview', { listings: [reduced], error: null }, { now: NOW });
  const repeated = updateObservations(data, 'civilview', { listings: [reduced], error: null }, { now: NOW });

  assert.equal(first.newSignals, 1);
  assert.equal(repeated.newSignals, 0);
  assert.equal(data.signals.length, 1);
  assert.equal(data.signals[0].kind, 'bid_reduced');
  assert.equal(data.signals[0].before, 100000);
  assert.equal(data.signals[0].after, 90000);
  assert.deepEqual(data.signals[0].evidence.map((item) => item.sourceUrl), [listing().sourceUrl, reduced.sourceUrl]);
});

test('failed and empty runs preserve records without inventing disappearance or sold signals', () => {
  const data = emptyObservations();
  updateObservations(data, 'civilview', { listings: [listing()], error: null }, { now: NOW });

  updateObservations(data, 'civilview', { listings: [], error: 'WAF challenge', rejectedCount: 0 }, {
    now: '2026-09-05T18:10:00.000Z',
  });
  assert.equal(data.runs.civilview.error, 'WAF challenge');
  assert.equal(data.runs.civilview.lastSuccessAt, NOW);
  assert.equal(data.signals.length, 0);
  assert.equal(Object.keys(data.records).length, 1);

  updateObservations(data, 'civilview', { listings: [], error: null, rejectedCount: 0 }, {
    now: '2026-09-05T18:20:00.000Z',
  });
  assert.equal(data.runs.civilview.error, null);
  assert.equal(data.runs.civilview.acceptedCount, 0);
  assert.equal(data.signals.length, 0);
  assert.equal(Object.keys(data.records).length, 1);
});

test('recordSourceRun persists an atomic observation history', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-source-observations-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'observations.json');

  recordSourceRun('civilview', { listings: [listing()], error: null, durationMs: 12 }, { filePath, now: NOW });
  const stored = loadObservations({ filePath });
  assert.equal(stored.runs.civilview.acceptedCount, 1);
  assert.equal(Object.keys(stored.records).length, 1);
  assert.equal(fs.existsSync(`${filePath}.lock`), false);
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith('.tmp')), false);
});
