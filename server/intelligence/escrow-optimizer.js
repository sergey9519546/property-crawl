'use strict';

/**
 * server/intelligence/escrow-optimizer.js
 *
 * Multi-Auction Escrow & Deposit Lockup Optimizer.
 *
 * Models upfront wire and cashier deposit schedules across distressed property platforms:
 * 1. RealAuction (FL clerks, OH sheriffs):
 *    - 5% to 10% deposit ($1,000 minimum floor)
 *    - Pre-auction wire / ACH due 24-48 hours before auction gavel
 *    - Refund turnaround: 3 business days for non-winning bidders
 *
 * 2. Bid4Assets (CA tax sales, PA/MD sheriff sales):
 *    - $1,000 - $5,000 flat deposit or 10%
 *    - Pre-auction wire due 48-72 hours prior
 *    - Refund turnaround: 5 business days
 *
 * 3. Texas Tax / Sheriff Sales (Tex. Tax Code § 34.01 / Tex. Civ. Prac. & Rem. Code § 34.044):
 *    - 100% full certified funds / cashier's checks tendered immediately at auction gavel
 *    - Zero settlement window; unspent cashier's checks retained by bidder (0 days lockup)
 *
 * 4. ServiceLink Auction (Private REO / Foreclosure Platform):
 *    - $2,500 minimum floor or 5% deposit
 *    - Credit card authorization hold or wire
 *    - Refund turnaround: 3 business days
 *
 * 5. CivilView (NJ Sheriff Sales under N.J.S.A. 22A:4-8):
 *    - 20% certified funds / cashier's check required at gavel
 *    - Remaining 80% due within 30 days
 *    - Non-winning bidders retain cashier's checks immediately (0-day lockup)
 *
 * Optimization Algorithm:
 * Evaluates a sequence of target auctions against available liquid capital, tracks deposit
 * lockup timelines, identifies date conflicts where funds from Auction A cannot be recycled
 * before Auction B's deposit deadline, and projects maximum executable bidding power.
 */

