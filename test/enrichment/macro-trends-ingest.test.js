'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const {
  parseMacroRecord,
  ingestMacroRecords,
  buildProvenance,
} = require('../../scripts/ingest-macro-trends');
const {
  getCountyMarketTrends,
  loadDynamicBenchmarks,
  invalidateDynamicBenchmarksCache,
} = require('../../server/enrichment/macro-valuation-data');

test('Macro Trends Ingest: parses Redfin format records', () => {
  const row = {
    region_name: 'Essex County, NJ',
    median_sale_price: '$520,000',
    median_sale_price_yoy: '5.8%',
    median_dom: '31',
  };

  const parsed = parseMacroRecord(row);
  assert.ok(parsed);
  assert.equal(parsed.key, 'NJ-ESSEX');
  assert.equal(parsed.state, 'NJ');
  assert.equal(parsed.county, 'Essex');
  assert.equal(parsed.medianSalePrice, 520000);
  assert.equal(parsed.yoyPriceChangePct, 5.8);
  assert.equal(parsed.marketTemperature, 'hot');
  assert.equal(parsed.medianDom, 31);
});

test('Macro Trends Ingest: parses Zillow ZHVI format records', () => {
  const row = {
    RegionName: 'Mercer County',
    State: 'NJ',
    zhvi: '385000',
    yoy: '0.042', // decimal fraction
    dom: '35',
  };

  const parsed = parseMacroRecord(row);
  assert.ok(parsed);
  assert.equal(parsed.key, 'NJ-MERCER');
  assert.equal(parsed.state, 'NJ');
  assert.equal(parsed.county, 'Mercer');
  assert.equal(parsed.medianSalePrice, 385000);
  assert.equal(parsed.yoyPriceChangePct, 4.2);
  assert.equal(parsed.marketTemperature, 'balanced');
  assert.equal(parsed.medianDom, 35);
});

test('Macro Trends Ingest: rejects invalid records with unknown state', () => {
  const row = {
    region_name: 'Atlantis County, XX',
    median_sale_price: '500000',
  };
  assert.equal(parseMacroRecord(row), null);
});

test('Macro Trends Ingest: provenance is observed only with a 64-hex sha and parseable retrievedAt', () => {
  const observed = buildProvenance({
    inputSha256: 'a'.repeat(64),
    retrievedAt: '2026-11-07T00:00:00.000Z',
    sourceLabel: 'operator CSV ingest: county.csv',
  });
  assert.equal(observed.status, 'observed');
  assert.equal(observed.inputSha256, 'a'.repeat(64));
  assert.equal(observed.retrievedAt, '2026-11-07T00:00:00.000Z');

  for (const partial of [
    {},
    { inputSha256: 'a'.repeat(64) },
    { retrievedAt: '2026-11-07T00:00:00.000Z' },
    { inputSha256: 'not-a-sha', retrievedAt: '2026-11-07T00:00:00.000Z' },
    { inputSha256: 'a'.repeat(64), retrievedAt: 'not-a-date' },
  ]) {
    assert.equal(buildProvenance(partial).status, 'unverified_legacy');
    assert.equal(buildProvenance(partial).inputSha256 === null || buildProvenance(partial).inputSha256 === partial.inputSha256, true);
  }
});

