'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeFieldYield,
  computeBatchYield,
  checkSelectorDrift,
  evaluateRecordsForDrift,
  isFieldPresent,
  DEFAULT_EXPECTED_FIELDS
} = require('../../server/scrapers/drift-alarm');

test('isFieldPresent: correctly classifies presence across data types', () => {
  assert.equal(isFieldPresent('123 Main St'), true);
  assert.equal(isFieldPresent('   '), false);
  assert.equal(isFieldPresent(''), false);
  assert.equal(isFieldPresent(null), false);
  assert.equal(isFieldPresent(undefined), false);
  assert.equal(isFieldPresent(0), true);
  assert.equal(isFieldPresent(100), true);
  assert.equal(isFieldPresent(NaN), false);
  assert.equal(isFieldPresent(false), true);
  assert.equal(isFieldPresent([]), false);
  assert.equal(isFieldPresent(['item']), true);
  assert.equal(isFieldPresent({}), false);
  assert.equal(isFieldPresent({ a: 1 }), true);
});

test('computeFieldYield: yields 1.0 and empty missingFields for complete record', () => {
  const completeRecord = {
    id: 'HUD-OH-001',
    address: '456 Elm St, Columbus, OH 43215',
    saleDate: '2026-11-20',
    openingBid: 85000,
    county: 'Franklin',
    sourceUrl: 'https://www.hudhomestore.gov/property/123'
  };
  const result = computeFieldYield(completeRecord);
  assert.equal(result.yieldFraction, 1);
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.totalFields, DEFAULT_EXPECTED_FIELDS.length);
});

test('computeFieldYield: calculates exact fraction and missingFields for partial records', () => {
  const partial = {
    id: 'SHERIFF-001',
    address: '789 Pine Road',
    // missing: saleDate, openingBid, county, sourceUrl
  };
  const result = computeFieldYield(partial, ['id', 'address', 'saleDate', 'openingBid']);
  assert.equal(result.yieldFraction, 0.5);
  assert.deepEqual(result.presentFields, ['id', 'address']);
  assert.deepEqual(result.missingFields, ['saleDate', 'openingBid']);
});

test('computeFieldYield: treats empty string and whitespace-only as missing', () => {
  const emptyStrings = {
    id: 'TEST-01',
    address: '   ',
    saleDate: '',
    openingBid: null,
    county: undefined,
    sourceUrl: '   '
  };
  const result = computeFieldYield(emptyStrings);
  assert.equal(result.yieldFraction, 1 / DEFAULT_EXPECTED_FIELDS.length);
  assert.deepEqual(result.presentFields, ['id']);
  assert.ok(result.missingFields.includes('address'));
  assert.ok(result.missingFields.includes('saleDate'));
  assert.ok(result.missingFields.includes('openingBid'));
});

test('computeFieldYield: returns 0 yield for empty object or invalid input', () => {
  assert.equal(computeFieldYield({}).yieldFraction, 0);
  assert.equal(computeFieldYield(null).yieldFraction, 0);
  assert.equal(computeFieldYield(undefined).yieldFraction, 0);
  assert.equal(computeFieldYield('not-an-object').yieldFraction, 0);
});

test('checkSelectorDrift: returns hasDrift=false when yield meets or exceeds baseline', () => {
  const goodYield = checkSelectorDrift('hud', 0.85, 0.80);
  assert.equal(goodYield.hasDrift, false);
  assert.equal(goodYield.warning, undefined);

  const perfectYield = checkSelectorDrift('sheriff', 1.0, 0.80);
  assert.equal(perfectYield.hasDrift, false);

  const minorDrop = checkSelectorDrift('gsa', 0.75, 0.80); // (0.80 - 0.75)/0.80 = 6.25% drop (<= 30%) and 0.75 >= 0.4
  assert.equal(minorDrop.hasDrift, false);
});

test('checkSelectorDrift: triggers alarm when yield collapses by > 30% from baseline', () => {
  // Baseline 0.90, current 0.60 -> collapse = (0.90 - 0.60) / 0.90 = 33.3% > 30%
  const drifted = checkSelectorDrift('civilview', 0.60, 0.90);
  assert.equal(drifted.hasDrift, true);
  assert.ok(drifted.warning);
  assert.ok(drifted.warning.includes('SELECTOR_DRIFT_WARNING'));
  assert.ok(drifted.warning.includes('civilview'));
  assert.ok(drifted.warning.includes('60.0%'));
  assert.equal(drifted.reason, 'YIELD_COLLAPSE');
});

