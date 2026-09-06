/**
 * @file server/ai/legal-rules.js
 * Evidence-aware legal and underwriting helpers.
 * State baselines and text-pattern signals are triage aids, not legal opinions;
 * cash-to-close outputs are explicitly labeled models.
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
 * @param {number|null} fallback - Explicit fallback value
 * @returns {number|null} Sanitized non-negative number, or null when unknown
 */
function parseCurrency(val, fallback = null) {
  if (val == null) return fallback;
  if (typeof val === 'number') return Number.isFinite(val) ? Math.max(0, val) : fallback;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,%x,]/gi, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nonNegativeNumber(value) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function positiveNumber(value) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function cleanLabel(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatMoney(value) {
  return value === null
    ? 'Unavailable — supporting evidence or an explicit buyer assumption is required'
    : `$${Math.round(value).toLocaleString()} USD`;
}

function sourceDisplayText(value) {
  return String(value || '').replace(/servicelink(?:\s+auction)?/gi, 'Public Auction Network');
}

/**
 * Retrieve the statutory redemption rule for a given state.
 * @param {string} state - 2-letter state code
 * @returns {object} State-level baseline, or an explicit unknown result
 */
function getRedemptionRule(state) {
  const st = (state || '').toUpperCase().trim();
  const rule = STATE_REDEMPTION_RULES[st];

  if (!rule) {
    return {
      state: st || null,
      days: null,
      label: 'Unknown — state, sale type, official sale terms, and current law must be verified.',
      warning: 'REDEMPTION_STATUS_UNKNOWN: No state-level rule was selected; do not infer a zero-day redemption period.',
      basis: 'unverified',
      requiresSaleTypeVerification: true
    };
  }

  return {
    state: st,
    days: rule.days,
    label: rule.label,
    warning: rule.days > 0 ? `${st}: ${rule.days}-Day Statutory Right of Redemption Applies as a State-Level Baseline; Sale Type and Current Official Terms Require Verification` : null,
    basis: 'state-level-baseline',
    requiresSaleTypeVerification: true
  };
}

/**
 * Detects if the foreclosing plaintiff is a junior lienholder (2nd mortgage, HELOC, HOA)
 * where senior mortgages and superior tax encumbrances survive the auction.
 * @param {string} plaintiff
 * @param {string} legalText
 * @returns {object} Pattern-match signal that never implies clear title
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
      warning: 'SENIOR_LIEN_RISK: High pattern-match signal. The text may describe a junior lien or prior encumbrance; obtain a current title search and legal review before concluding that any lien survives.'
    };
  }

  return {
    isJuniorLien: false,
    riskLevel: 'unknown',
    survivingSeniorLiens: null,
    matchedTerms: [],
    warning: 'NO_TITLE_CONCLUSION: No junior-lien phrase was detected in the supplied text. Absence of a phrase is not evidence of lien priority or clear title.'
  };
}

const CASH_COMPONENTS = [
  'buyersPremium',
  'sheriffPoundage',
  'transferTax',
  'delinquentTaxes',
  'settlementCosts'
];

function amountBasis(params, field, fallback = 'assumption') {
  const basis = cleanLabel(params?.basis?.[field] ?? params?.[`${field}Basis`]);
  return basis === 'published' || basis === 'assumption' ? basis : fallback;
}

/**
 * Calculates a cash-requirement scenario exclusively from published amounts or
 * caller-entered assumptions. Source names and state codes never select a fee.
 * A numeric zero is valid only when the caller supplies it explicitly.
 */
function computeCashToClose(params = {}) {
  const openingBid = positiveNumber(params.openingBid);
  const purchasePrice = positiveNumber(params.purchasePrice) ?? openingBid;
  const registrationFunds = nonNegativeNumber(params.registrationFunds);
  const creditedDeposit = nonNegativeNumber(params.creditedDeposit);
  const buyersPremium = nonNegativeNumber(params.buyersPremium);
  const sheriffPoundage = nonNegativeNumber(params.sheriffPoundage);
  const transferTax = nonNegativeNumber(params.transferTax);
  const delinquentTaxes = nonNegativeNumber(params.delinquentTaxes);
  const settlementCosts = nonNegativeNumber(params.settlementCosts ?? params.deedFees);
  const values = { buyersPremium, sheriffPoundage, transferTax, delinquentTaxes, settlementCosts };
  const missingInputs = [
    purchasePrice === null ? 'purchasePrice' : null,
    ...CASH_COMPONENTS.filter((field) => values[field] === null),
    creditedDeposit === null ? 'creditedDeposit' : null,
    registrationFunds === null ? 'registrationFunds' : null
  ].filter(Boolean);
  const missingAcquisitionInputs = [
    purchasePrice === null ? 'purchasePrice' : null,
    ...CASH_COMPONENTS.filter((field) => values[field] === null)
  ].filter(Boolean);
  const hasCompleteAcquisitionCost = missingAcquisitionInputs.length === 0;
  const totalAcquisitionCost = hasCompleteAcquisitionCost
    ? purchasePrice + buyersPremium + sheriffPoundage + transferTax + delinquentTaxes + settlementCosts
    : null;
  const cashDueAtSettlement = totalAcquisitionCost !== null && creditedDeposit !== null
    ? Math.max(0, totalAcquisitionCost - creditedDeposit)
    : null;
  const basis = {
    openingBid: openingBid === null ? null : amountBasis(params, 'openingBid', 'published'),
    purchasePrice: purchasePrice === null
      ? null
      : amountBasis(params, 'purchasePrice', positiveNumber(params.purchasePrice) === null ? 'assumption' : 'assumption'),
    registrationFunds: registrationFunds === null ? null : amountBasis(params, 'registrationFunds'),
    creditedDeposit: creditedDeposit === null ? null : amountBasis(params, 'creditedDeposit'),
    buyersPremium: buyersPremium === null ? null : amountBasis(params, 'buyersPremium'),
    sheriffPoundage: sheriffPoundage === null ? null : amountBasis(params, 'sheriffPoundage'),
    transferTax: transferTax === null ? null : amountBasis(params, 'transferTax'),
    delinquentTaxes: delinquentTaxes === null ? null : amountBasis(params, 'delinquentTaxes'),
    settlementCosts: settlementCosts === null ? null : amountBasis(params, 'settlementCosts')
  };
  const suppliedBasis = Object.values(basis).filter(Boolean);
  const verified = hasCompleteAcquisitionCost
    && creditedDeposit !== null
    && registrationFunds !== null
    && suppliedBasis.every((value) => value === 'published');
  const assumptions = Object.entries(basis)
    .filter(([, value]) => value === 'assumption')
    .map(([field]) => `${field} is an explicit scenario assumption.`);

  return {
    openingBid,
    purchasePrice,
    registrationFunds,
    creditedDeposit,
    buyersPremium,
    sheriffPoundage,
    transferTax,
    delinquentTaxes,
    settlementCosts,
    // Compatibility alias for older consumers. It carries the same explicit
    // settlement-cost input; no default recording fee is introduced.
    deedPrepAndRecording: settlementCosts,
    totalAcquisitionCost,
    totalCashToClose: totalAcquisitionCost,
    total: totalAcquisitionCost,
    cashDueAtSettlement,
    effectiveDiscountRate: totalAcquisitionCost !== null && purchasePrice > 0
      ? Number(((totalAcquisitionCost - purchasePrice) / purchasePrice).toFixed(4))
      : null,
    isModeled: assumptions.length > 0,
    verified,
    modelStatus: missingInputs.length === 0 ? 'complete_scenario' : 'insufficient_inputs',
    acquisitionCostStatus: hasCompleteAcquisitionCost ? 'complete' : 'unresolved',
    fundingTimingStatus: creditedDeposit !== null && registrationFunds !== null ? 'complete' : 'unresolved',
    model: 'explicit-cash-requirements-v2',
    basis,
    assumptions,
    missingInputs,
    missingAcquisitionInputs
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
    isStayed: null,
    status: 'UNKNOWN_UNVERIFIED',
    caseNumber: null,
    adjournmentDate: null,
    reason: 'No bankruptcy-stay or adjournment phrase was detected. Current sale status requires official docket verification.'
  };
}

/**
 * Extracts only rent-roll fields actually present in supplied text. Financial
 * aggregates remain null when their supporting fields or explicit assumptions
 * are incomplete.
 * @param {string} rawNotice
 * @param {{expenseRatio?: number}} assumptions
 * @returns {object}
 */
function parseRentRollSchedule(rawNotice = '', assumptions = {}) {
  const text = String(rawNotice || '');
  const units = [];
  const lines = text.split(/[\r\n]+/);

  for (const line of lines) {
    const unitMatch = line.match(/(?:unit|suite|apt|space)\s*([A-Za-z0-9\-]+)[:\-\s]+(.*)/i);
    if (!unitMatch) continue;

    const unit = unitMatch[1].trim();
    const rest = unitMatch[2].trim();

    let tenant = null;
    const firstSegment = rest.split(/,|\s-\s/)[0].trim();
    if (firstSegment && !/^(?:vacant|empty|unoccupied)$/i.test(firstSegment)) tenant = firstSegment;

    const isVacant = /\b(?:vacant|empty|unoccupied)\b/i.test(rest);
    const sqftMatch = rest.match(/(\d[\d,]*)\s*(?:sqft|sf|sq\s*ft)/i);
    const sqft = sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, ''), 10) : null;
    const rentMatch = rest.match(/(?:rent|\$)\s*[:\$]?\s*(\d[\d,]*)/i);
    const rent = rentMatch ? parseInt(rentMatch[1].replace(/,/g, ''), 10) : (isVacant ? 0 : null);
    const leaseMatch = rest.match(/(?:exp|expires|lease\s*end)\s*[:\s]?\s*([0-9\/\-]+)/i);
    const leaseEnd = leaseMatch ? leaseMatch[1].trim() : null;
    const status = isVacant ? 'Vacant' : rent !== null && rent > 0 ? 'Occupied' : 'Unknown';

    units.push({
      unit,
      tenant,
      status,
      sqft,
      monthlyRent: rent,
      annualRent: rent === null ? null : rent * 12,
      leaseEnd
    });
  }

  const hasCompleteSqft = units.length > 0 && units.every(unit => unit.sqft !== null);
  const hasCompleteRent = units.length > 0 && units.every(unit => unit.annualRent !== null);
  const hasCompleteOccupancy = hasCompleteSqft && units.every(unit => unit.status !== 'Unknown');
  const totalSqft = hasCompleteSqft
    ? units.reduce((sum, unit) => sum + (unit.sqft ?? 0), 0)
    : null;
  const totalAnnualRent = hasCompleteRent
    ? units.reduce((sum, unit) => sum + (unit.annualRent ?? 0), 0)
    : null;
  const occupiedSqft = hasCompleteOccupancy
    ? units.filter(unit => unit.status === 'Occupied').reduce((sum, unit) => sum + (unit.sqft ?? 0), 0)
    : null;
  const occupancyRate = totalSqft !== null && totalSqft > 0 && occupiedSqft !== null
    ? Number(((occupiedSqft / totalSqft) * 100).toFixed(1))
    : null;
  const expenseRatio = nonNegativeNumber(assumptions.expenseRatio);
  const inPlaceNoi = totalAnnualRent !== null && expenseRatio !== null && expenseRatio < 1
    ? Math.round(totalAnnualRent * (1 - expenseRatio))
    : null;
  const evidenceGaps = [];
  if (!hasCompleteSqft) evidenceGaps.push('Complete unit square footage is required for occupancy by area.');
  if (!hasCompleteRent) evidenceGaps.push('A complete reported rent schedule is required for annual rent.');
  if (expenseRatio === null || expenseRatio >= 1) evidenceGaps.push('A buyer-supplied operating-expense ratio is required for NOI.');

  return {
    unitCount: units.length,
    units,
    totalSqft,
    totalAnnualRent,
    occupancyRate,
    inPlaceNoi,
    evidenceGaps
  };
}

