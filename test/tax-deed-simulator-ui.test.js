'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeRedemptionYield } = require('../src/lib/underwriting.ts');
const { loadStateCounts, loadStateCounties } = require('../src/lib/state-coverage.ts');
const { summarize } = require('../server/discovery/coverage-matrix.js');

test('Tax Deed Yield Simulator: Georgia 20% Yr 1 vs 40% Yr 2 flat statutory penalty', () => {
  // Year 1 holding (e.g. 6 months / 180 days or 12 months / 360 days)
  const gaYr1 = computeRedemptionYield({
    purchasePrice: 50000,
    state: 'GA',
    redemptionDays: 180,
    isTaxSale: true,
  });
  assert.ok(gaYr1);
  assert.equal(gaYr1.penaltyRatePct, 20);
  assert.equal(gaYr1.legalRegime, 'Flat Statutory Penalty');
  assert.equal(gaYr1.yieldType, 'penalty');
  assert.equal(gaYr1.redemptionPayout, 60000);
  assert.equal(gaYr1.penaltyAmount, 10000);
  assert.equal(gaYr1.annualizedYieldPct, 40.6); // 20% in 180 days = 40.6% annualized IRR
  assert.ok(gaYr1.statute.includes('O.C.G.A. § 48-4-42'));
  assert.ok(gaYr1.statute.includes('20% statutory penalty in year one'));
  assert.equal(gaYr1.redemptionPeriodLabel, '6 Months (180 Days)');

  // Year 2 holding (e.g. 24 months / 720 days or 400 days)
  const gaYr2 = computeRedemptionYield({
    purchasePrice: 50000,
    state: 'GA',
    redemptionDays: 720,
    isTaxSale: true,
  });
  assert.ok(gaYr2);
  assert.equal(gaYr2.penaltyRatePct, 40);
  assert.equal(gaYr2.legalRegime, 'Flat Statutory Penalty');
  assert.equal(gaYr2.redemptionPayout, 70000);
  assert.equal(gaYr2.penaltyAmount, 20000);
  assert.equal(gaYr2.annualizedYieldPct, 20.3); // 40% over 720 days = 20.3% annualized IRR
  assert.ok(gaYr2.statute.includes('O.C.G.A. § 48-4-42'));
  assert.ok(gaYr2.statute.includes('40% statutory penalty in year two'));
  assert.equal(gaYr2.redemptionPeriodLabel, '24 Months (720 Days)');
});

test('Tax Deed Yield Simulator: Texas 25% Yr 1 vs 50% Yr 2 flat statutory penalty', () => {
  // Year 1 holding (e.g. 6 months / 180 days)
  const txYr1 = computeRedemptionYield({
    purchasePrice: 100000,
    state: 'TX',
    redemptionDays: 180,
    isTaxSale: true,
  });
  assert.ok(txYr1);
  assert.equal(txYr1.penaltyRatePct, 25);
  assert.equal(txYr1.legalRegime, 'Flat Statutory Penalty');
  assert.equal(txYr1.yieldType, 'penalty');
  assert.equal(txYr1.redemptionPayout, 125000);
  assert.equal(txYr1.penaltyAmount, 25000);
  assert.ok(txYr1.annualizedYieldPct > 50); // 25% in 180 days = 50.7% annualized IRR
  assert.ok(txYr1.statute.includes('Tex. Tax Code § 34.21'));
  assert.equal(txYr1.redemptionPeriodLabel, '6 Months (180 Days)');

  // Year 2 holding (e.g. 24 months / 720 days for homestead / agricultural land)
  const txYr2 = computeRedemptionYield({
    purchasePrice: 100000,
    state: 'TX',
    redemptionDays: 720,
    isTaxSale: true,
    isHomestead: true,
  });
  assert.ok(txYr2);
  assert.equal(txYr2.penaltyRatePct, 50);
  assert.equal(txYr2.legalRegime, 'Flat Statutory Penalty');
  assert.equal(txYr2.redemptionPayout, 150000);
  assert.equal(txYr2.penaltyAmount, 50000);
  assert.equal(txYr2.annualizedYieldPct, 25.3); // 50% over 720 days = 25.3% annualized IRR
  assert.ok(txYr2.statute.includes('Tex. Tax Code § 34.21(a)'));
  assert.ok(txYr2.statute.includes('50% statutory penalty in year two'));
  assert.equal(txYr2.redemptionPeriodLabel, '24 Months (720 Days)');
});

test('Tax Deed Yield Simulator: Tennessee 12% per annum simple interest', () => {
  const tn12mo = computeRedemptionYield({
    purchasePrice: 80000,
    state: 'TN',
    redemptionDays: 365,
    isTaxSale: true,
  });
  assert.ok(tn12mo);
  assert.equal(tn12mo.penaltyRatePct, 12);
  assert.equal(tn12mo.legalRegime, 'Statutory Interest');
  assert.equal(tn12mo.yieldType, 'interest');
  assert.equal(tn12mo.redemptionPayout, 89600);
  assert.equal(tn12mo.penaltyAmount, 9600);
  assert.equal(tn12mo.annualizedYieldPct, 12);
  assert.ok(tn12mo.statute.includes('T.C.A. § 67-5-2701'));
  assert.ok(tn12mo.statute.includes('12% per annum simple interest'));
  assert.equal(tn12mo.redemptionPeriodLabel, '12 Months (365 Days)');

  // 6 months holding (180 days)
  const tn6mo = computeRedemptionYield({
    purchasePrice: 80000,
    state: 'TN',
    redemptionDays: 180,
    isTaxSale: true,
  });
  assert.ok(tn6mo);
  assert.equal(tn6mo.penaltyRatePct, 12);
  assert.equal(tn6mo.legalRegime, 'Statutory Interest');
  assert.equal(tn6mo.redemptionPayout, 84734);
  assert.equal(tn6mo.penaltyAmount, 4734);
  assert.equal(tn6mo.annualizedYieldPct, 12);
  assert.equal(tn6mo.redemptionPeriodLabel, '6 Months (180 Days)');
});

