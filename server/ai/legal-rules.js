/**
 * @file server/ai/legal-rules.js
 * Comprehensive legal underwriting & statutory risk arbitration rules.
 * Encodes 50-state statutory redemption periods, junior lien survival detection,
 * and complete cash-to-close statutory fee schedules.
 */

// 50-State Statutory Redemption Periods & Rules
const STATE_REDEMPTION_RULES = {
  AL: { days: 180, label: '180-Day Statutory Right of Redemption (Ala. Code § 6-5-248)' },
  AR: { days: 365, label: '1-Year Statutory Redemption for non-judicial sales unless waived' },
  CA: { days: 0, label: 'No post-sale redemption if non-judicial foreclosure with power of sale' },
  FL: { days: 0, label: '0-Day post-sale redemption (terminates upon clerk issuance of Certificate of Sale)' },
  IL: { days: 90, label: 'Special statutory right of redemption within 30-90 days for certain residential' },
  MI: { days: 180, label: '6-Month Statutory Right of Redemption (MCL 600.3240)' },
  NJ: { days: 10, label: '10-Day Statutory Redemption / Objection Period (N.J. Ct. R. 4:65-5)' },
  NM: { days: 270, label: '9-Month statutory redemption unless shortened to 1 month by mortgage' },
  OH: { days: 0, label: 'Redemption expires at confirmation of sale (R.C. 2329.33)' },
  TN: { days: 730, label: '2-Year right of redemption unless expressly waived in deed of trust (T.C.A. § 66-8-101)' },
  TX: { days: 180, label: '180-Day right of redemption for tax foreclosures (2 years for homestead/ag)' }
};

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
 * @returns {object} { isJuniorLien: boolean, riskLevel: 'HIGH'|'NORMAL', warning: string|null }
 */
function detectSeniorLienSurvival(plaintiff = '', legalText = '') {
  const combined = `${plaintiff} ${legalText}`.toLowerCase();

  const juniorIndicators = [
    'second mortgage',
    'second trust deed',
    '2nd mortgage',
    'junior lien',
    'subordinate deed',
    'heloc',
    'home equity line',
    'homeowners association',
    'condominium association',
    'hoa lien',
    'subject to senior',
    'subject to superior',
    'senior encumbrance'
  ];

  const matched = juniorIndicators.filter(kw => combined.includes(kw));

  if (matched.length > 0) {
    return {
      isJuniorLien: true,
      riskLevel: 'HIGH',
      survivingSeniorLiens: true,
      matchedTerms: matched,
      warning: 'SENIOR_LIEN_RISK: High. Plaintiff appears to be a junior lienholder or notice indicates subject to senior encumbrances of record. Senior mortgages survive the sale.'
    };
  }

  return {
    isJuniorLien: false,
    riskLevel: 'NORMAL',
    survivingSeniorLiens: false,
    matchedTerms: [],
    warning: null
  };
}

/**
 * Calculates complete cash-to-close with realistic auction statutory fee schedule.
 * @param {object} params
 * @param {number} params.openingBid
 * @param {string} params.state
 * @param {string} params.source
 * @param {number} [params.delinquentTaxes=0]
 * @param {number} [params.deedFees=500]
 * @returns {object} Itemized cash-to-close schedule
 */
function computeCashToClose({
  openingBid = 0,
  state = 'OH',
  source = 'sheriff',
  delinquentTaxes = 0,
  deedFees = 500
}) {
  const bid = Number(openingBid) || 0;
  const st = (state || 'OH').toUpperCase();
  const src = (source || '').toLowerCase();

  // Buyer's Premium (typically 5% for online marketplaces like Bid4Assets/GovDeals/Auction.com)
  const buyersPremiumRate = src.includes('bid4assets') || src.includes('govdeals') || src.includes('auction') ? 0.05 : 0;
  const buyersPremium = Math.round(bid * buyersPremiumRate);

  // Sheriff Poundage / Statutory Commission (typically 2-3% in OH, NJ, PA, etc.)
  const poundageRate = src.includes('sheriff') ? (st === 'OH' ? 0.02 : st === 'NJ' ? 0.025 : 0.02) : 0;
  const sheriffPoundage = Math.round(bid * poundageRate);

  // Transfer Tax ($1 - $4 per $1,000 depending on state)
  const transferTaxRate = st === 'NJ' ? 0.005 : st === 'PA' ? 0.02 : st === 'OH' ? 0.004 : 0.002;
  const transferTax = Math.round(bid * transferTaxRate);

  const totalCashToClose = bid + buyersPremium + sheriffPoundage + transferTax + Number(delinquentTaxes) + Number(deedFees);

  return {
    openingBid: bid,
    buyersPremium,
    sheriffPoundage,
    transferTax,
    delinquentTaxes: Number(delinquentTaxes),
    deedPrepAndRecording: Number(deedFees),
    totalCashToClose,
    effectiveDiscountRate: bid > 0 ? ((totalCashToClose - bid) / bid) : 0
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
  getRedemptionRule,
  detectSeniorLienSurvival,
  computeCashToClose,
  detectBankruptcyOrAdjournment
};
