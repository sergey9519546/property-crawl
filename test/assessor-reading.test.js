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

test('assessor reading withholds a score for Cook, Clark, and Bannock', () => {
  for (const countyKey of ['IL-COOK', 'NV-CLARK', 'ID-BANNOCK']) {
    const reading = interpretAssessorParcel({ countyKey, parcel: parcel(80000), openingBid: 20000 });
    assert.equal(reading.rawFigure, 80000);
    assert.equal(reading.marketComparison, null);
    assert.equal(reading.dealScore, null);
    assert.ok(reading.withheldReason);
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