/**
 * Produces a non-binding LOI scenario without inventing buyer, price, deposit,
 * timing, cost, or title terms.
 * @param {object} listing
 * @param {object} options
 * @returns {string}
 */
function generateLetterOfIntent(listing = {}, options = {}) {
  const buyer = cleanLabel(options.buyerEntity);
  const recipient = cleanLabel(options.recipient);
  const price = positiveNumber(options.offerPrice);
  const suppliedDeposit = nonNegativeNumber(options.depositAmount);
  const depositPct = nonNegativeNumber(options.depositPct);
  const validDepositPct = depositPct !== null && depositPct <= 1 ? depositPct : null;
  const deposit = suppliedDeposit ?? (
    price !== null && validDepositPct !== null
      ? Math.round(price * validDepositPct)
      : null
  );
  const inspectionDays = nonNegativeNumber(options.inspectionDays);
  const closingDays = nonNegativeNumber(options.closingDays);
  const address = cleanLabel(listing.address);
  const city = cleanLabel(listing.city);
  const state = cleanLabel(listing.state)?.toUpperCase() ?? null;
  const zip = cleanLabel(listing.zip);
  const county = cleanLabel(listing.county);
  const source = cleanLabel(listing.source);
  const reference = cleanLabel(listing.id);
  const location = [address, city, state, zip].filter(Boolean).join(', ');
  const costs = options.closingCosts && typeof options.closingCosts === 'object'
    ? options.closingCosts
    : null;
  const registrationFunds = nonNegativeNumber(costs?.registrationFunds);
  const creditedDeposit = nonNegativeNumber(costs?.creditedDeposit);
  const buyersPremium = nonNegativeNumber(costs?.buyersPremium);
  const sheriffPoundage = nonNegativeNumber(costs?.sheriffPoundage);
  const transferTax = nonNegativeNumber(costs?.transferTax);
  const delinquentTaxes = nonNegativeNumber(costs?.delinquentTaxes);
  const settlementCosts = nonNegativeNumber(costs?.settlementCosts ?? costs?.deedFees);
  const hasCompleteCostScenario = price !== null && [
    buyersPremium,
    sheriffPoundage,
    transferTax,
    delinquentTaxes,
    settlementCosts
  ].every(value => value !== null);
  const modeledCashRequired = hasCompleteCostScenario
    ? price + buyersPremium + sheriffPoundage + transferTax + delinquentTaxes + settlementCosts
    : null;
  const cashDueAtSettlement = modeledCashRequired !== null && creditedDeposit !== null
    ? Math.max(0, modeledCashRequired - creditedDeposit)
    : null;
  const depositBasis = suppliedDeposit !== null
    ? 'buyer-supplied amount'
    : validDepositPct !== null
      ? `buyer-supplied ${(validDepositPct * 100).toFixed(2).replace(/\.00$/, '')}% assumption`
      : 'not supplied';

  return `DRAFT — NON-BINDING LETTER OF INTENT SCENARIO
NOT READY FOR SUBMISSION — MISSING TERMS REQUIRE BUYER AND COUNSEL REVIEW

DATE: ${new Date().toISOString().split('T')[0]}
TO: ${recipient ?? '[RECIPIENT NOT SUPPLIED — CONFIRM AUTHORIZED COUNTERPARTY]'}
REGARDING: ${location || '[PROPERTY ADDRESS NOT AVAILABLE IN SOURCE RECORD]'}
LISTING / DOCKET REFERENCE: ${reference ?? '[NOT AVAILABLE IN SOURCE RECORD]'}
SOURCE CHANNEL: ${source ? sourceDisplayText(source.toUpperCase()) : '[SOURCE NOT AVAILABLE]'}

1. PURCHASER: ${buyer ?? '[NOT SUPPLIED — BUYER INPUT REQUIRED]'}.
2. PROPERTY: ${location || '[ADDRESS EVIDENCE REQUIRED]'}${county ? `; reported county: ${county}` : '; county not reported'}.
3. PROPOSED PURCHASE PRICE: ${formatMoney(price)}${price !== null ? ' (buyer-supplied scenario; not inferred from the opening bid)' : ''}.
4. EARNEST MONEY DEPOSIT: ${formatMoney(deposit)} (${depositBasis}). Deposit timing and refundability are not supplied and must be confirmed from the official sale terms.
5. DUE DILIGENCE PERIOD: ${inspectionDays === null ? '[NOT SUPPLIED — BUYER INPUT REQUIRED]' : `${Math.round(inspectionDays)} calendar days (buyer-supplied scenario)`}. Any applicable auction restrictions must be confirmed.
6. CLOSING-COST SCENARIO (ONLY EXPLICITLY SUPPLIED INPUTS ARE SHOWN):
   - Registration Funds (separate liquidity requirement): ${formatMoney(registrationFunds)}
   - Deposit Credited Toward Purchase Price: ${formatMoney(creditedDeposit)}
   - Proposed Purchase Price: ${formatMoney(price)}
   - Buyer's Premium: ${formatMoney(buyersPremium)}
   - Sheriff / Trustee Fee or Poundage: ${formatMoney(sheriffPoundage)}
   - Transfer Tax: ${formatMoney(transferTax)}
   - Delinquent Taxes Assumed by Buyer: ${formatMoney(delinquentTaxes)}
   - Other Settlement / Recording Costs: ${formatMoney(settlementCosts)}
   - Total Acquisition Cash (credited deposit is included once): ${formatMoney(modeledCashRequired)}
   - Remaining Cash Due at Settlement: ${formatMoney(cashDueAtSettlement)}
7. CLOSING TIMELINE: ${closingDays === null ? '[NOT SUPPLIED — BUYER INPUT REQUIRED]' : `${Math.round(closingDays)} calendar days (buyer-supplied scenario)`}. The triggering event, confirmation process, and any objection or redemption rights require official verification.
8. TITLE / LEGAL STATUS: NOT DETERMINED. Obtain a current title search or commitment, foreclosure docket, lien-priority analysis, and the controlling sale terms. This draft makes no representation about surviving liens, insurability, redemption, possession, or seller authority.

DRAFT FOR REVIEW — NOT AGREED OR SUBMITTED
By: ___________________________
Authorized Representative, ${buyer ?? '[BUYER ENTITY REQUIRED]'}`;
}

