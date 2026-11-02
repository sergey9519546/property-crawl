'use strict';

/**
 * server/intelligence/irs-notice.js
 *
 * IRS Federal Tax Lien 25-Day Rule & Survival Analyzer under 26 U.S.C. § 7425.
 *
 * Foreclosure Underwriting & Legal Doctrine:
 * 1. 26 U.S.C. § 7425(b) & (c) - Non-Judicial Foreclosure Notice Rule:
 *    Where a Notice of Federal Tax Lien (NFTL) has been recorded more than 30 days
 *    before a scheduled foreclosure auction, statutory notice of the sale MUST be given
 *    in writing by registered or certified mail or personal service to the Secretary
 *    (IRS District Director / IRS Advisory Group) not less than 25 days prior to such sale.
 *
 * 2. Failure to Provide Timely 25-Day Notice (§ 7425(b)(1)):
 *    If the foreclosing mortgagee/trustee fails to serve written notice at least 25 days
 *    before the sale, the foreclosure sale is made SUBJECT TO and WITHOUT DISTURBING
 *    the federal tax lien. The federal tax lien SURVIVES the foreclosure sale in full!
 *    The winning bidder acquires the property subject to the IRS debt, primed or senior.
 *
 * 3. Timely Notice Provided (§ 7425(b)(2) & § 7425(d)):
 *    If proper written notice is given at least 25 days prior to the sale:
 *    The federal tax lien is discharged from the real property post-sale.
 *    HOWEVER, under 26 U.S.C. § 7425(d)(1), the United States retains a statutory
 *    120-day right of redemption from the sale date. The IRS may redeem the property
 *    by paying the winning bidder the purchase price plus statutory interest.
 */

const ONE_DAY_MS = 86400000;

function parseDateMs(dateVal) {
  if (!dateVal) return null;
  const time = Date.parse(typeof dateVal === 'string' ? dateVal.slice(0, 10) : dateVal);
  if (!Number.isFinite(time)) return null;
  return time;
}

/**
 * Scans text for federal tax lien existence and 25-day notice evidence.
 */
function detectIrsNoticeSignals(text = '') {
  const str = String(text || '');
  const hasIrs = /(?:united\s*states\s*of\s*america|internal\s*revenue\s*service|\birs\b|federal\s*tax\s*lien|26\s*u\.?s\.?c\.?\s*§?\s*7425)/i.test(str);

  if (!hasIrs) {
    return {
      hasFederalTaxLien: false,
      noticeProvided: null,
      noticeTimely: null,
      noticeMethod: null,
      explicitNoticeFailure: false,
    };
  }

  // Check for explicit lack of notice
  const explicitFailure = /(?:no\s*notice\s*(?:given|provided|sent|served)\s*to\s*(?:the\s*)?(?:irs|internal\s*revenue|district\s*director)|irs\s*not\s*served|25-?day\s*notice\s*not\s*(?:given|provided|served)|failure\s*to\s*notify\s*irs|without\s*(?:statutory\s*)?notice\s*to\s*(?:the\s*)?irs)/i.test(str);

  // Check for affirmative notice provided to IRS
  const noticeServed = /(?:notice\s*(?:of\s*sale\s*)?(?:given|provided|sent|served|mailed)\s*to\s*(?:the\s*)?(?:irs|internal\s*revenue|district\s*director|united\s*states)|(?:irs|internal\s*revenue\s*service|united\s*states)\s*(?:was\s*)?(?:served|notified|given\s*notice)|certified\s*mail\s*(?:to\s*)?(?:irs|internal\s*revenue)|proof\s*of\s*service\s*(?:on|to)\s*(?:the\s*)?(?:irs|internal\s*revenue)|25-?day\s*(?:statutory\s*)?(?:irs\s*)?notice\s*(?:satisfied|served|given|provided)|served\s*via\s*(?:certified|registered)\s*mail)/i.test(str);

  // Notice method
  let method = null;
  if (/certified\s*mail/i.test(str)) method = 'CERTIFIED_MAIL';
  else if (/registered\s*mail/i.test(str)) method = 'REGISTERED_MAIL';
  else if (/personal\s*service/i.test(str)) method = 'PERSONAL_SERVICE';

  return {
    hasFederalTaxLien: true,
    noticeProvided: explicitFailure ? false : (noticeServed ? true : null),
    noticeTimely: explicitFailure ? false : (noticeServed ? true : null),
    noticeMethod: method,
    explicitNoticeFailure: explicitFailure,
  };
}

/**
 * Evaluates IRS Federal Tax Lien 25-Day Notice Rule under 26 U.S.C. § 7425.
 *
 * @param {Object} params
 * @param {boolean} [params.hasFederalTaxLien] - Whether a recorded federal tax lien exists
 * @param {string|Date} [params.saleDate] - Foreclosure auction date
 * @param {string|Date} [params.irsNoticeDate] - Date notice was sent/served on the IRS
 * @param {boolean} [params.noticeProvided] - Whether statutory notice was served (false = failure)
 * @param {string} [params.noticeMethod] - Service method ('CERTIFIED_MAIL', 'REGISTERED_MAIL', 'PERSONAL_SERVICE', etc.)
 * @param {string} [params.noticeText] - Legal notice text for automated signal extraction
 * @returns {Object} IRS title risk analysis including discharge status and redemption rights
 */
