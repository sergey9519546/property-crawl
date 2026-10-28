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

const JURISDICTION_FEE_SCHEDULES = Object.freeze({
  FL: {
    state: 'FL',
    name: 'Florida',
    docStampRatePerThousand: 7.00, // $0.70 per $100
    defaultSheriffPoundagePercent: 0.00, // FL clerk sales use statutory clerk auction fee (approx $70 + 3% on first $500, 1.5% balance)
    defaultRecordingFee: 100.00,
    settlementWindowHours: 24,
    notes: 'Fla. Stat. § 201.02 doc stamps + clerk electronic auction fee. Certified funds due within 24 hours.',
  },
  PA: {
    state: 'PA',
    name: 'Pennsylvania',
    docStampRatePerThousand: 20.00, // 1% state + 1% local standard (Philadelphia is higher at 42.78 per $1k)
    defaultSheriffPoundagePercent: 0.02, // 2% statutory sheriff poundage
    defaultRecordingFee: 150.00,
    settlementWindowHours: 720, // 30 days to settle balance with sheriff
    notes: '2% standard transfer tax + 2% sheriff poundage. Balance due within 30 days of sale gavel.',
  },
  NJ: {
    state: 'NJ',
    name: 'New Jersey',
    docStampRatePerThousand: 8.50, // NJ Realty Transfer Fee graduated tiers average ~$8.50 per $1k
    defaultSheriffPoundagePercent: 0.025, // 2.5% statutory sheriff execution fee (N.J.S.A. 22A:4-8)
    defaultRecordingFee: 120.00,
    settlementWindowHours: 720, // 30 days to pay balance in full
    notes: 'N.J.S.A. 22A:4-8 statutory poundage + Realty Transfer Fee. 20% deposit at sale; balance in 30 days.',
  },
  OH: {
    state: 'OH',
    name: 'Ohio',
    docStampRatePerThousand: 4.00, // $1 mandatory state + up to $3 county conveyance fee ($4 total per $1k)
    defaultSheriffPoundagePercent: 0.02, // Statutory county sheriff execution fee
    defaultRecordingFee: 80.00,
    settlementWindowHours: 720, // Balance due within 30 days of sale confirmation
    notes: 'R.C. 319.54 conveyance fees + county poundage. Balance due upon judicial confirmation of sale.',
  },
  CA: {
    state: 'CA',
    name: 'California',
    docStampRatePerThousand: 1.10, // $1.10 per $1,000 standard documentary transfer tax
    defaultSheriffPoundagePercent: 0.00, // Non-judicial trustee sales do not assess county poundage
    defaultRecordingFee: 95.00,
    settlementWindowHours: 0, // 100% cashier checks tendered immediately at auction gavel
    notes: 'Cal. Rev. & Tax. Code § 11911 documentary transfer tax. 100% certified funds required at gavel.',
  },
  NC: {
    state: 'NC',
    name: 'North Carolina',
    docStampRatePerThousand: 2.00, // $1.00 per $500 ($2 per $1k) excise tax (N.C.G.S. § 105-228.30)
    defaultSheriffPoundagePercent: 0.05, // 5% statutory commissioner/trustee cap (N.C.G.S. § 45-21.15)
    defaultRecordingFee: 64.00,
    settlementWindowHours: 240, // 10 days rolling upset bid window (N.C.G.S. § 45-21.27)
    notes: 'N.C.G.S. § 45-21.27 10-day upset-bid period. 5% deposit floor ($750 min).',
  },
  TX: {
    state: 'TX',
    name: 'Texas',
    docStampRatePerThousand: 0.00, // $0 transfer tax (Texas Const. art. VIII § 29)
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 50.00,
    settlementWindowHours: 4, // Immediate cashier checks at first Tuesday sale
    notes: 'Texas Const. art. VIII § 29 $0 state transfer tax. 100% certified funds due at sale.',
  },
  GA: {
    state: 'GA',
    name: 'Georgia',
    docStampRatePerThousand: 1.00, // $1.00 per $1k transfer tax (O.C.G.A. § 48-6-1)
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 25.00,
    settlementWindowHours: 4, // Immediate cashier checks at first Tuesday non-judicial auction
    notes: 'O.C.G.A. § 44-14-162 non-judicial foreclosure under power of sale. First Tuesday auction; immediate payment.',
  },
  IL: {
    state: 'IL',
    name: 'Illinois',
    docStampRatePerThousand: 1.50, // $1 state + $0.50 county transfer stamps (35 ILCS 200/31-10)
    defaultSheriffPoundagePercent: 0.01, // 1% sheriff fee
    defaultRecordingFee: 100.00,
    settlementWindowHours: 720, // 30 days; balance due upon judicial confirmation
    notes: '735 ILCS 5/15-1507 judicial foreclosure. Balance due upon judicial confirmation of sale.',
  },
  NY: {
    state: 'NY',
    name: 'New York',
    docStampRatePerThousand: 4.00, // $2.00 per $500 ($4 per $1k) NY State Real Estate Transfer Tax
    defaultSheriffPoundagePercent: 0.01, // Referee compensation cap
    defaultRecordingFee: 150.00,
    settlementWindowHours: 720, // 30 days to close with referee
    notes: 'RPAPL § 1354 referee deed sale. 10% deposit at auction; 30 days to close with referee.',
  },
});