/**
 * Produces an evidence-review memo. Missing deal, legal, operating, financing,
 * and bid assumptions remain explicitly unavailable.
 * @param {object} listing
 * @param {object|null} creMetrics
 * @returns {string}
 */
function generateInvestmentCommitteeMemo(listing = {}, creMetrics = {}) {
  const bid = positiveNumber(listing.openingBid);
  const estLow = positiveNumber(listing.estLow);
  const estHigh = positiveNumber(listing.estHigh);
  const hasValuationRange = estLow !== null && estHigh !== null && estHigh >= estLow;
  const estMid = hasValuationRange ? (estLow + estHigh) / 2 : null;
  const spread = bid !== null && estMid !== null ? estMid - bid : null;
  const discountPct = spread !== null && estMid !== null && estMid > 0
    ? Number(((spread / estMid) * 100).toFixed(1))
    : null;
  const dealScoreValue = finiteNumber(listing.dealScore);
  const dealScore = dealScoreValue !== null && dealScoreValue >= 1 && dealScoreValue <= 99
    ? Math.round(dealScoreValue)
    : null;
  const redemptionDays = nonNegativeNumber(listing.redemptionDays);
  const seniorLienRisk = cleanLabel(listing.seniorLienRisk);
  const occupancy = cleanLabel(listing.occupancy);
  const netOperatingIncome = nonNegativeNumber(creMetrics?.netOperatingIncome);
  const capitalizationRate = nonNegativeNumber(creMetrics?.capitalizationRate);
  const estimatedDscr = nonNegativeNumber(creMetrics?.estimatedDscr);
  const maxAllowableOffer = nonNegativeNumber(creMetrics?.maxAllowableOffer);
  const stateZip = [cleanLabel(listing.state)?.toUpperCase(), cleanLabel(listing.zip)].filter(Boolean).join(' ');
  const asset = [cleanLabel(listing.address), cleanLabel(listing.city), stateZip]
    .filter(Boolean)
    .join(', ');
  const evidenceGaps = [];
  if (bid === null) evidenceGaps.push('published opening amount');
  if (estMid === null) evidenceGaps.push('supported valuation range');
  if (dealScore === null) evidenceGaps.push('computed triage score inputs');
  if (redemptionDays === null) evidenceGaps.push('official redemption or objection terms');
  if (seniorLienRisk === null) evidenceGaps.push('current title and lien-priority evidence');
  if (occupancy === null) evidenceGaps.push('verified occupancy evidence');
  if ([netOperatingIncome, capitalizationRate, estimatedDscr, maxAllowableOffer].some(value => value === null)) {
    evidenceGaps.push('complete buyer-supplied operating and financing assumptions');
  }
  const gapSummary = evidenceGaps.length > 0
    ? evidenceGaps.map(gap => `- ${gap}`).join('\n')
    : '- Official sale terms, title, lien priority, property condition, and authority to bid still require verification.';

  return `# INVESTMENT COMMITTEE (IC) ACQUISITION MEMORANDUM

**STATUS: EVIDENCE REVIEW DRAFT — NOT BID AUTHORITY**

## EXECUTIVE SUMMARY
- **Asset**: ${asset || 'Unavailable — property identity evidence required'}
- **Asset Class**: ${cleanLabel(listing.propType) ?? 'Unknown — source evidence required'}
- **Source Channel**: ${cleanLabel(listing.source)?.toUpperCase() ?? 'Unknown — source evidence required'}
- **Deal Score**: ${dealScore === null ? 'Unavailable — published bid and supported valuation inputs are required' : `${dealScore}/99 (triage indicator only; not an appraisal)`}
- **Published Opening Amount**: ${formatMoney(bid)}
- **Supported Valuation-Range Midpoint**: ${formatMoney(estMid)}
- **Bid Spread (valuation midpoint minus opening amount)**: ${spread === null || discountPct === null ? 'Unavailable — opening amount and both valuation bounds are required' : `${formatMoney(spread)} (${discountPct}% modeled spread; not equity and not an appraisal)`}

## TITLE / SALE-TERMS EVIDENCE
- **Redemption / Objection Period**: ${redemptionDays === null ? 'Unknown — official sale terms and current law review required' : `${Math.round(redemptionDays)} days recorded in this dataset; verify the triggering event, exceptions, and current official terms`}${cleanLabel(listing.redemptionWarning) ? ` (unverified record note: ${cleanLabel(listing.redemptionWarning)})` : ''}
- **Senior Lien Signal**: ${seniorLienRisk === null ? 'Unknown — current title and docket evidence required' : `${seniorLienRisk.toUpperCase()} (unverified risk signal; not a title conclusion)`}${cleanLabel(listing.seniorLienWarning) ? ` (record note: ${cleanLabel(listing.seniorLienWarning)})` : ''}
- **Occupancy Status**: ${occupancy ?? 'Unknown — inspection or other authorized evidence required'}

## FINANCIAL & RETURN METRICS
- **Net Operating Income (NOI)**: ${netOperatingIncome === null ? 'Unavailable — verified rent roll and explicit expense assumptions required' : `${formatMoney(netOperatingIncome)} / year (modeled)`}
- **Capitalization Rate**: ${capitalizationRate === null ? 'Unavailable — NOI and acquisition-cost basis required' : `${capitalizationRate}% (modeled)`}
- **Debt Service Coverage Ratio (DSCR)**: ${estimatedDscr === null ? 'Unavailable — NOI and explicit annual debt service required' : `${estimatedDscr}x (modeled)`}
- **Max Allowable Offer (MAO)**: ${maxAllowableOffer === null ? 'Unavailable — explicit target-yield assumptions required' : `${formatMoney(maxAllowableOffer)} (buyer-supplied model output; not a bid recommendation)`}

## EVIDENCE REQUIRED BEFORE A BID DECISION
${gapSummary}

## UNDERWRITING RECOMMENDATION
NO BID RECOMMENDATION. Do not place a deposit or authorize a bid from this draft. Confirm the exact source listing, current sale status and terms, title and lien priority, redemption or objection rights, occupancy, property condition, and every buyer-supplied financial assumption with qualified professionals.`;
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