function evaluateIrsNoticeRule(params = {}) {
  const detected = params.noticeText ? detectIrsNoticeSignals(params.noticeText) : {};

  const hasLien = Boolean(
    params.hasFederalTaxLien ??
    params.hasIrsLien ??
    params.hasLien ??
    detected.hasFederalTaxLien ??
    (params.noticeText && /(?:federal\s*tax\s*lien|26\s*u\.?s\.?c\.?\s*§?\s*7425|\birs\s*lien\b)/i.test(params.noticeText))
  );

  // If no IRS tax lien exists, return baseline clean state
  if (!hasLien) {
    return {
      hasFederalTaxLien: false,
      hasIrsLien: false,
      hasLien: false,
      noticeProvided: false,
      noticeTimely: null,
      noticeDaysBeforeSale: null,
      noticeMethod: null,
      lienSurvivesForeclosure: false,
      taxLienDischarged: null,
      irsRedemptionRightApplies: false,
      redemptionDays: 0,
      riskLevel: 'LOW',
      statutoryCitation: '26 U.S.C. § 7425',
      warning: null,
      bidderRecommendation: 'No federal tax lien detected.',
    };
  }

  // Calculate notice timing if dates are provided
  const saleTime = parseDateMs(params.saleDate);
  const noticeTime = parseDateMs(params.irsNoticeDate);
  let noticeDays = null;
  if (saleTime && noticeTime) {
    noticeDays = Math.floor((saleTime - noticeTime) / ONE_DAY_MS);
  }

  // Determine notice failure or timeliness
  let noticeFailed = false;
  let noticeDaysBeforeSale = noticeDays;
  let noticeMethod = params.noticeMethod || detected.noticeMethod;

  if (params.noticeProvided === false || detected.explicitNoticeFailure) {
    noticeFailed = true;
  } else if (noticeDays !== null && noticeDays < 25) {
    noticeFailed = true;
  }

  // SCENARIO 1: NOTICE WAS NOT GIVEN OR LATE (< 25 DAYS)
  // The federal tax lien SURVIVES the foreclosure in full under 26 U.S.C. § 7425(b)(1)!
  if (noticeFailed) {
    const warning = noticeDays !== null
      ? `CRITICAL TITLE DEFECT: Federal Tax Lien survives foreclosure under 26 U.S.C. § 7425(b)(1). Notice served only ${noticeDays} days prior to sale (minimum 25 days required by certified mail). Lien remains an encumbrance on the property post-sale!`
      : 'CRITICAL TITLE DEFECT: Federal Tax Lien survives foreclosure under 26 U.S.C. § 7425(b)(1). Foreclosing party failed to provide statutory 25-day written notice to the IRS District Director. Federal tax lien survives sale in full!';

    return {
      hasFederalTaxLien: true,
      hasIrsLien: true,
      hasLien: true,
      noticeProvided: false,
      noticeTimely: false,
      noticeDaysBeforeSale,
      noticeMethod: noticeMethod || 'NONE',
      lienSurvivesForeclosure: true,
      taxLienDischarged: false,
      irsRedemptionRightApplies: false,
      redemptionDays: 0,
      riskLevel: 'CRITICAL',
      statutoryCitation: '26 U.S.C. § 7425(b)(1)',
      warning,
      bidderRecommendation:
        'DO NOT BID. Federal tax lien survives foreclosure sale intact due to 26 U.S.C. § 7425 25-day notice failure. Winning bidder acquires property subject to IRS debt.',
    };
  }

  // SCENARIO 2: NOTICE GIVEN (>= 25 DAYS) OR DEFAULT RECORDED IRS LIEN
  // Notice satisfied: Federal tax lien is discharged, but IRS holds statutory 120-day right of redemption.
  const isExplicitTimely = (noticeDays !== null && noticeDays >= 25) || params.noticeProvided === true || detected.noticeProvided === true;
  const warning = isExplicitTimely
    ? 'FEDERAL TAX LIEN DISCHARGED SUBJECT TO 120-DAY IRS REDEMPTION: 25-day notice provided under 26 U.S.C. § 7425(c). Federal tax lien is divested from property, but United States retains statutory 120-day right of redemption under 26 U.S.C. § 7425(d).'
    : 'FEDERAL TAX LIEN ACTIVE: United States holds statutory 120-day right of redemption under 26 U.S.C. § 7425(d).';

  return {
    hasFederalTaxLien: true,
    hasIrsLien: true,
    hasLien: true,
    noticeProvided: isExplicitTimely ? true : null,
    noticeTimely: isExplicitTimely ? true : null,
    noticeDaysBeforeSale,
    noticeMethod: noticeMethod || (isExplicitTimely ? 'CERTIFIED_MAIL' : null),
    lienSurvivesForeclosure: false,
    taxLienDischarged: true,
    irsRedemptionRightApplies: true,
    redemptionDays: 120,
    riskLevel: 'HIGH',
    statutoryCitation: '26 U.S.C. § 7425(d)',
    warning,
    bidderRecommendation:
      'PROCEED WITH ESCROW BUFFER. Federal tax lien discharged at sale, but United States retains 120-day right of redemption from sale date under 26 U.S.C. § 7425(d). Avoid capital-intensive renovations until the 120-day redemption window expires.',
  };
}

module.exports = {
  detectIrsNoticeSignals,
  evaluateIrsNoticeRule,
};
