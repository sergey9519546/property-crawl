'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  parseMacroRecord,
  ingestMacroRecords,
} = require('../../scripts/ingest-macro-trends');
const {
  getCountyMarketTrends,
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

test('Macro Trends Ingest: writes benchmark file and enriches market trends dynamically', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-test-'));
  const targetJson = path.join(tmpDir, 'county-market-benchmarks.json');

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

  const benchmarks = ingestMacroRecords(rows, {
    saveToFile: true,
    outputPath: targetJson,
  });

  assert.equal(Object.keys(benchmarks).length, 2);
  assert.ok(fs.existsSync(targetJson));

  // Also write to server/enrichment/data/county-market-benchmarks.json
  const serverDataJson = path.resolve(__dirname, '../../server/enrichment/data/county-market-benchmarks.json');
  fs.mkdirSync(path.dirname(serverDataJson), { recursive: true });
  fs.writeFileSync(serverDataJson, JSON.stringify(benchmarks, null, 2), 'utf8');

  // Invalidate cache and test dynamic lookup
  invalidateDynamicBenchmarksCache();
  const camdenTrends = getCountyMarketTrends('NJ', 'Camden');
  assert.equal(camdenTrends.state, 'NJ');
  assert.equal(camdenTrends.county, 'Camden');
  assert.equal(camdenTrends.medianSalePrice, 310000);
  assert.equal(camdenTrends.yoyPriceChangePct, 6.5);
  assert.equal(camdenTrends.marketTemperature, 'hot');

  // Clean up test temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
