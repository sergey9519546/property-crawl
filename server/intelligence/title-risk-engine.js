'use strict';

/**
 * server/intelligence/title-risk-engine.js
 *
 * Deterministic Statutory Title Risk & Lien Survival Arbitration Engine.
 *
 * Implements rigorous foreclosure underwriting logic:
 * 1. Senior vs Junior Lien Survival: When 2nd mortgage/HELOC/HOA forecloses,
 *    senior 1st mortgage survives the sale in full.
 * 2. Federal Tax Liens: 26 U.S.C. § 7425(d) statutory 120-day IRS redemption right.
 * 3. 22-State HOA Super-Priority assessment rules (UCIOA & state statutes).
 * 4. 50-State Statutory Redemption & Upset Bid periods (AL, MI, NJ, NC, etc.).
 */

const { STATE_REDEMPTION_RULES } = require('../ai/legal-rules');

// 22 States with statutory HOA / Condominium Super-Priority assessment liens
const HOA_SUPER_PRIORITY_STATES = Object.freeze({
  NV: { months: 9, statute: 'NRS 116.3116', label: 'Nevada 9-month HOA super-priority assessment primes first deed of trust' },
  CO: { months: 6, statute: 'C.R.S. § 38-33.3-316', label: 'Colorado 6-month HOA super-priority assessment' },
  CT: { months: 9, statute: 'Conn. Gen. Stat. § 47-258', label: 'Connecticut 9-month common interest ownership super-priority' },
  FL: { months: 12, statute: 'Fla. Stat. § 718.116', label: 'Florida Safe Harbor: 12 months or 1% of original mortgage debt' },
  WA: { months: 6, statute: 'RCW 64.34.364', label: 'Washington 6-month condo super-priority lien' },
  DC: { months: 6, statute: 'D.C. Code § 42-1903.13', label: 'District of Columbia 6-month condo super-priority' },
  MD: { months: 4, statute: 'Md. Code Real Prop. § 11-110', label: 'Maryland 4-month condo assessment priority up to $1,200' },
  MA: { months: 6, statute: 'M.G.L. c. 183A § 6', label: 'Massachusetts 6-month rolling super-priority lien' },
  MN: { months: 6, statute: 'Minn. Stat. § 515B.3-116', label: 'Minnesota 6-month common interest community super-priority' },
  MO: { months: 6, statute: 'RSMo § 448.3-116', label: 'Missouri 6-month condominium super-priority' },
  NJ: { months: 6, statute: 'N.J.S.A. 46:8B-21', label: 'New Jersey 6-month condo assessment super-priority' },
  OR: { months: 6, statute: 'ORS § 100.450', label: 'Oregon 6-month condominium assessment super-priority' },
  PA: { months: 6, statute: '68 Pa.C.S. § 3315', label: 'Pennsylvania 6-month uniform condominium super-priority' },
  RI: { months: 6, statute: 'R.I. Gen. Laws § 34-36.1-3.16', label: 'Rhode Island 6-month super-priority assessment' },
  TN: { months: 6, statute: 'Tenn. Code § 66-27-415', label: 'Tennessee 6-month condominium priority' },
  VT: { months: 6, statute: '27A V.S.A. § 3-116', label: 'Vermont 6-month common interest ownership super-priority' },
  WV: { months: 6, statute: 'W. Va. Code § 36B-3-116', label: 'West Virginia 6-month UCIOA super-priority' },
  AL: { months: 6, statute: 'Ala. Code § 35-8A-316', label: 'Alabama 6-month condominium super-priority' },
  AK: { months: 6, statute: 'AS § 34.08.470', label: 'Alaska 6-month common interest super-priority' },
  HI: { months: 6, statute: 'HRS § 514B-146', label: 'Hawaii 6-month non-judicial condo super-priority' },
  IL: { months: 6, statute: '765 ILCS 605/9', label: 'Illinois condominium assessment strict lien' },
  NY: { months: 6, statute: 'N.Y. Real Prop. Law § 339-z', label: 'New York condominium assessment priority over subordinate liens' },
});

/**
 * Classifies the foreclosing plaintiff party type
 */
function classifyForeclosingParty(plaintiff = '', noticeText = '') {
  const combined = `${plaintiff} ${noticeText}`.toLowerCase();

  // 1. Municipal or property tax authority
  if (/(?:county\s*treasurer|tax\s*collector|city\s*of|dept\s*of\s*revenue|internal\s*revenue|irs|tax\s*lien|delinquent\s*tax)/i.test(combined)) {
    return 'TAX_AUTHORITY';
  }

  // 2. HOA / Condo Association
  if (/(?:homeowners?\s*association|condominium\s*association|hoa|condo\s*owners|master\s*association|community\s*association|property\s*owners\s*association)/i.test(combined)) {
    return 'HOA_ASSESSMENT';
  }

  // 3. Junior Mortgage / HELOC / Second Trust Deed
  if (/(?:second\s*mortgage|2nd\s*mortgage|junior\s*mortgage|heloc|home\s*equity\s*line|subordinate\s*deed|subordinate\s*mortgage)/i.test(combined)) {
    return 'SECOND_MORTGAGE_HELOC';
  }

  // 4. Conventional First Mortgage / Institutional Lender
  if (/(?:mortgage|bank|fannie|freddie|wells\s*fargo|jpmorgan|chase|citibank|truist|pnc|us\s*bank|loan\s*service|trustee|nationstar|mr\s*cooper|freedom\s*mortgage|rocket|caliber|quicken)/i.test(combined)) {
    return 'FIRST_MORTGAGE';
  }

  return 'UNKNOWN';
}

