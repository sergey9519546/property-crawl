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

test('assessor reading withholds a score for Cook, Clark, Bannock, Washoe, and Macomb', () => {
  for (const countyKey of ['IL-COOK', 'NV-CLARK', 'ID-BANNOCK', 'NV-WASHOE', 'MI-MACOMB']) {
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
  // Macomb's SEV is the statutory 50%-of-true-cash-value figure, but unlike
  // Wayne its deviation from 50 percent is unmeasured (no sale-price column),
  // and Michigan prescribes equality rather than a one-sided cap — so the
  // conversion must stay withheld until measured.
  const macomb = interpretAssessorParcel({ countyKey: 'MI-MACOMB', parcel: parcel(152100), openingBid: 20000 });
  assert.match(macomb.withheldReason, /211\.27a\(1\)/);
  assert.match(macomb.withheldReason, /unmeasured/);
  assert.equal(macomb.field, 'mborsev_0');
  assert.equal(macomb.rawFigure, 152100);
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

// Enrolled 2026-11-01 from the live-verified Maricopa County parcel layer
// (gis.maricopa.gov Reference/ParcelCityCounty layer 0). Arizona publishes the
// market figure directly: A.R.S. § 42-11001 defines full cash value as market
// value, so FullCashValue converts 1:1 — while AssessedFullCashValue (FCV ×
// statutory ratio) is the taxed basis and must never be read as market.
test('assessor reading converts Maricopa full cash value 1:1 with the A.R.S. citation', () => {
  // Real values captured from the live layer: APN 10101010, Avondale.
  const maricopa = interpretAssessorParcel({ countyKey: 'AZ-MARICOPA', parcel: parcel(10205862), openingBid: 5000000 });
  assert.equal(maricopa.enrolled, true);
  assert.equal(maricopa.marketComparison, 10205862);
  assert.equal(Math.round(maricopa.ratio * 100) / 100, 0.49);
  assert.equal(maricopa.dealScore, 66);
  assert.match(maricopa.citation, /FullCashValue/);
  assert.match(maricopa.citation, /42-11001/);
  // The citation must carry the statutory cap (the figure cannot exceed market
  // value, so the discount is a conservative lower bound) and name the taxed
  // basis it deliberately excludes. A citation that simply equates full cash
  // value with market value would overstate confidence in the comparison.
  assert.match(maricopa.citation, /shall not be greater than market value/);
  assert.match(maricopa.citation, /conservative lower bound/);
  assert.match(maricopa.citation, /LimitedPropertyValue/);
  assert.equal(maricopa.field, 'FullCashValue');
  assert.equal(maricopa.withheldReason, null);

  // The taxed basis (AssessedFullCashValue) must NOT be silently accepted as
  // market: an interpreter configured against it would read 10205862 × ratio
  // and overstate the discount. This guard pins the field choice.
  assert.notEqual(maricopa.field, 'AssessedFullCashValue');
});

test('the Maricopa enrollment registry entry resolves and carries the live-verified layer', () => {
  const { resolveCountyKey, COUNTY_ARCGIS_REGISTRY } = require('../server/enrichment/arcgis-parcels');
  assert.equal(resolveCountyKey('AZ', 'Maricopa'), 'AZ-MARICOPA');
  assert.equal(resolveCountyKey('AZ', 'MARICOPA COUNTY'), 'AZ-MARICOPA');
  const entry = COUNTY_ARCGIS_REGISTRY['AZ-MARICOPA'];
  assert.match(entry.endpoint, /^https:\/\/gis\.maricopa\.gov\//);
  assert.match(entry.endpoint, /Reference\/ParcelCityCounty\/MapServer\/0\/query$/);
  assert.equal(entry.apnField, 'APN');
  assert.equal(entry.assessedTotalField, 'FullCashValue');
  assert.equal(entry.assessedLandField, 'LandFullCashValue');
  assert.equal(entry.assessedImprvField, 'ImprovementFullCashValue');
  assert.equal(entry.taxYearField, 'TaxYear');
  assert.equal(entry.valuationYearField, 'ParcelValuationYear');
});

// Enrolled 2026-11-01 from the live-verified Pima County layer
// (gisdata.pima.gov GISOpenData/LandRecords layer 12, 448,600 parcels). The
// conversion rests on the same statewide statute as Maricopa, but this layer has
// no sale-price column, so the citation must not borrow Maricopa's sampled
// ratio as if it had been measured here.
test('assessor reading converts Pima full cash value 1:1 with the A.R.S. citation', () => {
  // Real values captured from the live layer: APN 10101003E (2150 W Orange Grove Rd).
  const pima = interpretAssessorParcel({ countyKey: 'AZ-PIMA', parcel: parcel(3051606), openingBid: 1500000 });
  assert.equal(pima.enrolled, true);
  assert.equal(pima.marketComparison, 3051606);
  assert.equal(Math.round(pima.ratio * 100) / 100, 0.49);
  assert.equal(pima.dealScore, 66);
  assert.match(pima.citation, /42-11001/);
  assert.match(pima.citation, /conservative lower bound/);
  assert.match(pima.citation, /no sale-price column/);
  assert.doesNotMatch(pima.citation, /0\.82/);
  assert.equal(pima.field, 'FCV');
  assert.equal(pima.withheldReason, null);
});

test('the Pima enrollment registry entry resolves and carries the live-verified layer', () => {
  const { resolveCountyKey, COUNTY_ARCGIS_REGISTRY } = require('../server/enrichment/arcgis-parcels');
  assert.equal(resolveCountyKey('AZ', 'Pima'), 'AZ-PIMA');
  assert.equal(resolveCountyKey('AZ', 'PIMA COUNTY'), 'AZ-PIMA');
  const entry = COUNTY_ARCGIS_REGISTRY['AZ-PIMA'];
  assert.equal(entry.fips, '04019');
  assert.match(entry.endpoint, /^https:\/\/gisdata\.pima\.gov\//);
  assert.match(entry.endpoint, /GISOpenData\/LandRecords\/MapServer\/12\/query$/);
  assert.equal(entry.apnField, 'PARCEL');
  assert.equal(entry.assessedTotalField, 'FCV');
  assert.equal(entry.taxYearField, 'TAXYR');
});

// Enrolled 2026-11-01 from live-verified county-owned layers. Mohave's layer is
// a naming trap (the column called TOTAL_FCV_VALUE is the taxed basis), so the
// registry pin and citation both guard the real full cash value field. Yuma's
// FCV sits at ~0.66 of recent sale prices - market level, not a taxed fraction -
// with the statutory cap keeping the comparison conservative.
test('assessor reading converts Mohave full cash value and rejects the taxed-basis column', () => {
  // Real values from the live layer: APN TPARCEL 22802081, FULL_CASH_VALUE 864270.
  const mohave = interpretAssessorParcel({ countyKey: 'AZ-MOHAVE', parcel: parcel(864270), openingBid: 400000 });
  assert.equal(mohave.enrolled, true);
  assert.equal(mohave.marketComparison, 864270);
  assert.equal(Math.round(mohave.ratio * 100) / 100, 0.46);
  assert.equal(mohave.dealScore, 70);
  assert.match(mohave.citation, /FULL_CASH_VALUE/);
  assert.match(mohave.citation, /42-11001/);
  assert.match(mohave.citation, /conservative lower bound/);
  // The trap is named in the citation: TOTAL_FCV_VALUE is the taxed basis.
  assert.match(mohave.citation, /TOTAL_FCV_VALUE is the taxed basis/);
  assert.equal(mohave.field, 'FULL_CASH_VALUE');
  assert.equal(mohave.withheldReason, null);
});

test('assessor reading converts Yuma full cash value with the sale-price corroboration on the citation', () => {
  // Real values from the live layer: APN PIDNUM 70053293, TOTAL_FULL_CASH_VALUE 152118.
  const yuma = interpretAssessorParcel({ countyKey: 'AZ-YUMA', parcel: parcel(152118), openingBid: 100000 });
  assert.equal(yuma.enrolled, true);
  assert.equal(yuma.marketComparison, 152118);
  assert.equal(Math.round(yuma.ratio * 100) / 100, 0.66);
  assert.equal(yuma.dealScore, 45);
  assert.match(yuma.citation, /TOTAL_FULL_CASH_VALUE/);
  assert.match(yuma.citation, /42-11001/);
  assert.match(yuma.citation, /conservative lower bound/);
  assert.match(yuma.citation, /~0\.66/);
  assert.equal(yuma.field, 'TOTAL_FULL_CASH_VALUE');
  assert.equal(yuma.withheldReason, null);
});

test('the Mohave and Yuma registry entries resolve and carry the live-verified layers', () => {
  const { resolveCountyKey, COUNTY_ARCGIS_REGISTRY } = require('../server/enrichment/arcgis-parcels');
  assert.equal(resolveCountyKey('AZ', 'Mohave'), 'AZ-MOHAVE');
  assert.equal(resolveCountyKey('AZ', 'Yuma'), 'AZ-YUMA');
  const mohave = COUNTY_ARCGIS_REGISTRY['AZ-MOHAVE'];
  assert.equal(mohave.fips, '04015');
  assert.match(mohave.endpoint, /^https:\/\/mcgis\.mohave\.gov\//);
  assert.match(mohave.endpoint, /PARCELS\/MapServer\/14\/query$/);
  // TPARCEL is the separator-free APN spelling; the dashed spellings would
  // never match the repo's normalized LIKE lookup.
  assert.equal(mohave.apnField, 'TPARCEL');
  assert.equal(mohave.assessedTotalField, 'FULL_CASH_VALUE');
  assert.notEqual(mohave.assessedTotalField, 'TOTAL_FCV_VALUE');
  assert.equal(mohave.assessedLandField, 'LANDVALUE');
  assert.equal(mohave.assessedImprvField, 'IMPVALUE');
  assert.equal(mohave.taxYearField, 'TAX_YEAR');
  const yuma = COUNTY_ARCGIS_REGISTRY['AZ-YUMA'];
  assert.equal(yuma.fips, '04027');
  assert.match(yuma.endpoint, /^https:\/\/arcgis\.yumacountyaz\.gov\//);
  assert.equal(yuma.apnField, 'PIDNUM');
  assert.equal(yuma.assessedTotalField, 'TOTAL_FULL_CASH_VALUE');
  assert.equal(yuma.assessedLandField, 'LAND_FULL_CASH_VALUE');
  assert.equal(yuma.assessedImprvField, 'IMP_FULL_CASH_VALUE');
  assert.equal(yuma.taxYearField, 'TAX_YEAR');
});

// Enrolled 2026-11-01 from live-verified layers. Michigan's statutory 50%
// taxable fraction (MCL 211.27a(1)) grosses Detroit's assessed value to a
// market figure that the county's own recorded sales show is conservative (the
// roll assesses at ~0.33 of sale prices, below the statutory 50%). The test
// pins the fraction, the arithmetic, and the disclosure.
test('assessor reading converts Wayne assessed value at the statutory 50 percent', () => {
  // Real values from the live layer: parcel 15008031-3, assessed 905600.
  const wayne = interpretAssessorParcel({ countyKey: 'MI-WAYNE', parcel: parcel(905600), openingBid: 400000 });
  assert.equal(wayne.enrolled, true);
  assert.equal(wayne.marketComparison, 1811200);
  assert.equal(Math.round(wayne.ratio * 100) / 100, 0.22);
  // (1 - 0.2208) * 130 = 101 clamps at the 99 score ceiling.
  assert.equal(wayne.dealScore, 99);
  assert.match(wayne.citation, /211\.27a/);
  assert.match(wayne.citation, /50% of true cash value/);
  assert.match(wayne.citation, /~0\.33/);
  assert.match(wayne.citation, /conservative lower bound/);
  assert.equal(wayne.field, 'amt_assessed_value');
  assert.equal(wayne.withheldReason, null);
});

test('assessor reading converts Philadelphia market value 1:1 with the measured citation', () => {
  // Real values from the live layer: parcel 301325005, market_value 717800.
  const philly = interpretAssessorParcel({ countyKey: 'PA-PHILADELPHIA', parcel: parcel(717800), openingBid: 500000 });
  assert.equal(philly.enrolled, true);
  assert.equal(philly.marketComparison, 717800);
  assert.equal(Math.round(philly.ratio * 100) / 100, 0.7);
  assert.equal(philly.dealScore, 39);
  assert.match(philly.citation, /market_value/);
  assert.match(philly.citation, /~0\.97/);
  assert.match(philly.citation, /taxed components/);
  assert.equal(philly.field, 'market_value');
  assert.equal(philly.withheldReason, null);
});

test('assessor reading converts Allegheny County market value 1:1 with the measured citation', () => {
  // Real values from the live layer: parcel 0001C00228000400, FAIRMARKETTOTAL 410100.
  const allegheny = interpretAssessorParcel({ countyKey: 'PA-ALLEGHENY', parcel: parcel(410100), openingBid: 300000 });
  assert.equal(allegheny.enrolled, true);
  assert.equal(allegheny.marketComparison, 410100);
  assert.equal(Math.round(allegheny.ratio * 100) / 100, 0.73);
  assert.equal(allegheny.dealScore, 35);
  assert.match(allegheny.citation, /FAIRMARKETTOTAL/);
  assert.match(allegheny.citation, /72 P.S./);
  assert.equal(allegheny.field, 'FAIRMARKETTOTAL');
  assert.equal(allegheny.withheldReason, null);
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

test('assessor reading converts Florida counties 1:1 with Fla. Stat. § 193.011 citation', () => {
  for (const countyKey of ['FL-BROWARD', 'FL-PALMBEACH', 'FL-MIAMI-DADE', 'FL-HILLSBOROUGH', 'FL-MIAMI DADE']) {
    const reading = interpretAssessorParcel({ countyKey, parcel: parcel(200000), openingBid: 80000 });
    assert.equal(reading.enrolled, true);
    assert.equal(reading.found, true);
    assert.equal(reading.rawFigure, 200000);
    assert.equal(reading.marketComparison, 200000);
    assert.equal(reading.ratio, 0.4);
    assert.equal(reading.dealScore, 78);
    assert.match(reading.citation, /Fla\. Stat\. § 193\.011/);
  }
});

test('assessor reading handles Ohio market comparisons for Montgomery and Summit', () => {
  const montgomery = interpretAssessorParcel({ countyKey: 'OH-MONTGOMERY', parcel: parcel(150000), openingBid: 60000 });
  assert.equal(montgomery.enrolled, true);
  assert.equal(montgomery.marketComparison, 150000);
  assert.equal(montgomery.ratio, 0.4);
  assert.equal(montgomery.dealScore, 78);
  assert.match(montgomery.citation, /5715\.01/);

  const summit = interpretAssessorParcel({ countyKey: 'OH-SUMMIT', parcel: parcel(120000), openingBid: 60000 });
  assert.equal(summit.enrolled, true);
  assert.equal(summit.marketComparison, 120000);
  assert.equal(summit.ratio, 0.5);
  assert.equal(summit.dealScore, 65);
  assert.match(summit.citation, /cntmarval/);
});

test('zero-fabrication invariant: missing openingBid or missing parcel yields null dealScore', () => {
  const missingBid = interpretAssessorParcel({ countyKey: 'FL-BROWARD', parcel: parcel(250000), openingBid: null });
  assert.equal(missingBid.marketComparison, 250000);
  assert.equal(missingBid.ratio, null);
  assert.equal(missingBid.dealScore, null);
  assert.match(missingBid.withheldReason, /Opening amount is not published/);

  const missingParcel = interpretAssessorParcel({ countyKey: 'FL-BROWARD', parcel: null, openingBid: 100000 });
  assert.equal(missingParcel.found, false);
  assert.equal(missingParcel.rawFigure, null);
  assert.equal(missingParcel.marketComparison, null);
  assert.equal(missingParcel.ratio, null);
  assert.equal(missingParcel.dealScore, null);
  assert.match(missingParcel.withheldReason, /No parcel matched/);
});

test('statewide endpoint resolution resolves Florida listings with null or unmapped county to FL-STATEWIDE', () => {
  const { resolveCountyEndpoint, resolveCountyKey } = require('../server/enrichment/arcgis-parcels');
  const endpointNull = resolveCountyEndpoint('FL', null);
  const countyKeyNull = endpointNull?.key || resolveCountyKey('FL', null);
  assert.equal(countyKeyNull, 'FL-STATEWIDE');

  const reading = interpretAssessorParcel({ countyKey: countyKeyNull, parcel: parcel(300000), openingBid: 120000 });
  assert.equal(reading.enrolled, true);
  assert.equal(reading.marketComparison, 300000);
  assert.equal(reading.ratio, 0.4);
  assert.equal(reading.dealScore, 78);
  assert.match(reading.citation, /Fla\. Stat\. § 193\.011/);
});
