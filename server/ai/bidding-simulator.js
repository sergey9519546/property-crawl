/**
 * Bidding Intelligence & Underwriting Simulator
 * Models Max Allowable Offer (MAO), hold costs, and competitive auction clearing probabilities.
 */

class BiddingSimulator {
  /**
   * Computes the 70% ARV Max Allowable Offer (MAO).
   * @param {Object} [params={}]
   * @param {number} [params.arv=0] - After Repair Value
   * @param {number} [params.rehabBudget=0] - Estimated rehab scope
   * @param {number} [params.cashToClose=0] - Title, escrow, and statutory closing costs
   * @param {number} [params.targetProfit=0] - Target net profit ($)
   * @param {number} [params.targetPercentage=0.7] - Typical institutional target is 70%
   * @param {number} [params.holdingCosts=0] - Carry costs, loan points, etc.
   * @returns {number} The maximum allowable offer
   */
  static calculateMAO({
    arv = 0,
    rehabBudget = 0,
    cashToClose = 0,
    targetProfit = 0,
    targetPercentage = 0.7,
    holdingCosts = 0
  } = {}) {
    const arvNum = Number(arv) || 0;
    if (arvNum <= 0) return 0;
    const rehab = Number(rehabBudget) || 0;
    const ctc = Number(cashToClose) || 0;
    const profit = Number(targetProfit) || 0;
    const pct = Number(targetPercentage) || 0.7;
    const holding = Number(holdingCosts) || 0;

    const mao = (arvNum * pct) - rehab - ctc - profit - holding;
    return Math.max(0, Math.floor(Number.isFinite(mao) ? mao : 0));
  }

  /**
   * Models Holding & Financing Carry Cost Drag
   * @param {Object} [params={}]
   * @param {number|string} [params.purchasePrice=0] - Expected purchase price
   * @param {number|string} [params.rehabBudget=0] - Rehab budget
   * @param {number} [params.loanPoints=2] - Origination points
   * @param {number} [params.interestRate=0.12] - Annual interest rate for hard money
   * @param {number} [params.holdMonths=6] - Expected hold time
   * @param {number} [params.transferTaxRate=0.01] - State/County transfer tax rate
   * @returns {number} Estimated holding cost drag
   */
  static calculateHoldingCosts({
    purchasePrice = 0,
    rehabBudget = 0,
    loanPoints = 2,
    interestRate = 0.12,
    holdMonths = 6,
    transferTaxRate = 0.01
  } = {}) {
    const price = Number(purchasePrice) || 0;
    const rehab = Number(rehabBudget) || 0;
    const points = Number(loanPoints) || 0;
    const rate = Number(interestRate) || 0;
    const months = Number(holdMonths) || 0;
    const taxRate = Number(transferTaxRate) || 0;

    const loanAmount = price + rehab;
    const pointsCost = loanAmount * (points / 100);
    const interestCost = loanAmount * (rate / 12) * months;
    const transferTax = price * taxRate;
    const insuranceAndTaxes = (price * 0.02 / 12) * months; // ~2% annual for property tax + insurance
    
    const total = pointsCost + interestCost + transferTax + insuranceAndTaxes;
    return Math.floor(Number.isFinite(total) ? Math.max(0, total) : 0);
  }

  /**
   * Forecasts the probability of clearing at an auction based on county and plaintiff upset bid.
   * Institutional logic dictates that plaintiffs usually bid up to judgment minus 10%.
   * Supports both canonical listing schema (judgment, assessed) and raw (debt, assessedValue).
   * @param {Object} [listing={}]
   * @param {number} targetBid - The investor's intended bid
   * @returns {Object} Probability metrics (winProbability, expectedClearingPrice, plaintiffUpsetRisk, upsetBidCeiling)
   */
  static simulateClearingProbability(listing = {}, targetBid = 0) {
    if (!listing) listing = {};
    const bid = Number(targetBid) || 0;
    const openBid = Number(listing.openingBid) || 0;
    const debt = Number(listing.judgment ?? listing.debt ?? 0);
    const assessedValue = Number(listing.assessed ?? listing.assessedValue ?? 0);
    
    // Determine the likely plaintiff upset bid threshold (where the bank stops bidding)
    let upsetBidCeiling = 0;
    if (debt > 0) {
      // Banks typically bid up to their debt amount or ~80% of assessed value to avoid taking REO
      upsetBidCeiling = Math.min(debt, assessedValue > 0 ? assessedValue * 0.8 : debt);
      if (upsetBidCeiling === 0) upsetBidCeiling = debt * 0.9;
    } else if (openBid > 0) {
      upsetBidCeiling = openBid;
    }
    
    // Calculate expected clearing price (competitive market estimate)
    // In competitive counties, properties clear at 60-80% of assessed value
    const marketClearingFloor = assessedValue * 0.6;
    const expectedClearingPrice = Math.max(upsetBidCeiling, marketClearingFloor);

    // Calculate Win Probability based on standard deviation curve around expected clearing price
    let winProbability = 0;
    if (bid < openBid) {
      winProbability = 0;
    } else if (expectedClearingPrice <= 0) {
      winProbability = bid >= openBid ? 70 : 0;
    } else if (bid >= expectedClearingPrice * 1.2) {
      winProbability = 99; // Overbidding significantly secures the win
    } else if (bid >= expectedClearingPrice) {
      // Linear scale from expected (50%) to expected * 1.2 (99%)
      const excess = bid - expectedClearingPrice;
      const margin = (expectedClearingPrice * 1.2) - expectedClearingPrice;
      winProbability = margin > 0 ? (50 + (excess / margin) * 49) : 50;
    } else if (bid >= upsetBidCeiling) {
      // Linear scale from upset bid (10%) to expected (50%)
      const excess = bid - upsetBidCeiling;
      const margin = expectedClearingPrice - upsetBidCeiling;
      winProbability = 10 + (margin > 0 ? (excess / margin) * 40 : 0);
    } else {
      // Under upset bid
      winProbability = 5;
    }

    const safeWinProb = Math.min(100, Math.max(0, Math.floor(Number.isFinite(winProbability) ? winProbability : 0)));

    return {
      winProbability: safeWinProb,
      expectedClearingPrice: Math.floor(expectedClearingPrice),
      plaintiffUpsetRisk: bid < upsetBidCeiling,
      upsetBidCeiling: Math.floor(upsetBidCeiling)
    };
  }
}

module.exports = { BiddingSimulator };
