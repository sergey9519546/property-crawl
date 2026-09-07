'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { evaluateOpportunitySignals, SIGNAL_WEIGHTS } = require('../server/intelligence/signals');
const { buildPropertyDossier } = require('../server/intelligence/dossier');
const { createPropertySignalsHandler } = require('../server/routes/property-signals');

function sampleListing(overrides = {}) {
  return {
    id: 'TEST-LISTING-001',
    source: 'civilview',
    address: '100 Opportunity Way, Newark, NJ 07102',
    openingBid: 150000,
    estLow: 250000,
    estHigh: 350000,
    mid: 300000,
    sqft: 2000,
    saleDate: '2027-11-15',
    status: 'scheduled',
    seniorLienRisk: 'low',
    redemptionDays: 30,
    cashToClose: 165000,
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=99999',
    sourceObservedAt: '2026-09-06T12:00:00.000Z',
    provenance: { origin: 'live', publisher: 'CivilView', recordId: '99999' },
    ...overrides,
  };
}

describe('Opportunity-Signal Evaluator (Priority Upgrade 3)', () => {
  test('evaluates sale_date_known signal correctly for future and past dates', () => {
    const future = evaluateOpportunitySignals(sampleListing({ saleDate: '2028-01-01' }), { now: Date.parse('2026-09-06T00:00:00.000Z') });
    const futureSig = future.signals.find(s => s.key === 'sale_date_known');
    assert.equal(futureSig.status, 'supported');
    assert.ok(futureSig.reason.includes('2028-01-01'));

    const past = evaluateOpportunitySignals(sampleListing({ saleDate: '2024-01-01' }), { now: Date.parse('2026-09-06T00:00:00.000Z') });
    const pastSig = past.signals.find(s => s.key === 'sale_date_known');
    assert.equal(pastSig.status, 'unknown');
    assert.ok(pastSig.reason.includes('has passed'));

    const missing = evaluateOpportunitySignals(sampleListing({ saleDate: null }));
    const missingSig = missing.signals.find(s => s.key === 'sale_date_known');
    assert.equal(missingSig.status, 'unknown');
  });

  test('evaluates bid_reduction signal from source observation history', () => {
    const observationsWithReduction = {
      records: {},
      signals: [{ listingId: 'TEST-LISTING-001', type: 'bid_reduced', recordId: '99999' }]
    };
    const withRed = evaluateOpportunitySignals(sampleListing(), { observations: observationsWithReduction });
    const sig1 = withRed.signals.find(s => s.key === 'bid_reduction');
    assert.equal(sig1.status, 'supported');

    const withoutRed = evaluateOpportunitySignals(sampleListing(), { observations: { records: {}, signals: [] } });
    const sig2 = withoutRed.signals.find(s => s.key === 'bid_reduction');
    assert.equal(sig2.status, 'unknown');
  });

  test('evaluates returned_to_market from notice and status keywords', () => {
    const returned = evaluateOpportunitySignals(sampleListing({ status: 're-listed' }));
    assert.equal(returned.signals.find(s => s.key === 'returned_to_market').status, 'supported');

    const rawNoticeReturn = evaluateOpportunitySignals(sampleListing({ rawNotice: 'Property returned to market after stay vacated.' }));
    assert.equal(rawNoticeReturn.signals.find(s => s.key === 'returned_to_market').status, 'supported');

    const standard = evaluateOpportunitySignals(sampleListing({ status: 'scheduled' }));
    assert.equal(standard.signals.find(s => s.key === 'returned_to_market').status, 'unknown');
  });

  test('evaluates bid_to_value_ratio accurately and reports spread', () => {
    // openingBid: 150000, mid: 300000 -> 50% ratio
    const evalRes = evaluateOpportunitySignals(sampleListing());
    const ratioSig = evalRes.signals.find(s => s.key === 'bid_to_value_ratio');
    assert.equal(ratioSig.status, 'supported');
    assert.ok(ratioSig.reason.includes('50.0%'));
    assert.ok(ratioSig.reason.includes('50% spread'));

    // Missing mid/estimates
    const missingMid = evaluateOpportunitySignals(sampleListing({ mid: null, estLow: null, estHigh: null }));
    assert.equal(missingMid.signals.find(s => s.key === 'bid_to_value_ratio').status, 'unknown');
  });

  test('detects building_area_discrepancy against official cadastral records', () => {
    const publicRecordsWithDiscrepancy = {
      parcel: {
        status: 'matched',
        properties: { livingAreaSqft: 2800 },
        source: { url: 'https://floridacadastral.gov/parcel/123' }
      }
    };
    // listing.sqft is 2000, cadastral is 2800 -> 28% difference
    const contradicted = evaluateOpportunitySignals(sampleListing({ sqft: 2000 }), { publicRecords: publicRecordsWithDiscrepancy });
    const contraSig = contradicted.signals.find(s => s.key === 'building_area_discrepancy');
    assert.equal(contraSig.status, 'contradicted');
    assert.ok(contraSig.reason.includes('disagrees'));

    const publicRecordsMatching = {
      parcel: {
        status: 'matched',
        properties: { livingAreaSqft: 2050 },
        source: { url: 'https://floridacadastral.gov/parcel/123' }
      }
    };
    const supported = evaluateOpportunitySignals(sampleListing({ sqft: 2000 }), { publicRecords: publicRecordsMatching });
    assert.equal(supported.signals.find(s => s.key === 'building_area_discrepancy').status, 'supported');
  });

  test('evaluates title_equity_unresolved based on completeness of title variables', () => {
    const complete = evaluateOpportunitySignals(sampleListing({
      seniorLienRisk: 'low',
      redemptionDays: 180,
      cashToClose: 160000
    }));
    assert.equal(complete.signals.find(s => s.key === 'title_equity_unresolved').status, 'supported');

    const incomplete = evaluateOpportunitySignals(sampleListing({
      seniorLienRisk: null,
      redemptionDays: null
    }));
    assert.equal(incomplete.signals.find(s => s.key === 'title_equity_unresolved').status, 'unknown');
  });

  test('computes deterministic triagePriority with published component weights', () => {
    const evaluation = evaluateOpportunitySignals(sampleListing());
    assert.equal(typeof evaluation.triagePriority, 'number');
    assert.ok(evaluation.triagePriority >= 1 && evaluation.triagePriority <= 99);
    assert.deepEqual(evaluation.weights, SIGNAL_WEIGHTS);
    assert.ok(evaluation.disclaimer.includes('Triage priority only'));
  });

  test('dossier integration incorporates opportunity signals and triagePriority', () => {
    const dossier = buildPropertyDossier(sampleListing());
    assert.ok(Array.isArray(dossier.opportunitySignals));
    assert.equal(dossier.opportunitySignals.length, 6);
    assert.equal(typeof dossier.triagePriority, 'number');
    assert.ok(dossier.summary.opportunitySignals >= 0);
  });

  test('HTTP route handler evaluates signals and returns valid JSON response', async () => {
    const mockDb = {
      getListingById: async (id) => id === 'MOCK-1' ? sampleListing({ id: 'MOCK-1' }) : null
    };
    const handler = createPropertySignalsHandler({ database: mockDb, loadObservations: () => ({ records: {}, signals: [] }) });

    let status = 200;
    let body = null;
    const res = {
      setHeader: () => {},
      status: (code) => { status = code; return res; },
      json: (data) => { body = data; return res; }
    };

    // Valid query
    await handler({ method: 'GET', url: '/api/property-signals?listingId=MOCK-1' }, res);
    assert.equal(status, 200);
    assert.equal(body.listingId, 'MOCK-1');
    assert.equal(body.signals.length, 6);
    assert.equal(typeof body.triagePriority, 'number');

    // Missing listing
    await handler({ method: 'GET', url: '/api/property-signals?listingId=DOES-NOT-EXIST' }, res);
    assert.equal(status, 404);

    // Missing ID
    await handler({ method: 'GET', url: '/api/property-signals' }, res);
    assert.equal(status, 400);
  });

  test('HTTP route handler resolves listingId from POST body', async () => {
    const mockDb = {
      getListingById: async (id) => id === 'MOCK-1' ? sampleListing({ id: 'MOCK-1' }) : null
    };
    const handler = createPropertySignalsHandler({ database: mockDb, loadObservations: () => ({ records: {}, signals: [] }) });

    let status = 200;
    let body = null;
    const res = {
      setHeader: () => {},
      status: (code) => { status = code; return res; },
      json: (data) => { body = data; return res; }
    };

    await handler({ method: 'POST', url: '/api/property-signals', body: { listingId: 'MOCK-1' } }, res);
    assert.equal(status, 200);
    assert.equal(body.listingId, 'MOCK-1');

    await handler({ method: 'POST', url: '/api/property-signals', body: {} }, res);
    assert.equal(status, 400);
  });

  test('overpay ratio (bid above midpoint) is reported but contributes no ratio points', () => {
    // openingBid 390000 vs mid 300000 -> ratio 1.3 (overpay), 0 discount fraction
    const evaluation = evaluateOpportunitySignals(sampleListing({ openingBid: 390000 }));
    const ratioSig = evaluation.signals.find((s) => s.key === 'bid_to_value_ratio');
    assert.equal(ratioSig.status, 'supported');
    assert.ok(ratioSig.reason.includes('130.0%'));

    // Reconstruct the ratio-only priority contribution: with a >100% ratio the
    // discount fraction clamps to zero, so the bidToValueRatio component is 0.
    const noDiscount = evaluateOpportunitySignals(sampleListing({ openingBid: 300000 })); // exactly at midpoint
    const discount = evaluateOpportunitySignals(sampleListing({ openingBid: 150000 }));
    assert.ok(discount.triagePriority > noDiscount.triagePriority);
  });

  test('building area boundary at exactly 10% is treated as verified (not contradicted)', () => {
    // 2000 vs 2200 -> 200 / 2200 = 9.09% -> supported
    const within = evaluateOpportunitySignals(sampleListing({ sqft: 2000 }), {
      publicRecords: { parcel: { status: 'matched', properties: { livingAreaSqft: 2200 }, source: { url: 'https://x.gov/1' } } }
    });
    assert.equal(within.signals.find((s) => s.key === 'building_area_discrepancy').status, 'supported');

    // 2000 vs 2223 -> 223 / 2223 = 10.03% -> contradicted
    const beyond = evaluateOpportunitySignals(sampleListing({ sqft: 2000 }), {
      publicRecords: { parcel: { status: 'matched', properties: { livingAreaSqft: 2223 }, source: { url: 'https://x.gov/2' } } }
    });
    assert.equal(beyond.signals.find((s) => s.key === 'building_area_discrepancy').status, 'contradicted');
  });
});
