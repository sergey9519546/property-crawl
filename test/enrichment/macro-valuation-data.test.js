'use strict';

// test/enrichment/macro-valuation-data.test.js
//
// County macro trends after the fabricated 21-county benchmark table was
// removed. Trends are observed context only, never a per-property dollar
// band:
//   - an ETL-produced dynamic county benchmark (county-market-benchmarks.json)
//     is served when present (source PUBLIC_COUNTY_BENCHMARKS, observed true);
//   - otherwise the observed statewide FHFA HPI summary is the context
//     (source FHFA_STATE_HPI_SUMMARY), and an unobserved state fails closed
//     (null temperature, null source, observed false);
//   - classifyMarketTemperature(null) no longer lies 'balanced';
//   - the module exports no COUNTY_MARKET_BENCHMARKS and no output may
//     contain the retired 'FHFA_AND_PUBLIC_BENCHMARKS' source label.

const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateHpi = require('../../server/enrichment/fhfa-state-hpi');
const macroData = require('../../server/enrichment/macro-valuation-data');

const FIXED_RETRIEVED_AT = '2026-01-05T00:00:00.000Z';

// --- offline observed-snapshot fixture (no network) ----------------------

function buildFixtureCsv() {
  const lines = ['State,Rank,"1 Quarter","1 Year","5 Year","Since 1991"'];
  const explicitYoy = { OH: '4.41', AK: '8.30', CA: '-0.20' };
  let index = 0;
  for (const [name, code] of Object.entries(stateHpi.STATE_NAME_TO_CODE)) {
    index += 1;
    const yoy = explicitYoy[code] !== undefined
      ? explicitYoy[code]
      : (index / 10 - 3).toFixed(2); // deterministic, distinct per state
    const quarterPct = ((index % 5) * 0.2).toFixed(2);
    const fiveYearPct = (index * 1.1).toFixed(2);
    const since1991Pct = (100 + index * 2).toFixed(2);
    lines.push(`${name},${index},${quarterPct},${yoy},${fiveYearPct},${since1991Pct}`);
  }
  return lines.join('\n');
}

const FIXTURE_SNAPSHOT = stateHpi.buildStateHpiSnapshot({
  sourceUrl: 'https://www.fhfa.gov/hpi-state/csv',
  retrievedAt: FIXED_RETRIEVED_AT,
  csvText: buildFixtureCsv(),
});

let fixtureDirectory = null;
let previousEnvValue;

before(() => {
  fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-valuation-data-fixture-'));
  const fixturePath = path.join(fixtureDirectory, 'fhfa-state-hpi.json');
  fs.writeFileSync(fixturePath, JSON.stringify(FIXTURE_SNAPSHOT), 'utf8');
  previousEnvValue = process.env.FHFA_STATE_HPI_PATH;
  process.env.FHFA_STATE_HPI_PATH = fixturePath;
  stateHpi.invalidateStateHpiCache();
  macroData.invalidateDynamicBenchmarksCache();
});

after(() => {
  if (previousEnvValue === undefined) delete process.env.FHFA_STATE_HPI_PATH;
  else process.env.FHFA_STATE_HPI_PATH = previousEnvValue;
  stateHpi.invalidateStateHpiCache();
  if (fixtureDirectory) fs.rmSync(fixtureDirectory, { recursive: true, force: true });
});

// --- module contract -----------------------------------------------------

test('module contract: exports the observed-context API and no fabricated benchmark table', () => {
  assert.equal(typeof macroData.DISCLAIMER, 'string');
  for (const key of [
    'normalizeCountyKey',
    'deriveStateHpiYoy',
    'classifyMarketTemperature',
    'getCountyMarketTrends',
    'enrichListingWithMacroTrends',
    'loadDynamicBenchmarks',
    'invalidateDynamicBenchmarksCache',
  ]) {
    assert.equal(typeof macroData[key], 'function', `${key} must be exported`);
  }
  assert.ok(!('COUNTY_MARKET_BENCHMARKS' in macroData), 'the hand-written 21-county table must not be exported');
  assert.equal(macroData.COUNTY_MARKET_BENCHMARKS, undefined);
});

// --- deriveStateHpiYoy: observed, fixture-based ---------------------------