const PLATFORM_DEPOSIT_RULES = Object.freeze({
  realauction: {
    platform: 'realauction',
    label: 'RealAuction Online County Auction',
    depositPercent: 0.10, // 10% standard deposit (5% in FL clerk tax sales)
    minimumDeposit: 1000,
    maximumDeposit: null,
    paymentMethod: 'wire',
    timing: 'pre_auction_wire',
    leadTimeHours: 24, // Due 24 hours prior
    settlementWindowDays: 1, // 24 hours to fund remaining 90%
    refundTurnaroundDays: 3, // 3 business days for ACH/wire refund
    citation: 'RealAuction Clerk & Sheriff Online Operating Rules',
    notes: 'Requires pre-bidding funds on deposit. Unused funds refunded to bank via ACH/wire in 3 business days.',
  },
  bid4assets: {
    platform: 'bid4assets',
    label: 'Bid4Assets Government Auction',
    depositPercent: 0.10,
    minimumDeposit: 1500, // typically $1,000 - $2,500 deposit
    maximumDeposit: null,
    paymentMethod: 'wire',
    timing: 'pre_auction_wire',
    leadTimeHours: 48, // Deposit deadline 48 hours prior
    settlementWindowDays: 3, // 3 business days to pay balance
    refundTurnaroundDays: 5, // 5 business days for ACH/wire refund
    citation: 'Bid4Assets Bidder Deposit Agreement',
    notes: 'Pre-sale deposit required per county auction. Refund processed within 5 business days.',
  },
  texas_tax: {
    platform: 'texas_tax',
    label: 'Texas Tax / Sheriff Auction (In-Person)',
    depositPercent: 1.00, // 100% full cashier checks at gavel
    minimumDeposit: 0,
    maximumDeposit: null,
    paymentMethod: 'cashiers_check',
    timing: 'at_auction_gavel',
    leadTimeHours: 0, // Present at auction
    settlementWindowDays: 0, // 100% due at gavel
    refundTurnaroundDays: 0, // Non-winning bidder retains cashier check immediately
    citation: 'Tex. Tax Code § 34.01 / Tex. Civ. Prac. & Rem. Code § 34.044',
    notes: '100% full cashier check payment required at gavel. Non-winning bidder leaves with check in hand (0-day deposit lockup).',
  },
  servicelink: {
    platform: 'servicelink',
    label: 'ServiceLink Auction Foreclosure / REO',
    depositPercent: 0.05,
    minimumDeposit: 2500,
    maximumDeposit: null,
    paymentMethod: 'credit_card_hold',
    timing: 'pre_auction_wire',
    leadTimeHours: 24,
    settlementWindowDays: 30, // 30-day closing period
    refundTurnaroundDays: 3,
    citation: 'ServiceLink Auction Purchase Agreement Terms',
    notes: '$2,500 or 5% earnest money deposit hold. Credit card hold or wire. Released 3 days post-auction if not won.',
  },
  civilview: {
    platform: 'civilview',
    label: 'CivilView NJ County Sheriff Foreclosure',
    depositPercent: 0.20, // 20% statutory certified funds
    minimumDeposit: 0,
    maximumDeposit: null,
    paymentMethod: 'certified_funds',
    timing: 'at_auction_gavel',
    leadTimeHours: 0,
    settlementWindowDays: 30, // 30 calendar days to pay remaining 80% balance
    refundTurnaroundDays: 0, // Certified check kept in hand if outbid
    citation: 'N.J.S.A. 22A:4-8 (New Jersey Sheriff Sales)',
    notes: '20% certified check / cashier check down at gavel. Balance due within 30 days. Non-winning bidders retain checks.',
  },
  generic_sheriff: {
    platform: 'generic_sheriff',
    label: 'Standard County Sheriff / Trustee Auction',
    depositPercent: 0.10,
    minimumDeposit: 1000,
    maximumDeposit: null,
    paymentMethod: 'certified_funds',
    timing: 'at_auction_gavel',
    leadTimeHours: 0,
    settlementWindowDays: 30,
    refundTurnaroundDays: 0,
    citation: 'Uniform County Sheriff Sale Execution Practice',
    notes: 'Standard 10% certified funds deposit at gavel.',
  },
});

/**
 * Normalizes platform or source key into canonical rule key.
 *
 * @param {string} platformOrSource
 * @param {object} [options={}]
 * @returns {string} Rule key
 */
function normalizePlatformKey(platformOrSource, options = {}) {
  const text = String(platformOrSource || '').trim().toLowerCase();
  const state = String(options.state || '').trim().toUpperCase();

  if (/bid4assets/i.test(text)) return 'bid4assets';
  if (/realauction/i.test(text)) return 'realauction';
  if (/servicelink/i.test(text)) return 'servicelink';
  if (/civilview/i.test(text) || state === 'NJ') return 'civilview';
  if (/texas/i.test(text) || state === 'TX' || /tx_tax|texas_tax/i.test(text)) return 'texas_tax';

  return 'generic_sheriff';
}

/**
 * Retrieves the statutory deposit rules for an auction platform or source.
 *
 * @param {string} platformOrSource
 * @param {object} [options={}]
 * @returns {object} Deposit rule configuration
 */
function getAuctionDepositRules(platformOrSource, options = {}) {
  const key = normalizePlatformKey(platformOrSource, options);
  const rule = PLATFORM_DEPOSIT_RULES[key] || PLATFORM_DEPOSIT_RULES.generic_sheriff;

  // Clone to avoid mutation
  const res = { ...rule };

  // Allow caller overrides
  if (Number.isFinite(options.depositPercent) && options.depositPercent > 0) {
    res.depositPercent = options.depositPercent;
  }
  if (Number.isFinite(options.minimumDeposit)) {
    res.minimumDeposit = options.minimumDeposit;
  }

  return res;
}

/**
 * Calculates the required upfront escrow / cashier deposit for a specific auction listing.
 *
 * @param {object} auctionListing - Listing with openingBid, estimatedMaxBid, platform, source, state, saleDate
 * @param {object} [options={}] - Optional overrides such as targetBid
 * @returns {object} Calculated deposit requirement
 */