test('Tax Deed Yield Simulator: Florida 0-day post-sale redemption (immediate deed)', () => {
  const fl = computeRedemptionYield({
    purchasePrice: 100000,
    state: 'FL',
    redemptionDays: 0,
    isTaxSale: true,
  });
  assert.ok(fl);
  assert.equal(fl.penaltyRatePct, 0);
  assert.equal(fl.legalRegime, 'Immediate Deed');
  assert.equal(fl.regime, 'post_redemption_deed');
  assert.equal(fl.redemptionPayout, 100000);
  assert.equal(fl.penaltyAmount, 0);
  assert.equal(fl.annualizedYieldPct, 0);
  assert.equal(fl.redemptionPeriodLabel, '0 Days (Immediate Deed)');
  assert.ok(fl.statute.includes('Fla. Stat. § 197.542'));
  assert.ok(fl.statute.includes('0-day post-sale redemption'));
});

test('Resilient Programmatic SEO: loadStateCounts falls back to local coverage matrix when API unreachable', async () => {
  const savedUrl = process.env.PROPERTY_API_URL;
  // Point to a port that cannot be connected to, forcing network failure
  process.env.PROPERTY_API_URL = 'http://127.0.0.1:59998';
  try {
    const result = await loadStateCounts();
    assert.equal(result.error, null, 'Error should be null when fallback succeeds');
    assert.ok(Array.isArray(result.rows), 'Rows should be an array');
    assert.ok(result.rows.length > 0, 'Rows should have elements from local coverage matrix');

    // Confirm descending sort by count
    for (let i = 1; i < result.rows.length; i++) {
      assert.ok(result.rows[i - 1].count >= result.rows[i].count, 'Rows should be sorted descending by count');
    }

    // Verify key states with published records are present
    const stateMap = Object.fromEntries(result.rows.map((r) => [r.state, r.count]));
    assert.ok(stateMap.NJ > 0, 'NJ should have listings');
    assert.ok(stateMap.TX > 0, 'TX should have listings');
    assert.ok(stateMap.GA > 0, 'GA should have listings');

    // Cross-verify with directly invoked coverage matrix summarize()
    const matrix = summarize();
    assert.equal(stateMap.NJ, matrix.liveByState.byStateTotal.NJ);
    assert.equal(stateMap.TX, matrix.liveByState.byStateTotal.TX);
    assert.equal(stateMap.GA, matrix.liveByState.byStateTotal.GA);
  } finally {
    process.env.PROPERTY_API_URL = savedUrl;
  }
});

test('Resilient Programmatic SEO: loadStateCounts falls back when API returns HTTP 503 or readError', async (t) => {
  const originalFetch = globalThis.fetch;
  try {
    // 1. Mock fetch responding with HTTP 503 Service Unavailable
    globalThis.fetch = async () => new Response('Service Unavailable', { status: 503 });
    const res503 = await loadStateCounts();
    assert.equal(res503.error, null, 'Should fallback on HTTP 503');
    assert.ok(res503.rows.length > 0);

    // 2. Mock fetch responding with readError in coverage JSON
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ liveByState: { readError: 'EACCES reading live record store' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const resReadError = await loadStateCounts();
    assert.equal(resReadError.error, null, 'Should fallback on readError payload');
    assert.ok(resReadError.rows.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Resilient Programmatic SEO: loadStateCounties falls back to local coverage matrix when API unreachable', async () => {
  const savedUrl = process.env.PROPERTY_API_URL;
  process.env.PROPERTY_API_URL = 'http://127.0.0.1:59998';
  try {
    const gaResult = await loadStateCounties('GA');
    assert.equal(gaResult.error, null, 'Error should be null when fallback succeeds');
    assert.ok(gaResult.total > 0, 'GA total should be > 0');
    assert.ok(Array.isArray(gaResult.counties), 'Counties should be an array');
    assert.ok(gaResult.counties.length > 0, 'GA should have county entries');

    const fulton = gaResult.counties.find((c) => c.county === 'Fulton');
    assert.ok(fulton, 'Fulton County should be present in GA');
    assert.ok(fulton.count > 0, 'Fulton County count should be > 0');
    assert.ok(Array.isArray(fulton.sources), 'Fulton County should list sources');

    const txResult = await loadStateCounties('TX');
    assert.equal(txResult.error, null);
    assert.ok(txResult.total > 0);
    assert.ok(txResult.counties.length > 0);

    // Cross-verify with directly invoked coverage matrix summarize()
    const matrix = summarize();
    assert.equal(gaResult.total, matrix.liveByState.byStateTotal.GA);
    assert.equal(txResult.total, matrix.liveByState.byStateTotal.TX);
  } finally {
    process.env.PROPERTY_API_URL = savedUrl;
  }
});