test('deriveStateHpiYoy: returns the observed statewide FHFA YoY and matches the state HPI module', () => {
  assert.equal(macroData.deriveStateHpiYoy('OH'), 4.41);
  assert.equal(macroData.deriveStateHpiYoy('OH'), stateHpi.getStateHpiYoy('OH'));
  assert.equal(macroData.deriveStateHpiYoy('XX'), null, 'placeholder state codes are never observed');
});

// --- getCountyMarketTrends ------------------------------------------------

test('getCountyMarketTrends: no county benchmark falls back to observed statewide HPI context', () => {
  const trends = macroData.getCountyMarketTrends('OH', 'Cuyahoga');
  assert.equal(trends.state, 'OH');
  assert.equal(trends.county, 'Cuyahoga');
  assert.equal(trends.medianSalePrice, null, 'no county benchmark means no county median sale price');
  assert.equal(trends.yoyPriceChangePct, 4.41);
  assert.equal(trends.marketTemperature, 'balanced');
  assert.ok(trends.trendLabel.includes('4.41'), `trendLabel: ${trends.trendLabel}`);
  assert.equal(trends.source, 'FHFA_STATE_HPI_SUMMARY');
  assert.equal(trends.observed, true);
  assert.equal(trends.disclaimer, macroData.DISCLAIMER);
});

test('getCountyMarketTrends: the committed unverified_legacy envelope is NOT served (fail closed)', () => {
  // The committed county file predates provenance capture and its source CSV
  // was not retained, so it is recorded as unverified_legacy and the loader
  // refuses it: Camden must fall back to the observed statewide context
  // instead of serving unprovenanced numbers.
  const trends = macroData.getCountyMarketTrends('NJ', 'Camden');
  assert.equal(trends.state, 'NJ');
  assert.equal(trends.county, 'Camden');
  assert.equal(trends.medianSalePrice, null);
  assert.notEqual(trends.source, 'PUBLIC_COUNTY_BENCHMARKS');
  assert.equal(trends.disclaimer, macroData.DISCLAIMER);
});

test('getCountyMarketTrends: an observed envelope is served via COUNTY_BENCHMARKS_PATH', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'county-env-'));
  const envelopePath = path.join(tmpDir, 'county-market-benchmarks.json');
  const originalEnv = process.env.COUNTY_BENCHMARKS_PATH;
  try {
    fs.writeFileSync(envelopePath, JSON.stringify({
      version: 1,
      generator: 'test fixture',
      generatedAt: '2026-11-07T00:00:00.000Z',
      provenance: {
        status: 'observed',
        sourceLabel: 'test fixture CSV',
        inputSha256: 'c'.repeat(64),
        retrievedAt: '2026-11-07T00:00:00.000Z',
      },
      benchmarks: {
        'NJ-CAMDEN': {
          state: 'NJ', county: 'Camden', medianSalePrice: 310000,
          yoyPriceChangePct: 6.5, marketTemperature: 'hot', medianDom: 29,
          trendLabel: 'HOT Market (+6.5% YoY, 29 median DOM)',
        },
      },
    }), 'utf8');
    process.env.COUNTY_BENCHMARKS_PATH = envelopePath;
    macroData.invalidateDynamicBenchmarksCache();
    const trends = macroData.getCountyMarketTrends('NJ', 'Camden');
    assert.equal(trends.state, 'NJ');
    assert.equal(trends.county, 'Camden');
    assert.equal(trends.medianSalePrice, 310000);
    assert.equal(trends.yoyPriceChangePct, 6.5);
    assert.equal(trends.marketTemperature, 'hot');
    assert.equal(trends.source, 'PUBLIC_COUNTY_BENCHMARKS');
    assert.equal(trends.observed, true);
    assert.equal(trends.disclaimer, macroData.DISCLAIMER);
  } finally {
    if (originalEnv === undefined) delete process.env.COUNTY_BENCHMARKS_PATH;
    else process.env.COUNTY_BENCHMARKS_PATH = originalEnv;
    macroData.invalidateDynamicBenchmarksCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getCountyMarketTrends: an unobserved state fails closed instead of lying balanced', () => {
  const trends = macroData.getCountyMarketTrends('XX', 'Nowhere');
  assert.equal(trends.state, 'XX');
  assert.equal(trends.county, 'Nowhere');
  assert.equal(trends.medianSalePrice, null);
  assert.equal(trends.yoyPriceChangePct, null);
  assert.equal(trends.marketTemperature, null);
  assert.equal(trends.trendLabel, 'Statewide FHFA trend unobserved');
  assert.equal(trends.source, null);
  assert.equal(trends.observed, false);
  assert.equal(trends.disclaimer, macroData.DISCLAIMER);
});

