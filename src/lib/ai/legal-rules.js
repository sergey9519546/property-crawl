/**
 * @file src/lib/ai/legal-rules.js
 * Comprehensive legal underwriting & statutory risk arbitration rules.
 * Encodes 50-state statutory redemption periods, junior lien survival detection,
 * and complete cash-to-close statutory fee schedules.
 */

// 50-State Statutory Redemption Periods & Rules
const STATE_REDEMPTION_RULES = {
  AL: { days: 180, label: '180-Day Statutory Right of Redemption (Ala. Code § 6-5-248)' },
  AK: { days: 0, label: 'No post-sale redemption for non-judicial deed of trust (AS § 34.20.090)' },
  AZ: { days: 180, label: '180-Day Statutory Redemption for judicial foreclosure (A.R.S. § 12-1282); 0 days for deed of trust' },
  AR: { days: 365, label: '1-Year Statutory Redemption for non-judicial sales unless waived' },
  CA: { days: 0, label: 'No post-sale redemption if non-judicial foreclosure with power of sale (Cal. Civ. Code § 2924m)' },
  CO: { days: 0, label: '0-Day post-sale redemption; terminates at sale confirmation under C.R.S. § 38-38-501' },
  CT: { days: 0, label: 'Strict foreclosure law day or decree of sale terminates equity of redemption' },
  DE: { days: 0, label: 'Statutory redemption terminates upon judicial confirmation of sheriff sale' },
  DC: { days: 0, label: '0-Day post-sale redemption; terminates at trustee auction gavel drop' },
  FL: { days: 0, label: '0-Day post-sale redemption (terminates upon clerk issuance of Certificate of Sale)' },
  GA: { days: 365, label: '1-Year statutory right of redemption for tax deed auctions (O.C.G.A. § 48-4-40); 0 days for non-judicial mortgage' },
  HI: { days: 0, label: 'No post-sale redemption in non-judicial or judicial foreclosures (HRS § 667-33)' },
  ID: { days: 365, label: '1-Year statutory redemption for judicial sales (Idaho Code § 11-402); 0 days for deed of trust' },
  IL: { days: 90, label: 'Special statutory right of redemption within 30-90 days for residential property (735 ILCS 5/15-1603)' },
  IN: { days: 0, label: 'Redemption terminates upon sheriff sale completion under Ind. Code § 32-29-7-7' },
  IA: { days: 365, label: '1-Year statutory right of redemption (Iowa Code § 628.3); reduced to 6 months or 30 days if abandoned' },
  KS: { days: 365, label: '1-Year statutory redemption (K.S.A. § 60-2414); shortened to 3 months if less than 1/3 debt paid' },
  KY: { days: 180, label: '6-Month statutory right of redemption (KRS § 426.530) if purchase price is less than 2/3 appraised value' },
  LA: { days: 0, label: '0-Day post-sale redemption for executory process; 3-year redemption for tax adjudications (La. Const. art. VII § 25)' },
  ME: { days: 0, label: '90-Day pre-sale redemption; post-sale redemption terminates at public auction (14 M.R.S. § 6323)' },
  MD: { days: 0, label: 'Mortgage redemption terminates upon judicial ratification; 6-month redemption for tax sales (Md. Code Tax-Prop. § 14-827)' },
  MA: { days: 0, label: 'Right of redemption waived in standard statutory power of sale; 1 year for tax takings (M.G.L. c. 60 § 62)' },
  MI: { days: 180, label: '6-Month Statutory Right of Redemption (MCL 600.3240); 1 month if property abandoned' },
  MN: { days: 180, label: '6-Month statutory redemption (Minn. Stat. § 580.23); 12 months for agricultural or low principal balance' },
  MS: { days: 730, label: '2-Year statutory right of redemption for tax sales (Miss. Code § 27-45-3); 0 days for trustee deed foreclosures' },
  MO: { days: 365, label: '1-Year statutory right of redemption (RSMo § 443.410) if lender purchases at auction and bond posted within 20 days' },
  MT: { days: 365, label: '1-Year statutory redemption for judicial sales (MCA § 25-13-802); 0 days for Small Tract Financing Act deeds' },
  NE: { days: 0, label: 'Redemption terminates upon judicial order of sale confirmation (Neb. Rev. Stat. § 25-1532)' },
  NV: { days: 365, label: '1-Year statutory redemption for judicial foreclosure (NRS 21.210); 0 days for non-judicial deed of trust' },
  NH: { days: 0, label: '0-Day post-sale redemption; equity of redemption terminates at auction gavel drop (RSA 479:25)' },
  NJ: { days: 10, label: '10-Day Statutory Redemption / Objection Period (N.J. Ct. R. 4:65-5)' },
  NM: { days: 270, label: '9-Month statutory redemption unless shortened to 1 month by mortgage agreement (NMSA § 39-5-18)' },
  NY: { days: 0, label: 'Redemption terminates upon foreclosure auction gavel drop; referee report of sale filed within 30 days' },
  NC: { days: 10, label: '10-Day statutory upset bid period (N.C.G.S. § 45-21.27); each upset bid reopens a new 10-day window' },
  ND: { days: 365, label: '1-Year statutory right of redemption (N.D.C.C. § 28-24-02); 60 days under Short-Term Mortgage Act' },
  OH: { days: 0, label: 'Redemption expires at confirmation of sale (R.C. 2329.33)' },
  OK: { days: 0, label: 'Statutory redemption terminates upon judicial confirmation of sheriff sale (12 O.S. § 765)' },
  OR: { days: 180, label: '180-Day statutory right of redemption for judicial foreclosures (ORS § 18.964); 0 days for trust deeds' },
  PA: { days: 270, label: '9-Month statutory redemption for municipal/tax claims (53 P.S. § 7293); 0 days for mortgage foreclosures' },
  PR: { days: 0, label: 'Redemption terminates upon public deed execution before notary under Puerto Rico Mortgage Act' },
  RI: { days: 0, label: 'Statutory power of sale terminates redemption at auction; 1 year for tax sales (R.I.G.L. § 44-9-19)' },
  SC: { days: 30, label: '30-Day upset bid period (S.C. Code § 15-39-720) unless plaintiff waives deficiency judgment in complaint' },
  SD: { days: 365, label: '1-Year statutory right of redemption (SDCL § 21-52-11); 180 days for short-term redemption mortgage' },
  TN: { days: 730, label: '2-Year right of redemption unless expressly waived in deed of trust (T.C.A. § 66-8-101)' },
  TX: { days: 180, label: '180-Day right of redemption for tax foreclosures (2 years for homestead/ag under Tex. Tax Code § 34.21)' },
  UT: { days: 180, label: '6-Month statutory right of redemption for judicial foreclosure (Utah R. Civ. P. 69C); 0 days for trust deeds' },
  VT: { days: 180, label: '6-Month statutory redemption period in strict foreclosure unless shortened by court (12 V.S.A. § 4941)' },
  VA: { days: 0, label: '0-Day post-sale redemption; terminates upon non-judicial trustee auction under Va. Code § 55.1-320' },
  WA: { days: 365, label: '1-Year statutory redemption for judicial sales (RCW 6.23.020); 8 months without deficiency; 0 days for deeds of trust' },
  WV: { days: 0, label: '0-Day post-sale redemption for deed of trust; 18-month redemption for tax sales (W. Va. Code § 11A-3-21)' },
  WI: { days: 180, label: 'Pre-sale redemption period (Wis. Stat. § 846.101); statutory right terminates upon confirmation of sheriff sale' },
  WY: { days: 90, label: '3-Month statutory right of redemption (Wyo. Stat. § 1-18-103); 12 months for agricultural property' }
};