function calculateRequiredDeposit(auctionListing = {}, options = {}) {
  const platform = auctionListing.platform || auctionListing.source || 'generic_sheriff';
  const state = auctionListing.state || options.state;
  const rules = getAuctionDepositRules(platform, { state, ...options });

  // Determine target bid amount: targetBid option wins, then estimatedMaxBid, purchasePrice, openingBid
  const targetBid = Number.isFinite(options.targetBid) && options.targetBid > 0
    ? options.targetBid
    : Number.isFinite(auctionListing.estimatedMaxBid) && auctionListing.estimatedMaxBid > 0
      ? auctionListing.estimatedMaxBid
      : Number.isFinite(auctionListing.purchasePrice) && auctionListing.purchasePrice > 0
        ? auctionListing.purchasePrice
        : Number.isFinite(auctionListing.openingBid) && auctionListing.openingBid > 0
          ? auctionListing.openingBid
          : 0;

  let rawCalculated = targetBid * rules.depositPercent;
  let requiredDeposit = rawCalculated;
  let basis = 'percentage';

  if (rules.depositPercent >= 1.0) {
    basis = 'full_cash';
    requiredDeposit = targetBid;
  } else if (rawCalculated < rules.minimumDeposit) {
    basis = 'minimum_floor';
    requiredDeposit = rules.minimumDeposit;
  }

  if (Number.isFinite(rules.maximumDeposit) && requiredDeposit > rules.maximumDeposit) {
    requiredDeposit = rules.maximumDeposit;
  }

  // Calculate deposit deadline
  let depositDeadline = null;
  const rawSaleDate = auctionListing.saleDate || auctionListing.auctionDate;
  if (rawSaleDate) {
    const saleTime = new Date(rawSaleDate).getTime();
    if (!Number.isNaN(saleTime)) {
      const deadlineMs = saleTime - (rules.leadTimeHours * 3600 * 1000);
      depositDeadline = new Date(deadlineMs).toISOString();
    }
  }

  return {
    listingId: auctionListing.id || auctionListing.listingId || null,
    targetBid,
    requiredDeposit: Math.round(requiredDeposit * 100) / 100,
    depositPercent: rules.depositPercent,
    basis,
    paymentMethod: rules.paymentMethod,
    depositDeadline,
    leadTimeHours: rules.leadTimeHours,
    refundTurnaroundDays: rules.refundTurnaroundDays,
    settlementWindowDays: rules.settlementWindowDays,
    rules,
  };
}

/**
 * Optimizes escrow and deposit allocation across a portfolio of upcoming auctions.
 *
 * Evaluates capital lockup windows:
 * - When an auction deposit is locked from depositDeadline until saleDate + refundTurnaroundDays.
 * - Detects date conflicts where capital from Auction A is not yet recycled in time for Auction B.
 * - Maximizes executable bidding power within available capital constraints.
 *
 * @param {Array<object>} auctions - List of upcoming target auctions
 * @param {number} totalCapital - Total available liquid cash / capital reserve
 * @param {object} [options={}]
 * @param {boolean} [options.allowRecycling=true] - Whether non-winning deposits can be recycled after turnaround
 * @param {string} [options.sortBy='priority'] - 'priority' | 'chronological' | 'bidding_power'
 * @returns {object} Escrow optimization plan
 */
