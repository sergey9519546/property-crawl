const assert = require('assert');
const { BiddingSimulator } = require('../server/ai/bidding-simulator');

async function runBiddingTests() {
  console.log('--- Testing Bidding Simulator ---');

  // Test 1: Calculate MAO
  const mao = BiddingSimulator.calculateMAO({
    arv: 250000,
    rehabBudget: 35000,
    cashToClose: 2500,
    targetProfit: 40000,
    targetPercentage: 0.7
  });
  
  // (250000 * 0.7) - 35000 - 2500 - 40000 = 175000 - 77500 = 97500
  assert.strictEqual(mao, 97500, `MAO should be 97500, got ${mao}`);
  console.log('✓ MAO calculation correct');

  // Test 2: Calculate Holding Costs
  const holding = BiddingSimulator.calculateHoldingCosts({
    purchasePrice: 100000,
    rehabBudget: 50000,
    loanPoints: 2, // 2% of 150000 = 3000
    interestRate: 0.12, // 1% per month = 1500 * 6 = 9000
    holdMonths: 6,
    transferTaxRate: 0.01 // 1% of 100000 = 1000
    // insurance = (100000 * 0.02 / 12) * 6 = 1000
  });
  // Total = 3000 + 9000 + 1000 + 1000 = 14000
  assert.strictEqual(holding, 14000, `Holding costs should be 14000, got ${holding}`);
  console.log('✓ Holding costs calculation correct');

  // Test 3: Clearing Probability
  const mockListing = {
    debt: 150000,
    assessedValue: 200000,
    openingBid: 120000
  };

  // Upset Bid Ceiling: min(150000, 200000*0.8=160000) = 150000
  // Expected Clearing Floor: 200000*0.6 = 120000
  // Expected Clearing Price: max(150000, 120000) = 150000

  // Win probability under upset bid should be 5%
  const prob1 = BiddingSimulator.simulateClearingProbability(mockListing, 140000);
  assert.strictEqual(prob1.winProbability, 5, 'Win probability should be 5% when under upset bid');
  assert.strictEqual(prob1.plaintiffUpsetRisk, true, 'Plaintiff upset risk should be true');

  // Win probability above 1.2x expected (150000 * 1.2 = 180000) should be 99%
  const prob2 = BiddingSimulator.simulateClearingProbability(mockListing, 185000);
  assert.strictEqual(prob2.winProbability, 99, 'Win probability should be 99% when bidding aggressively high');

  console.log('✓ Clearing probability logic correct');
  console.log('All bidding tests passed.\n');
}

if (require.main === module) {
  runBiddingTests().catch(err => {
    console.error('Bidding tests failed:', err);
    process.exit(1);
  });
}

module.exports = runBiddingTests;
