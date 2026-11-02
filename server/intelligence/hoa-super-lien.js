'use strict';

/**
 * server/intelligence/hoa-super-lien.js
 *
 * 50-State Statutory HOA / COA Super-Lien Priority Engine.
 *
 * Evaluates priority arbitration between Condominium & Homeowner Associations
 * and senior first mortgages / deeds of trust across all US jurisdictions:
 *
 * 1. Nevada (NRS 116.3116):
 *    True super-priority up to 9 months of common assessments.
 *    Landmark: SFR Investments Pool 1, LLC v. U.S. Bank, N.A., 334 P.3d 408 (Nev. 2014).
 *    Foreclosure of HOA super-priority lien extinguishes prior first mortgages/deeds of trust!
 *    Explicit risk rating: EXTINGUISHES_FIRST_MORTGAGE.
 *
 * 2. Colorado (C.R.S. § 38-33.3-316):
 *    6 months of common expense assessments take super-priority over first deeds of trust.
 *
 * 3. Florida (Fla. Stat. § 718.116 / § 720.3085):
 *    Safe harbor cap: liability of first mortgagee or subsequent acquirer is limited to
 *    lesser of 12 months unpaid assessments or 1% of the original mortgage debt.
 *
 * 4. Washington DC (D.C. Code § 42-1903.13):
 *    6 months condominium common expense assessment super-priority.
 *
 * 5. Maryland (Md. Code Ann., Real Prop. § 11B-117 / § 11-110):
 *    Super-priority capped at 4 months of common assessments or $1,200, whichever is less.
 *
 * 6. Connecticut (Conn. Gen. Stat. § 47-258):
 *    9 months of common expense assessments hold super-priority over first mortgages.
 *
 * 7. Pennsylvania (68 Pa.C.S. § 3315 / § 5315):
 *    6 months of common assessments prime prior mortgages.
 *
 * 8. Other 22-State Super-Priority Jurisdictions (MA, MN, MO, NJ, OR, RI, TN, VT, WA, WV, AL, AK, HI, IL, NY):
 *    6 months rolling or fixed common assessment priority.
 *
 * 9. Non-Super-Priority States (TX, CA, OH, AZ, GA, NC, SC, VA, etc.):
 *    HOA liens are strictly subordinate to prior recorded first mortgages/deeds of trust.
 *    HOA foreclosure does NOT extinguish first mortgage; buyer takes title subject to senior mortgage debt.
 */

