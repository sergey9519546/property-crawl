'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getHudSafmrBenchmark, loadBenchmarks } = require('../server/enrichment/hud-safmr');

test('HUD SAFMR benchmark returns exact statutory figures for valid ZIP and bedroom count', () => {
  const benchmarks = loadBenchmarks();
  assert.ok(Object.keys(benchmarks).length > 1000);

  // Test invalid / null inputs
  assert.equal(getHudSafmrBenchmark(), null);
  assert.equal(getHudSafmrBenchmark({ zip: 'invalid' }), null);
  assert.equal(getHudSafmrBenchmark({ zip: '99999' }), null);

  // Pick first available zip from benchmark cache
  const firstZip = Object.keys(benchmarks)[0];
  const result2Br = getHudSafmrBenchmark({ zip: firstZip, bedrooms: 2 });
  assert.ok(result2Br !== null);
  assert.equal(result2Br.zip, firstZip);
  assert.equal(result2Br.bedrooms, 2);
  assert.ok(Number.isFinite(result2Br.fairMarketRent));
  assert.equal(result2Br.paymentStandard90Pct, Math.round(result2Br.fairMarketRent * 0.90));
  assert.equal(result2Br.paymentStandard110Pct, Math.round(result2Br.fairMarketRent * 1.10));
  assert.equal(result2Br.asOfFiscalYear, 'FY2025');
  assert.match(result2Br.source, /HUD FY2025/);

  // Test 0BR and 4BR bounds
  const result0Br = getHudSafmrBenchmark({ zip: firstZip, bedrooms: 0 });
  const result4Br = getHudSafmrBenchmark({ zip: firstZip, bedrooms: 4 });
  assert.ok(result0Br !== null && result4Br !== null);
  assert.equal(result0Br.bedrooms, 0);
  assert.equal(result4Br.bedrooms, 4);
});
