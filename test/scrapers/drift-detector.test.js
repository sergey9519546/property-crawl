'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeDomStructureHash,
  extractDomSkeleton,
  calculateFieldYield,
  evaluateDrift,
  ESSENTIAL_FIELDS
} = require('../../server/scrapers/drift-detector');
const BaseScraper = require('../../server/scrapers/base');
const { ScraperTelemetry } = require('../../server/scrapers/telemetry');

test('DOM Structure Fingerprinting: computeDomStructureHash', async (t) => {
  await t.test('identical DOM structures with different dynamic text & attributes yield identical hash', () => {
    const htmlPage1 = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Auction Notice #101 - 123 Main St</title>
          <meta name="csrf-token" content="abc-123-random-session">
          <script>var session = "user_42";</script>
          <style>.active { color: #ff0000; }</style>
        </head>
        <body class="theme-light page-101" data-tracking-id="trk_999">
          <!-- Main auction container -->
          <div id="listing-container" class="auction-card flex-row">
            <h1 class="title">123 Main St, Columbus, OH</h1>
            <table class="data-table zebra">
              <thead>
                <tr><th>Field</th><th>Value</th></tr>
              </thead>
              <tbody>
                <tr><td>Opening Bid</td><td>$45,000</td></tr>
                <tr><td>APN</td><td>123-456-789</td></tr>
              </tbody>
            </table>
          </div>
        </body>
      </html>
    `;

    const htmlPage2 = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Auction Notice #202 - 999 Oak Ave</title>
          <meta name="csrf-token" content="xyz-789-different-session">
          <script>var session = "user_888"; console.log("debug");</script>
          <style>.active { color: #00ff00; } p { margin: 10px; }</style>
        </head>
        <body class="theme-dark page-202" data-tracking-id="trk_111">
          <!-- Completely different comment -->
          <div id="listing-container-2" class="auction-card column-layout">
            <h1 class="title">999 Oak Ave, Akron, OH</h1>
            <table class="data-table compact">
              <thead>
                <tr><th>Property Info</th><th>Record Details</th></tr>
              </thead>
              <tbody>
                <tr><td>Minimum Upset</td><td>$150,000</td></tr>
                <tr><td>Parcel Number</td><td>999-000-111</td></tr>
              </tbody>
            </table>
          </div>
        </body>
      </html>
    `;

    const hash1 = computeDomStructureHash(htmlPage1);
    const hash2 = computeDomStructureHash(htmlPage2);

    assert.equal(typeof hash1, 'string');
    assert.equal(hash1.length, 64, 'Must be a 64-char hex SHA-256');
    assert.equal(hash1, hash2, 'Identical DOM skeletons must yield the exact same SHA-256 fingerprint');

    const skeleton1 = extractDomSkeleton(htmlPage1);
    const skeleton2 = extractDomSkeleton(htmlPage2);
    assert.equal(skeleton1, skeleton2);
  });

  await t.test('different DOM structures produce different hashes', () => {
    const tableStructure = `
      <div class="content">
        <table>
          <tbody>
            <tr><td>Row 1</td></tr>
          </tbody>
        </table>
      </div>
    `;

    const divGridStructure = `
      <div class="content">
        <div class="grid-row">
          <div class="grid-cell">Row 1</div>
        </div>
      </div>
    `;

    const hashTable = computeDomStructureHash(tableStructure);
    const hashDiv = computeDomStructureHash(divGridStructure);

    assert.notEqual(hashTable, hashDiv, 'Table vs Div grid structure must produce different hashes');
  });

  await t.test('handles empty or non-string input safely', () => {
    const emptyHash = computeDomStructureHash('');
    const nullHash = computeDomStructureHash(null);
    assert.equal(emptyHash, nullHash);
    assert.equal(emptyHash.length, 64);
  });
});

test('Field Yield Calculation: calculateFieldYield', async (t) => {
  await t.test('yields 1.0 for all essential fields on complete listings', () => {
    const completeListings = [
      {
        openingBid: 50000,
        saleDate: '2026-12-01',
        apn: 'APN-1001',
        address: '100 Main St',
        city: 'Cleveland',
        state: 'OH',
        zip: '44114',
        latitude: 41.4993,
        longitude: -81.6944
      },
      {
        openingBid: 120000,
        saleDate: '2026-12-05',
        apn: 'APN-1002',
        address: '200 Oak Ave',
        city: 'Columbus',
        state: 'OH',
        zip: '43215',
        latitude: 39.9612,
        longitude: -82.9988
      }
    ];

    const result = calculateFieldYield(completeListings);

    assert.equal(result.totalCount, 2);
    for (const field of ESSENTIAL_FIELDS) {
      assert.equal(result[field], 1.0, `Expected 1.0 for field ${field}`);
      assert.equal(result.fieldYield[field], 1.0);
    }
  });

  await t.test('calculates accurate partial yield fractions and ignores zero/empty values', () => {
    const partialListings = [
      {
        openingBid: 75000,
        saleDate: '2026-11-15',
        apn: 'APN-101',
        address: '300 Pine St',
        city: 'Cincinnati',
        state: 'OH',
        zip: '45202',
        latitude: 39.1031,
        longitude: -84.5120
      },
      {
        openingBid: 0, // Invalid: zero opening bid is not present
        saleDate: '', // Empty: not present
        apn: '   ', // Whitespace: not present
        address: '400 Elm St',
        city: 'Dayton',
        state: 'OH',
        zip: '45402',
        latitude: null, // Null: not present
        longitude: undefined // Undefined: not present
      }
    ];

    const result = calculateFieldYield(partialListings);

    assert.equal(result.totalCount, 2);
    assert.equal(result.address, 1.0);
    assert.equal(result.city, 1.0);
    assert.equal(result.state, 1.0);
    assert.equal(result.zip, 1.0);
    assert.equal(result.openingBid, 0.5);
    assert.equal(result.saleDate, 0.5);
    assert.equal(result.apn, 0.5);
    assert.equal(result.latitude, 0.5);
    assert.equal(result.longitude, 0.5);
  });

  await t.test('yields 0.0 for empty or invalid listings array', () => {
    const emptyResult = calculateFieldYield([]);
    assert.equal(emptyResult.totalCount, 0);
    for (const field of ESSENTIAL_FIELDS) {
      assert.equal(emptyResult[field], 0);
      assert.equal(emptyResult.fieldYield[field], 0);
    }

    const nullResult = calculateFieldYield(null);
    assert.equal(nullResult.totalCount, 0);
    assert.equal(nullResult.openingBid, 0);
  });
});

test('Drift Alarm Evaluation: evaluateDrift', async (t) => {
  const baseHtml = `<html><body><div class="row"><table><tr><td>A</td></tr></table></div></body></html>`;
  const baseHash = computeDomStructureHash(baseHtml);

  await t.test('detects DOM_STRUCTURE_DRIFT when template layout changes', () => {
    const alteredHtml = `<html><body><div class="grid"><section><p>A</p></section></div></body></html>`;
    const listings = [
      {
        openingBid: 10000,
        saleDate: '2026-11-20',
        apn: '123',
        address: '123 St',
        city: 'City',
        state: 'OH',
        zip: '12345',
        latitude: 40.0,
        longitude: -80.0
      }
    ];

    const baseline = {
      domHash: baseHash,
      fieldYield: { openingBid: 1.0, saleDate: 1.0, apn: 1.0, address: 1.0, city: 1.0, state: 1.0, zip: 1.0, latitude: 1.0, longitude: 1.0 }
    };

    const evaluation = evaluateDrift('civilview', alteredHtml, listings, baseline);

    assert.equal(evaluation.hasDrift, true);
    assert.equal(evaluation.domDrift, true);
    assert.equal(evaluation.yieldCollapse, false);
    assert.deepEqual(evaluation.flags, ['DOM_STRUCTURE_DRIFT']);
    assert.equal(evaluation.domHash.matches, false);
  });

  await t.test('detects FIELD_YIELD_COLLAPSE when field yields drop > 25%', () => {
    const listings = [
      {
        // openingBid missing in all
        // saleDate missing in all
        address: '123 St',
        city: 'City',
        state: 'OH',
        zip: '12345',
        latitude: 40.0,
        longitude: -80.0
      }
    ];

    const baseline = {
      domHash: baseHash,
      fieldYield: {
        openingBid: 0.95,
        saleDate: 0.90,
        address: 1.0,
        city: 1.0,
        state: 1.0,
        zip: 1.0,
        latitude: 1.0,
        longitude: 1.0
      }
    };

    const evaluation = evaluateDrift('sheriff', baseHtml, listings, baseline);

    assert.equal(evaluation.hasDrift, true);
    assert.equal(evaluation.domDrift, false);
    assert.equal(evaluation.yieldCollapse, true);
    assert.ok(evaluation.flags.includes('FIELD_YIELD_COLLAPSE'));
    assert.ok(evaluation.affectedFields.some((f) => f.field === 'openingBid'));
    assert.ok(evaluation.affectedFields.some((f) => f.field === 'saleDate'));
  });

  await t.test('detects both DOM_STRUCTURE_DRIFT and FIELD_YIELD_COLLAPSE when both occur', () => {
    const changedHtml = `<div><span>Drifted</span></div>`;
    const emptyListings = [];
    const baseline = {
      domHash: baseHash,
      fieldYield: {
        openingBid: 0.9,
        saleDate: 0.8
      }
    };

    const evaluation = evaluateDrift('hud', changedHtml, emptyListings, baseline);

    assert.equal(evaluation.hasDrift, true);
    assert.equal(evaluation.domDrift, true);
    assert.equal(evaluation.yieldCollapse, true);
    assert.deepEqual(evaluation.flags, ['DOM_STRUCTURE_DRIFT', 'FIELD_YIELD_COLLAPSE']);
    assert.equal(evaluation.totalListings, 0);
  });

  await t.test('remains healthy with no drift when DOM and yields match baseline', () => {
    const listings = [
      {
        openingBid: 85000,
        saleDate: '2026-11-20',
        apn: 'APN-888',
        address: '888 Main St',
        city: 'Columbus',
        state: 'OH',
        zip: '43215',
        latitude: 39.9,
        longitude: -82.9
      }
    ];

    const baseline = {
      domHash: baseHash,
      fieldYield: {
        openingBid: 1.0,
        saleDate: 1.0,
        apn: 1.0,
        address: 1.0
      }
    };

    const evaluation = evaluateDrift('gsa', baseHtml, listings, baseline);

    assert.equal(evaluation.hasDrift, false);
    assert.equal(evaluation.domDrift, false);
    assert.equal(evaluation.yieldCollapse, false);
    assert.deepEqual(evaluation.flags, []);
  });
});

test('Integration: BaseScraper and Telemetry methods', () => {
  const scraper = new BaseScraper({ sourceKey: 'test_sheriff', name: 'Test Sheriff' });
  assert.equal(typeof scraper.computeDomStructureHash, 'function');
  assert.equal(typeof scraper.calculateFieldYield, 'function');
  assert.equal(typeof scraper.evaluateDrift, 'function');

  const html = `<div><p>Sample</p></div>`;
  const hash = scraper.computeDomStructureHash(html);
  assert.equal(hash.length, 64);

  const telemetry = new ScraperTelemetry({ persist: false });
  assert.equal(typeof telemetry.recordRun, 'function');

  telemetry.recordRun('test_sheriff', [{ openingBid: 100, address: 'Test St', saleDate: '2026-11-01' }], 120, null, {
    html,
    historicalBaseline: { domHash: hash, fieldYield: { openingBid: 1.0 } }
  });

  const state = telemetry.history['test_sheriff'];
  assert.ok(state);
  assert.equal(state.driftDetected, false);
  assert.ok(state.driftReport);
  assert.equal(state.driftReport.hasDrift, false);
});

test('ScraperTelemetry ignores sparse (<25%) fields in auto-captured baselines while catching genuine core-field collapse', () => {
  const telemetry = new ScraperTelemetry({ persist: false });
  // Run 1 auto-captures baseline: 100% address/saleDate/state/zip, 1/50 (2%) openingBid
  const run1 = Array.from({ length: 50 }, (_, i) => ({
    address: `${100 + i} Bergen Ave`,
    saleDate: '2026-12-01',
    state: 'NJ',
    zip: '07601',
    openingBid: i === 0 ? 150000 : null,
  }));
  telemetry.recordRun('CivilViewSparse', run1, 100, null, { scopeKey: 'civilview:counties:NJ:Bergen' });
  assert.equal(telemetry.getHealthReport().details.CivilViewSparse.driftDetected, false);

  // Run 2 on the same slice has 0% openingBid (0.02 -> 0.00), while all core fields stay 100%: must NOT false-alarm
  const run2 = Array.from({ length: 20 }, (_, i) => ({
    address: `${200 + i} Bergen Ave`,
    saleDate: '2026-12-01',
    state: 'NJ',
    zip: '07601',
    openingBid: null,
  }));
  telemetry.recordRun('CivilViewSparse', run2, 100, null, { scopeKey: 'civilview:counties:NJ:Bergen' });
  assert.equal(telemetry.getHealthReport().details.CivilViewSparse.driftDetected, false);

  // Run 3 drops a core (>= 25%) baseline field (saleDate 100% -> 0%): MUST trigger driftDetected
  const run3 = Array.from({ length: 20 }, (_, i) => ({
    address: `${300 + i} Bergen Ave`,
    saleDate: null,
    state: 'NJ',
    zip: '07601',
    openingBid: null,
  }));
  telemetry.recordRun('CivilViewSparse', run3, 100, null, { scopeKey: 'civilview:counties:NJ:Bergen' });
  assert.equal(telemetry.getHealthReport().details.CivilViewSparse.driftDetected, true);
  assert.equal(telemetry.history.CivilViewSparse.driftReport.yieldCollapse, true);
});