/**
 * Safely parses currency and numeric inputs without NaN contamination.
 * @param {any} val - Input value (number, currency string, etc.)
 * @param {number} fallback - Default fallback value
 * @returns {number} Sanitized non-negative number
 */
function parseCurrency(val, fallback = 0) {
  if (val == null) return fallback;
  if (typeof val === 'number') return Number.isFinite(val) ? Math.max(0, val) : fallback;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

/**
 * Retrieve the statutory redemption rule for a given state.
 * @param {string} state - 2-letter state code
 * @returns {object} { days: number, label: string, warning: string|null }
 */
function getRedemptionRule(state) {
  const st = (state || '').toUpperCase().trim();
  const rule = STATE_REDEMPTION_RULES[st] || {
    days: 0,
    label: 'Statutory redemption typically terminates at confirmation of sale unless state law specifies otherwise.'
  };

  return {
    state: st,
    days: rule.days,
    label: rule.label,
    warning: rule.days > 0 ? `${st}: ${rule.days}-Day Statutory Right of Redemption Applies` : null
  };
}

/**
 * Detects if the foreclosing plaintiff is a junior lienholder (2nd mortgage, HELOC, HOA)
 * where senior mortgages and superior tax encumbrances survive the auction.
 * @param {string} plaintiff
 * @param {string} legalText
 * @returns {object} { isJuniorLien: boolean, riskLevel: 'high'|'normal', warning: string|null }
 */
function detectSeniorLienSurvival(plaintiff = '', legalText = '') {
  const combined = `${String(plaintiff || '')} ${String(legalText || '')}`.toLowerCase();

  const juniorRegexes = [
    /\bsecond\s+mortgage\b/,
    /\bsecond\s+trust\s+deed\b/,
    /\b2nd\s+mortgage\b/,
    /\bjunior\s+lien\b/,
    /\bsubordinate\b/,
    /\bheloc\b/,
    /\bhome\s+equity\b/,
    /\bhomeowners?\s+association\b/,
    /\bcondominium\s+association\b/,
    /\bcondo\s+assessment\b/,
    /\b\bhoa\b/,
    /\bhoa\s+lien\b/,
    /\bassessment\s+lien\b/,
    /\bmechanic(?:'s)?\s+lien\b/,
    /\bjudgment\s+creditor\b/,
    /\bsubject\s+to\s+(?:senior|prior|superior)\b/,
    /\bsenior\s+encumbrance\b/
  ];

  const matched = [];
  for (const re of juniorRegexes) {
    const match = combined.match(re);
    if (match) {
      matched.push(match[0]);
    }
  }

  if (matched.length > 0) {
    return {
      isJuniorLien: true,
      riskLevel: 'high',
      survivingSeniorLiens: true,
      matchedTerms: [...new Set(matched)],
      warning: 'SENIOR_LIEN_RISK: High. Plaintiff appears to be a junior lienholder or notice indicates subject to senior encumbrances of record. Senior mortgages survive the sale.'
    };
  }

  return {
    isJuniorLien: false,
    riskLevel: 'normal',
    survivingSeniorLiens: false,
    matchedTerms: [],
    warning: null
  };
}

/**
 * Calculates complete cash-to-close with realistic auction statutory fee schedule.
 * @param {object} params
 * @param {number|string} params.openingBid
 * @param {string} params.state
 * @param {string} params.source
 * @param {number|string} [params.delinquentTaxes=0]
 * @param {number|string} [params.deedFees=500]
 * @returns {object} Itemized cash-to-close schedule
 */
function computeCashToClose({
  openingBid = 0,
  state = 'OH',
  source = 'sheriff',
  delinquentTaxes = 0,
  deedFees = 500
} = {}) {
  const bid = parseCurrency(openingBid, 0);
  const taxes = parseCurrency(delinquentTaxes, 0);
  const fees = parseCurrency(deedFees, 500);
  const st = (state || 'OH').toUpperCase().trim();
  const src = (source || '').toLowerCase().trim();

  // Buyer's Premium (typically 5% for online marketplaces like Bid4Assets/GovDeals/Auction.com)
  const buyersPremiumRate = src.includes('bid4assets') || src.includes('govdeals') || src.includes('auction') ? 0.05 : 0;
  const buyersPremium = Math.round(bid * buyersPremiumRate);

  // Sheriff Poundage / Statutory Commission (typically 2-3% in OH, NJ, PA, etc.)
  const isSheriffSale = src.includes('sheriff') || src.includes('civilview') || src.includes('trustee') || (src.includes('bid4assets') && (st === 'PA' || st === 'OH'));
  const poundageRate = isSheriffSale ? (st === 'OH' ? 0.02 : st === 'NJ' ? 0.025 : st === 'PA' ? 0.02 : 0.02) : 0;
  const sheriffPoundage = Math.round(bid * poundageRate);

  // Transfer Tax ($1 - $4 per $1,000 depending on state)
  const transferTaxRate = st === 'NJ' ? 0.005 : st === 'PA' ? 0.02 : st === 'OH' ? 0.004 : 0.002;
  const transferTax = Math.round(bid * transferTaxRate);

  const totalCashToClose = bid + buyersPremium + sheriffPoundage + transferTax + taxes + fees;

  return {
    openingBid: bid,
    buyersPremium,
    sheriffPoundage,
    transferTax,
    delinquentTaxes: taxes,
    deedPrepAndRecording: fees,
    totalCashToClose,
    effectiveDiscountRate: bid > 0 ? Number(((totalCashToClose - bid) / bid).toFixed(4)) : 0
  };
}

/**
 * Detects if an auction has been stayed due to bankruptcy filing or adjourned.
 * @param {string} rawNotice
 * @returns {object} { isStayed: boolean, status: string, adjournmentDate: string|null, reason: string|null }
 */
function detectBankruptcyOrAdjournment(rawNotice = '') {
  const text = String(rawNotice || '');

  const bankruptcyRegex = /bankruptcy\s+(?:petition|case|code)?\s*(?:no\.?|#)?\s*([0-9a-zA-Z\-]+)/i;
  const adjournedRegex = /adjourned\s+to\s+([A-Za-z0-9\s,\/]+?)(?:\s+(?:due\s+to|at|because)|\.|$)/i;
  const stayedRegex = /stayed\s+by\s+bankruptcy/i;

  const isBankruptcy = bankruptcyRegex.test(text) || stayedRegex.test(text);
  const adjournedMatch = text.match(adjournedRegex);
  const bkMatch = text.match(bankruptcyRegex);

  if (isBankruptcy) {
    let adjDate = null;
    if (adjournedMatch) {
      const parsedDate = new Date(adjournedMatch[1].trim());
      if (!isNaN(parsedDate.getTime())) {
        adjDate = parsedDate.toISOString().split('T')[0];
      } else {
        adjDate = adjournedMatch[1].trim();
      }
    }

    return {
      isStayed: true,
      status: 'STAYED_BANKRUPTCY',
      caseNumber: bkMatch ? bkMatch[1] : null,
      adjournmentDate: adjDate,
      reason: 'Sale stayed by active Bankruptcy filing.'
    };
  }

  if (adjournedMatch) {
    return {
      isStayed: false,
      status: 'ADJOURNED',
      caseNumber: null,
      adjournmentDate: adjournedMatch[1].trim(),
      reason: 'Auction adjourned to subsequent date.'
    };
  }

  return {
    isStayed: false,
    status: 'ACTIVE_SCHEDULED',
    caseNumber: null,
    adjournmentDate: null,
    reason: null
  };
}

module.exports = {
  STATE_REDEMPTION_RULES,
  parseCurrency,
  getRedemptionRule,
  detectSeniorLienSurvival,
  computeCashToClose,
  detectBankruptcyOrAdjournment
};
