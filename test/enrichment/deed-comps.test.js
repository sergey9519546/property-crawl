'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const {
  MIN_QUALIFIED_COMPS,
  DEED_COMPS_CAVEAT,
  computeQualifiedDeedComps,
} = require('../../server/enrichment/deed-comps');
const {
  computePublicBenchmarkConsensus,
} = require('../../server/enrichment/public-benchmark-consensus');

const AS_OF = '2026-11-24T00:00:00Z';

describe('L2 Qualified Deed Comps (DATA-01)', () => {
  test('withholds medianSalePrice and medianPricePerSqft when n < 3 qualified comps', () => {
    const empty = computeQualifiedDeedComps([], { zip: '07722', asOf: AS_OF });
    assert.equal(empty.available, false);
    assert.equal(empty.reason, 'insufficient_qualified_comps');
    assert.equal(empty.sampleSize, 0);
    assert.equal(empty.medianSalePrice, null);
    assert.equal(empty.medianPricePerSqft, null);
    assert.equal(empty.zip, '07722');
    assert.equal(empty.windowMonths, 12);
    assert.equal(empty.caveat, DEED_COMPS_CAVEAT);
    assert.equal('estLow' in empty, false);
    assert.equal('estHigh' in empty, false);
    assert.equal('dealScore' in empty, false);

    const two = computeQualifiedDeedComps(
      [
        { salePrice: 320000, saleDate: '2026-08-15', sqft: 1600, nuCode: '00' },
        { salePrice: 360000, saleDate: '2026-09-10', sqft: 1800, nuCode: '' },
      ],
      { zip: '07722', asOf: AS_OF }
    );
    assert.equal(two.available, false);
    assert.equal(two.reason, 'insufficient_qualified_comps');
    assert.equal(two.sampleSize, 2);
    assert.equal(two.medianSalePrice, null);
    assert.equal(two.medianPricePerSqft, null);
  });

  test('excludes nominal deeds, NJ NU codes, FL non-qualified codes, distressed transfers, and invalid/stale dates', () => {
    const records = [
      // Nominal ($100 and $1,000 boundary)
      { salePrice: 100, saleDate: '2026-09-01', sqft: 1500, nuCode: '00' },
      { salePrice: 1000, saleDate: '2026-09-02', sqft: 1500, nuCode: '00' },
      // NJ Non-Usable NU codes
      { SALE_PRICE: 250000, DEED_DATE: '2026-08-01', NU_CODE: '01', sqft: 1500 },
      { SALE_PRICE: 275000, DEED_DATE: '2026-08-05', nuCode: '12', sqft: 1600 },
      { SALE_PRICE: 290000, DEED_DATE: '2026-08-10', saleNuCode: '26', sqft: 1700 },
      // FL non-qualified QUAL_CD1 codes (only 01 and 02 are qualified)
      { SALE_PRC1: 310000, SALE_YR1: 2026, SALE_MO1: 7, QUAL_CD1: '03', TOT_LVG_AR: 1600 },
      { SALE_PRC1: 315000, SALE_YR1: 2026, SALE_MO1: 7, QUAL_CD1: '11', TOT_LVG_AR: 1600 },
      { SALE_PRC1: 325000, SALE_YR1: 2026, SALE_MO1: 7, QUAL_CD1: '37', TOT_LVG_AR: 1600 },
      { SALE_PRC1: 330000, SALE_YR1: 2026, SALE_MO1: 7, QUAL_CD1: '', TOT_LVG_AR: 1600 },
      // Distressed / explicit non-arms-length flags
      { salePrice: 340000, saleDate: '2026-09-12', deedType: 'Sheriff Deed', sqft: 1600 },
      { salePrice: 345000, saleDate: '2026-09-13', armsLength: false, sqft: 1600 },
      // Missing / invalid calendar date (Feb 30 rollover) / stale outside 12m window
      { salePrice: 350000, saleDate: null, sqft: 1600 },
      { salePrice: 355000, saleDate: '2026-02-30', sqft: 1600 },
      { salePrice: 360000, saleDate: '2025-01-15', sqft: 1600 },
      // Cross-ZIP mismatch
      { salePrice: 370000, saleDate: '2026-09-20', zip: '33406', sqft: 1600 },
      // Only 2 truly qualified sales -> total sampleSize must be 2 (< 3)
      { salePrice: 400000, saleDate: '2026-10-01', zip: '07722', nuCode: '00', sqft: 2000 },
      { salePrice: 420000, saleDate: '2026-10-15', zip: '07722', nuCode: null, sqft: 2100 },
    ];

    const res = computeQualifiedDeedComps(records, {
      zip: '07722',
      windowMonths: 12,
      asOf: AS_OF,
    });

    assert.equal(res.available, false);
    assert.equal(res.reason, 'insufficient_qualified_comps');
    assert.equal(res.sampleSize, 2);
    assert.equal(res.excludedCount, 15);
    assert.equal(res.medianSalePrice, null);
    assert.equal(res.medianPricePerSqft, null);
    assert.equal(res.excludedReasons.nominal_or_invalid_price, 2);
    assert.equal(res.excludedReasons.nj_non_usable_code, 3);
    assert.equal(res.excludedReasons.fl_unqualified_code, 4);
    assert.equal(res.excludedReasons.distressed_or_unqualified_flag, 2);
    assert.equal(res.excludedReasons.missing_or_invalid_date, 2);
    assert.equal(res.excludedReasons.outside_window, 1);
    assert.equal(res.excludedReasons.zip_mismatch, 1);
  });

  test('aggregates qualified NJ and FL deeds accurately and withholds medianPricePerSqft if < 3 valid sqft', () => {
    // 3 qualified NJ deeds, only 2 have valid sqft
    const njRecords = [
      { SALE_PRICE: 400000, DEED_DATE: '2026-06-01', NU_CODE: '00', ZIP5: '07722', sqft: 2000 },
      { SALE_PRICE: 500000, DEED_DATE: '2026-07-15', NU_CODE: '', ZIP5: '7722', sqft: 2500 },
      { SALE_PRICE: 600000, DEED_DATE: '2026-09-20', NU_CODE: '0', ZIP5: '07722', sqft: 0 },
      // Excluded nominal $100 transfer
      { SALE_PRICE: 100, DEED_DATE: '2026-10-01', NU_CODE: '00', ZIP5: '07722', sqft: 2000 },
    ];

    const njRes = computeQualifiedDeedComps(njRecords, {
      zip: '07722',
      source: 'NJGIN_MODIV_CADASTRAL',
      asOf: AS_OF,
    });

    assert.equal(njRes.available, true);
    assert.equal(njRes.reason, null);
    assert.equal(njRes.sampleSize, 3);
    assert.equal(njRes.sqftSampleSize, 2);
    assert.equal(njRes.excludedCount, 1);
    assert.equal(njRes.medianSalePrice, 500000);
    assert.equal(njRes.medianPricePerSqft, null);
    assert.equal(njRes.source, 'NJGIN_MODIV_CADASTRAL');
    assert.equal(njRes.zip, '07722');

    // 4 qualified FL deeds (QUAL_CD1 '01' & '02') with valid TOT_LVG_AR
    const flRecords = [
      { SALE_PRC1: 300000, SALE_YR1: 2026, SALE_MO1: 5, QUAL_CD1: '01', TOT_LVG_AR: 1500 }, // $200/sqft
      { SALE_PRC1: 360000, SALE_YR1: 2026, SALE_MO1: 6, QUAL_CD1: '02', TOT_LVG_AR: 1800 }, // $200/sqft
      { SALE_PRC1: 440000, SALE_YR1: 2026, SALE_MO1: 8, QUAL_CD1: '1', TOT_LVG_AR: 2000 },  // $220/sqft
      { SALE_PRC1: 520000, SALE_YR1: 2026, SALE_MO1: 9, QUAL_CD1: '2', TOT_LVG_AR: 2000 },  // $260/sqft
      // Excluded FL disqualification code 12
      { SALE_PRC1: 120000, SALE_YR1: 2026, SALE_MO1: 9, QUAL_CD1: '12', TOT_LVG_AR: 1500 },
    ];

    const flRes = computeQualifiedDeedComps(flRecords, {
      zip: '32084',
      source: 'FLORIDA_DOR_STATEWIDE',
      asOf: AS_OF,
    });

    assert.equal(flRes.available, true);
    assert.equal(flRes.sampleSize, 4);
    assert.equal(flRes.sqftSampleSize, 4);
    assert.equal(flRes.excludedCount, 1);
    assert.equal(flRes.medianSalePrice, 400000);
    assert.equal(flRes.medianPricePerSqft, 210);
    assert.equal(flRes.isAppraisal, false);
    assert.equal(flRes.isBidRecommendation, false);
    assert.equal(MIN_QUALIFIED_COMPS, 3);
  });

  test('wires optional deedComps into computePublicBenchmarkConsensus without altering omitted output or Zero-Fabrication invariants', () => {
    const hpiSeries = {
      version: 1,
      sourceUrl: 'https://www.fhfa.gov/data/hpi',
      retrievedAt: '2026-10-30T00:00:00Z',
      datasetSha256: 'a'.repeat(64),
      values: { FL: { '2020Q2': 300, '2026Q1': 450 } },
    };
    const listingContext = {
      address: '100 King St, St. Augustine, FL 32084',
      county: 'ST. JOHNS',
      state: 'FL',
      zip: '32084',
      openingBid: 160000,
      assessmentYear: 2020,
      assessmentPeriod: '2020Q2',
      parcel: {
        county: 'ST. JOHNS',
        canonicalApn: '123456-0000',
        assessedValue: { total: 250000, land: 50000, improvement: 200000 },
      },
    };

    const baseline = computePublicBenchmarkConsensus(listingContext, { hpiSeries });
    assert.equal(baseline.availableSourceCount, 3);
    assert.equal(baseline.evidenceAvailabilityRatio, 1.0);
    assert.equal(baseline.deedComps, undefined);

    const withComps = computePublicBenchmarkConsensus(listingContext, {
      hpiSeries,
      asOf: AS_OF,
      deedComps: [
        { SALE_PRC1: 300000, SALE_YR1: 2026, SALE_MO1: 5, QUAL_CD1: '01', TOT_LVG_AR: 1500 },
        { SALE_PRC1: 360000, SALE_YR1: 2026, SALE_MO1: 7, QUAL_CD1: '01', TOT_LVG_AR: 1800 },
        { SALE_PRC1: 420000, SALE_YR1: 2026, SALE_MO1: 9, QUAL_CD1: '02', TOT_LVG_AR: 2000 },
        { SALE_PRC1: 100, SALE_YR1: 2026, SALE_MO1: 9, QUAL_CD1: '01', TOT_LVG_AR: 1500 },
      ],
    });

    // Primary 3-way consensus metrics remain unaltered
    assert.equal(withComps.availableSourceCount, baseline.availableSourceCount);
    assert.equal(withComps.evidenceAvailabilityRatio, baseline.evidenceAvailabilityRatio);
    assert.deepEqual(withComps.sourcesAvailable, baseline.sourcesAvailable);

    // Secondary deed-comp layer is clearly labeled
    assert.ok(withComps.deedComps);
    assert.equal(withComps.deedComps.layer, 'L2_QUALIFIED_DEED_COMPS');
    assert.equal(withComps.deedComps.available, true);
    assert.equal(withComps.deedComps.sampleSize, 3);
    assert.equal(withComps.deedComps.medianSalePrice, 360000);
    assert.equal(withComps.deedComps.medianPricePerSqft, 200);
    assert.equal(withComps.deedComps.isAppraisal, false);

    // Strict Zero-Fabrication Invariant: deed comps NEVER overwrite estLow, estHigh, dealScore, or arv
    assert.equal(withComps.estLow, null);
    assert.equal(withComps.estHigh, null);
    assert.equal(withComps.dealScore, null);
    assert.equal(withComps.arv, undefined);
  });
});
