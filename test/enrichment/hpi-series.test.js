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
const crypto = require('node:crypto');

const hpi = require('../../server/enrichment/hpi');
const {
  SERIES_PATH_ENV,
  DEFAULT_SERIES_PATH,
  loadObservedHpiSeries,
  invalidateHpiSeriesCache,
} = require('../../server/enrichment/hpi-series');
const {
  buildHpiSeriesSnapshot,
  ingestHpiSeries,
} = require('../../scripts/ingest-fhfa-hpi');

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

// --- Zero-Fabrication Versioned State-Quarter Series Validation & Helpers ---

test('quarter ordering helpers: compareQuarters, areQuartersChronological, sortQuarters', () => {
  // compareQuarters
  assert.equal(hpi.compareQuarters('2020Q1', '2020Q2') < 0, true);
  assert.equal(hpi.compareQuarters('2020Q2', '2020Q1') > 0, true);
  assert.equal(hpi.compareQuarters('2024Q3', '2024Q3'), 0);
  assert.equal(hpi.compareQuarters('2020Q4', '2021Q1') < 0, true);
  assert.equal(hpi.compareQuarters('invalid', '2020Q1'), null);
  assert.equal(hpi.compareQuarters('2020Q1', null), null);

  // areQuartersChronological
  assert.equal(hpi.areQuartersChronological(['2018Q1', '2020Q2', '2024Q4', '2026Q1']), true);
  assert.equal(hpi.areQuartersChronological(['2026Q1', '2020Q2']), false);
  assert.equal(hpi.areQuartersChronological(['2020Q2', '2020Q2'], { strictlyAscending: true }), false);
  assert.equal(hpi.areQuartersChronological(['2020Q2', '2020Q2'], { strictlyAscending: false }), true);
  assert.equal(hpi.areQuartersChronological([]), false);
  assert.equal(hpi.areQuartersChronological(['2020Q1', 'not-a-quarter']), false);

  // sortQuarters
  const unsorted = ['2026Q1', '2019Q4', '2020Q2', '2023Q3', 'bogus'];
  assert.deepEqual(hpi.sortQuarters(unsorted), ['2019Q4', '2020Q2', '2023Q3', '2026Q1']);
});

test('validateStateQuarterSeries: verifies full contract including sha256 and chronological keys', () => {
  assert.equal(hpi.validateStateQuarterSeries(VALID_SERIES), true);
  assert.equal(hpi.validateStateQuarterSeries(null), false);
  assert.equal(hpi.validateStateQuarterSeries(undefined), false);

  // requireChronologicalKeys option
  const chronological = {
    ...VALID_SERIES,
    values: { FL: { '2020Q1': 200, '2020Q2': 210, '2026Q1': 450 } },
  };
  assert.equal(hpi.validateStateQuarterSeries(chronological, { requireChronologicalKeys: true }), true);

  // Sha256 digest verification when rawJson is embedded
  const rawPayload = JSON.stringify({ FL: { '2020Q2': 300, '2026Q1': 450 } });
  const rawSha = crypto.createHash('sha256').update(rawPayload, 'utf8').digest('hex');
  const embeddedSeries = {
    ...VALID_SERIES,
    datasetSha256: rawSha,
    rawJson: rawPayload,
  };
  assert.equal(hpi.validateStateQuarterSeries(embeddedSeries), true);

  // Tampered rawJson fails closed
  const tamperedSeries = {
    ...embeddedSeries,
    rawJson: rawPayload + ' tampered',
  };
  assert.equal(hpi.validateStateQuarterSeries(tamperedSeries), false);
});

test('scripts/ingest-fhfa-hpi.js: buildHpiSeriesSnapshot constructs valid versioned snapshot with sha256', () => {
  const values = { OH: { '2021Q1': 250.5, '2026Q1': 350.2 } };
  const snapshot = buildHpiSeriesSnapshot({
    sourceUrl: 'https://www.fhfa.gov/data/hpi',
    retrievedAt: '2026-11-09T00:00:00.000Z',
    values,
  });

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.sourceUrl, 'https://www.fhfa.gov/data/hpi');
  assert.ok(/^[a-f0-9]{64}$/i.test(snapshot.datasetSha256));
  assert.equal(hpi.validateStateQuarterSeries(snapshot), true);
});