/**
 * Detects presence of recorded federal tax liens under 26 U.S.C. § 7425
 */
function detectIrsFederalTaxLien(noticeText = '') {
  const text = String(noticeText || '');
  const hasIrs = /(?:united\s*states\s*of\s*america|internal\s*revenue\s*service|irs|federal\s*tax\s*lien|26\s*u\.?s\.?c\.?\s*§?\s*7425)/i.test(text);

  return {
    hasIrsLien: hasIrs,
    redemptionDays: hasIrs ? 120 : 0,
    statute: '26 U.S.C. § 7425(d)',
    warning: hasIrs
      ? 'FEDERAL TAX LIEN ACTIVE: United States holds statutory 120-day right of redemption under 26 U.S.C. § 7425(d).'
      : null,
  };
}

/**
 * Arbitrate complete title risk profile for a foreclosure listing
 */
function arbitrateTitleRisk(listing = {}, rawNoticeText = '') {
  const plaintiff = String(listing.plaintiff || listing.plaintiff_or_seller || '');
  const state = String(listing.state || 'OH').toUpperCase();
  const notice = `${rawNoticeText} ${listing.raw || ''} ${listing.description || ''}`;

  const partyType = classifyForeclosingParty(plaintiff, notice);
  const irsLien = detectIrsFederalTaxLien(notice);
  const hoaConfig = HOA_SUPER_PRIORITY_STATES[state] || null;
  const redemptionRule = (STATE_REDEMPTION_RULES || {})[state] || { days: 0, label: 'Standard statutory confirmation' };

  const warnings = [];
  let riskLevel = 'LOW';
  let firstMortgageSurvives = false;
  let canProceedWithBid = true;

  // 1. Junior Lien Foreclosure Alert
  if (partyType === 'SECOND_MORTGAGE_HELOC') {
    firstMortgageSurvives = true;
    riskLevel = 'CRITICAL';
    canProceedWithBid = false;
    warnings.push('CRITICAL TITLE DEFECT: Foreclosing party is a junior lienholder (2nd Mortgage/HELOC). Senior 1st mortgage survives sale in full!');
  } else if (partyType === 'HOA_ASSESSMENT') {
    if (hoaConfig) {
      riskLevel = 'HIGH';
      warnings.push(`HOA SUPER-PRIORITY: ${hoaConfig.label}. Assessments over ${hoaConfig.months} months remain subordinate to first mortgage.`);
    } else {
      firstMortgageSurvives = true;
      riskLevel = 'CRITICAL';
      canProceedWithBid = false;
      warnings.push('CRITICAL TITLE DEFECT: HOA foreclosing in a non-super-priority state. 1st mortgage recorded prior survives the auction in full!');
    }
  } else if (partyType === 'TAX_AUTHORITY') {
    riskLevel = 'LOW';
    warnings.push('TAX SALE PRIORITY: Property tax foreclosures generally prime all private mortgages and deeds of trust.');
  } else if (partyType === 'FIRST_MORTGAGE') {
    warnings.push('SENIOR FORECLOSURE: 1st mortgage foreclosing wipes out junior deeds and subordinate judgment liens (subject to unjoined parties).');
  } else {
    riskLevel = 'MODERATE';
    warnings.push('UNCONFIRMED LIEN PRIORITY: Plaintiff lien position could not be deterministically established from publisher record. Title search required.');
  }

  // 2. Federal Tax Lien Redemption Warning
  if (irsLien.hasIrsLien) {
    if (riskLevel !== 'CRITICAL') riskLevel = 'HIGH';
    warnings.push(irsLien.warning);
  }

  // 3. State Statutory Redemption Warning
  if (redemptionRule.days > 0) {
    warnings.push(`STATUTORY REDEMPTION ACTIVE: ${redemptionRule.label}`);
    if (redemptionRule.days >= 180 && riskLevel === 'LOW') {
      riskLevel = 'MODERATE';
    }
  }

  // 4. North Carolina Upset Bid Window
  if (state === 'NC') {
    warnings.push('NORTH CAROLINA 10-DAY UPSET BID: Sale remains open for upset bids (5% or $750 minimum increase) under N.C.G.S. § 45-21.27.');
  }

  let titleActionAdvice = 'Title risk verified acceptable for standard bidding.';
  if (riskLevel === 'CRITICAL') {
    titleActionAdvice = 'DO NOT BID. Senior mortgage survives sale; winning bidder takes property encumbered by underlying debt.';
  } else if (riskLevel === 'HIGH') {
    titleActionAdvice = 'ESCROW ESCALATION. Order full 40-year title search to confirm federal tax lien and HOA payoff balances.';
  } else if (riskLevel === 'MODERATE') {
    titleActionAdvice = 'PROCEED WITH CAUTION. Verify county docket for unjoined junior lienholders or extended statutory redemption.';
  }

  return {
    riskLevel,
    plaintiffType: partyType,
    firstMortgageSurvives,
    irsTaxLienRedemption: irsLien,
    hoaSuperPriority: {
      isSuperPriorityState: Boolean(hoaConfig),
      monthsProtected: hoaConfig ? hoaConfig.months : 0,
      statute: hoaConfig ? hoaConfig.statute : null,
    },
    statutoryRedemption: {
      state,
      days: redemptionRule.days,
      label: redemptionRule.label,
    },
    titleWarnings: warnings,
    titleActionAdvice,
    canProceedWithBid,
  };
}

module.exports = {
  HOA_SUPER_PRIORITY_STATES,
  classifyForeclosingParty,
  detectIrsFederalTaxLien,
  arbitrateTitleRisk,
};
