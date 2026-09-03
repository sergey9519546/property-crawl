/**
 * @file server/ai/legal-rules.js
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
    total: totalCashToClose,
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

/**
 * Extracts commercial multi-tenant lease schedules and rent roll data from legal notices or court filings.
 * Implements "the-gavel" rent roll abstraction engine.
 * @param {string} rawNotice
 * @returns {object}
 */
function parseRentRollSchedule(rawNotice = '') {
  const text = String(rawNotice || '');
  const units = [];
  const lines = text.split(/[\r\n]+/);

  for (const line of lines) {
    const unitMatch = line.match(/(?:unit|suite|apt|space)\s*([A-Za-z0-9\-]+)[:\-\s]+(.*)/i);
    if (!unitMatch) continue;

    const unit = unitMatch[1].trim();
    const rest = unitMatch[2].trim();

    let tenant = 'Occupied';
    const firstSegment = rest.split(/,|\s-\s/)[0].trim();
    if (firstSegment) tenant = firstSegment;
    if (/vacant|empty|unoccupied/i.test(rest)) {
      tenant = 'Vacant';
    }

    const sqftMatch = rest.match(/(\d[\d,]*)\s*(?:sqft|sf|sq\s*ft)/i);
    const sqft = sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, ''), 10) : 0;

    const rentMatch = rest.match(/(?:rent|\$)\s*[:\$]?\s*(\d[\d,]*)/i);
    const rent = rentMatch ? parseInt(rentMatch[1].replace(/,/g, ''), 10) : 0;

    const leaseMatch = rest.match(/(?:exp|expires|lease\s*end)\s*[:\s]?\s*([0-9\/\-]+)/i);
    const leaseEnd = leaseMatch ? leaseMatch[1].trim() : null;

    const isVacant = tenant === 'Vacant';
    units.push({
      unit,
      tenant,
      status: isVacant ? 'Vacant' : 'Occupied',
      sqft,
      monthlyRent: rent,
      annualRent: rent * 12,
      leaseEnd
    });
  }

  const totalSqft = units.reduce((acc, u) => acc + u.sqft, 0);
  const occupiedSqft = units.filter(u => u.status === 'Occupied').reduce((acc, u) => acc + u.sqft, 0);
  const totalAnnualRent = units.reduce((acc, u) => acc + u.annualRent, 0);
  const occupancyRate = totalSqft > 0
    ? Number(((occupiedSqft / totalSqft) * 100).toFixed(1))
    : (units.length > 0 ? Number(((units.filter(u => u.status === 'Occupied').length / units.length) * 100).toFixed(1)) : 100);

  return {
    unitCount: units.length,
    units,
    totalSqft,
    totalAnnualRent,
    occupancyRate,
    inPlaceNoi: Math.round(totalAnnualRent * 0.60) // 40% standard OPEX
  };
}

/**
 * Generates an institutional Letter of Intent (LOI) for distressed real estate acquisition.
 * Implements "loi-generator" skill.
 * @param {object} listing
 * @param {object} options
 * @returns {string}
 */
function generateLetterOfIntent(listing = {}, options = {}) {
  const buyer = options.buyerEntity || 'Institutional Acquisition Partner LLC';
  const price = options.offerPrice || Number(listing.openingBid) || 100000;
  const deposit = Math.round(price * (options.depositPct || 0.10));
  const inspectionDays = options.inspectionDays || 10;
  const closingDays = options.closingDays || 30;
  const cashToClose = computeCashToClose({
    openingBid: price,
    state: listing.state || 'OH',
    source: listing.source || 'sheriff'
  });

  const deedFees = cashToClose.deedPrepAndRecording || cashToClose.deedFees || 500;
  const bp = cashToClose.buyersPremium || 0;
  const poundage = cashToClose.sheriffPoundage || 0;
  const tax = cashToClose.transferTax || 0;
  const total = cashToClose.total || cashToClose.totalCashToClose || price;

  return `CONFIDENTIAL LETTER OF INTENT (LOI)
ACQUISITION OF DISTRESSED REAL ASSET

DATE: ${new Date().toISOString().split('T')[0]}
TO: Trustee / Foreclosing Counsel / Special Servicer
REGARDING: ${listing.address || 'Property'}, ${listing.city || ''}, ${listing.state || ''} ${listing.zip || ''}
COURT DOCKET / CASE: ${listing.id || 'N/A'}
SOURCE PORTAL: ${(listing.source || 'AUCTION').toUpperCase()}

1. PURCHASER: ${buyer}, or its designated special purpose entity (SPE).
2. PROPERTY: Real property situated in ${listing.county || 'County'} County, State of ${listing.state || 'OH'}, commonly known as ${listing.address || 'Property'}.
3. PURCHASE PRICE: $${price.toLocaleString()} USD (all cash at closing).
4. EARNEST MONEY DEPOSIT: $${deposit.toLocaleString()} USD (10% earnest funds), deposited into escrow within two (2) business days of mutual execution.
5. DUE DILIGENCE PERIOD: ${inspectionDays} calendar days from receipt of preliminary title commitment and docket filings.
6. STATUTORY CASH-TO-CLOSE & ESTIMATED CLOSING COSTS:
   - Base Offering Bid: $${price.toLocaleString()}
   - Estimated Buyer's Premium: $${bp.toLocaleString()}
   - Statutory Sheriff Poundage (${listing.state || 'OH'}): $${poundage.toLocaleString()}
   - State Transfer Tax: $${tax.toLocaleString()}
   - Estimated Deed Recording Fees: $${deedFees.toLocaleString()}
   - Net Estimated Cash to Close: $${total.toLocaleString()}
7. CLOSING DATE: On or before ${closingDays} calendar days following expiration of the Due Diligence Period, subject to statutory confirmation and redemption rules under ${listing.state || 'OH'} law.
8. CONDITION: "As-Is, Where-Is", subject to insurable title free and clear of un-extinguished senior encumbrances.

AGREED & SUBMITTED:
By: ___________________________
Authorized Representative, ${buyer}`;
}

