'use strict';

/**
 * server/intelligence/surplus-waterfall.js
 *
 * Excess Proceeds Waterfall Engine under Tyler v. Hennepin County, 598 U.S. 631 (2023).
 *
 * In Tyler v. Hennepin County, the Supreme Court unanimously established that the government's
 * retention of surplus proceeds from a tax forfeiture or distress sale exceeding the tax debt
 * violates the Takings Clause of the Fifth Amendment ("The County had the power to sell
 * Tyler's home to recover the $15,000 tax debt. But it could not use the toehold of the tax
 * debt to confiscate more property than was due.").
 *
 * Statutory Surplus Distribution Waterfall (Tiers):
 * Tier 1: Primary Adjudged Debt / Delinquent Taxes / Statutory Auction Costs
 * Tier 2: Super-Priority Municipal Liens & Special Assessments (unadjudged water/sewer/demolition)
 * Tier 3: Junior Mortgages & Deeds of Trust (ordered by recording priority / recording date)
 * Tier 4: Junior Judgments, Mechanics Liens, & HOA Assessments
 * Tier 5: Residual Surplus Equity Payable to Former Property Owner
 */

const WATERFALL_TIERS = Object.freeze({
  TIER_1_ADJUDGED_DEBT: 1,
  TIER_2_SUPER_PRIORITY_MUNICIPAL: 2,
  TIER_3_JUNIOR_MORTGAGES: 3,
  TIER_4_JUDGMENTS_AND_MECHANICS: 4,
  TIER_5_FORMER_OWNER_EQUITY: 5,
});

/**
 * Classifies a recorded lien into its statutory waterfall priority tier.
 *
 * @param {object} lien
 * @returns {number} Tier number (2, 3, or 4)
 */
function classifyLienTier(lien) {
  if (!lien || typeof lien !== 'object') return WATERFALL_TIERS.TIER_4_JUDGMENTS_AND_MECHANICS;
  const rawType = String(lien.type || lien.lienType || lien.category || '').toLowerCase();

  // Tier 2: Super-priority municipal liens & special assessments
  if (
    /municipal|utility|water|sewer|special_assessment|demolition|weed|nuisance|environmental/i.test(rawType)
  ) {
    return WATERFALL_TIERS.TIER_2_SUPER_PRIORITY_MUNICIPAL;
  }

  // Tier 3: Mortgages, Deeds of Trust, HELOCs
  if (
    /mortgage|deed_of_trust|heloc|equity_line|trust_deed|dot\b/i.test(rawType)
  ) {
    return WATERFALL_TIERS.TIER_3_JUNIOR_MORTGAGES;
  }

  // Tier 4: Mechanics liens, judgments, HOA, other junior liens
  return WATERFALL_TIERS.TIER_4_JUDGMENTS_AND_MECHANICS;
}

/**
 * Calculates the complete statutory surplus proceeds waterfall ledger.
 *
 * @param {object} params
 * @param {number} params.winningBid - Winning bid / gavel price at auction
 * @param {number} params.totalAdjudgedDebt - Total foreclosing judgment, taxes, interest, & statutory costs
 * @param {Array<object>} [params.recordedLiens=[]] - Array of subordinate recorded liens
 * @param {object} [params.options={}]
 * @returns {object} Complete surplus waterfall analysis and ledger
 */
