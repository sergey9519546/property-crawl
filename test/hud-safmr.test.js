'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getHudSafmrBenchmark, loadBenchmarks } = require('../server/enrichment/hud-safmr');
const { presentListing } = require('../server/routes/listings');
const { buildDecisionPacket } = require('../server/export/decision-packet');
const { buildPropertyDossier } = require('../server/intelligence/dossier');

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

test('presentListing wires hudSafmr benchmark for valid ZIP and omits for unbenchmarked ZIP', () => {
  const benchmarks = loadBenchmarks();
  const validZip = Object.keys(benchmarks)[0];

  const presentedWithZip = presentListing({
    id: 'TEST-HUD-1',
    address: '100 Main St',
    zip: validZip,
    beds: 3,
    source: 'sheriff',
  });
  assert.ok(presentedWithZip.hudSafmr, 'expected hudSafmr to be attached to presented listing');
  assert.equal(presentedWithZip.hudSafmr.zip, validZip);
  assert.equal(presentedWithZip.hudSafmr.bedrooms, 3);
  assert.ok(presentedWithZip.hudSafmr.fairMarketRent > 0);

  const presentedNoZip = presentListing({
    id: 'TEST-HUD-2',
    address: '200 Unknown St',
    zip: '99999',
    source: 'sheriff',
  });
  assert.equal(presentedNoZip.hudSafmr, undefined, 'expected hudSafmr to be omitted for unbenchmarked ZIP');
});

test('buildDecisionPacket wires hudSafmr as optional top-level field', () => {
  const benchmarks = loadBenchmarks();
  const validZip = Object.keys(benchmarks)[0];

  const packetWithZip = buildDecisionPacket({
    id: 'TEST-HUD-DP-1',
    address: '100 Main St',
    zip: validZip,
    beds: 2,
    openingBid: 150000,
    source: 'sheriff',
  });
  assert.ok(packetWithZip.hudSafmr, 'expected packet.hudSafmr to be present');
  assert.equal(packetWithZip.hudSafmr.zip, validZip);
  assert.equal(packetWithZip.hudSafmr.bedrooms, 2);

  const packetNoZip = buildDecisionPacket({
    id: 'TEST-HUD-DP-2',
    address: '200 Unknown St',
    zip: '99999',
    openingBid: 150000,
    source: 'sheriff',
  });
  assert.equal(packetNoZip.hudSafmr, undefined, 'expected packet.hudSafmr to be omitted');
});

test('buildPropertyDossier wires hudSafmr on returned dossier', () => {
  const benchmarks = loadBenchmarks();
  const validZip = Object.keys(benchmarks)[0];

  const dossierWithZip = buildPropertyDossier({
    id: 'TEST-HUD-DOS-1',
    address: '100 Main St',
    zip: validZip,
    beds: 2,
    source: 'sheriff',
  });
  assert.ok(dossierWithZip.hudSafmr, 'expected dossier.hudSafmr to be present');
  assert.equal(dossierWithZip.hudSafmr.zip, validZip);

  const dossierNoZip = buildPropertyDossier({
    id: 'TEST-HUD-DOS-2',
    address: '200 Unknown St',
    zip: '99999',
    source: 'sheriff',
  });
  assert.equal(dossierNoZip.hudSafmr, null, 'expected dossier.hudSafmr to be null');
});