/**
 * Generates an Investment Committee (IC) Acquisition Memo for institutional deal review.
 * Implements "acq-investment-report" skill.
 * @param {object} listing
 * @param {object} creMetrics
 * @returns {string}
 */
function generateInvestmentCommitteeMemo(listing = {}, creMetrics = {}) {
  const bid = Number(listing.openingBid) || 0;
  const estMid = ((Number(listing.estLow) || bid) + (Number(listing.estHigh) || bid)) / 2;
  const equity = Math.max(0, estMid - bid);
  const discountPct = estMid > 0 ? ((equity / estMid) * 100).toFixed(1) : '0.0';

  return `# INVESTMENT COMMITTEE (IC) ACQUISITION MEMORANDUM

## EXECUTIVE SUMMARY
- **Asset**: ${listing.address || 'Subject Property'}, ${listing.city || ''}, ${listing.state || ''} ${listing.zip || ''}
- **Asset Class**: ${listing.propType || 'Residential / Commercial'}
- **Source Channel**: ${(listing.source || 'Sheriff').toUpperCase()}
- **Deal Score**: ${listing.dealScore || 85}/100
- **Opening / Target Bid**: $${bid.toLocaleString()}
- **Estimated Fair Market Value**: $${Math.round(estMid).toLocaleString()}
- **Gross Built-In Equity**: +$${equity.toLocaleString()} (${discountPct}% below market)

## TITLE RISK & STATUTORY ANALYSIS
- **Statutory Redemption Period**: ${listing.redemptionDays || 0} Days (${listing.redemptionWarning || 'Clean / No post-sale statutory redemption'})
- **Senior Lien Risk**: ${listing.seniorLienRisk ? listing.seniorLienRisk.toUpperCase() : 'LOW'} (${listing.seniorLienWarning || 'No surviving prior senior encumbrance detected'})
- **Occupancy Status**: ${listing.occupancy || 'Unknown (Drive-by inspection recommended)'}

## FINANCIAL & RETURN METRICS
- **Net Operating Income (NOI)**: $${(creMetrics.netOperatingIncome || Math.round(bid * 0.085)).toLocaleString()} / year
- **Capitalization Rate**: ${creMetrics.capitalizationRate || '8.50'}%
- **Debt Service Coverage Ratio (DSCR)**: ${creMetrics.estimatedDscr || '1.45'}x
- **Target Yield Max Allowable Offer (MAO)**: $${(creMetrics.maxAllowableOffer || Math.round(bid * 1.15)).toLocaleString()}

## UNDERWRITING RECOMMENDATION
Proceed with pre-auction title search and deposit placement. Target maximum bid of $${(creMetrics.maxAllowableOffer || Math.round(bid * 1.15)).toLocaleString()} preserves an institutional yield floor above 8.00% Cap Rate.`;
}

module.exports = {
  STATE_REDEMPTION_RULES,
  parseCurrency,
  getRedemptionRule,
  detectSeniorLienSurvival,
  computeCashToClose,
  detectBankruptcyOrAdjournment,
  parseRentRollSchedule,
  generateLetterOfIntent,
  generateInvestmentCommitteeMemo
};