test('Macro Trends Ingest: writes an observed envelope and serves it via COUNTY_BENCHMARKS_PATH', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-test-'));
  const targetJson = path.join(tmpDir, 'county-market-benchmarks.json');
  const originalEnv = process.env.COUNTY_BENCHMARKS_PATH;

  const rows = [
    {
      region_name: 'Camden County, NJ',
      median_sale_price: '310000',
      median_sale_price_yoy: '6.5%',
      median_dom: '29',
    },
    {
      region_name: 'Bergen County, NJ',
      median_sale_price: '640000',
      median_sale_price_yoy: '4.9%',
      median_dom: '27',
    },
  ];

  try {
    const inputSha256 = crypto.createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
    const benchmarks = ingestMacroRecords(rows, {
      saveToFile: true,
      outputPath: targetJson,
      inputSha256,
      retrievedAt: '2026-11-07T00:00:00.000Z',
      sourceLabel: 'test fixture CSV',
    });

    assert.equal(Object.keys(benchmarks).length, 2);
    assert.ok(fs.existsSync(targetJson));

    const envelope = JSON.parse(fs.readFileSync(targetJson, 'utf8'));
    assert.equal(envelope.version, 1);
    assert.equal(envelope.generator, 'scripts/ingest-macro-trends.js');
    assert.equal(envelope.provenance.status, 'observed');
    assert.equal(envelope.provenance.inputSha256, inputSha256);
    assert.equal(typeof envelope.benchmarks, 'object');

    // The repo file is NOT touched by tests: the lookup goes through the
    // COUNTY_BENCHMARKS_PATH override instead of polluting server/enrichment/data.
    process.env.COUNTY_BENCHMARKS_PATH = targetJson;
    invalidateDynamicBenchmarksCache();
    const camdenTrends = getCountyMarketTrends('NJ', 'Camden');
    assert.equal(camdenTrends.state, 'NJ');
    assert.equal(camdenTrends.county, 'Camden');
    assert.equal(camdenTrends.medianSalePrice, 310000);
    assert.equal(camdenTrends.yoyPriceChangePct, 6.5);
    assert.equal(camdenTrends.marketTemperature, 'hot');
    assert.equal(camdenTrends.source, 'PUBLIC_COUNTY_BENCHMARKS');
    assert.equal(camdenTrends.observed, true);
  } finally {
    if (originalEnv === undefined) delete process.env.COUNTY_BENCHMARKS_PATH;
    else process.env.COUNTY_BENCHMARKS_PATH = originalEnv;
    invalidateDynamicBenchmarksCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Macro Trends Ingest: the loader fails closed on unprovenanced files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-neg-'));
  const originalEnv = process.env.COUNTY_BENCHMARKS_PATH;

  try {
    // 1. Legacy flat map (the pre-envelope shape) is refused.
    const legacyPath = path.join(tmpDir, 'legacy.json');
    fs.writeFileSync(legacyPath, JSON.stringify({
      'NJ-CAMDEN': {
        state: 'NJ', county: 'Camden', medianSalePrice: 310000,
        yoyPriceChangePct: 6.5, marketTemperature: 'hot', medianDom: 29,
        trendLabel: 'HOT Market (+6.5% YoY, 29 median DOM)',
      },
    }), 'utf8');
    process.env.COUNTY_BENCHMARKS_PATH = legacyPath;
    invalidateDynamicBenchmarksCache();
    assert.deepEqual(loadDynamicBenchmarks(), {});

    // 2. An 'observed' status without a valid 64-hex sha is refused.
    const noShaPath = path.join(tmpDir, 'nosha.json');
    fs.writeFileSync(noShaPath, JSON.stringify({
      version: 1,
      generator: 'test',
      generatedAt: '2026-11-07T00:00:00.000Z',
      provenance: { status: 'observed', sourceLabel: 'x', inputSha256: null, retrievedAt: null },
      benchmarks: { 'NJ-CAMDEN': { state: 'NJ', county: 'Camden', medianSalePrice: 1 } },
    }), 'utf8');
    process.env.COUNTY_BENCHMARKS_PATH = noShaPath;
    invalidateDynamicBenchmarksCache();
    assert.deepEqual(loadDynamicBenchmarks(), {});

    // 3. unverified_legacy is refused even with benchmarks present.
    const unverifiedPath = path.join(tmpDir, 'unverified.json');
    fs.writeFileSync(unverifiedPath, JSON.stringify({
      version: 1,
      generator: 'test',
      generatedAt: '2026-11-07T00:00:00.000Z',
      provenance: { status: 'unverified_legacy', sourceLabel: 'x', inputSha256: 'a'.repeat(64), retrievedAt: '2026-11-07T00:00:00.000Z' },
      benchmarks: { 'NJ-CAMDEN': { state: 'NJ', county: 'Camden', medianSalePrice: 1 } },
    }), 'utf8');
    process.env.COUNTY_BENCHMARKS_PATH = unverifiedPath;
    invalidateDynamicBenchmarksCache();
    assert.deepEqual(loadDynamicBenchmarks(), {});

    // 4. Malformed JSON is refused.
    const badPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badPath, '{not json', 'utf8');
    process.env.COUNTY_BENCHMARKS_PATH = badPath;
    invalidateDynamicBenchmarksCache();
    assert.deepEqual(loadDynamicBenchmarks(), {});

    // 5. With no benchmarks served, getCountyMarketTrends falls back cleanly
    //    to the observed statewide context instead of throwing.
    process.env.COUNTY_BENCHMARKS_PATH = legacyPath;
    invalidateDynamicBenchmarksCache();
    const trends = getCountyMarketTrends('NJ', 'Camden');
    assert.equal(trends.state, 'NJ');
    assert.equal(trends.county, 'Camden');
    assert.equal(trends.medianSalePrice, null);
    assert.notEqual(trends.source, 'PUBLIC_COUNTY_BENCHMARKS');
  } finally {
    if (originalEnv === undefined) delete process.env.COUNTY_BENCHMARKS_PATH;
    else process.env.COUNTY_BENCHMARKS_PATH = originalEnv;
    invalidateDynamicBenchmarksCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
