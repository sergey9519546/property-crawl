'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretAssessorParcel } = require('../server/enrichment/assessor-reading');

function parcel(total) {
  return { assessedValue: { total, land: null, improvements: null }, canonicalApn: '123', landUse: 'RES' };
}

test('assessor reading converts Bexar and Orange 1:1 and scores the opening amount', () => {
  const bexar = interpretAssessorParcel({ countyKey: 'TX-BEXAR', parcel: parcel(100000), openingBid: 40000 });
  assert.equal(bexar.marketComparison, 100000);
  assert.equal(bexar.rawFigure, 100000);
  assert.equal(bexar.ratio, 0.4);
  assert.equal(bexar.dealScore, 78);
  assert.equal(bexar.evidenceClass, 'assessor-figure-v1');
  assert.equal(bexar.estLow, undefined);
  assert.equal(bexar.isAppraisal, false);

  const orange = interpretAssessorParcel({ countyKey: 'FL-ORANGE', parcel: parcel(200000), openingBid: 100000 });
  assert.equal(orange.marketComparison, 200000);
  assert.equal(orange.dealScore, 65);
});

test('assessor reading converts Alachua and Harris 1:1 and scores the opening amount', () => {
  const alachua = interpretAssessorParcel({ countyKey: 'FL-ALACHUA', parcel: parcel(150000), openingBid: 60000 });
  assert.equal(alachua.marketComparison, 150000);
  assert.equal(alachua.rawFigure, 150000);
  assert.equal(alachua.ratio, 0.4);
  assert.equal(alachua.dealScore, 78);
  assert.match(alachua.citation, /193\.011/);

  const harris = interpretAssessorParcel({ countyKey: 'TX-HARRIS', parcel: parcel(250000), openingBid: 125000 });
  assert.equal(harris.marketComparison, 250000);
  assert.equal(harris.dealScore, 65);
  assert.match(harris.citation, /23\.01/);
});

test('assessor reading converts Cuyahoga taxable value at 35 percent', () => {
  const reading = interpretAssessorParcel({ countyKey: 'OH-CUYAHOGA', parcel: parcel(35000), openingBid: 50000 });
  assert.equal(reading.rawFigure, 35000);
  assert.equal(reading.marketComparison, 100000);
  assert.equal(reading.ratio, 0.5);
  assert.equal(reading.dealScore, 65);
  assert.match(reading.citation, /5715\.01/);
});

test('assessor reading withholds a score for Cook, Clark, Bannock, and Washoe', () => {
  for (const countyKey of ['IL-COOK', 'NV-CLARK', 'ID-BANNOCK', 'NV-WASHOE']) {
    const reading = interpretAssessorParcel({ countyKey, parcel: parcel(80000), openingBid: 20000 });
    assert.equal(reading.rawFigure, 80000);
    assert.equal(reading.marketComparison, null);
    assert.equal(reading.dealScore, null);
    assert.ok(reading.withheldReason);
  }
  // Washoe has a reason specific to its unconfirmed full-cash-value chain,
  // not the generic "no conversion configured" fallback.
  const washoe = interpretAssessorParcel({ countyKey: 'NV-WASHOE', parcel: parcel(80000), openingBid: 20000 });
  assert.match(washoe.withheldReason, /NRS 361\.227/);
});

// Enrolled 2026-10-21 from live-verified endpoints; the conversion math is
// pinned per county so a registry edit can never silently change the ratio.
test('assessor reading converts the 2026-10-21 enrollments 1:1 with published citations', () => {
  const franklin = interpretAssessorParcel({ countyKey: 'OH-FRANKLIN', parcel: parcel(300000), openingBid: 120000 });
  assert.equal(franklin.marketComparison, 300000);
  assert.equal(franklin.ratio, 0.4);
  assert.equal(franklin.dealScore, 78);
  assert.match(franklin.citation, /TOTVALUEBASE/);
  assert.match(franklin.citation, /5715\.01/);

  const hamilton = interpretAssessorParcel({ countyKey: 'OH-HAMILTON', parcel: parcel(282790), openingBid: 100000 });
  assert.equal(hamilton.marketComparison, 282790);
  assert.match(hamilton.citation, /MKT_TOTAL_VAL/);
  assert.match(hamilton.citation, /5715\.01/);

  const tarrant = interpretAssessorParcel({ countyKey: 'TX-TARRANT', parcel: parcel(703452), openingBid: 350000 });
  assert.equal(tarrant.marketComparison, 703452);
  assert.match(tarrant.citation, /APPRAISED_VALUE/);
  assert.match(tarrant.citation, /23\.01/);
});

test('the 2026-10-21 enrollment registry entries resolve from county names and carry verified endpoints', () => {
  const { resolveCountyKey, COUNTY_ARCGIS_REGISTRY } = require('../server/enrichment/arcgis-parcels');
  for (const [state, county, key] of [
    ['OH', 'Franklin', 'OH-FRANKLIN'],
    ['OH', 'Hamilton', 'OH-HAMILTON'],
    ['TX', 'Tarrant', 'TX-TARRANT'],
    ['NV', 'Washoe', 'NV-WASHOE'],
  ]) {
    assert.equal(resolveCountyKey(state, county), key, `${key} must resolve`);
    const entry = COUNTY_ARCGIS_REGISTRY[key];
    assert.match(entry.endpoint, /^https:\/\//, `${key} endpoint must be https`);
    assert.ok(entry.apnField && entry.assessedTotalField, `${key} must name its APN and value fields`);
  }
});

test('assessor reading withholds a score when the county is not enrolled or the bid is missing', () => {
  const outside = interpretAssessorParcel({ countyKey: null, parcel: parcel(80000), openingBid: 20000 });
  assert.equal(outside.enrolled, false);
  assert.equal(outside.dealScore, null);
  assert.match(outside.withheldReason, /not in the assessor registry/);

  const noBid = interpretAssessorParcel({ countyKey: 'TX-BEXAR', parcel: parcel(100000), openingBid: null });
  assert.equal(noBid.marketComparison, 100000);
  assert.equal(noBid.dealScore, null);
  assert.match(noBid.withheldReason, /Opening amount/);
});
