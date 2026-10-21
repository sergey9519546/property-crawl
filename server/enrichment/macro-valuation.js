'use strict';

const { getAppreciationMultiplier, DEFAULT_CURRENT_PERIOD } = require('../intelligence/fhfa-hpi');

/**
 * Calculates macroeconomic trend valuation derived from FHFA HPI.
 *
 * Invariant: Never claim to be a certified appraisal, AVM, or physical condition inspection.
 *
 * @param {Object} params
 * @param {number} params.historicalValue - Historical dollar amount (prior sale, assessed val)
 * @param {number|string} params.historicalYear - Historical year (e.g. 2018) or quarter ("2018Q2")
 * @param {string} params.state - Two-letter state code (e.g. 'OH')
 * @param {string} [params.basisType='TAX_ASSESSMENT'] - 'TAX_ASSESSMENT' | 'PRIOR_SALE' | 'MORTGAGE_NOTE'
 * @param {string} [params.currentPeriod=DEFAULT_CURRENT_PERIOD]
 * @returns {Object|null}
 */
function calculateMacroValuation({
  historicalValue,
  historicalYear,
  state,
  basisType = 'TAX_ASSESSMENT',
  currentPeriod = DEFAULT_CURRENT_PERIOD
}) {
  const value = Number(historicalValue);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (!state || !historicalYear) {
    return null;
  }

  const multiplier = getAppreciationMultiplier(state, historicalYear, currentPeriod);
  const estimatedMacroValue = Math.round(value * multiplier);

  // Calibrated ±8% macro variance band based on historical FHFA metro volatility
  const estLow = Math.round(estimatedMacroValue * 0.92);
  const estHigh = Math.round(estimatedMacroValue * 1.08);

  return {
    estimatedMacroValue,
    estLow,
    estHigh,
    basis: {
      type: basisType,
      historicalValue: value,
      historicalPeriod: String(historicalYear)
    },
    currentPeriod,
    appreciationMultiplier: multiplier,
    valuationMethod: 'FHFA_HPI_TREND',
    isAvmAppraisal: false, // Strict honest invariant: NOT a black-box AVM
    label: 'FHFA Macro Trend',
    disclaimer: 'Macroeconomic trend estimate derived from Federal Housing Finance Agency (FHFA) House Price Index data. Does not account for physical condition, deferred maintenance, or local interior finish. Not a certified appraisal.'
  };
}

function explicitDollarBasis(listing) {
  const assessed = Number(listing.assessedValue ?? listing.assessed);
  const lastSale = Number(listing.lastSalePrice);
  const assessmentYear = listing.assessmentYear ?? listing.taxYear
    ?? listing.provenance?.derivedFields?.assessorRoll?.assessmentYear;
  const saleYear = listing.lastSaleYear;
  if (Number.isFinite(assessed) && assessed > 0 && assessmentYear) {
    return {
      historicalValue: assessed,
      historicalYear: assessmentYear,
      state: listing.state,
      basisType: 'TAX_ASSESSMENT',
    };
  }
  if (Number.isFinite(lastSale) && lastSale > 0 && saleYear) {
    return {
      historicalValue: lastSale,
      historicalYear: saleYear,
      state: listing.state,
      basisType: 'PRIOR_SALE',
    };
  }
  return null;
}

/**
 * Does not invent a valuation. Opening bid, year built, and a guessed year
 * are not a basis. The index behind calculateMacroValuation is not an official
 * FHFA release, so this function never copies a band onto estLow/estHigh.
 *
 * @param {Object} listing
 * @returns {Object} the same listing
 */
function enrichListingWithMacroValuation(listing) {
  if (!listing) return listing;
  return listing;
}

module.exports = {
  calculateMacroValuation,
  explicitDollarBasis,
  enrichListingWithMacroValuation
};