// 22 States with statutory HOA / Condominium Super-Priority assessment liens
const HOA_SUPER_PRIORITY_RULES = Object.freeze({
  NV: {
    months: 9,
    statute: 'NRS 116.3116',
    label: 'Nevada 9-month HOA super-priority assessment primes first deed of trust',
    extinguishesFirstMortgageOnHoaForeclosure: true,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
    landmarkCase: 'SFR Investments Pool 1, LLC v. U.S. Bank, N.A., 334 P.3d 408 (Nev. 2014)',
  },
  CO: {
    months: 6,
    statute: 'C.R.S. § 38-33.3-316',
    label: 'Colorado 6-month HOA super-priority assessment',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  CT: {
    months: 9,
    statute: 'Conn. Gen. Stat. § 47-258',
    label: 'Connecticut 9-month common interest ownership super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  FL: {
    months: 12,
    statute: 'Fla. Stat. § 718.116 / § 720.3085',
    label: 'Florida Safe Harbor: 12 months past assessments or 1% of original mortgage debt',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: true,
    safeHarborPercent: 0.01,
    statutoryDollarCap: null,
  },
  DC: {
    months: 6,
    statute: 'D.C. Code § 42-1903.13',
    label: 'District of Columbia 6-month condo super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  MD: {
    months: 4,
    statute: 'Md. Code Ann., Real Prop. § 11B-117 / § 11-110',
    label: 'Maryland 4-month condo/HOA assessment priority capped at $1,200',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: 1200,
  },
  PA: {
    months: 6,
    statute: '68 Pa.C.S. § 3315',
    label: 'Pennsylvania 6-month uniform condominium / planned community super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  WA: {
    months: 6,
    statute: 'RCW 64.34.364',
    label: 'Washington 6-month condo super-priority lien',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  MA: {
    months: 6,
    statute: 'M.G.L. c. 183A § 6',
    label: 'Massachusetts 6-month rolling super-priority lien',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  MN: {
    months: 6,
    statute: 'Minn. Stat. § 515B.3-116',
    label: 'Minnesota 6-month common interest community super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  MO: {
    months: 6,
    statute: 'RSMo § 448.3-116',
    label: 'Missouri 6-month condominium super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  NJ: {
    months: 6,
    statute: 'N.J.S.A. 46:8B-21',
    label: 'New Jersey 6-month condo assessment super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  OR: {
    months: 6,
    statute: 'ORS § 100.450',
    label: 'Oregon 6-month condominium assessment super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  RI: {
    months: 6,
    statute: 'R.I. Gen. Laws § 34-36.1-3.16',
    label: 'Rhode Island 6-month super-priority assessment',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  TN: {
    months: 6,
    statute: 'Tenn. Code § 66-27-415',
    label: 'Tennessee 6-month condominium priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  VT: {
    months: 6,
    statute: '27A V.S.A. § 3-116',
    label: 'Vermont 6-month common interest ownership super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  WV: {
    months: 6,
    statute: 'W. Va. Code § 36B-3-116',
    label: 'West Virginia 6-month UCIOA super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  AL: {
    months: 6,
    statute: 'Ala. Code § 35-8A-316',
    label: 'Alabama 6-month condominium super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  AK: {
    months: 6,
    statute: 'AS § 34.08.470',
    label: 'Alaska 6-month common interest super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  HI: {
    months: 6,
    statute: 'HRS § 514B-146',
    label: 'Hawaii 6-month non-judicial condo super-priority',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  IL: {
    months: 6,
    statute: '765 ILCS 605/9',
    label: 'Illinois condominium assessment strict lien',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  NY: {
    months: 6,
    statute: 'N.Y. Real Prop. Law § 339-z',
    label: 'New York condominium assessment priority over subordinate liens',
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
});

/**
 * Evaluates statutory HOA / Condominium Super-Lien status and buyer risk.
 *
 * @param {Object} params
 * @param {string} [params.state] - 2-letter state code (e.g. 'NV', 'CO', 'FL', 'TX')
 * @param {number|null} [params.monthlyDues] - Monthly HOA/condo assessment amount
 * @param {number|null} [params.originalMortgageDebt] - Original principal balance of first mortgage (for FL safe harbor)
 * @param {boolean} [params.isHoaForeclosing] - Whether the HOA / COA is the foreclosing plaintiff
 * @param {string} [params.foreclosingPartyType] - Party classification (e.g. 'HOA_ASSESSMENT', 'FIRST_MORTGAGE')
 * @param {string} [params.noticeText] - Raw legal notice text for additional context
 * @returns {Object} Standardized HOA super-lien priority profile
 */
function evaluateHoaSuperLien(params = {}) {
  const state = String(params.state || '').trim().toUpperCase();
  const rule = HOA_SUPER_PRIORITY_RULES[state] || null;

  const isSuperPriorityState = Boolean(rule);
  const statutoryCapMonths = rule ? rule.months : 0;
  const safeHarborApplicable = rule ? Boolean(rule.safeHarborApplicable) : false;
  const statutoryDollarCap = rule ? (rule.statutoryDollarCap ?? null) : null;
  const statute = rule ? rule.statute : null;

  // Determine if HOA/COA is foreclosing
  const isHoa = Boolean(
    params.isHoaForeclosing === true ||
    params.foreclosingPartyType === 'HOA_ASSESSMENT' ||
    (params.noticeText && /(?:homeowners?\s*association|condominium\s*association|\bhoa\b|master\s*association)/i.test(params.noticeText))
  );

  // Senior mortgage extinguishment: True only in Nevada under NRS 116.3116 / SFR Investments Pool 1
  let seniorMortgageExtinguished = false;
  let riskRating = 'NONE';
  const warnings = [];

  if (isHoa) {
    if (state === 'NV') {
      // Nevada: HOA foreclosure of super-priority lien extinguishes prior first mortgages!
      seniorMortgageExtinguished = true;
      riskRating = 'EXTINGUISHES_FIRST_MORTGAGE';
      warnings.push(
        `NEVADA TRUE SUPER-PRIORITY (NRS 116.3116): Nevada 9-month HOA super-priority assessment primes first deed of trust and EXTINGUISHES prior first mortgage upon foreclosure (SFR Investments Pool 1 v. U.S. Bank, 334 P.3d 408). Winning bidder takes free and clear of senior mortgage.`
      );
    } else if (isSuperPriorityState) {
      seniorMortgageExtinguished = false;
      riskRating = 'SUPER_PRIORITY_ASSESSMENT';
      warnings.push(
        `HOA SUPER-PRIORITY: ${rule.label}. Assessments over ${rule.months} months remain subordinate to first mortgage.`
      );
    } else {
      // Non-super-priority state (e.g. TX, OH, CA)
      seniorMortgageExtinguished = false;
      riskRating = 'CRITICAL_SENIOR_MORTGAGE_SURVIVES';
      warnings.push(
        `CRITICAL TITLE DEFECT: HOA foreclosing in a non-super-priority state (${state || 'UNKNOWN'}). 1st mortgage recorded prior survives the auction in full! Winning bidder takes property encumbered by senior debt.`
      );
    }
  } else {
    // Non-HOA foreclosing (e.g. First Mortgage foreclosing)
    if (isSuperPriorityState) {
      riskRating = 'HOA_SUPER_PRIORITY_PAYOFF';
      warnings.push(
        `HOA SUPER-PRIORITY PAYOFF (${rule.statute}): Senior mortgage foreclosure does NOT extinguish up to ${rule.months} months of delinquent HOA assessments. Buyer/lender must satisfy super-priority lien.`
      );
    } else {
      riskRating = 'HOA_SUBORDINATE_EXTINGUISHED';
    }
  }

  // Specific state nuances
  if (state === 'FL') {
    warnings.push(
      `FLORIDA SAFE HARBOR (Fla. Stat. § 718.116 / § 720.3085): First mortgagee or subsequent purchaser liability is capped at the lesser of 12 months unpaid assessments or 1% of original mortgage debt.`
    );
  } else if (state === 'MD') {
    warnings.push(
      `MARYLAND STATUTORY ASSESSMENT CAP (Md. Code Ann., Real Prop. § 11B-117 / § 11-110): HOA/COA super-priority is strictly capped at 4 months of common assessments or $1,200, whichever is less.`
    );
  } else if (state === 'CO') {
    warnings.push(
      `COLORADO SUPER-PRIORITY (C.R.S. § 38-33.3-316): Association possesses a 6-month super-priority lien for common assessments ahead of first deeds of trust.`
    );
  } else if (state === 'DC') {
    warnings.push(
      `DISTRICT OF COLUMBIA SUPER-PRIORITY (D.C. Code § 42-1903.13): Condominium common expense assessment lien holds 6 months super-priority over prior first deeds of trust.`
    );
  } else if (state === 'CT') {
    warnings.push(
      `CONNECTICUT SUPER-PRIORITY (Conn. Gen. Stat. § 47-258): 9 months of common expense assessments hold super-priority over first mortgages.`
    );
  } else if (state === 'PA') {
    warnings.push(
      `PENNSYLVANIA SUPER-PRIORITY (68 Pa.C.S. § 3315): 6 months of common assessments take priority over first recorded mortgages.`
    );
  }

  // Calculate estimated super-lien amount:
  // Strict rule: "Never invent numbers; if monthly dues are missing, keep dollar amount null and report statutory months and risk code."
  let estimatedSuperLienAmount = null;
  const rawDues = params.monthlyDues;
  const hasValidDues = typeof rawDues === 'number' && Number.isFinite(rawDues) && rawDues > 0;

  if (hasValidDues) {
    if (state === 'MD') {
      // 4 months or $1,200, whichever is less
      estimatedSuperLienAmount = Math.min(rawDues * 4, 1200);
    } else if (state === 'FL') {
      const rawDebt = params.originalMortgageDebt;
      const hasValidDebt = typeof rawDebt === 'number' && Number.isFinite(rawDebt) && rawDebt > 0;
      if (hasValidDebt) {
        // Lesser of 12 months assessments or 1% of original mortgage debt
        estimatedSuperLienAmount = Math.min(rawDues * 12, rawDebt * 0.01);
      } else {
        // 12 months assessments (subject to 1% debt safe harbor ceiling if debt known)
        estimatedSuperLienAmount = rawDues * 12;
      }
    } else if (isSuperPriorityState) {
      estimatedSuperLienAmount = rawDues * statutoryCapMonths;
    } else {
      estimatedSuperLienAmount = 0;
    }
  }

  return {
    isSuperPriorityState,
    statutoryCapMonths,
    safeHarborApplicable,
    statutoryDollarCap,
    statute,
    seniorMortgageExtinguished,
    riskRating,
    estimatedSuperLienAmount,
    warningDetails: warnings,
    monthsProtected: statutoryCapMonths, // Backwards-compatible alias
  };
}

module.exports = {
  HOA_SUPER_PRIORITY_RULES,
  HOA_SUPER_PRIORITY_STATES: HOA_SUPER_PRIORITY_RULES, // Backwards-compatible alias for title-risk-engine
  evaluateHoaSuperLien,
};
