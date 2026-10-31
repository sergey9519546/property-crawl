'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { computePublicBenchmarkConsensus, DISCLAIMER } = require('../../server/enrichment/public-benchmark-consensus');

describe('Three-Way Public-Record Benchmark Consensus (Hack #4)', () => {
  test('synthesizes assessor roll, FHFA HPI trajectory, and HUD SAFMR implied GRM when all 3 present', () => {
    const listingContext = {
      address: '100 King St, St. Augustine, FL 32084',
      county: 'ST. JOHNS',
      state: 'FL',
      zip: '32084',
      apn: '123456-0000',
      openingBid: 160000,
      assessmentYear: 2020,
      parcel: {
        county: 'ST. JOHNS',
        canonicalApn: '123456-0000',
        assessedValue: {
          total: 250000,
          land: 50000,
          improvement: 200000,
        },
      },
    };

    const result = computePublicBenchmarkConsensus(listingContext);

    assert.equal(result.benchmarkType, 'PUBLIC_RECORD_BENCHMARK');
    assert.equal(result.isAppraisal, false);
    assert.equal(result.isBidRecommendation, false);
    assert.equal(result.disclaimer, DISCLAIMER);

    // 3 out of 3 verified
    assert.equal(result.sourcesVerifiedCount, 3);
    assert.equal(result.publicConsensusScore, 1.0);
    assert.ok(result.sourcesVerified.includes('assessor_roll'));
    assert.ok(result.sourcesVerified.includes('fhfa_hpi'));
    assert.ok(result.sourcesVerified.includes('hud_safmr'));

    // 1. Assessor roll
    assert.ok(result.assessorRoll);
    assert.equal(result.assessorRoll.assessedValue, 250000);
    assert.equal(result.assessorRoll.landValue, 50000);
    assert.equal(result.assessorRoll.improvementValue, 200000);

    // 2. FHFA HPI Trajectory
    assert.ok(result.assessedTrajectory);
    assert.equal(result.assessedTrajectory.state, 'FL');
    assert.equal(result.assessedTrajectory.baselinePeriod, '2020Q2');
    assert.equal(result.assessedTrajectory.currentPeriod, '2026Q1');
    assert.ok(result.assessedTrajectory.hpiMultiplier > 1.0);
    assert.ok(result.assessedTrajectory.hpiAdjustedAssessedValue > result.assessorRoll.assessedValue);
    assert.ok(Number.isFinite(result.assessedTrajectory.hpiAppreciationPct));

    // 3. HUD SAFMR and Implied GRM
    assert.ok(result.hudSafmr);
    assert.equal(result.hudSafmr.zip, '32084');
    assert.ok(result.hudSafmr.fmr2br > 0);
    assert.ok(result.impliedGrm > 0);
    const expectedGrm = Math.round((160000 / (result.hudSafmr.fmr2br * 12)) * 100) / 100;
    assert.equal(result.impliedGrm, expectedGrm);

    // STRICT ZERO-FABRICATION INVARIANT:
    assert.equal(result.estLow, null);
    assert.equal(result.estHigh, null);
    assert.equal(result.dealScore, null);
  });

  test('strict zero-fabrication: when assessor is missing, fields remain null with explicit reasons', () => {
    const listingContext = {
      address: 'Unknown County Rural Route, TX 75001',
      state: 'TX',
      zip: '75001',
      openingBid: 120000,
      // No parcel or assessor data provided
    };

    const result = computePublicBenchmarkConsensus(listingContext);

    assert.equal(result.assessorRoll, null);
    assert.equal(result.assessedTrajectory, null); // Cannot compute trajectory without assessor base value
    assert.ok(result.unobservedReasons.some(r => r.includes('assessor')));
    assert.ok(result.sourcesVerifiedCount <= 2);
    assert.ok(result.publicConsensusScore < 1.0);

    // Strictly null
    assert.equal(result.estLow, null);
    assert.equal(result.estHigh, null);
    assert.equal(result.dealScore, null);
  });

  test('strict zero-fabrication: when opening bid is missing, implied GRM remains null with explicit reason', () => {
    const listingContext = {
      address: '100 King St, St. Augustine, FL 32084',
      state: 'FL',
      zip: '32084',
      // No opening bid provided
      parcel: {
        county: 'ST. JOHNS',
        canonicalApn: '123456-0000',
        assessedValue: { total: 180000 },
      },
    };

    const result = computePublicBenchmarkConsensus(listingContext);

    assert.equal(result.impliedGrm, null);
    assert.ok(result.unobservedReasons.some(r => r.includes('opening bid') || r.includes('Opening bid')));

    // Strictly null
    assert.equal(result.estLow, null);
    assert.equal(result.estHigh, null);
    assert.equal(result.dealScore, null);
  });

  test('handles completely unobserved property with 0.0 consensus score and explicit unobserved reasons', () => {
    const result = computePublicBenchmarkConsensus({});

    assert.equal(result.publicConsensusScore, 0.0);
    assert.equal(result.sourcesVerifiedCount, 0);
    assert.equal(result.assessorRoll, null);
    assert.equal(result.assessedTrajectory, null);
    assert.equal(result.hudSafmr, null);
    assert.equal(result.impliedGrm, null);
    assert.ok(result.unobservedReasons.length >= 3);

    // Strictly null
    assert.equal(result.estLow, null);
    assert.equal(result.estHigh, null);
    assert.equal(result.dealScore, null);
  });
});
