'use strict';

/**
 * server/intelligence/title-risk-engine.js
 *
 * Deterministic Statutory Title Risk & Lien Survival Arbitration Engine.
 *
 * Implements rigorous foreclosure underwriting logic:
 * 1. Senior vs Junior Lien Survival: When 2nd mortgage/HELOC/HOA forecloses,
 *    senior 1st mortgage survives the sale in full.
 * 2. Federal Tax Liens: 26 U.S.C. § 7425 25-day notice rule and 120-day IRS redemption right.
 * 3. 22-State HOA Super-Priority assessment rules (UCIOA & state statutes), including
 *    Nevada (NRS 116.3116) senior mortgage extinguishment under SFR Investments Pool 1.
 * 4. Bankruptcy Automatic Stay Analyzer under 11 U.S.C. § 362 (serial-filer 30-day expiration,
 *    zero automatic stay for 2+ prior dismissals, and 2-year in rem relief).
 * 5. 50-State Statutory Redemption & Upset Bid periods (AL, MI, NJ, NC, etc.).
 */

const { STATE_REDEMPTION_RULES } = require('../ai/legal-rules');
const {
  HOA_SUPER_PRIORITY_RULES,
  HOA_SUPER_PRIORITY_STATES,
  evaluateHoaSuperLien,
} = require('./hoa-super-lien');
const { analyzeBankruptcyStay } = require('./bankruptcy-stay');
const { evaluateIrsNoticeRule } = require('./irs-notice');

/**
 * Classifies the foreclosing plaintiff party type
 */