const DEFAULT_SCHEDULE = Object.freeze({
  state: 'US',
  name: 'Standard US Default',
  docStampRatePerThousand: 5.00,
  defaultSheriffPoundagePercent: 0.015,
  defaultRecordingFee: 100.00,
  settlementWindowHours: 48,
  notes: 'Standard statutory baseline estimates.',
});

/**
 * Calculates complete itemized cash-to-close fee schedule
 */
function calculateCompleteCashToClose(params = {}) {
  const winningBid = Math.max(0, Number(params.winningBid || params.purchasePrice || params.openingBid || 0));
  const state = String(params.state || 'OH').toUpperCase();
  const isSupported = Boolean(JURISDICTION_FEE_SCHEDULES[state]);
  const schedule = JURISDICTION_FEE_SCHEDULES[state] || DEFAULT_SCHEDULE;

  const isMarketplace = Boolean(params.isMarketplace || params.source === 'bid4assets' || params.source === 'servicelink');

  // 1. Buyer's Premium: 5% on marketplace auctions ($2,500 min); 0% on direct county sales
  let buyersPremium = 0;
  if (isMarketplace) {
    buyersPremium = Math.max(2500, Math.round(winningBid * 0.05));
  } else if (params.buyersPremium != null) {
    buyersPremium = Math.max(0, Number(params.buyersPremium));
  }

  // 2. Sheriff Poundage
  let sheriffPoundage = 0;
  if (params.sheriffPoundage != null) {
    sheriffPoundage = Math.max(0, Number(params.sheriffPoundage));
  } else {
    sheriffPoundage = Math.round(winningBid * schedule.defaultSheriffPoundagePercent);
  }

  // 3. State & County Transfer Taxes (Documentary Stamps)
  let transferTax = 0;
  if (params.transferTax != null) {
    transferTax = Math.max(0, Number(params.transferTax));
  } else {
    transferTax = Math.round((winningBid / 1000) * schedule.docStampRatePerThousand);
  }

  // 4. Delinquent Property Taxes
  const delinquentTaxes = Math.max(0, Number(params.delinquentTaxes || 0));

  // 5. Recording Fees
  const recordingFees = params.recordingFees != null
    ? Math.max(0, Number(params.recordingFees))
    : schedule.defaultRecordingFee;

  // Total Acquisition Cost
  const totalAcquisitionCost = winningBid + buyersPremium + sheriffPoundage + transferTax + delinquentTaxes + recordingFees;

  // Credited Deposit
  const creditedDeposit = Math.max(0, Number(params.creditedDeposit || params.deposit || 0));

  // Net Cash Due at Settlement (guarded against negative values)
  const netCashDueAtSettlement = Math.max(0, totalAcquisitionCost - creditedDeposit);

  return {
    state,
    jurisdictionName: schedule.name,
    supported: isSupported,
    notice: isSupported ? null : `Statutory fee preset unavailable for state ${state}`,
    winningBid,
    buyersPremium,
    sheriffPoundage,
    transferTax,
    delinquentTaxes,
    recordingFees,
    totalAcquisitionCost,
    creditedDeposit,
    netCashDueAtSettlement,
    settlementWindowHours: schedule.settlementWindowHours,
    statutoryNotes: schedule.notes,
    isMarketplace,
    computedAt: typeof params.computedAt === 'string' && params.computedAt.trim()
      ? params.computedAt.trim()
      : new Date().toISOString(),
  };
}

module.exports = {
  JURISDICTION_FEE_SCHEDULES,
  calculateCompleteCashToClose,
};
