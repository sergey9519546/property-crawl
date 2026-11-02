'use strict';

/**
 * server/intelligence/bankruptcy-stay.js
 *
 * Bankruptcy Serial-Filer Automatic Stay Analyzer under 11 U.S.C. § 362.
 *
 * Foreclosure Underwriting & Legal Doctrine:
 * 1. 11 U.S.C. § 362(a): Baseline Automatic Stay
 *    A debtor bankruptcy petition filing triggers an immediate automatic stay.
 *    Foreclosure sales conducted in violation of the stay are VOID ab initio.
 *
 * 2. 11 U.S.C. § 362(c)(3): Single Prior Case Dismissed Within 1 Year
 *    If debtor had a single prior bankruptcy case pending and dismissed within
 *    the 1-year period preceding the current petition:
 *    The automatic stay terminates automatically on the 30th day post-petition,
 *    unless the court affirmatively enters an order extending the stay upon
 *    timely motion and notice under § 362(c)(3)(B).
 *
 * 3. 11 U.S.C. § 362(c)(4): Two or More Prior Cases Dismissed Within 1 Year
 *    If debtor had 2 or more cases pending and dismissed within the prior 1-year period:
 *    ZERO automatic stay takes effect upon filing of the later petition!
 *    Lender / trustee may proceed with the scheduled auction without stay violation.
 *
 * 4. 11 U.S.C. § 362(d)(4): In Rem Bankruptcy Relief
 *    If the bankruptcy court enters an in rem relief order (finding filing was part
 *    of a scheme to delay, hinder, or defraud creditors involving transfers or multiple filings)
 *    and it is recorded in county land records:
 *    The order is binding for 2 years (730 days) from entry. Subsequent bankruptcy
 *    filings by the debtor or any transferee do NOT trigger an automatic stay as to that parcel.
 */

const ONE_DAY_MS = 86400000;
const TWO_YEARS_DAYS = 730;

/**
 * Parses a date value into an ISO string (YYYY-MM-DD) and timestamp in ms
 */
function parseDateMs(dateVal) {
  if (!dateVal) return null;
  const time = Date.parse(typeof dateVal === 'string' ? dateVal.slice(0, 10) : dateVal);
  if (!Number.isFinite(time)) return null;
  return time;
}

function toIsoDate(timeMs) {
  if (!timeMs) return null;
  return new Date(timeMs).toISOString().slice(0, 10);
}

/**
 * Detects bankruptcy filing indicators, docket numbers, and serial dismissal text.
 */
