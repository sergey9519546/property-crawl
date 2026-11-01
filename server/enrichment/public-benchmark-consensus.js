'use strict';

/**
 * server/enrichment/public-benchmark-consensus.js
 *
 * Three-Way Public-Record Benchmark Consensus (Hack #4)
 * Synthesizes three zero-cost verified public records:
 * 1. County Certified Assessor Tax Roll (assessedValue, landValue, improvementValue)
 *    via server/enrichment/assessor-reading.js / parcel data.
 * 2. FHFA House Price Index (HPI) appreciation benchmarks
 *    via server/intelligence/fhfa-hpi.js or server/enrichment/hpi.js.
 * 3. HUD Small Area Fair Market Rent (SAFMR) published rent benchmark
 *    via server/enrichment/hud-safmr.js.
 *
 * STRICT ZERO-FABRICATION RULE:
 * - NEVER invent estLow, estHigh, or dealScore.
 * - If assessor or SAFMR is unavailable, explicitly set to null with unobservedReasons array.
 * - Clearly label all metrics as PUBLIC_RECORD_BENCHMARK, never as appraisal or buyer bid authority.
 */

const { getHpiIndex, getAppreciationMultiplier, DEFAULT_CURRENT_PERIOD } = require('./hpi');
const { getHudSafmrBenchmark } = require('./hud-safmr');
const { interpretAssessorParcel } = require('./assessor-reading');

const DISCLAIMER = 'Public record consensus benchmarks are statutory and administrative observations, not an appraisal, valuation opinion, or buyer bid recommendation.';

/**
 * Computes the Three-Way Public-Record Benchmark Consensus for a property listing or parcel context.
 *
 * @param {Object} listingContext
 * @param {string} [listingContext.address]
 * @param {string} [listingContext.state]
 * @param {string} [listingContext.county]
 * @param {string|number} [listingContext.zip]
 * @param {string} [listingContext.apn]
 * @param {number} [listingContext.openingBid]
 * @param {number|string} [listingContext.saleDate]
 * @param {number|string} [listingContext.assessmentYear]
 * @param {Object} [listingContext.parcel] - Raw or resolved parcel object
 * @param {Object} [options]
 * @param {Object} [options.assessorParcel] - Pre-interpreted assessor parcel
 * @param {Object} [options.hudSafmr] - Pre-computed SAFMR benchmark override
 * @param {string} [options.currentPeriod] - Target HPI period (defaults to '2026Q1')
 * @returns {Object} Public Benchmark Consensus structure
 */
