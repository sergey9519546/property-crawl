/**
 * Bidding Intelligence & Underwriting Simulator
 * Models Max Allowable Offer (MAO), hold costs, and competitive auction clearing probabilities.
 */

class BiddingSimulator {
  /**
   * Computes the 70% ARV Max Allowable Offer (MAO).
   * @param {Object} params
   * @param {number} params.arv - After Repair Value
   * @param {number} params.rehabBudget - Estimated rehab scope
   * @param {number} params.cashToClose - Title, escrow, and statutory closing costs
   * @param {number} params.targetProfit - Target net profit ($)
   * @param {number} [params.targetPercentage=0.7] - Typical institutional target is 70%
   * @param {number} [params.holdingCosts=0] - Carry costs, loan points, etc.
   * @returns {number} The maximum allowable offer
   */
  static calculateMAO({ arv, rehabBudget, cashToClose, targetProfit, targetPercentage = 0.7, holdingCosts = 0 }) {
    if (!arv || arv <= 0) return 0;
    const mao = (arv * targetPercentage) - rehabBudget - cashToClose - targetProfit - holdingCosts;
    return Math.max(0, Math.floor(mao));
  }

  /**
   * Models Holding & Financing Carry Cost Drag
   * @param {Object} params
   * @param {number} params.purchasePrice - Expected purchase price
   * @param {number} params.rehabBudget - Rehab budget
   * @param {number} [params.loanPoints=2] - Origination points
   * @param {number} [params.interestRate=0.12] - Annual interest rate for hard money
   * @param {number} [params.holdMonths=6] - Expected hold time
   * @param {number} [params.transferTaxRate=0.01] - State/County transfer tax rate
   * @returns {number} Estimated holding cost drag
   */
  static calculateHoldingCosts({ purchasePrice, rehabBudget, loanPoints = 2, interestRate = 0.12, holdMonths = 6, transferTaxRate = 0.01 }) {
    const loanAmount = purchasePrice + rehabBudget;
    const pointsCost = loanAmount * (loanPoints / 100);
    const interestCost = loanAmount * (interestRate / 12) * holdMonths;
    const transferTax = purchasePrice * transferTaxRate;
    const insuranceAndTaxes = (purchasePrice * 0.02 / 12) * holdMonths; // ~2% annual for property tax + insurance
    
    return Math.floor(pointsCost + interestCost + transferTax + insuranceAndTaxes);
  }

  /**
   * Forecasts the probability of clearing at an auction based on county and plaintiff upset bid.
   * Institutional logic dictates that plaintiffs usually bid up to judgment minus 10%.
   * @param {Object} listing
   * @param {number} targetBid - The investor's intended bid
   * @returns {Object} Probability metrics (winProbability, expectedClearingPrice, plaintiffUpsetRisk)
   */
  static simulateClearingProbability(listing, targetBid) {
    const debt = listing.debt || 0;
    const assessedValue = listing.assessedValue || 0;
    
    // Determine the likely plaintiff upset bid threshold (where the bank stops bidding)
    let upsetBidCeiling = 0;
    if (debt > 0) {
      // Banks typically bid up to their debt amount or ~80% of assessed value to avoid taking REO
      upsetBidCeiling = Math.min(debt, assessedValue * 0.8);
      if (upsetBidCeiling === 0) upsetBidCeiling = debt * 0.9;
    } else if (listing.openingBid > 0) {
      upsetBidCeiling = listing.openingBid;
    }
    
    // Calculate expected clearing price (competitive market estimate)
    // In competitive counties, properties clear at 60-80% of assessed value
    const marketClearingFloor = assessedValue * 0.6;
    const expectedClearingPrice = Math.max(upsetBidCeiling, marketClearingFloor);

    // Calculate Win Probability based on standard deviation curve around expected clearing price
    let winProbability = 0;
    if (targetBid < listing.openingBid) {
      winProbability = 0;
    } else if (targetBid >= expectedClearingPrice * 1.2) {
      winProbability = 99; // Overbidding significantly secures the win
    } else if (targetBid >= expectedClearingPrice) {
      // Linear scale from expected (50%) to expected * 1.2 (99%)
      const excess = targetBid - expectedClearingPrice;
      const margin = (expectedClearingPrice * 1.2) - expectedClearingPrice;
      winProbability = 50 + (excess / margin) * 49;
    } else if (targetBid >= upsetBidCeiling) {
      // Linear scale from upset bid (10%) to expected (50%)
      const excess = targetBid - upsetBidCeiling;
      const margin = expectedClearingPrice - upsetBidCeiling;
      winProbability = 10 + (margin > 0 ? (excess / margin) * 40 : 0);
    } else {
      // Under upset bid
      winProbability = 5;
    }

    return {
      winProbability: Math.min(100, Math.floor(winProbability)),
      expectedClearingPrice: Math.floor(expectedClearingPrice),
      plaintiffUpsetRisk: targetBid < upsetBidCeiling,
      upsetBidCeiling: Math.floor(upsetBidCeiling)
    };
  }
}

module.exports = { BiddingSimulator };