test('scripts/ingest-fhfa-hpi.js: ingestHpiSeries normalizes quarters chronologically and verifies digest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hpi-ingest-test-'));
  const srcFile = path.join(dir, 'input-series.json');
  const outFile = path.join(dir, 'output-series.json');

  // Input series with unordered quarter keys
  const inputSeries = {
    version: 1,
    sourceUrl: 'https://www.fhfa.gov/data/hpi',
    retrievedAt: '2026-11-09T00:00:00.000Z',
    values: {
      FL: { '2026Q1': 450, '2020Q2': 300, '2022Q4': 380 },
    },
  };
  fs.writeFileSync(srcFile, JSON.stringify(inputSeries), 'utf8');

  try {
    const ingested = ingestHpiSeries({ seriesFile: srcFile, outPath: outFile });
    assert.ok(ingested);
    assert.equal(ingested.version, 1);
    assert.ok(fs.existsSync(outFile));

    // Verify quarters were ordered chronologically
    const writtenKeys = Object.keys(ingested.values.FL);
    assert.deepEqual(writtenKeys, ['2020Q2', '2022Q4', '2026Q1']);

    // Verify sha256 matches written rawJson
    const expectedSha = crypto.createHash('sha256').update(ingested.rawJson, 'utf8').digest('hex');
    assert.equal(ingested.datasetSha256, expectedSha);

    // Verify it passes validateStateQuarterSeries
    assert.equal(hpi.validateStateQuarterSeries(ingested), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scripts/ingest-fhfa-hpi.js: ingestHpiSeries fails closed on missing file or invalid series', () => {
  assert.throws(
    () => ingestHpiSeries({ seriesFile: 'C:/nonexistent/file.json' }),
    /Series source file not found/
  );

  assert.throws(
    () => ingestHpiSeries({}),
    /No series data or file supplied/
  );

  // Invalid state code 'US'
  assert.throws(
    () => ingestHpiSeries({
      seriesData: {
        version: 1,
        sourceUrl: 'https://www.fhfa.gov/data/hpi',
        retrievedAt: '2026-11-09T00:00:00.000Z',
        values: { US: { '2026Q1': 450 } },
      },
    }),
    /Series validation failed/
  );

  // Non-quarter period key
  assert.throws(
    () => ingestHpiSeries({
      seriesData: {
        version: 1,
        sourceUrl: 'https://www.fhfa.gov/data/hpi',
        retrievedAt: '2026-11-09T00:00:00.000Z',
        values: { FL: { '2026-01': 450 } },
      },
    }),
    /Non-chronological or invalid quarter keys/
  );
});

test('loadObservedHpiSeries fails closed to null when quarter keys are unchronological', () => {
  const unchronological = {
    ...VALID_SERIES,
    values: {
      FL: { '2026Q1': 450, '2020Q2': 300 },
    },
  };
  const { file } = writeTempSeries(unchronological);
  withSeriesPath(file, () => {
    assert.equal(loadObservedHpiSeries(), null, 'unchronological quarter keys must fail closed');
  });
});

test('loadObservedHpiSeries fails closed to null when embedded rawJson does not match datasetSha256', () => {
  const rawPayload = JSON.stringify({ test: 'tampered' });
  const tamperedSeries = {
    ...VALID_SERIES,
    datasetSha256: crypto.createHash('sha256').update('original', 'utf8').digest('hex'),
    rawJson: rawPayload,
  };
  const { file } = writeTempSeries(tamperedSeries);
  withSeriesPath(file, () => {
    assert.equal(loadObservedHpiSeries(), null, 'tampered rawJson payload must fail closed');
  });
});

test('scripts/ingest-fhfa-hpi.js: parseFhfaQuarterlySeriesCsv parses multi-quarter state CSV and ingestHpiSeries accepts CSV input', () => {
  const { parseFhfaQuarterlySeriesCsv, ingestHpiSeries } = require('../../scripts/ingest-fhfa-hpi');
  const csvData = [
    'state,year,quarter,index_nsa',
    'OH,2020,1,200.0',
    'OH,2024,4,280.0',
    'NJ,2020,1,300.0',
    'NJ,2024,4,420.0',
  ].join('\n');

  const parsed = parseFhfaQuarterlySeriesCsv(csvData);
  assert.equal(typeof parsed.datasetSha256, 'string');
  assert.equal(parsed.datasetSha256.length, 64);
  assert.equal(parsed.values.OH['2020Q1'], 200.0);
  assert.equal(parsed.values.OH['2024Q4'], 280.0);
  assert.equal(parsed.values.NJ['2020Q1'], 300.0);
  assert.equal(parsed.values.NJ['2024Q4'], 420.0);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hpi-csv-test-'));
  const outJson = path.join(tmpDir, 'output.json');
  try {
    const ingested = ingestHpiSeries({ rawText: csvData, outPath: outJson });
    assert.equal(ingested.values.OH['2024Q4'], 280.0);
    assert.equal(fs.existsSync(outJson), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computePublicBenchmarkConsensus auto-loads observed series and respects explicit null override', () => {
  const { computePublicBenchmarkConsensus } = require('../../server/enrichment/public-benchmark-consensus');
  const { file, dir } = writeTempSeries(VALID_SERIES);
  try {
    withSeriesPath(file, () => {
      // Auto-loads series when options.hpiSeries is omitted
      const resultWithAuto = computePublicBenchmarkConsensus({
        state: 'FL',
        assessmentYear: 2020,
        assessmentPeriod: '2020Q2',
        parcel: { assessedValue: { total: 300000, land: 50000, improvement: 250000 }, taxYear: 2020 },
      });
      assert.ok(resultWithAuto.assessedTrajectory);
      assert.equal(resultWithAuto.assessedTrajectory.baselinePeriod, '2020Q2');
      assert.equal(resultWithAuto.assessedTrajectory.currentPeriod, '2026Q1');
      assert.equal(resultWithAuto.assessedTrajectory.hpiMultiplier, 1.5);
      assert.equal(resultWithAuto.assessedTrajectory.hpiAdjustedAssessedValue, 450000);

      // Respects explicit null override
      const resultWithNull = computePublicBenchmarkConsensus({
        state: 'FL',
        assessmentYear: 2020,
        assessmentPeriod: '2020Q2',
        parcel: { assessedValue: { total: 300000 }, taxYear: 2020 },
      }, { hpiSeries: null });
      assert.equal(resultWithNull.assessedTrajectory, null);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