function computePublicBenchmarkConsensus(listingContext = {}, options = {}) {
  const unobservedReasons = [];
  const sourcesAvailable = [];

  const ctx = listingContext && typeof listingContext === 'object' ? listingContext : {};
  const state = String(ctx.state || '').trim().toUpperCase();
  const zip = ctx.zip ? String(ctx.zip).trim().padStart(5, '0').slice(0, 5) : null;
  const openingBid = Number.isFinite(Number(ctx.openingBid)) && Number(ctx.openingBid) > 0
    ? Number(ctx.openingBid)
    : null;
  const currentPeriod = options.currentPeriod || DEFAULT_CURRENT_PERIOD;

  // -------------------------------------------------------------
  // 1. County Certified Assessor Tax Roll
  // -------------------------------------------------------------
  let assessorRoll = null;
  const rawParcel = ctx.parcel || options.assessorParcel || null;

  if (rawParcel) {
    let reading = null;
    try {
      reading = interpretAssessorParcel(rawParcel, {
        openingBid: openingBid || 0,
        state,
        county: ctx.county,
      });
    } catch {
      reading = null;
    }

    const totalVal = rawParcel?.assessedValue?.total != null && Number.isFinite(Number(rawParcel.assessedValue.total))
      ? Number(rawParcel.assessedValue.total)
      : (Number.isFinite(Number(reading?.rawFigure)) ? Number(reading.rawFigure) : null);

    const landVal = rawParcel?.assessedValue?.land != null && Number.isFinite(Number(rawParcel.assessedValue.land))
      ? Number(rawParcel.assessedValue.land)
      : null;

    const imprvVal = rawParcel?.assessedValue?.improvement != null && Number.isFinite(Number(rawParcel.assessedValue.improvement))
      ? Number(rawParcel.assessedValue.improvement)
      : (totalVal !== null && landVal !== null && totalVal >= landVal ? totalVal - landVal : null);

    if (totalVal !== null && totalVal > 0) {
      assessorRoll = {
        assessedValue: totalVal,
        landValue: landVal,
        improvementValue: imprvVal,
        county: ctx.county || rawParcel?.county || null,
        apn: rawParcel?.canonicalApn || rawParcel?.apn || ctx.apn || null,
        source: 'County Certified Assessor Tax Roll',
        marketComparison: reading?.marketComparison || null,
        citation: reading?.citation || null,
      };
      sourcesAvailable.push('assessor_roll');
    } else {
      unobservedReasons.push('Assessor parcel layer returned no positive certified assessed total.');
    }
  } else {
    unobservedReasons.push('No county assessor parcel record observed for property.');
  }

  // -------------------------------------------------------------
  // 2. FHFA House Price Index (HPI) Trajectory
  // -------------------------------------------------------------
  let assessedTrajectory = null;

  if (state && assessorRoll && assessorRoll.assessedValue > 0) {
    const providedPeriod = ctx.assessmentPeriod || rawParcel?.assessmentPeriod;
    const rawYear = Number(ctx.assessmentYear ?? rawParcel?.assessmentYear ?? providedPeriod?.slice(0, 4));
    const assessmentYear = Number.isInteger(rawYear) && rawYear >= 1900 && rawYear <= new Date().getUTCFullYear()
      ? rawYear
      : null;

    const baselinePeriod = assessmentYear !== null && /^\d{4}Q[1-4]$/.test(providedPeriod || '') && Number(providedPeriod.slice(0,4)) === assessmentYear ? providedPeriod : null;
    if (assessmentYear === null) unobservedReasons.push('Assessment year is unknown; no HPI trajectory computed.');
    else if (!baselinePeriod) unobservedReasons.push('Assessment quarter is unknown; no HPI trajectory computed.');

    try {
      const baselineHpi = getHpiIndex(state, baselinePeriod, options.hpiSeries);
      const currentHpi = getHpiIndex(state, currentPeriod, options.hpiSeries);

      if (baselineHpi && currentHpi && baselineHpi > 0 && baselinePeriod <= currentPeriod) {
        const multiplier = getAppreciationMultiplier(state, baselinePeriod, currentPeriod, options.hpiSeries);
        const hpiAdjustedAssessedValue = Math.round(assessorRoll.assessedValue * multiplier);
        const appreciationPct = Math.round((multiplier - 1.0) * 1000) / 10;

        assessedTrajectory = {
          state,
          baselinePeriod,
          currentPeriod,
          baselineHpi,
          currentHpi,
          hpiMultiplier: multiplier,
          hpiAppreciationPct: appreciationPct,
          hpiAdjustedAssessedValue,
          source: 'FHFA House Price Index (HPI) Quarterly Series',
          provenance: { sourceUrl: options.hpiSeries.sourceUrl, retrievedAt: options.hpiSeries.retrievedAt, datasetSha256: options.hpiSeries.datasetSha256 },
        };
        sourcesAvailable.push('fhfa_hpi');
      } else {
        unobservedReasons.push(`FHFA HPI index benchmarks unavailable for state "${state}".`);
      }
    } catch {
      unobservedReasons.push(`Error computing FHFA HPI trajectory for state "${state}".`);
    }
  } else {
    if (!state) {
      unobservedReasons.push('Property state not specified; cannot resolve FHFA HPI trajectory.');
    } else if (!assessorRoll) {
      unobservedReasons.push('Assessed base figure not observed; cannot compute HPI-adjusted assessed trajectory.');
    }
  }

  // -------------------------------------------------------------
  // 3. HUD SAFMR Rent Benchmark & Implied GRM
  // -------------------------------------------------------------
  let hudSafmr = null;
  let impliedGrm = null;

  const benchmarkOverride = options.hudSafmr || options.safmrBenchmark || null;
  let benchmark = null;

  if (benchmarkOverride) {
    benchmark = benchmarkOverride;
  } else if (zip) {
    try {
      benchmark = getHudSafmrBenchmark({ zip, bedrooms: 2 });
    } catch {
      benchmark = null;
    }
  }

  if (benchmark && ((Number.isFinite(benchmark.fairMarketRent) && benchmark.fairMarketRent > 0) || (Number.isFinite(benchmark.fmr2br) && benchmark.fmr2br > 0))) {
    const fmr2br = Number.isFinite(benchmark.fairMarketRent) && benchmark.fairMarketRent > 0 ? benchmark.fairMarketRent : benchmark.fmr2br;
    const annualFmr2br = fmr2br * 12;

    hudSafmr = {
      zip: zip || benchmark.zip || null,
      fmr0br: benchmark.bedroomRents?.[0] || benchmark.fmr0br || null,
      fmr1br: benchmark.bedroomRents?.[1] || benchmark.fmr1br || null,
      fmr2br: fmr2br,
      fmr3br: benchmark.bedroomRents?.[3] || benchmark.fmr3br || null,
      fmr4br: benchmark.bedroomRents?.[4] || benchmark.fmr4br || null,
      annualFmr2br,
      bedroomRents: benchmark.bedroomRents || null,
      hudAreaName: benchmark.hudAreaName || 'HUD Metropolitan FMR Area',
      asOfFiscalYear: benchmark.asOfFiscalYear || 'FY2025',
      source: benchmark.source || 'HUD FY2025 Small Area Fair Market Rents (SAFMR)',
    };
    sourcesAvailable.push('hud_safmr');

    if (openingBid !== null && openingBid > 0) {
      impliedGrm = Math.round((openingBid / annualFmr2br) * 100) / 100;
    }
  } else {
    if (!zip && !benchmarkOverride) {
      unobservedReasons.push('5-digit ZIP code not provided; HUD SAFMR benchmark not queried.');
    } else {
      unobservedReasons.push(`HUD SAFMR rent benchmarks not observed for ZIP code "${zip}".`);
    }
  }

  // Ensure unobserved opening bid reason is always recorded if bid is missing
  if (openingBid === null || openingBid <= 0) {
    unobservedReasons.push('Published opening bid is absent or non-positive; cannot calculate implied GRM.');
  }

  // -------------------------------------------------------------
  // Public Consensus Score (Bounded count: 0.0, 0.33, 0.67, 1.0)
  // -------------------------------------------------------------
  const availableSourceCount = sourcesAvailable.length;
  const publicConsensusScore = Math.round((availableSourceCount / 3) * 100) / 100;

  return {
    benchmarkType: 'PUBLIC_RECORD_BENCHMARK',
    isAppraisal: false,
    isBidRecommendation: false,
    disclaimer: DISCLAIMER,

    evidenceAvailabilityRatio: publicConsensusScore,
    scoreMeaning: 'Available benchmark inputs; not agreement on property value',
    availableSourceCount,
    sourcesAvailable: Object.freeze(sourcesAvailable),
    unobservedReasons: Object.freeze(unobservedReasons),

    // 1. Assessor Roll
    assessorRoll,

    // 2. FHFA HPI Trajectory
    assessedTrajectory,

    // 3. HUD SAFMR Rent Benchmark & GRM
    hudSafmr,
    impliedGrm,

    // Strict Zero-Fabrication: estLow, estHigh, and dealScore must NEVER be generated here
    estLow: null,
    estHigh: null,
    dealScore: null,
  };
}

module.exports = {
  DISCLAIMER,
  computePublicBenchmarkConsensus,
};