function classifyForeclosingParty(plaintiff = '', noticeText = '') {
  const combined = `${plaintiff} ${noticeText}`.toLowerCase();

  // 1. Municipal or property tax authority
  if (/(?:county\s*treasurer|tax\s*collector|city\s*of|dept\s*of\s*revenue|internal\s*revenue|\birs\b|tax\s*lien|delinquent\s*tax)/i.test(combined)) {
    return 'TAX_AUTHORITY';
  }

  // 2. PACE Loan / Clean Energy Assessment
  if (/(?:pace\s*(?:loan|assessment|financing|lien)|clean\s*energy\s*(?:lien|assessment)|hero\s*program|ygrene|property\s*assessed\s*clean\s*energy)/i.test(combined)) {
    return 'PACE_LIEN';
  }

  // 3. Mechanic's Lien / Construction Lien / Materialman's Lien
  if (/(?:mechanic'?s?\s*lien|materialm[ae]n'?s?\s*lien|construction\s*lien|contractor'?s?\s*lien|labor\s*(?:and|&)\s*materials?|claim\s*of\s*lien)/i.test(combined)) {
    return 'MECHANICS_LIEN';
  }

  // 4. HOA / Condo Association
  if (/(?:homeowners?\s*association|condominium\s*association|\bhoa\b|condo\s*owners|master\s*association|community\s*association|property\s*owners\s*association)/i.test(combined)) {
    return 'HOA_ASSESSMENT';
  }

  // 5. Junior Mortgage / HELOC / Second Trust Deed
  if (/(?:second\s*(?:mortgage|(?:trust\s*)?deed)|2nd\s*(?:mortgage|(?:trust\s*)?deed)|junior\s*(?:mortgage|deed|lien)|\bheloc\b|(?:home\s+)?equity\s*line|subordinate\s*(?:deed|mortgage|lien))/i.test(combined)) {
    return 'SECOND_MORTGAGE_HELOC';
  }

  // 6. Conventional First Mortgage / Institutional Lender
  if (/(?:mortgage|bank|fannie|freddie|wells\s*fargo|jpmorgan|chase|citibank|truist|pnc|us\s*bank|loan\s*service|trustee|nationstar|mr\s*cooper|freedom\s*mortgage|rocket|caliber|quicken)/i.test(combined)) {
    return 'FIRST_MORTGAGE';
  }

  return 'UNKNOWN';
}

/**
 * Detects presence of recorded federal tax liens under 26 U.S.C. § 7425
 */
function detectIrsFederalTaxLien(noticeText = '', options = {}) {
  const result = evaluateIrsNoticeRule({ noticeText, ...options });
  return {
    hasIrsLien: result.hasFederalTaxLien,
    hasLien: result.hasFederalTaxLien,
    redemptionDays: result.redemptionDays,
    statute: result.statutoryCitation,
    warning: result.warning,
    lienSurvivesForeclosure: result.lienSurvivesForeclosure,
    noticeTimely: result.noticeTimely,
    taxLienDischarged: result.taxLienDischarged,
  };
}

function extractInstrumentPrioritySignals(noticeText = '') {
  const text = String(noticeText || '');
  const instrumentMatch = text.match(/(?:instrument\s*(?:no\.?|#)|doc(?:ument)?\s*(?:no\.?|#))\s*([A-Za-z0-9-]{4,24})/i);
  const bookPageMatch = text.match(/(?:book|liber|volume)\s*([0-9A-Za-z]+)\s*,?\s*(?:page|folio)\s*([0-9A-Za-z]+)/i);
  const recordedDateMatch = text.match(/(?:recorded|filed)\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2},\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i);
  const seniorSubjectToMatch = /(?:subject\s+to\s+(?:a\s+|any\s+)?(?:(?:prior|senior|first)\s+)+(?:mortgage|deed\s+of\s+trust|lien)|senior\s+lien\s+remains)/i.test(text);

  return {
    instrumentNumber: instrumentMatch ? instrumentMatch[1] : null,
    bookPage: bookPageMatch ? { book: bookPageMatch[1], page: bookPageMatch[2] } : null,
    recordedDate: recordedDateMatch ? recordedDateMatch[1] : null,
    explicitlySubjectToSeniorMortgage: seniorSubjectToMatch,
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
  const instrumentSignals = extractInstrumentPrioritySignals(notice);
  const redemptionRule = (STATE_REDEMPTION_RULES || {})[state] || { days: 0, label: 'Standard statutory confirmation' };

  // 1. Evaluate 50-State HOA Super-Lien Priority
  const hoaEval = evaluateHoaSuperLien({
    state,
    monthlyDues: listing.monthlyHoa ?? listing.hoaDues ?? listing.monthlyDues ?? null,
    originalMortgageDebt: listing.originalMortgageDebt ?? listing.mortgageDebt ?? null,
    isHoaForeclosing: partyType === 'HOA_ASSESSMENT',
    foreclosingPartyType: partyType,
    noticeText: notice,
  });

  // 2. Evaluate IRS Federal Tax Lien 25-Day Notice Rule (26 U.S.C. § 7425)
  const irsNoticeEval = evaluateIrsNoticeRule({
    hasFederalTaxLien: listing.hasIrsLien ?? listing.hasFederalTaxLien,
    saleDate: listing.saleDate,
    irsNoticeDate: listing.irsNoticeDate,
    noticeProvided: listing.irsNoticeProvided ?? listing.irsNoticeGiven,
    noticeMethod: listing.irsNoticeMethod,
    noticeText: notice,
  });

  const irsLien = {
    hasIrsLien: irsNoticeEval.hasFederalTaxLien,
    hasLien: irsNoticeEval.hasFederalTaxLien,
    redemptionDays: irsNoticeEval.redemptionDays,
    statute: irsNoticeEval.statutoryCitation,
    warning: irsNoticeEval.warning,
    lienSurvivesForeclosure: irsNoticeEval.lienSurvivesForeclosure,
    noticeTimely: irsNoticeEval.noticeTimely,
    taxLienDischarged: irsNoticeEval.taxLienDischarged,
  };

  // 3. Evaluate Bankruptcy Automatic Stay (11 U.S.C. § 362)
  const bankruptcyStay = analyzeBankruptcyStay({
    hasBankruptcyFiling: listing.bankruptcy?.active ?? listing.hasBankruptcyFiling,
    petitionDate: listing.bankruptcy?.petitionDate ?? listing.petitionDate,
    priorDismissalsWithin1Year: listing.bankruptcy?.priorDismissalsWithin1Year ?? listing.priorDismissalsWithin1Year,
    hasCourtExtension: listing.bankruptcy?.hasCourtExtension ?? listing.hasCourtExtension,
    hasInRemReliefOrder: listing.bankruptcy?.hasInRemReliefOrder ?? listing.hasInRemReliefOrder,
    inRemOrderDate: listing.bankruptcy?.inRemOrderDate ?? listing.inRemOrderDate,
    hasReliefFromStay: listing.bankruptcy?.hasReliefFromStay ?? listing.hasReliefFromStay,
    saleDate: listing.saleDate,
    noticeText: notice,
  });

  const warnings = [];
  let riskLevel = 'LOW';
  let firstMortgageSurvives = false;
  let canProceedWithBid = true;

  // I. Junior Lien Foreclosure / Priority Analysis
  if (partyType === 'SECOND_MORTGAGE_HELOC' || instrumentSignals.explicitlySubjectToSeniorMortgage) {
    firstMortgageSurvives = true;
    riskLevel = 'CRITICAL';
    canProceedWithBid = false;
    warnings.push('CRITICAL TITLE DEFECT: Foreclosing party is a junior lienholder (2nd Mortgage/HELOC). Senior 1st mortgage survives sale in full!');
  } else if (partyType === 'HOA_ASSESSMENT') {
    if (state === 'NV') {
      // Nevada: True super-priority primes first deed of trust and extinguishes senior mortgage (SFR Investments Pool 1)
      firstMortgageSurvives = false;
      riskLevel = 'HIGH';
      canProceedWithBid = true;
      warnings.push(hoaEval.warningDetails[0]);
    } else if (hoaEval.isSuperPriorityState) {
      riskLevel = 'HIGH';
      warnings.push(...hoaEval.warningDetails);
    } else {
      firstMortgageSurvives = true;
      riskLevel = 'CRITICAL';
      canProceedWithBid = false;
      warnings.push('CRITICAL TITLE DEFECT: HOA foreclosing in a non-super-priority state. 1st mortgage recorded prior survives the auction in full!');
    }
  } else if (partyType === 'PACE_LIEN') {
    riskLevel = 'HIGH';
    warnings.push('PACE ASSESSMENT SUPER-PRIORITY: PACE clean energy financing is collected as a senior municipal tax assessment under state statutes, surviving private mortgage foreclosures.');
  } else if (partyType === 'MECHANICS_LIEN') {
    firstMortgageSurvives = true;
    riskLevel = 'CRITICAL';
    canProceedWithBid = false;
    warnings.push("CRITICAL TITLE DEFECT: Mechanic's/Construction lien foreclosure. Senior mortgages recorded prior to commencement of work survive sale in full; verify contractor commencement affidavit.");
  } else if (partyType === 'TAX_AUTHORITY') {
    riskLevel = 'LOW';
    warnings.push('TAX SALE PRIORITY: Property tax foreclosures generally prime all private mortgages and deeds of trust.');
  } else if (partyType === 'FIRST_MORTGAGE') {
    warnings.push('SENIOR FORECLOSURE: 1st mortgage foreclosing wipes out junior deeds and subordinate judgment liens (subject to unjoined parties).');
    if (hoaEval.isSuperPriorityState) {
      warnings.push(`HOA SUPER-PRIORITY PAYOFF (${hoaEval.statute}): Senior mortgage foreclosure does NOT extinguish up to ${hoaEval.statutoryCapMonths} months of delinquent HOA assessments. Buyer/lender must satisfy super-priority lien.`);
    }
  } else {
    riskLevel = 'MODERATE';
    firstMortgageSurvives = null;
    canProceedWithBid = false;
    warnings.push('UNCONFIRMED LIEN PRIORITY: Plaintiff lien position could not be deterministically established from publisher record. Title search required.');
  }

  // II. Federal Tax Lien 25-Day Rule Analysis
  if (irsNoticeEval.hasFederalTaxLien) {
    if (irsNoticeEval.lienSurvivesForeclosure) {
      riskLevel = 'CRITICAL';
      canProceedWithBid = false;
      warnings.push(irsNoticeEval.warning);
    } else {
      if (riskLevel !== 'CRITICAL') riskLevel = 'HIGH';
      warnings.push(irsNoticeEval.warning);
    }
  }

  // III. Bankruptcy Automatic Stay Analysis
  if (bankruptcyStay.hasBankruptcyFiling || bankruptcyStay.inRemReliefActive) {
    if (bankruptcyStay.stayEffective) {
      riskLevel = 'CRITICAL';
      canProceedWithBid = false;
      warnings.push(`BANKRUPTCY AUTOMATIC STAY ACTIVE (${bankruptcyStay.statutoryRuleCited}): Foreclosure auction stayed by operation of law. Any sale conducted during stay is void ab initio.`);
    } else if (bankruptcyStay.serialFilerFlag === 'TWO_OR_MORE_PRIOR_DISMISSALS_ZERO_STAY') {
      warnings.push(`BANKRUPTCY SERIAL FILER (11 U.S.C. § 362(c)(4)): Debtor had 2+ prior dismissals within 1 year; ZERO automatic stay took effect upon filing. Foreclosure sale may proceed.`);
    } else if (bankruptcyStay.serialFilerFlag === 'IN_REM_RELIEF_RECORDED_2_YEAR_BAR') {
      warnings.push(`IN REM BANKRUPTCY RELIEF (11 U.S.C. § 362(d)(4)): Binding 2-year in rem order bars automatic stay on this property. Foreclosure sale may proceed.`);
    } else if (bankruptcyStay.serialFilerFlag === 'SINGLE_PRIOR_DISMISSAL_30_DAY_EXPIRATION') {
      warnings.push(`BANKRUPTCY STAY TERMINATED (11 U.S.C. § 362(c)(3)): Single prior dismissal within 1 year; automatic stay expired after 30 days without court extension. Foreclosure sale may proceed.`);
    } else if (bankruptcyStay.serialFilerFlag === 'RELIEF_FROM_STAY_GRANTED') {
      warnings.push(`RELIEF FROM STAY GRANTED (11 U.S.C. § 362(d)): Bankruptcy court granted relief from automatic stay. Foreclosure sale may proceed.`);
    }
  }

  // IV. State Statutory Redemption Warning
  if (redemptionRule.days > 0) {
    warnings.push(`STATUTORY REDEMPTION ACTIVE: ${redemptionRule.label}`);
    if (redemptionRule.days >= 180 && riskLevel === 'LOW') {
      riskLevel = 'MODERATE';
    }
  }

  // V. North Carolina Upset Bid Window
  if (state === 'NC') {
    warnings.push('NORTH CAROLINA 10-DAY UPSET BID: Sale remains open for upset bids (5% or $750 minimum increase) under N.C.G.S. § 45-21.27.');
  }

  // VI. Action Advice Synthesis
  let titleActionAdvice = 'No senior-lien flag from the published plaintiff. This is not a title opinion or a bid instruction.';
  if (riskLevel === 'CRITICAL') {
    if (bankruptcyStay.stayEffective) {
      titleActionAdvice = 'DO NOT BID. Sale stayed by federal bankruptcy court (11 U.S.C. § 362). Foreclosure sale would be void ab initio.';
    } else if (irsNoticeEval.lienSurvivesForeclosure) {
      titleActionAdvice = 'DO NOT BID. Federal tax lien survives sale due to 26 U.S.C. § 7425 25-day notice failure.';
    } else {
      titleActionAdvice = 'DO NOT BID. Senior mortgage survives sale; winning bidder takes property encumbered by underlying debt.';
    }
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
    irsNoticeEvaluation: irsNoticeEval,
    hoaSuperPriority: {
      isSuperPriorityState: hoaEval.isSuperPriorityState,
      monthsProtected: hoaEval.statutoryCapMonths,
      statutoryCapMonths: hoaEval.statutoryCapMonths,
      statute: hoaEval.statute,
      safeHarborApplicable: hoaEval.safeHarborApplicable,
      statutoryDollarCap: hoaEval.statutoryDollarCap,
      seniorMortgageExtinguished: hoaEval.seniorMortgageExtinguished,
      riskRating: hoaEval.riskRating,
      estimatedSuperLienAmount: hoaEval.estimatedSuperLienAmount,
      warningDetails: hoaEval.warningDetails,
    },
    bankruptcyStay,
    statutoryRedemption: {
      state,
      days: redemptionRule.days,
      label: redemptionRule.label,
    },
    instrumentPriority: instrumentSignals,
    titleWarnings: warnings,
    titleActionAdvice,
    canProceedWithBid,
  };
}

module.exports = {
  HOA_SUPER_PRIORITY_STATES,
  HOA_SUPER_PRIORITY_RULES,
  classifyForeclosingParty,
  detectIrsFederalTaxLien,
  extractInstrumentPrioritySignals,
  arbitrateTitleRisk,
  evaluateHoaSuperLien,
  analyzeBankruptcyStay,
  evaluateIrsNoticeRule,
};
