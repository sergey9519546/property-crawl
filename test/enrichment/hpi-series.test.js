'use strict';

// Observed HPI quarterly-series loader contract (operator-supplied file).
//
// Positive: a valid series loads, integrates with server/enrichment/hpi.js
// (getLatestObservedPeriod / getHpiIndex / getAppreciationMultiplier), follows
// the FHFA_HPI_SERIES_PATH env override, and re-reads after invalidation.
// Negative (all fail closed to null): missing file, malformed JSON, non-fhfa
// or http sourceUrl, bad datasetSha256, version != 1, empty values, national
// aggregate 'US' / lowercase state keys, non-quarter period keys, and
// zero/negative/non-numeric values.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hpi = require('../../server/enrichment/hpi');
const {
  SERIES_PATH_ENV,
  DEFAULT_SERIES_PATH,
  loadObservedHpiSeries,
  invalidateHpiSeriesCache,
} = require('../../server/enrichment/hpi-series');

const VALID_SERIES = {
  version: 1,
  sourceUrl: 'https://www.fhfa.gov/data/hpi',
  retrievedAt: '2026-10-30T00:00:00.000Z',
  datasetSha256: 'a'.repeat(64),
  values: { FL: { '2020Q2': 300, '2026Q1': 450 } },
};

function writeTempSeries(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hpi-series-'));
  const file = path.join(dir, 'fhfa-hpi-series.json');
  fs.writeFileSync(file, typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8');
  return { dir, file };
}

function withSeriesPath(file, fn) {
  const original = process.env[SERIES_PATH_ENV];
  process.env[SERIES_PATH_ENV] = file;
  invalidateHpiSeriesCache();
  try {
    fn();
  } finally {
    if (original === undefined) delete process.env[SERIES_PATH_ENV];
    else process.env[SERIES_PATH_ENV] = original;
    invalidateHpiSeriesCache();
  }
}

test('a valid observed series loads and integrates with the hpi.js contract', () => {
  const { file } = writeTempSeries(VALID_SERIES);
  withSeriesPath(file, () => {
    const series = loadObservedHpiSeries();
    assert.ok(series, 'a valid series must load');
    assert.equal(hpi.isObservedSeries(series), true);
    assert.equal(hpi.getLatestObservedPeriod(series), '2026Q1');
    assert.equal(hpi.getHpiIndex('FL', '2020Q2', series), 300);
    assert.equal(hpi.getAppreciationMultiplier('FL', '2020Q2', '2026Q1', series), 1.5);
  });
});

test('a missing series file fails closed to null', () => {
  const { file } = writeTempSeries(VALID_SERIES);
  const missing = path.join(path.dirname(file), 'absent.json');
  withSeriesPath(missing, () => {
    assert.equal(loadObservedHpiSeries(), null);
  });
});

test('malformed JSON fails closed to null', () => {
  const { file } = writeTempSeries('{not json');
  withSeriesPath(file, () => {
    assert.equal(loadObservedHpiSeries(), null);
  });
});

test('provenance failures fail closed to null', () => {
  const cases = [
    { ...VALID_SERIES, sourceUrl: 'https://example.gov/data/hpi' },
    { ...VALID_SERIES, sourceUrl: 'http://www.fhfa.gov/data/hpi' },
    { ...VALID_SERIES, datasetSha256: 'not-a-sha' },
    { ...VALID_SERIES, version: 2 },
  ];
  for (const payload of cases) {
    const { file } = writeTempSeries(payload);
    withSeriesPath(file, () => {
      assert.equal(loadObservedHpiSeries(), null, JSON.stringify(payload.sourceUrl || payload.datasetSha256 || payload.version));
    });
  }
});

test('invalid values shapes fail closed to null', () => {
  const cases = [
    { ...VALID_SERIES, values: {} },
    { ...VALID_SERIES, values: { US: { '2026Q1': 450 } } },
    { ...VALID_SERIES, values: { fl: { '2026Q1': 450 } } },
    { ...VALID_SERIES, values: { FL: { '2026-01': 450 } } },
    { ...VALID_SERIES, values: { FL: { '2026Q1': 0 } } },
    { ...VALID_SERIES, values: { FL: { '2026Q1': -12 } } },
    { ...VALID_SERIES, values: { FL: { '2026Q1': '450' } } },
    { ...VALID_SERIES, values: { FL: {} } },
  ];
  for (const payload of cases) {
    const { file } = writeTempSeries(payload);
    withSeriesPath(file, () => {
      assert.equal(loadObservedHpiSeries(), null, Object.keys(payload.values)[0]);
    });
  }
});

test('the loader follows the FHFA_HPI_SERIES_PATH env override', () => {
  const a = writeTempSeries(VALID_SERIES);
  const b = writeTempSeries({ ...VALID_SERIES, values: { OH: { '2018Q2': 275.8, '2026Q1': 494.5 } } });
  try {
    withSeriesPath(a.file, () => {
      assert.equal(loadObservedHpiSeries().values.FL['2026Q1'], 450);
    });
    withSeriesPath(b.file, () => {
      const series = loadObservedHpiSeries();
      assert.equal(series.values.OH['2018Q2'], 275.8);
      assert.equal(series.values.FL, undefined);
    });
  } finally {
    fs.rmSync(a.dir, { recursive: true, force: true });
    fs.rmSync(b.dir, { recursive: true, force: true });
  }
});

test('invalidation forces a re-read from disk', () => {
  const { dir, file } = writeTempSeries(VALID_SERIES);
  withSeriesPath(file, () => {
    assert.equal(loadObservedHpiSeries().values.FL['2026Q1'], 450);
    fs.writeFileSync(file, JSON.stringify({ ...VALID_SERIES, values: { FL: { '2020Q2': 300, '2026Q1': 460 } } }), 'utf8');
    // Cached: still the old value inside the TTL window.
    assert.equal(loadObservedHpiSeries().values.FL['2026Q1'], 450);
    invalidateHpiSeriesCache();
    assert.equal(loadObservedHpiSeries().values.FL['2026Q1'], 460);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the default path is the .cache drop location and the env var name is stable', () => {
  assert.equal(SERIES_PATH_ENV, 'FHFA_HPI_SERIES_PATH');
  assert.equal(path.basename(DEFAULT_SERIES_PATH), 'fhfa-hpi-series.json');
  assert.equal(path.basename(path.dirname(DEFAULT_SERIES_PATH)), '.cache');
});