function calculateSurplusEquityWaterfall(params = {}) {
  const { options = {} } = params;
  const rawBid = params.winningBid ?? params.openingBid ?? 0;
  const rawDebt = params.totalAdjudgedDebt ?? params.judgmentAmount ?? 0;
  const rawLiens = params.recordedLiens ?? params.liens ?? [];

  const bid = Number.isFinite(rawBid) && rawBid > 0 ? rawBid : 0;
  const debt = Number.isFinite(rawDebt) && rawDebt > 0 ? rawDebt : 0;
  const recordedLiens = Array.isArray(rawLiens) ? rawLiens : [];

  const grossSurplus = Math.max(0, Number((bid - debt).toFixed(2)));
  const surplusGenerated = grossSurplus > 0;
  const adjudgedDebtSatisfied = Math.min(bid, debt);
  const deficiencyAmount = Number(Math.max(0, debt - bid).toFixed(2));

  const ledger = [];

  // Tier 1: Adjudged Debt / Foreclosing Authority
  ledger.push({
    tier: WATERFALL_TIERS.TIER_1_ADJUDGED_DEBT,
    tierName: 'Adjudged Debt & Foreclosure Sale Costs',
    claimant: options.foreclosingEntity || 'Foreclosing Plaintiff / Taxing Authority',
    claimAmount: debt,
    paidAmount: adjudgedDebtSatisfied,
    remainingUnpaid: deficiencyAmount,
    status: deficiencyAmount === 0 ? 'FULL' : 'PARTIAL',
    statuteOrBasis: 'Tax Judgment / Foreclosure Decree',
  });

  // Separate junior liens into tiers
  const tier2Liens = [];
  const tier3Liens = [];
  const tier4Liens = [];

  if (Array.isArray(recordedLiens)) {
    for (const item of recordedLiens) {
      if (!item || typeof item !== 'object') continue;
      const tier = classifyLienTier(item);
      const parsedLien = {
        id: item.id || null,
        claimant: item.claimant || item.creditor || item.name || 'Recorded Lienholder',
        claimAmount: Number.isFinite(item.amount) && item.amount > 0 ? Number(item.amount.toFixed(2)) : 0,
        type: item.type || 'recorded_lien',
        recordingDate: item.recordingDate || item.date || null,
        priority: Number.isFinite(item.priority) ? item.priority : 100,
        statuteOrBasis: item.statute || item.basis || 'Recorded County Instrument',
      };

      if (tier === WATERFALL_TIERS.TIER_2_SUPER_PRIORITY_MUNICIPAL) {
        tier2Liens.push(parsedLien);
      } else if (tier === WATERFALL_TIERS.TIER_3_JUNIOR_MORTGAGES) {
        tier3Liens.push(parsedLien);
      } else {
        tier4Liens.push(parsedLien);
      }
    }
  }

  // Sort helper: by priority ascending, then recordingDate ascending
  const sortLienList = (list) => {
    return list.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.recordingDate && b.recordingDate) {
        return new Date(a.recordingDate).getTime() - new Date(b.recordingDate).getTime();
      }
      return 0;
    });
  };

  sortLienList(tier2Liens);
  sortLienList(tier3Liens);
  sortLienList(tier4Liens);

  let availableSurplus = grossSurplus;
  let allocatedJuniorClaims = 0;
  let uncoveredClaims = 0;

  // Process Tiers 2, 3, and 4
  const processTierLiens = (liens, tierNumber, tierName) => {
    for (const lien of liens) {
      const claim = lien.claimAmount;
      let paid = 0;

      if (availableSurplus > 0) {
        paid = Math.min(availableSurplus, claim);
        paid = Number(paid.toFixed(2));
        availableSurplus = Number((availableSurplus - paid).toFixed(2));
        allocatedJuniorClaims = Number((allocatedJuniorClaims + paid).toFixed(2));
      }

      const unpaid = Number((claim - paid).toFixed(2));
      uncoveredClaims = Number((uncoveredClaims + unpaid).toFixed(2));

      let status = 'UNPAID';
      if (paid === claim && claim > 0) {
        status = 'FULL';
      } else if (paid > 0) {
        status = 'PARTIAL';
      }

      ledger.push({
        tier: tierNumber,
        tierName,
        claimant: lien.claimant,
        claimAmount: claim,
        paidAmount: paid,
        remainingUnpaid: unpaid,
        status,
        type: lien.type,
        recordingDate: lien.recordingDate,
        statuteOrBasis: lien.statuteOrBasis,
      });
    }
  };

  processTierLiens(tier2Liens, WATERFALL_TIERS.TIER_2_SUPER_PRIORITY_MUNICIPAL, 'Super-Priority Municipal & Special Assessments');
  processTierLiens(tier3Liens, WATERFALL_TIERS.TIER_3_JUNIOR_MORTGAGES, 'Junior Mortgages & Deeds of Trust');
  processTierLiens(tier4Liens, WATERFALL_TIERS.TIER_4_JUDGMENTS_AND_MECHANICS, 'Junior Judgments, Mechanics Liens, & HOA');

  // Tier 5: Residual Surplus Equity Payable to Former Property Owner
  const formerOwnerEquity = Number(Math.max(0, availableSurplus).toFixed(2));

  ledger.push({
    tier: WATERFALL_TIERS.TIER_5_FORMER_OWNER_EQUITY,
    tierName: 'Residual Surplus Equity (Former Property Owner)',
    claimant: options.formerOwnerName || 'Former Property Owner (Fee Simple Estate)',
    claimAmount: formerOwnerEquity,
    paidAmount: formerOwnerEquity,
    remainingUnpaid: 0,
    status: formerOwnerEquity > 0 ? 'FULL' : 'UNPAID',
    statuteOrBasis: 'Tyler v. Hennepin County, 598 U.S. 631 (2023) / Fifth Amendment Takings Clause',
  });

  return {
    winningBid: bid,
    totalAdjudgedDebt: debt,
    grossSurplus,
    surplusGenerated,
    adjudgedDebtSatisfied,
    deficiencyAmount,
    allocatedJuniorClaims,
    formerOwnerEquity,
    uncoveredClaims,
    totalClaimsSatisfied: Number((adjudgedDebtSatisfied + allocatedJuniorClaims + formerOwnerEquity).toFixed(2)),
    ledger,
    constitutionalBasis: {
      landmarkCase: 'Tyler v. Hennepin County, 598 U.S. 631 (2023)',
      constitutionalClause: 'Fifth Amendment Takings Clause',
      holding: 'Retention of excess proceeds beyond government debt constitutes unconstitutional taking.',
    },
  };
}

module.exports = {
  WATERFALL_TIERS,
  classifyLienTier,
  calculateSurplusEquityWaterfall,
};