// --- classifyMarketTemperature --------------------------------------------

test('classifyMarketTemperature: null/NaN/non-number fail closed; hot/cold/balanced boundaries hold', () => {
  assert.equal(macroData.classifyMarketTemperature(null), null);
  assert.equal(macroData.classifyMarketTemperature(Number.NaN), null);
  assert.equal(macroData.classifyMarketTemperature('5'), null, 'a numeric string is not a number');
  assert.equal(macroData.classifyMarketTemperature(5), 'hot');
  assert.equal(macroData.classifyMarketTemperature(4.8), 'hot');
  assert.equal(macroData.classifyMarketTemperature(1.0), 'cold');
  assert.equal(macroData.classifyMarketTemperature(3), 'balanced');
});

// --- normalizeCountyKey ----------------------------------------------------

test('normalizeCountyKey: strips the County suffix into the registry key shape', () => {
  assert.equal(macroData.normalizeCountyKey('OH', 'Cuyahoga County'), 'OH-CUYAHOGA');
  assert.equal(macroData.normalizeCountyKey('oh', 'cuyahoga'), 'OH-CUYAHOGA');
});

// --- enrichListingWithMacroTrends ------------------------------------------

test('enrichListingWithMacroTrends: preserves publisher estimates, never invents them, attaches macroTrends', () => {
  const withEstimates = macroData.enrichListingWithMacroTrends({
    id: 'listing-oh-101',
    state: 'OH',
    county: 'Cuyahoga',
    openingBid: 45000,
    estLow: 110000,
    estHigh: 135000,
  });
  assert.equal(withEstimates.estLow, 110000, 'existing estLow must be preserved');
  assert.equal(withEstimates.estHigh, 135000, 'existing estHigh must be preserved');
  assert.ok(withEstimates.macroTrends, 'macroTrends must be attached');
  assert.equal(withEstimates.macroTrends.state, 'OH');
  assert.equal(withEstimates.macroTrends.county, 'Cuyahoga');
  assert.equal(withEstimates.macroTrends.medianSalePrice, null);
  assert.equal(withEstimates.macroTrends.yoyPriceChangePct, 4.41);
  assert.equal(withEstimates.macroTrends.source, 'FHFA_STATE_HPI_SUMMARY');

  const withoutEstimates = macroData.enrichListingWithMacroTrends({
    id: 'listing-oh-102',
    state: 'OH',
    county: 'Cuyahoga',
    openingBid: 45000,
  });
  assert.ok(!('estLow' in withoutEstimates), 'estLow must never be invented');
  assert.ok(!('estHigh' in withoutEstimates), 'estHigh must never be invented');
  assert.ok(withoutEstimates.macroTrends);
  assert.equal(withoutEstimates.macroTrends.yoyPriceChangePct, 4.41);
});

// --- retired source label must never reappear -------------------------------

test('retired source label: no trend or enrichment output contains FHFA_AND_PUBLIC_BENCHMARKS', () => {
  const outputs = [
    macroData.getCountyMarketTrends('OH', 'Cuyahoga'),
    macroData.getCountyMarketTrends('XX', 'Nowhere'),
    macroData.getCountyMarketTrends('NJ', 'Camden'),
    macroData.enrichListingWithMacroTrends({ state: 'OH', county: 'Cuyahoga', openingBid: 1 }),
    macroData.enrichListingWithMacroTrends({ state: 'XX', county: 'Nowhere', openingBid: 1 }),
    macroData.enrichListingWithMacroTrends({ state: 'NJ', county: 'Camden', openingBid: 1 }),
  ];
  const serialized = JSON.stringify(outputs);
  assert.ok(!serialized.includes('FHFA_AND_PUBLIC_BENCHMARKS'), 'the retired source label must never appear in any output');
});
