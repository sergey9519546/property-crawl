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

/**
 * Enriches a raw listing object with FHFA macro valuation if historical basis exists
 * and listing lacks certified valuation.
 *
 * @param {Object} listing
 * @returns {Object} listing with macroValuation attached
 */
function enrichListingWithMacroValuation(listing) {
  if (!listing) return listing;

  // Use assessed value or last sale price as historical basis if available
  const basisVal = Number(listing.assessedValue || listing.lastSalePrice || listing.openingBid);
  const basisYear = listing.yearBuilt ? Math.max(2015, Math.min(2023, listing.yearBuilt)) : 2018;

  if (Number.isFinite(basisVal) && basisVal > 0 && listing.state) {
    const macro = calculateMacroValuation({
      historicalValue: basisVal,
      historicalYear: basisYear,
      state: listing.state,
      basisType: listing.assessedValue ? 'TAX_ASSESSMENT' : 'AUCTION_OPENING_BID'
    });

    if (macro) {
      return {
        ...listing,
        macroValuation: macro,
        // Populate estLow/estHigh only if previously missing
        estLow: listing.estLow ?? macro.estLow,
        estHigh: listing.estHigh ?? macro.estHigh
      };
    }
  }

  return listing;
}

module.exports = {
  calculateMacroValuation,
  enrichListingWithMacroValuation
};