function optimizeEscrowAllocation(auctions = [], totalCapital = 0, options = {}) {
  const allowRecycling = options.allowRecycling !== false;
  const liquidCapital = Number.isFinite(totalCapital) && totalCapital > 0 ? totalCapital : 0;

  if (!Array.isArray(auctions) || auctions.length === 0) {
    return {
      totalCapital: liquidCapital,
      totalCommittedCapital: 0,
      remainingUnallocatedCapital: liquidCapital,
      maximumExecutableBiddingPower: 0,
      capitalEfficiencyRatio: 0,
      allocatedAuctions: [],
      dateConflicts: [],
      notes: 'No auctions provided to optimize.',
    };
  }

  // Step 1: Pre-calculate deposit requirements and timing windows for each auction
  const parsedAuctions = auctions.map((item, idx) => {
    const id = item.id || item.listingId || `auction_${idx + 1}`;
    const depositCalc = calculateRequiredDeposit(item);
    const saleDateStr = item.saleDate || item.auctionDate || null;
    const saleTime = saleDateStr ? new Date(saleDateStr).getTime() : Date.now() + (idx * 86400000);
    const leadTimeMs = depositCalc.leadTimeHours * 3600 * 1000;
    const lockupStartMs = saleTime - leadTimeMs;
    const refundMs = depositCalc.refundTurnaroundDays * 24 * 3600 * 1000;
    const recyclableMs = saleTime + refundMs;

    const priorityScore = Number.isFinite(item.priorityScore)
      ? item.priorityScore
      : Number.isFinite(item.dealScore)
        ? item.dealScore
        : 50;

    return {
      id,
      original: item,
      targetBid: depositCalc.targetBid,
      requiredDeposit: depositCalc.requiredDeposit,
      depositPercent: depositCalc.depositPercent,
      paymentMethod: depositCalc.paymentMethod,
      platform: depositCalc.rules.platform,
      saleDate: saleDateStr ? new Date(saleTime).toISOString() : null,
      saleTime,
      lockupStartTime: lockupStartMs,
      recyclableTime: recyclableMs,
      lockupStartDate: new Date(lockupStartMs).toISOString(),
      recyclableDate: new Date(recyclableMs).toISOString(),
      refundTurnaroundDays: depositCalc.refundTurnaroundDays,
      priorityScore,
    };
  });

  // Step 2: Sort auctions according to chosen optimization policy
  const sortBy = options.sortBy || 'priority';
  if (sortBy === 'chronological') {
    parsedAuctions.sort((a, b) => a.saleTime - b.saleTime);
  } else if (sortBy === 'bidding_power') {
    // Highest bidding power per deposit dollar first
    parsedAuctions.sort((a, b) => {
      const ratioA = a.requiredDeposit > 0 ? a.targetBid / a.requiredDeposit : 0;
      const ratioB = b.requiredDeposit > 0 ? b.targetBid / b.requiredDeposit : 0;
      return ratioB - ratioA;
    });
  } else {
    // Default: priority / dealScore descending, then chronological
    parsedAuctions.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      return a.saleTime - b.saleTime;
    });
  }

  // Step 3: Simulate deposit commitments over time and test feasibility
  const allocatedAuctions = [];
  const dateConflicts = [];
  const fundedList = []; // list of accepted auctions for concurrent overlap checks

  for (const candidate of parsedAuctions) {
    if (candidate.requiredDeposit > liquidCapital) {
      allocatedAuctions.push({
        ...candidate,
        status: 'EXCLUDED_CAPITAL_SHORTFALL',
        reason: `Required deposit ($${candidate.requiredDeposit.toLocaleString()}) exceeds total available capital ($${liquidCapital.toLocaleString()}).`,
      });
      continue;
    }

    if (!allowRecycling) {
      // Without recycling, deposits are strictly cumulative
      const currentCommitted = fundedList.reduce((sum, a) => sum + a.requiredDeposit, 0);
      if (currentCommitted + candidate.requiredDeposit <= liquidCapital) {
        fundedList.push(candidate);
        allocatedAuctions.push({
          ...candidate,
          status: 'FUNDED',
          allocatedDeposit: candidate.requiredDeposit,
          reason: 'Funded under strict capital reservation.',
        });
      } else {
        allocatedAuctions.push({
          ...candidate,
          status: 'EXCLUDED_CAPITAL_SHORTFALL',
          reason: 'Cumulative un-recycled deposits exceed total available capital.',
        });
      }
      continue;
    }

    // With recycling: Check if adding candidate causes concurrent peak lockup to exceed liquidCapital
    // Look for all funded auctions that overlap with candidate's lockup window:
    // Overlap occurs if:
    // not (candidate.recyclableTime <= existing.lockupStartTime || candidate.lockupStartTime >= existing.recyclableTime)
    const overlappingExisting = fundedList.filter((existing) => {
      const separated = candidate.recyclableTime <= existing.lockupStartTime ||
                        candidate.lockupStartTime >= existing.recyclableTime;
      return !separated;
    });

    const concurrentDepositNeeded = overlappingExisting.reduce((sum, e) => sum + e.requiredDeposit, 0)
      + candidate.requiredDeposit;

    if (concurrentDepositNeeded <= liquidCapital) {
      fundedList.push(candidate);
      allocatedAuctions.push({
        ...candidate,
        status: 'FUNDED',
        allocatedDeposit: candidate.requiredDeposit,
        concurrentDepositsAtGavel: concurrentDepositNeeded,
        reason: overlappingExisting.length > 0
          ? `Funded concurrently with ${overlappingExisting.length} overlapping auction(s).`
          : 'Funded with recycled / standalone capital.',
      });
    } else {
      // Date conflict & capital shortfall
      const conflictingNames = overlappingExisting.map((e) => e.id).join(', ');
      dateConflicts.push({
        candidateAuction: candidate.id,
        conflictingAuctions: overlappingExisting.map((e) => e.id),
        candidateRequiredDeposit: candidate.requiredDeposit,
        overlappingDeposits: overlappingExisting.reduce((sum, e) => sum + e.requiredDeposit, 0),
        totalNeeded: concurrentDepositNeeded,
        availableCapital: liquidCapital,
        shortfall: concurrentDepositNeeded - liquidCapital,
        reason: `Deposit for ${candidate.id} ($${candidate.requiredDeposit.toLocaleString()}) overlaps with [${conflictingNames}] between ${candidate.lockupStartDate} and ${candidate.recyclableDate}. Peak deposit requirement ($${concurrentDepositNeeded.toLocaleString()}) exceeds capital ($${liquidCapital.toLocaleString()}).`,
      });

      allocatedAuctions.push({
        ...candidate,
        status: 'EXCLUDED_DATE_CONFLICT',
        allocatedDeposit: 0,
        reason: `Capital locked in overlapping auction(s) [${conflictingNames}] cannot be recycled before deposit deadline.`,
      });
    }
  }

  // Calculate global peak committed capital across all funded auctions
  let peakCommittedCapital = 0;
  if (fundedList.length > 0) {
    // Generate all discrete critical time points
    const criticalTimes = new Set();
    for (const f of fundedList) {
      criticalTimes.add(f.lockupStartTime);
      criticalTimes.add(f.recyclableTime);
    }

    for (const t of criticalTimes) {
      const activeAtT = fundedList.filter((f) => t >= f.lockupStartTime && t < f.recyclableTime);
      const sumAtT = activeAtT.reduce((sum, f) => sum + f.requiredDeposit, 0);
      if (sumAtT > peakCommittedCapital) {
        peakCommittedCapital = sumAtT;
      }
    }
  }

  const maximumExecutableBiddingPower = fundedList.reduce((sum, f) => sum + f.targetBid, 0);
  const remainingUnallocatedCapital = Math.max(0, liquidCapital - peakCommittedCapital);
  const capitalEfficiencyRatio = liquidCapital > 0
    ? Number((maximumExecutableBiddingPower / liquidCapital).toFixed(2))
    : 0;

  return {
    totalCapital: liquidCapital,
    totalCommittedCapital: peakCommittedCapital,
    remainingUnallocatedCapital,
    maximumExecutableBiddingPower,
    capitalEfficiencyRatio,
    fundedAuctionCount: fundedList.length,
    excludedAuctionCount: allocatedAuctions.length - fundedList.length,
    allocatedAuctions,
    dateConflicts,
  };
}

module.exports = {
  PLATFORM_DEPOSIT_RULES,
  normalizePlatformKey,
  getAuctionDepositRules,
  calculateRequiredDeposit,
  optimizeEscrowAllocation,
};
