'use strict';

/**
 * server/intelligence/cash-to-close.js
 *
 * Deterministic Foreclosure Bid Cost Model & Complete Cash-to-Close Fee Schedules.
 *
 * Formula:
 * Total Acquisition Cost = Winning Bid + Buyer's Premium + Sheriff Poundage
 *                        + Transfer Taxes + Delinquent Property Taxes + Recording Fees
 * Net Cash Due at Settlement = max(0, Total Acquisition Cost - Credited Deposit)
 */

const {
  JURISDICTION_FEE_SCHEDULES,
  computeStatutoryStateFees,
} = require('./statutory-fees');

/**
 * Calculates complete itemized cash-to-close fee schedule
 */
function calculateCompleteCashToClose(params = {}) {
  const winningBid = Math.max(0, Number(params.winningBid || params.purchasePrice || params.openingBid || 0));
  const state = String(params.state || 'OH').toUpperCase();
  const baseFees = computeStatutoryStateFees({
    purchasePrice: winningBid,
    state,
    source: params.source,
    distressType: params.distressType,
    isTaxSale: params.isTaxSale,
    isMarketplace: params.isMarketplace,
  });

  // 1. Buyer's Premium: 5% on marketplace auctions ($2,500 min); 0% on direct county sales
  let buyersPremium = baseFees.buyersPremium;
  if (!baseFees.isMarketplace && params.buyersPremium != null) {
    buyersPremium = Math.max(0, Number(params.buyersPremium));
  }

  // 2. Sheriff Poundage (uses exact statutory tiered/marginal formula unless overridden)
  const sheriffPoundage = params.sheriffPoundage != null
    ? Math.max(0, Number(params.sheriffPoundage))
    : baseFees.sheriffPoundage;

  // 3. State & County Transfer Taxes (Documentary Stamps)
  const transferTax = params.transferTax != null
    ? Math.max(0, Number(params.transferTax))
    : baseFees.transferTax;

  // 4. Delinquent Property Taxes
  const delinquentTaxes = Math.max(0, Number(params.delinquentTaxes || 0));

  // 5. Recording Fees
  const recordingFees = params.recordingFees != null
    ? Math.max(0, Number(params.recordingFees))
    : baseFees.defaultRecordingFee;

  // Total Acquisition Cost
  const totalAcquisitionCost = winningBid + buyersPremium + sheriffPoundage + transferTax + delinquentTaxes + recordingFees;

  // Credited Deposit
  const creditedDeposit = Math.max(0, Number(params.creditedDeposit || params.deposit || 0));

  // Net Cash Due at Settlement (guarded against negative values)
  const netCashDueAtSettlement = Math.max(0, totalAcquisitionCost - creditedDeposit);

  return {
    state,
    jurisdictionName: baseFees.schedule.name,
    supported: baseFees.supported,
    notice: baseFees.supported ? null : `Statutory fee preset unavailable for state ${state}`,
    winningBid,
    buyersPremium,
    sheriffPoundage,
    transferTax,
    delinquentTaxes,
    recordingFees,
    totalAcquisitionCost,
    creditedDeposit,
    netCashDueAtSettlement,
    settlementWindowHours: baseFees.settlementWindowHours,
    statutoryNotes: baseFees.statutoryNotes,
    isMarketplace: baseFees.isMarketplace,
    computedAt: typeof params.computedAt === 'string' && params.computedAt.trim()
      ? params.computedAt.trim()
      : new Date().toISOString(),
  };
}

module.exports = {
  JURISDICTION_FEE_SCHEDULES,
  calculateCompleteCashToClose,
};