test('checkSelectorDrift: triggers alarm when yield falls below minimum threshold (0.4)', () => {
  // Baseline 0.45, current 0.35 -> collapse is (0.45 - 0.35)/0.45 = 22.2% (< 30%),
  // but current 0.35 is below the 0.40 floor!
  const belowFloor = checkSelectorDrift('treasury', 0.35, 0.45);
  assert.equal(belowFloor.hasDrift, true);
  assert.ok(belowFloor.warning);
  assert.equal(belowFloor.reason, 'BELOW_MIN_THRESHOLD');
});

test('checkSelectorDrift: handles critical double-violation (collapse > 30% and below floor)', () => {
  // Baseline 0.85, current 0.15 -> collapse 82% and below 0.40 floor
  const critical = checkSelectorDrift('irs', 0.15, 0.85);
  assert.equal(critical.hasDrift, true);
  assert.equal(critical.reason, 'CRITICAL_COLLAPSE_AND_SUB_FLOOR');
  assert.ok(critical.warning.includes('irs'));
});

test('computeBatchYield: computes mean yield across multiple records', () => {
  const records = [
    { id: '1', address: 'Addr 1', saleDate: '2026-01-01', openingBid: 1000 }, // 4/4 = 1.0
    { id: '2', address: 'Addr 2' }, // 2/4 = 0.5
  ];
  const batch = computeBatchYield(records, ['id', 'address', 'saleDate', 'openingBid']);
  assert.equal(batch.recordCount, 2);
  assert.equal(batch.meanYield, 0.75);
});

test('evaluateRecordsForDrift: evaluates batch records and flags drift when selectors break', () => {
  // Simulate broken DOM where only the address is captured and other selectors fail
  const degradedRecords = [
    { address: '123 Main St' },
    { address: '456 Oak St' },
    { address: '789 Pine St' }
  ];
  const evalResult = evaluateRecordsForDrift('fannie', degradedRecords, ['id', 'address', 'openingBid', 'saleDate', 'county'], 0.85);
  assert.equal(evalResult.hasDrift, true);
  assert.equal(evalResult.recordCount, 3);
  assert.ok(evalResult.currentYield <= 0.25);
  assert.ok(evalResult.warning.includes('fannie'));
});
test('IngestionScheduler: records driftAlarm when accepted records suffer selector drift', async () => {
  const schedulerModule = require('../../server/scrapers/scheduler');
  let recordedTelemetry = null;
  let runReport = null;

  const mockScraper = {
    name: 'DriftFixtureScraper',
    sourceKey: 'hud',
    getRawPublisherRecord: () => ({ fixture: true }),
    async scrapeFeed() {
      // Ingestible minimal record that lacks optional fields (saleDate, openingBid, county)
      return [{
        id: 'DRIFT-001',
        source: 'hud',
        state: 'OH',
        address: '100 Main St, Columbus, OH 43215',
        sourceUrl: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=123-456789',
        provenance: {
          origin: 'live',
          observed: true,
          publisher: 'HUD Homestore',
          recordId: 'rec-001',
          observedAt: '2026-06-01T00:00:00Z'
        },
        raw: 'Valid text with more than ten characters.'
      }];
    }
  };

  const sched = new schedulerModule.IngestionScheduler({
    realScrapers: [mockScraper],
    database: { async createListing() {} },
    telemetry: {
      recordRun(name, accepted, latency, err, meta) {
        recordedTelemetry = meta;
      }
    },
    networkEnabled: true
  });

  sched.onSourceRun = async (sourceKey, outcome) => {
    runReport = outcome.report;
  };

  const result = await sched.runAll();
  assert.equal(result.totalIngested, 1);
  assert.ok(recordedTelemetry);
  assert.equal(recordedTelemetry.driftAlarm?.hasDrift, true);
  assert.ok(runReport?.driftAlarm?.hasDrift);
});
