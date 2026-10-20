'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DISCLAIMER,
  COUNTY_MARKET_BENCHMARKS,
  normalizeCountyKey,
  deriveStateHpiYoy,
  classifyMarketTemperature,
  getCountyMarketTrends,
  enrichListingWithMacroTrends
} = require('../../server/enrichment/macro-valuation-data');

test('getCountyMarketTrends retrieves verified benchmarks for major counties', () => {
  // 1. Cuyahoga County, OH
  const cuyahoga = getCountyMarketTrends('OH', 'Cuyahoga');
  assert.equal(cuyahoga.state, 'OH');
  assert.equal(cuyahoga.county, 'Cuyahoga');
  assert.equal(cuyahoga.medianSalePrice, 215000);
  assert.equal(cuyahoga.yoyPriceChangePct, 5.4);
  assert.equal(cuyahoga.marketTemperature, 'hot');
  assert.ok(cuyahoga.trendLabel.includes('+5.4% YoY'));
  assert.equal(cuyahoga.source, 'FHFA_AND_PUBLIC_BENCHMARKS');
  assert.equal(cuyahoga.disclaimer, DISCLAIMER);

  // Normalization with "County" suffix
  const cuyahogaSuffix = getCountyMarketTrends('OH', 'Cuyahoga County');
  assert.equal(cuyahogaSuffix.medianSalePrice, 215000);

  // 2. Cook County, IL
  const cook = getCountyMarketTrends('IL', 'Cook');
  assert.equal(cook.state, 'IL');
  assert.equal(cook.county, 'Cook');
  assert.equal(cook.medianSalePrice, 335000);
  assert.equal(cook.yoyPriceChangePct, 4.2);
  assert.equal(cook.marketTemperature, 'balanced');
  assert.ok(cook.trendLabel.includes('+4.2% YoY'));

  // 3. Orange County, FL
  const orange = getCountyMarketTrends('FL', 'Orange County');
  assert.equal(orange.state, 'FL');
  assert.equal(orange.county, 'Orange');
  assert.equal(orange.medianSalePrice, 425000);
  assert.equal(orange.yoyPriceChangePct, 3.8);
  assert.equal(orange.marketTemperature, 'hot');
  assert.ok(orange.trendLabel.includes('+3.8% YoY'));

  // 4. Philadelphia County, PA
  const phila = getCountyMarketTrends('PA', 'Philadelphia');
  assert.equal(phila.state, 'PA');
  assert.equal(phila.county, 'Philadelphia');
  assert.equal(phila.medianSalePrice, 240000);
  assert.equal(phila.yoyPriceChangePct, 3.1);
  assert.equal(phila.marketTemperature, 'balanced');

  // 5. Bexar County, TX
  const bexar = getCountyMarketTrends('TX', 'Bexar');
  assert.equal(bexar.state, 'TX');
  assert.equal(bexar.county, 'Bexar');
  assert.equal(bexar.medianSalePrice, 305000);
  assert.equal(bexar.yoyPriceChangePct, 2.5);
  assert.equal(bexar.marketTemperature, 'balanced');
});

test('getCountyMarketTrends provides clean fallback for unbenchmarked rural counties', () => {
  // Rural county in Nebraska (Cherry County)
  const ruralNe = getCountyMarketTrends('NE', 'Cherry');
  assert.equal(ruralNe.state, 'NE');
  assert.equal(ruralNe.county, 'Cherry');
  assert.equal(ruralNe.medianSalePrice, null, 'Unbenchmarked rural county median sale price must be null');
  assert.equal(typeof ruralNe.yoyPriceChangePct, 'number', 'Derives YoY from statewide FHFA HPI index');
  assert.ok(['hot', 'balanced', 'cold'].includes(ruralNe.marketTemperature));
  assert.ok(ruralNe.trendLabel.includes('Statewide FHFA Trend'));
  assert.equal(ruralNe.source, 'FHFA_AND_PUBLIC_BENCHMARKS');
  assert.equal(ruralNe.disclaimer, DISCLAIMER);

  // Unknown state/county
  const unknown = getCountyMarketTrends('XX', 'Nowhere');
  assert.equal(unknown.state, 'XX');
  assert.equal(unknown.county, 'Nowhere');
  assert.equal(unknown.medianSalePrice, null);
  assert.equal(unknown.yoyPriceChangePct, null);
  assert.equal(unknown.marketTemperature, 'balanced');
  assert.equal(unknown.trendLabel, 'Macro Trend Unavailable');
  assert.equal(unknown.source, 'FHFA_AND_PUBLIC_BENCHMARKS');
});

test('enrichListingWithMacroTrends safely attaches macroTrends and preserves honesty invariants', () => {
  // Listing with existing estLow and estHigh
  const listingWithEstimates = {
    id: 'listing-oh-101',
    address: '1234 E 55th St',
    city: 'Cleveland',
    county: 'Cuyahoga',
    state: 'OH',
    openingBid: 45000,
    estLow: 110000,
    estHigh: 135000
  };

  const enriched1 = enrichListingWithMacroTrends(listingWithEstimates);

  // Original fields preserved
  assert.equal(enriched1.id, 'listing-oh-101');
  assert.equal(enriched1.address, '1234 E 55th St');
  assert.equal(enriched1.openingBid, 45000);

  // Strict honesty invariants: estLow & estHigh are NOT overwritten
  assert.equal(enriched1.estLow, 110000);
  assert.equal(enriched1.estHigh, 135000);

  // Attached macroTrends
  assert.ok(enriched1.macroTrends);
  assert.equal(enriched1.macroTrends.county, 'Cuyahoga');
  assert.equal(enriched1.macroTrends.medianSalePrice, 215000);
  assert.equal(enriched1.macroTrends.marketTemperature, 'hot');

  // Listing WITHOUT estLow or estHigh
  const listingWithoutEstimates = {
    id: 'listing-fl-202',
    address: '500 Orange Ave',
    city: 'Orlando',
    county: 'Orange',
    state: 'FL',
    openingBid: 120000
  };

  const enriched2 = enrichListingWithMacroTrends(listingWithoutEstimates);

  // Strict honesty invariant: estLow & estHigh are NEVER fabricated
  assert.equal(enriched2.estLow, undefined);
  assert.equal(enriched2.estHigh, undefined);
  assert.ok(!('estLow' in enriched2));
  assert.ok(!('estHigh' in enriched2));

  // Attached macroTrends
  assert.ok(enriched2.macroTrends);
  assert.equal(enriched2.macroTrends.county, 'Orange');
  assert.equal(enriched2.macroTrends.medianSalePrice, 425000);
  assert.equal(enriched2.macroTrends.marketTemperature, 'hot');
});

test('enrichListingWithMacroTrends handles null or non-object inputs safely', () => {
  assert.equal(enrichListingWithMacroTrends(null), null);
  assert.equal(enrichListingWithMacroTrends(undefined), undefined);
  assert.equal(enrichListingWithMacroTrends('invalid'), 'invalid');
});