function detectBankruptcySignals(text = '') {
  const str = String(text || '');
  const hasBankruptcy = /(?:bankruptcy|\bchapter\s*(?:7|11|12|13)\b|11\s*u\.?s\.?c\.?\s*§?\s*362|adversary\s*proceeding|debtor\s*in\s*possession|petition\s*filed)/i.test(str);
  if (!hasBankruptcy) {
    return {
      hasBankruptcyFiling: false,
      caseNumber: null,
      chapter: null,
      priorDismissalsCount: 0,
      hasInRemRelief: false,
      hasCourtExtension: false,
      hasReliefFromStay: false,
    };
  }

  // Case number extraction (e.g. 24-12345, 26-BK-90210)
  const caseMatch = str.match(/(?:case\s*(?:no\.?|#)\s*|bankruptcy\s*#?\s*)([0-9]{2}-[0-9]{4,6}|[0-9]{2}-bk-[0-9]{4,6})/i);
  const chapterMatch = str.match(/\bchapter\s*(7|11|12|13)\b/i);

  // Serial dismissal extraction
  let dismissals = 0;
  if (/(?:two|2)\s*(?:or\s*more\s*)?(?:prior|previous)\s*(?:cases?|filings?|petitions?)\s*dismissed|dismissed\s*(?:two|2)\s*times|362\(c\)\(4\)/i.test(str)) {
    dismissals = 2;
  } else if (/(?:one|1|single)\s*(?:prior|previous)\s*(?:case|filing|petition)\s*dismissed|prior\s*case\s*dismissed|362\(c\)\(3\)/i.test(str)) {
    dismissals = 1;
  }

  // In rem relief extraction
  const hasInRem = /(?:in\s*rem\s*(?:relief|order|sanction)|362\(d\)\(4\)|two-?year\s*stay\s*exclusion)/i.test(str);

  // Court extension or relief from stay
  const hasExtension = /(?:order\s*extending\s*(?:automatic\s*)?stay|stay\s*extended\s*under\s*362\(c\)\(3\)\(B\)|stay\s*extended\s*by\s*court)/i.test(str);
  const hasRelief = /(?:relief\s*from\s*(?:automatic\s*)?stay\s*granted|order\s*lifting\s*stay|stay\s*(?:is\s*)?lifted)/i.test(str);

  return {
    hasBankruptcyFiling: true,
    caseNumber: caseMatch ? caseMatch[1] : null,
    chapter: chapterMatch ? chapterMatch[1] : null,
    priorDismissalsCount: dismissals,
    hasInRemRelief: hasInRem,
    hasCourtExtension: hasExtension,
    hasReliefFromStay: hasRelief,
  };
}

/**
 * Analyzes automatic stay enforceability under 11 U.S.C. § 362.
 *
 * @param {Object} params
 * @param {boolean} [params.hasBankruptcyFiling] - Whether an active bankruptcy petition exists
 * @param {string|Date} [params.petitionDate] - Date petition was filed
 * @param {number} [params.priorDismissalsWithin1Year] - Count of prior cases dismissed within 12 months
 * @param {boolean} [params.hasCourtExtension] - Whether court entered § 362(c)(3)(B) order extending stay
 * @param {boolean} [params.hasInRemReliefOrder] - Whether an in rem relief order (§ 362(d)(4)) exists
 * @param {string|Date} [params.inRemOrderDate] - Entry date of in rem relief order
 * @param {boolean} [params.hasReliefFromStay] - Whether standard relief from stay was granted
 * @param {string|Date} [params.saleDate] - Foreclosure auction date or evaluation date
 * @param {string} [params.noticeText] - Legal notice text for automated signal extraction
 * @returns {Object} Stay analysis with statutory citation and bidder recommendation
 */
function analyzeBankruptcyStay(params = {}) {
  // Merge text-detected signals if noticeText is provided
  const detected = params.noticeText ? detectBankruptcySignals(params.noticeText) : {};

  const hasBankruptcy = Boolean(
    params.hasBankruptcyFiling ??
    detected.hasBankruptcyFiling ??
    params.petitionDate ??
    params.caseNumber
  );

  const saleTime = parseDateMs(params.saleDate || params.asOfDate) || Date.now();
  const priorDismissals = typeof params.priorDismissalsWithin1Year === 'number'
    ? params.priorDismissalsWithin1Year
    : (detected.priorDismissalsCount ?? 0);

  const inRemOrderTime = parseDateMs(params.inRemOrderDate);
  const hasInRemRelief = Boolean(params.hasInRemReliefOrder || detected.hasInRemRelief || inRemOrderTime);
  const hasCourtExtension = Boolean(params.hasCourtExtension || detected.hasCourtExtension);
  const hasReliefFromStay = Boolean(params.hasReliefFromStay || detected.hasReliefFromStay);

  // Baseline when no bankruptcy exists
  if (!hasBankruptcy && !hasInRemRelief) {
    return {
      hasBankruptcyFiling: false,
      stayEffective: false,
      stayExpiresAt: null,
      serialFilerFlag: 'NONE',
      statutoryRuleCited: null,
      priorDismissalsCount: 0,
      inRemReliefActive: false,
      canProceedWithAuction: true,
      bidderRecommendation: 'No active bankruptcy filing detected. Foreclosure auction may proceed.',
    };
  }

  // 1. IN REM RELIEF UNDER 11 U.S.C. § 362(d)(4)
  // An in rem order recorded in real property records binds the property for 2 years (730 days).
  if (hasInRemRelief) {
    let within2Years = true;
    if (inRemOrderTime) {
      const daysSinceInRem = Math.floor((saleTime - inRemOrderTime) / ONE_DAY_MS);
      within2Years = daysSinceInRem >= 0 && daysSinceInRem <= TWO_YEARS_DAYS;
    }

    if (within2Years) {
      return {
        hasBankruptcyFiling: hasBankruptcy,
        stayEffective: false,
        stayExpiresAt: null,
        serialFilerFlag: 'IN_REM_RELIEF_RECORDED_2_YEAR_BAR',
        statutoryRuleCited: '11 U.S.C. § 362(d)(4)',
        priorDismissalsCount: priorDismissals,
        inRemReliefActive: true,
        canProceedWithAuction: true,
        bidderRecommendation:
          'IN REM RELIEF ACTIVE (11 U.S.C. § 362(d)(4)): Real property is covered by a binding in rem order entered within the past 2 years. Subsequent debtor bankruptcy filings do not trigger an automatic stay. Foreclosure auction may proceed.',
      };
    }
  }

  // 2. STANDARD RELIEF FROM STAY ORDER ENTERED (§ 362(d))
  if (hasReliefFromStay) {
    return {
      hasBankruptcyFiling: true,
      stayEffective: false,
      stayExpiresAt: null,
      serialFilerFlag: 'RELIEF_FROM_STAY_GRANTED',
      statutoryRuleCited: '11 U.S.C. § 362(d)',
      priorDismissalsCount: priorDismissals,
      inRemReliefActive: false,
      canProceedWithAuction: true,
      bidderRecommendation:
        'RELIEF FROM STAY GRANTED (11 U.S.C. § 362(d)): Bankruptcy court entered order granting relief from the automatic stay. Foreclosure sale may proceed without stay violation.',
    };
  }

  // 3. TWO OR MORE PRIOR CASES DISMISSED WITHIN 1 YEAR: § 362(c)(4)
  // ZERO automatic stay takes effect upon filing!
  if (priorDismissals >= 2) {
    return {
      hasBankruptcyFiling: true,
      stayEffective: false,
      stayExpiresAt: null,
      serialFilerFlag: 'TWO_OR_MORE_PRIOR_DISMISSALS_ZERO_STAY',
      statutoryRuleCited: '11 U.S.C. § 362(c)(4)',
      priorDismissalsCount: priorDismissals,
      inRemReliefActive: false,
      canProceedWithAuction: true,
      bidderRecommendation:
        'ZERO AUTOMATIC STAY (11 U.S.C. § 362(c)(4)): Debtor had 2 or more bankruptcy cases dismissed within the previous 1-year period. By statute, NO automatic stay took effect upon filing. Foreclosure auction may proceed without stay violation unless court affirmatively ordered stay imposition.',
    };
  }

  // Calculate days post-petition for single prior dismissal and baseline calculations
  const petitionTime = parseDateMs(params.petitionDate) || saleTime;
  const daysPostPetition = Math.max(0, Math.floor((saleTime - petitionTime) / ONE_DAY_MS));
  const day30Time = petitionTime + 30 * ONE_DAY_MS;
  const day30Iso = toIsoDate(day30Time);

  // 4. SINGLE PRIOR CASE DISMISSED WITHIN 1 YEAR: § 362(c)(3)
  // Stay automatically terminates on day 30 post-petition unless extended by court order.
  if (priorDismissals === 1) {
    if (hasCourtExtension) {
      return {
        hasBankruptcyFiling: true,
        stayEffective: true,
        stayExpiresAt: null,
        serialFilerFlag: 'SINGLE_PRIOR_DISMISSAL_EXTENDED_BY_COURT',
        statutoryRuleCited: '11 U.S.C. § 362(c)(3)(B)',
        priorDismissalsCount: 1,
        daysPostPetition,
        inRemReliefActive: false,
        canProceedWithAuction: false,
        bidderRecommendation:
          'STAY EXTENDED BY COURT ORDER (11 U.S.C. § 362(c)(3)(B)): Bankruptcy court affirmatively extended the automatic stay beyond the 30-day statutory limit. Foreclosure auction is stayed. DO NOT BID.',
      };
    }

    if (daysPostPetition > 30) {
      // 30 days elapsed with no court extension -> Stay terminated!
      return {
        hasBankruptcyFiling: true,
        stayEffective: false,
        stayExpiresAt: day30Iso,
        serialFilerFlag: 'SINGLE_PRIOR_DISMISSAL_30_DAY_EXPIRATION',
        statutoryRuleCited: '11 U.S.C. § 362(c)(3)',
        priorDismissalsCount: 1,
        daysPostPetition,
        inRemReliefActive: false,
        canProceedWithAuction: true,
        bidderRecommendation:
          `AUTOMATIC STAY TERMINATED (11 U.S.C. § 362(c)(3)): Debtor had 1 prior case dismissed within 1 year. Automatic stay terminated on day 30 (${day30Iso}) without court extension. Foreclosure auction may proceed.`,
      };
    } else {
      // Within first 30 days -> Stay is temporarily active
      return {
        hasBankruptcyFiling: true,
        stayEffective: true,
        stayExpiresAt: day30Iso,
        serialFilerFlag: 'SINGLE_PRIOR_DISMISSAL_30_DAY_EXPIRATION',
        statutoryRuleCited: '11 U.S.C. § 362(c)(3)',
        priorDismissalsCount: 1,
        daysPostPetition,
        inRemReliefActive: false,
        canProceedWithAuction: false,
        bidderRecommendation:
          `AUTOMATIC STAY TEMPORARILY ACTIVE (11 U.S.C. § 362(c)(3)): Day ${daysPostPetition} of 30-day stay window. Automatic stay will terminate on ${day30Iso} unless debtor secures affirmative court extension. DO NOT BID until day 30 expires.`,
      };
    }
  }

  // 5. STANDARD INITIAL BANKRUPTCY PETITION: § 362(a)
  // 0 prior dismissals -> Automatic stay applies in full
  return {
    hasBankruptcyFiling: true,
    stayEffective: true,
    stayExpiresAt: null,
    serialFilerFlag: 'NONE',
    statutoryRuleCited: '11 U.S.C. § 362(a)',
    priorDismissalsCount: 0,
    daysPostPetition,
    inRemReliefActive: false,
    canProceedWithAuction: false,
    bidderRecommendation:
      'AUTOMATIC STAY IN EFFECT (11 U.S.C. § 362(a)): Foreclosure auction prohibited by federal law. Any sale conducted during automatic stay is VOID ab initio. DO NOT BID.',
  };
}

module.exports = {
  detectBankruptcySignals,
  analyzeBankruptcyStay,
};
