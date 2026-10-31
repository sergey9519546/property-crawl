// Client-safe underwriting helpers (pure functions, no CJS imports).
//
// These helpers deliberately distinguish source evidence from buyer-supplied
// scenarios. A missing fact is never converted into an actionable deal term or
// a favorable legal conclusion.

function sourceDisplayText(value: string): string {
  return value.replace(/servicelink(?:\s+auction)?/gi, "Public Auction Network");
}

export interface CashToClose {
  openingBid: number | null;
  purchasePrice: number | null;
  registrationFunds: number | null;
  creditedDeposit: number | null;
  buyersPremium: number | null;
  sheriffPoundage: number | null;
  transferTax: number | null;
  delinquentTaxes: number | null;
  settlementCosts: number | null;
  /** Compatibility alias; it never introduces a default recording fee. */
  deedFees: number | null;
  totalAcquisitionCost: number | null;
  totalCashToClose: number | null;
  total: number | null;
  cashDueAtSettlement: number | null;
  modelStatus: "complete_scenario" | "insufficient_inputs";
  acquisitionCostStatus: "complete" | "unresolved";
  fundingTimingStatus: "complete" | "unresolved";
  model: "explicit-cash-requirements-v2";
  verified: boolean;
  isModeled: boolean;
  basis: Record<CashAmountField, CashInputBasis | null>;
  assumptions: string[];
  missingInputs: string[];
  missingAcquisitionInputs: string[];
}

export type CashInputBasis = "published" | "assumption";
export type CashAmountField =
  | "openingBid"
  | "purchasePrice"
  | "registrationFunds"
  | "creditedDeposit"
  | "buyersPremium"
  | "sheriffPoundage"
  | "transferTax"
  | "delinquentTaxes"
  | "settlementCosts";

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%x,]/gi, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function formatMoney(value: number | null): string {
  return value === null
    ? "Unavailable — supporting evidence or an explicit buyer assumption is required"
    : `$${Math.round(value).toLocaleString()} USD`;
}

function cleanLabel(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export interface CashToCloseInput {
  openingBid?: number | string | null;
  purchasePrice?: number | string | null;
  registrationFunds?: number | string | null;
  creditedDeposit?: number | string | null;
  buyersPremium?: number | string | null;
  sheriffPoundage?: number | string | null;
  transferTax?: number | string | null;
  delinquentTaxes?: number | string | null;
  settlementCosts?: number | string | null;
  /** Deprecated compatibility input, interpreted as explicit settlement costs. */
  deedFees?: number | string | null;
  basis?: Partial<Record<CashAmountField, CashInputBasis>>;
  // Retained only so older callers compile. These fields never select fees.
  state?: string;
  source?: string;
}

const acquisitionCostFields = [
  "buyersPremium",
  "sheriffPoundage",
  "transferTax",
  "delinquentTaxes",
  "settlementCosts",
] as const;

export function computeCashToClose(params: CashToCloseInput = {}): CashToClose {
  const openingBid = positiveNumber(params.openingBid);
  const suppliedPurchasePrice = positiveNumber(params.purchasePrice);
  const purchasePrice = suppliedPurchasePrice ?? openingBid;
  const registrationFunds = nonNegativeNumber(params.registrationFunds);
  const creditedDeposit = nonNegativeNumber(params.creditedDeposit);
  const buyersPremium = nonNegativeNumber(params.buyersPremium);
  const sheriffPoundage = nonNegativeNumber(params.sheriffPoundage);
  const transferTax = nonNegativeNumber(params.transferTax);
  const delinquentTaxes = nonNegativeNumber(params.delinquentTaxes);
  const settlementCosts = nonNegativeNumber(params.settlementCosts ?? params.deedFees);
  const values = { buyersPremium, sheriffPoundage, transferTax, delinquentTaxes, settlementCosts };
  const missingAcquisitionInputs = [
    purchasePrice === null ? "purchasePrice" : null,
    ...acquisitionCostFields.filter((field) => values[field] === null),
  ].filter((field): field is string => field !== null);
  const missingInputs = [
    ...missingAcquisitionInputs,
    creditedDeposit === null ? "creditedDeposit" : null,
    registrationFunds === null ? "registrationFunds" : null,
  ].filter((field): field is string => field !== null);
  const hasCompleteAcquisitionCost = missingAcquisitionInputs.length === 0;
  const totalAcquisitionCost = hasCompleteAcquisitionCost
    ? purchasePrice! + buyersPremium! + sheriffPoundage! + transferTax! + delinquentTaxes! + settlementCosts!
    : null;
  const cashDueAtSettlement = totalAcquisitionCost !== null && creditedDeposit !== null
    ? Math.max(0, totalAcquisitionCost - creditedDeposit)
    : null;
  const basis: Record<CashAmountField, CashInputBasis | null> = {
    openingBid: openingBid === null ? null : (params.basis?.openingBid ?? "published"),
    purchasePrice: purchasePrice === null ? null : (params.basis?.purchasePrice ?? "assumption"),
    registrationFunds: registrationFunds === null ? null : (params.basis?.registrationFunds ?? "assumption"),
    creditedDeposit: creditedDeposit === null ? null : (params.basis?.creditedDeposit ?? "assumption"),
    buyersPremium: buyersPremium === null ? null : (params.basis?.buyersPremium ?? "assumption"),
    sheriffPoundage: sheriffPoundage === null ? null : (params.basis?.sheriffPoundage ?? "assumption"),
    transferTax: transferTax === null ? null : (params.basis?.transferTax ?? "assumption"),
    delinquentTaxes: delinquentTaxes === null ? null : (params.basis?.delinquentTaxes ?? "assumption"),
    settlementCosts: settlementCosts === null ? null : (params.basis?.settlementCosts ?? "assumption"),
  };
  const suppliedBasis = Object.values(basis).filter((value): value is CashInputBasis => value !== null);
  const verified = hasCompleteAcquisitionCost
    && creditedDeposit !== null
    && registrationFunds !== null
    && suppliedBasis.every((value) => value === "published");
  const assumptions = Object.entries(basis)
    .filter(([, value]) => value === "assumption")
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
    deedFees: settlementCosts,
    totalAcquisitionCost,
    totalCashToClose: totalAcquisitionCost,
    total: totalAcquisitionCost,
    cashDueAtSettlement,
    modelStatus: missingInputs.length === 0 ? "complete_scenario" : "insufficient_inputs",
    acquisitionCostStatus: hasCompleteAcquisitionCost ? "complete" : "unresolved",
    fundingTimingStatus: creditedDeposit !== null && registrationFunds !== null ? "complete" : "unresolved",
    model: "explicit-cash-requirements-v2",
    verified,
    isModeled: assumptions.length > 0,
    basis,
    assumptions,
    missingInputs,
    missingAcquisitionInputs,
  };
}

export interface TargetPriceScenario {
  maxPurchasePrice: number;
  priceReductionNeeded: number;
  maxOtherAcquisitionCostsAtCurrentPrice: number;
  costReductionNeeded: number;
  targetAchievableAtCurrentPrice: boolean;
  targetProfit: number;
}

/** Answers the reverse question: which price or cost change satisfies a target. */
export function computeTargetPriceScenario(params: {
  estimatedValue: number | string | null;
  targetMarginPct: number | string | null;
  rehabBudget: number | string | null;
  currentPrice: number | string | null;
  otherAcquisitionCosts: number | string | null;
}): TargetPriceScenario | null {
  const estimatedValue = positiveNumber(params.estimatedValue);
  const targetMarginPct = nonNegativeNumber(params.targetMarginPct);
  const rehabBudget = nonNegativeNumber(params.rehabBudget);
  const currentPrice = positiveNumber(params.currentPrice);
  const otherAcquisitionCosts = nonNegativeNumber(params.otherAcquisitionCosts);
  if (
    estimatedValue === null
    || targetMarginPct === null
    || targetMarginPct >= 100
    || rehabBudget === null
    || currentPrice === null
    || otherAcquisitionCosts === null
  ) return null;

  const targetProfit = Math.round(estimatedValue * (targetMarginPct / 100));
  const availableAcquisitionBudget = Math.max(0, estimatedValue - targetProfit - rehabBudget);
  const maxPurchasePrice = Math.max(0, Math.floor(availableAcquisitionBudget - otherAcquisitionCosts));
  const maxOtherAcquisitionCostsAtCurrentPrice = Math.max(0, Math.floor(availableAcquisitionBudget - currentPrice));
  return {
    maxPurchasePrice,
    priceReductionNeeded: Math.max(0, currentPrice - maxPurchasePrice),
    maxOtherAcquisitionCostsAtCurrentPrice,
    costReductionNeeded: currentPrice <= availableAcquisitionBudget
      ? Math.max(0, otherAcquisitionCosts - maxOtherAcquisitionCostsAtCurrentPrice)
      : 0,
    targetAchievableAtCurrentPrice: currentPrice <= availableAcquisitionBudget,
    targetProfit,
  };
}

export function redemptionLabel(days: number | null | undefined): string {
  const parsed = nonNegativeNumber(days);
  if (parsed === null) return "Unknown — official sale terms required";
  const d = Math.round(parsed);
  if (d === 0) return "0 days reported — verify official sale terms";
  if (d === 365) return "1 Year";
  if (d === 730) return "2 Years";
  if (d === 180) return "6 Months";
  return `${d} Days`;
}

export interface CreUnderwritingMetrics {
  grossPotentialRent: number;
  effectiveGrossIncome: number;
  operatingExpenses: number;
  netOperatingIncome: number;
  capitalizationRate: number;
  estimatedDscr: number;
  maxAllowableOffer: number;
}

export interface CreUnderwritingAssumptions {
  sqft?: number;
  openingBid: number;
  estimatedValue?: number;
  propType?: string;
  /** Annual market rent in dollars per square foot. */
  marketRentPerSqftAnnual?: number;
  /** Operating expenses as a decimal ratio, e.g. 0.4 for 40%. */
  expenseRatio?: number;
  /** Economic vacancy/credit loss as a decimal ratio, e.g. 0.05 for 5%. */
  vacancyRate?: number;
  /** Retained for source compatibility; DSCR still requires annualDebtService. */
  ltv?: number;
  /** Explicit annual debt service from a buyer-supplied financing scenario. */
  annualDebtService?: number;
  /** Buyer's target cap rate as a decimal, e.g. 0.08 for 8%. */
  targetCapitalizationRate?: number;
}

export function computeCreMetrics(params: CreUnderwritingAssumptions): CreUnderwritingMetrics | null {
  const sqft = positiveNumber(params.sqft);
  const bid = positiveNumber(params.openingBid);
  const rentPerSqft = positiveNumber(params.marketRentPerSqftAnnual);
  const expenseRatio = nonNegativeNumber(params.expenseRatio);
  const vacancyRate = nonNegativeNumber(params.vacancyRate);
  const annualDebtService = positiveNumber(params.annualDebtService);
  const targetCapitalizationRate = positiveNumber(params.targetCapitalizationRate);

  // Property type, an opening bid, or square footage does not establish rent,
  // expenses, financing, or a target yield. Do not manufacture those inputs.
  if (
    sqft === null ||
    bid === null ||
    rentPerSqft === null ||
    expenseRatio === null || expenseRatio >= 1 ||
    vacancyRate === null || vacancyRate >= 1 ||
    annualDebtService === null ||
    targetCapitalizationRate === null || targetCapitalizationRate >= 1
  ) {
    return null;
  }

  const grossPotentialRent = Math.round(sqft * rentPerSqft);
  const effectiveGrossIncome = Math.round(grossPotentialRent * (1 - vacancyRate));
  const operatingExpenses = Math.round(effectiveGrossIncome * expenseRatio);
  const netOperatingIncome = Math.max(0, effectiveGrossIncome - operatingExpenses);

  const capitalizationRate = Number(((netOperatingIncome / bid) * 100).toFixed(2));
  const estimatedDscr = Number((netOperatingIncome / annualDebtService).toFixed(2));
  const maxAllowableOffer = Math.max(0, Math.round(netOperatingIncome / targetCapitalizationRate));

  return {
    grossPotentialRent,
    effectiveGrossIncome,
    operatingExpenses,
    netOperatingIncome,
    capitalizationRate,
    estimatedDscr,
    maxAllowableOffer
  };
}

export interface RentRollUnit {
  unit: string;
  tenant: string | null;
  status: 'Occupied' | 'Vacant' | 'Unknown';
  sqft: number | null;
  monthlyRent: number | null;
  annualRent: number | null;
  leaseEnd: string | null;
}

export interface RentRollSchedule {
  unitCount: number;
  units: RentRollUnit[];
  totalSqft: number | null;
  totalAnnualRent: number | null;
  occupancyRate: number | null;
  inPlaceNoi: number | null;
  evidenceGaps: string[];
}

export function parseRentRollSchedule(
  rawNotice = '',
  assumptions: { expenseRatio?: number } = {},
): RentRollSchedule {
  const text = String(rawNotice || '');
  const units: RentRollUnit[] = [];
  const lines = text.split(/[\r\n]+/);

  for (const line of lines) {
    const unitMatch = line.match(/(?:unit|suite|apt|space)\s*([A-Za-z0-9\-]+)[:\-\s]+(.*)/i);
    if (!unitMatch) continue;

    const unit = unitMatch[1].trim();
    const rest = unitMatch[2].trim();

    let tenant: string | null = null;
    const firstSegment = rest.split(/,|\s-\s/)[0].trim();
    if (firstSegment && !/^(?:vacant|empty|unoccupied)$/i.test(firstSegment)) tenant = firstSegment;

    const isVacant = /\b(?:vacant|empty|unoccupied)\b/i.test(rest);

    const sqftMatch = rest.match(/(\d[\d,]*)\s*(?:sqft|sf|sq\s*ft)/i);
    const sqft = sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, ''), 10) : null;

    const rentMatch = rest.match(/(?:rent\s*[:=]?\s*)?\$\s*(\d[\d,]*(?:\.\d+)?)\s*(\/\s*(?:mo(?:nth)?|yr|year|annual)|(?:per\s+)?(?:mo(?:nth)?|yr|year|annual))?/i)
      || rest.match(/rent\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)\s*(\/\s*(?:mo(?:nth)?|yr|year|annual)|(?:per\s+)?(?:mo(?:nth)?|yr|year|annual))/i);
    const rentAmount = rentMatch ? Number(rentMatch[1].replace(/,/g, '')) : null;
    const rentPeriod = rentMatch?.[2]?.toLowerCase().replace(/\s+/g, '') || null;
    const rent = rentAmount !== null && Number.isFinite(rentAmount) && rentPeriod
      ? rentAmount
      : (isVacant ? 0 : null);
    const isAnnualRent = /yr|year|annual/.test(rentPeriod || '');
    const monthlyRent = rent === null ? null : isAnnualRent ? rent / 12 : rent;
    const annualRent = rent === null ? null : isAnnualRent ? rent : rent * 12;

    const leaseMatch = rest.match(/(?:exp|expires|lease\s*end)\s*[:\s]?\s*([0-9\/\-]+)/i);
    const leaseEnd = leaseMatch ? leaseMatch[1].trim() : null;

    const status: RentRollUnit['status'] = isVacant
      ? 'Vacant'
      : monthlyRent !== null && monthlyRent > 0
        ? 'Occupied'
        : 'Unknown';
    units.push({
      unit,
      tenant,
      status,
      sqft,
      monthlyRent,
      annualRent,
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
  const evidenceGaps: string[] = [];
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
    evidenceGaps,
  };
}

export interface LetterOfIntentOptions {
  buyerEntity?: string | null;
  recipient?: string | null;
  offerPrice?: number | null;
  depositAmount?: number | null;
  depositPct?: number | null;
  inspectionDays?: number | null;
  closingDays?: number | null;
  closingCosts?: {
    registrationFunds?: number | null;
    creditedDeposit?: number | null;
    buyersPremium?: number | null;
    sheriffPoundage?: number | null;
    transferTax?: number | null;
    delinquentTaxes?: number | null;
    settlementCosts?: number | null;
    /** Deprecated alias for settlementCosts. */
    deedFees?: number | null;
  } | null;
}

export function generateLetterOfIntent(listing: {
  id?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  openingBid?: number | null;
  source?: string | null;
  raw?: string | null;
  [key: string]: any;
}, options: LetterOfIntentOptions = {}): string {
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
  const costs = options.closingCosts ?? null;
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
    settlementCosts,
  ].every(value => value !== null);
  const modeledCashRequired = hasCompleteCostScenario
    ? price + buyersPremium! + sheriffPoundage! + transferTax! + delinquentTaxes! + settlementCosts!
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

export function generateInvestmentCommitteeMemo(listing: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  propType?: string | null;
  source?: string | null;
  dealScore?: number | null;
  openingBid?: number | null;
  estLow?: number | null;
  estHigh?: number | null;
  redemptionDays?: number | null;
  redemptionWarning?: string | null;
  seniorLienRisk?: string | null;
  seniorLienWarning?: string | null;
  occupancy?: string | null;
  [key: string]: any;
}, creMetrics?: Partial<CreUnderwritingMetrics> | null): string {
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
  const derivedRedemption = listing?.provenance?.derivedFields?.redemption;
  const redemptionDays = derivedRedemption ? null : nonNegativeNumber(listing.redemptionDays);
  const baselineRedemptionDays = derivedRedemption
    ? nonNegativeNumber(derivedRedemption.days ?? listing.redemptionDays)
    : null;
  const derivedSeniorLien = listing?.provenance?.derivedFields?.seniorLienRisk;
  const seniorLienRisk = derivedSeniorLien ? null : cleanLabel(listing.seniorLienRisk);
  const patternSeniorLien = derivedSeniorLien ? cleanLabel(listing.seniorLienRisk) : null;
  const seniorLienSentence = derivedSeniorLien
    ? (patternSeniorLien && patternSeniorLien.toLowerCase() !== "unknown"
      ? `${patternSeniorLien.toUpperCase()} is a text-pattern flag, not a title opinion`
      : "No junior-lien phrase was stored, not a title opinion")
    : (seniorLienRisk === null
      ? "Unknown — current title and docket evidence required"
      : `${seniorLienRisk.toUpperCase()} (unverified risk signal; not a title conclusion)`);
  const occupancy = cleanLabel(listing.occupancy);
  const netOperatingIncome = nonNegativeNumber(creMetrics?.netOperatingIncome);
  const capitalizationRate = nonNegativeNumber(creMetrics?.capitalizationRate);
  const estimatedDscr = nonNegativeNumber(creMetrics?.estimatedDscr);
  const maxAllowableOffer = nonNegativeNumber(creMetrics?.maxAllowableOffer);
  const asset = [cleanLabel(listing.address), cleanLabel(listing.city), cleanLabel(listing.state)?.toUpperCase(), cleanLabel(listing.zip)]
    .filter(Boolean)
    .join(', ');
  const evidenceGaps: string[] = [];
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
- **Source Channel**: ${sourceDisplayText(cleanLabel(listing.source)?.toUpperCase() ?? 'Unknown — source evidence required')}
- **Deal Score**: ${dealScore === null ? 'Unavailable — published bid and supported valuation inputs are required' : `${dealScore}/99 (triage indicator only; not an appraisal)`}
- **Published Opening Amount**: ${formatMoney(bid)}
- **Supported Valuation-Range Midpoint**: ${formatMoney(estMid)}
- **Bid Spread (valuation midpoint minus opening amount)**: ${spread === null || discountPct === null ? 'Unavailable — opening amount and both valuation bounds are required' : `${formatMoney(spread)} (${discountPct}% modeled spread; not equity and not an appraisal)`}

## TITLE / SALE-TERMS EVIDENCE
- **Redemption / Objection Period**: ${derivedRedemption ? `${baselineRedemptionDays === null ? 'No day count was selected from the state table' : `${Math.round(baselineRedemptionDays)} days is a state-table baseline`}, not a term recorded on this sale` : redemptionDays === null ? 'Unknown — official sale terms and current law review required' : `${Math.round(redemptionDays)} days recorded in this dataset; verify the triggering event, exceptions, and current official terms`}${!derivedRedemption && cleanLabel(listing.redemptionWarning) ? ` (unverified record note: ${cleanLabel(listing.redemptionWarning)})` : ''}
- **Senior Lien Signal**: ${seniorLienSentence}${!derivedSeniorLien && cleanLabel(listing.seniorLienWarning) ? ` (record note: ${cleanLabel(listing.seniorLienWarning)})` : ''}
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

export interface StatutoryFeePreset {
  state: string;
  scheduleLabel: string;
  buyersPremium: number;
  sheriffPoundage: number;
  transferTax: number;
  creditedDeposit: number;
  registrationFunds: number;
  citations: string[];
  supported?: boolean;
  notice?: string | null;
}

function parsePublishedDepositAmount(depositText: string | null | undefined, price: number): number | null {
  if (!depositText || typeof depositText !== "string") return null;
  const dollarMatch = depositText.match(/\$\s*([0-9,]+(?:\.[0-9]{1,2})?)/);
  if (dollarMatch) {
    const val = Number(dollarMatch[1].replace(/,/g, ""));
    if (Number.isFinite(val) && val >= 0) return Math.round(val);
  }
  const pctMatch = depositText.match(/([0-9]{1,2}(?:\.[0-9]{1,2})?)\s*%/);
  if (pctMatch) {
    const pct = Number(pctMatch[1]);
    if (Number.isFinite(pct) && pct > 0 && pct <= 100) return Math.round(price * (pct / 100));
  }
  return null;
}

export function computeStatutoryFeePreset(params: {
  purchasePrice: number | string | null;
  state?: string | null;
  source?: string | null;
  distressType?: string | null;
  isTaxSale?: boolean | null;
  depositText?: string | null;
}): StatutoryFeePreset | null {
  const price = positiveNumber(params.purchasePrice);
  if (price === null) return null;
  const st = (params.state || "").trim().toUpperCase();
  const src = (params.source || "").trim().toLowerCase();
  const citations: string[] = [];
  const isSupported = ["NJ", "OH", "FL", "PA", "NC", "TX", "CA", "GA", "IL", "NY", "MI", "NV", "TN", "WA", "MD", "SC", "VA", "IN", "MO", "AZ"].includes(st);
  const supportedNotice = isSupported ? null : `Statutory fee preset unavailable for state ${st || "unknown"}. Showing generic baseline estimates.`;

  let buyersPremium = 0;
  if (src === "bid4assets" || src === "servicelink") {
    buyersPremium = Math.max(2500, Math.round(price * 0.05));
    citations.push("Marketplace schedule assumption: 5% ($2,500 min) buyer's premium on portal auctions.");
  } else {
    citations.push("Direct government / court auction assumption: $0 marketplace buyer's premium.");
  }

  let sheriffPoundage = 0;
  let transferTax = 0;
  let defaultDepositPct = 0.10;
  let scheduleLabel = `${st || "State"} Statutory Baseline Schedule`;

  if (st === "NJ") {
    scheduleLabel = "New Jersey Sheriff Statutory Schedule (N.J.S.A. 22A:4-8 & 46:15-7)";
    const tier1 = Math.min(price, 5000) * 0.06;
    const tier2 = Math.max(0, Math.min(price - 5000, 15000)) * 0.04;
    const tier3 = Math.max(0, price - 20000) * 0.02;
    sheriffPoundage = Math.max(150, Math.round(tier1 + tier2 + tier3));
    transferTax = Math.round(price * 0.01);
    defaultDepositPct = 0.20;
    citations.push(
      "N.J.S.A. 22A:4-8: Sheriff commission 6% on first $5k, 4% on next $15k, 2% above $20k ($150 min).",
      "N.J.S.A. 46:15-7: NJ Realty Transfer Fee baseline (~1.0% tiered statutory schedule).",
      "N.J.S.A. 2A:50-64: 20% statutory sheriff sale deposit at knockdown."
    );
  } else if (st === "OH") {
    scheduleLabel = "Ohio Sheriff Statutory Schedule (ORC § 311.17 & § 319.54)";
    sheriffPoundage = Math.round(price * 0.015);
    transferTax = Math.round((price / 1000) * 4);
    defaultDepositPct = 0.10;
    citations.push(
      "ORC § 311.17(B)(1): Sheriff poundage 1.5% of foreclosure sale proceeds.",
      "ORC § 319.54(G)(3): County auditor conveyance fee baseline ($4.00 per $1,000)."
    );
  } else if (st === "FL") {
    scheduleLabel = "Florida Clerk Judicial Schedule (Fla. Stat. § 28.24 & § 201.02)";
    sheriffPoundage = Math.round(Math.min(price, 500) * 0.03 + Math.max(0, price - 500) * 0.015);
    transferTax = Math.round(Math.ceil(price / 100) * 0.70);
    defaultDepositPct = 0.05;
    citations.push(
      "Fla. Stat. § 28.24(10): Clerk registry fee 3% on first $500 + 1.5% on balance.",
      "Fla. Stat. § 201.02: Documentary stamp tax $0.70 per $100 of consideration.",
      "Fla. Stat. § 45.031(3): 5% statutory judicial auction deposit at sale."
    );
  } else if (st === "PA") {
    scheduleLabel = "Pennsylvania Sheriff Statutory Schedule (42 Pa.C.S. § 21107 & 72 P.S. § 8102-C)";
    sheriffPoundage = Math.round(Math.min(price, 250000) * 0.02 + Math.max(0, price - 250000) * 0.005);
    transferTax = Math.round(price * 0.02);
    defaultDepositPct = 0.10;
    citations.push(
      "42 Pa.C.S. § 21107: Sheriff poundage 2% up to $250k + 0.5% on excess.",
      "72 P.S. § 8102-C: PA Realty Transfer Tax (1% state + 1% typical local municipal/school)."
    );
  } else if (st === "NC") {
    scheduleLabel = "North Carolina Judicial / Trustee Schedule (N.C.G.S. § 45-21.15 & § 105-228.30)";
    sheriffPoundage = Math.min(Math.round(price * 0.05), 25000);
    transferTax = Math.round(price / 500);
    defaultDepositPct = 0.05;
    citations.push(
      "N.C.G.S. § 45-21.15: Trustee/commissioner statutory commission cap (up to 5%).",
      "N.C.G.S. § 105-228.30: NC Excise Tax $1.00 per $500 ($2.00 per $1,000).",
      "N.C.G.S. § 45-21.27: 5% minimum deposit ($750 floor) for judicial/upset bids."
    );
  } else if (st === "TX") {
    scheduleLabel = "Texas Constable / Trustee Schedule (Tex. Civ. Prac. & Rem. Code)";
    sheriffPoundage = 0;
    transferTax = 0;
    defaultDepositPct = 0.10;
    citations.push(
      "Texas Const. art. VIII § 29: $0 state real estate transfer tax.",
      "Tex. Local Gov't Code § 118.011: County clerk recording fee ($34 typical baseline).",
      "Tex. Tax Code § 34.015: Purchaser tax certificate required before deed execution."
    );
  } else if (st === "CA") {
    scheduleLabel = "California Non-Judicial Trustee Schedule (Cal. Civ. Code § 2924h & § 2924m; Rev. & Tax Code § 11911)";
    sheriffPoundage = Math.min(Math.round(price * 0.01), 1500);
    transferTax = Math.round((price / 1000) * 1.10);
    defaultDepositPct = 0.10;
    citations.push(
      "Cal. Civ. Code § 2924h: 100% cashier's check / certified funds requirement at trustee sale.",
      "Cal. Rev. & Tax Code § 11911: County documentary transfer tax ($1.10 per $1,000 baseline).",
      "Cal. Civ. Code § 2924m (SB 1079): 45-day post-sale eligible bidder window on 1-4 unit residential."
    );
  } else if (st === "GA") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      src.includes("tax")
    );
    if (isTax) {
      scheduleLabel = "Georgia First Tuesday Tax Deed Schedule (O.C.G.A. § 48-4-1 et seq. & § 48-4-40)";
      sheriffPoundage = 0;
      transferTax = Math.round(price / 1000);
      defaultDepositPct = 0.20;
      citations.push(
        "O.C.G.A. § 48-4-1: County tax commissioner / sheriff first Tuesday tax execution sale.",
        "O.C.G.A. § 48-4-40: 12-month (365 days) statutory right of redemption with 20% statutory penalty in Year 1.",
        "O.C.G.A. § 48-4-45: Mandatory barment of redemption notice after 12 months to ripen fee simple title.",
        "O.C.G.A. § 48-6-1: Georgia Real Estate Transfer Tax ($1.00 per $1,000 of consideration)."
      );
    } else {
      scheduleLabel = "Georgia Non-Judicial Foreclosure Schedule (O.C.G.A. § 44-14-162 & § 48-6-1)";
      sheriffPoundage = 0;
      transferTax = Math.round(price / 1000);
      defaultDepositPct = 0.10;
      citations.push(
        "O.C.G.A. § 44-14-162: Non-judicial foreclosure under power of sale (first Tuesday auction; 0-day post-sale redemption).",
        "O.C.G.A. § 48-6-1: Georgia Real Estate Transfer Tax ($1.00 per $1,000 of consideration)."
      );
    }
  } else if (st === "IL") {
    scheduleLabel = "Illinois Judicial Mortgage Foreclosure Schedule (735 ILCS 5/15-1507 & 35 ILCS 200/31-10)";
    sheriffPoundage = Math.min(Math.round(price * 0.01), 1000);
    transferTax = Math.round((price / 1000) * 1.50);
    defaultDepositPct = 0.10;
    citations.push(
      "735 ILCS 5/15-1507(e): Sheriff or designated selling officer statutory fee schedule.",
      "35 ILCS 200/31-10: Combined state ($1.00/k) and county ($0.50/k) real estate transfer stamps.",
      "735 ILCS 5/15-1508: Mandatory judicial confirmation of sale before deed delivery."
    );
  } else if (st === "NY") {
    scheduleLabel = "New York Judicial Referee Schedule (RPAPL § 1354 & CPLR § 8003(b))";
    sheriffPoundage = Math.min(Math.round(price * 0.01), 1100);
    transferTax = Math.round((price / 500) * 2.00);
    defaultDepositPct = 0.10;
    citations.push(
      "RPAPL § 1354: Distribution of mortgage foreclosure sale proceeds and referee deed.",
      "CPLR § 8003(b): Statutory referee compensation cap on mortgage foreclosure sales ($750–$1,100).",
      "NY Tax Law § 1402: NY State Real Estate Transfer Tax ($2.00 per $500 / $4.00 per $1,000)."
    );
  } else if (st === "MI") {
    scheduleLabel = "Michigan Sheriff Foreclosure Schedule (MCL § 600.2558 & § 207.525)";
    sheriffPoundage = Math.min(Math.round(price * 0.005), 500);
    transferTax = Math.round((price / 1000) * 4.30);
    defaultDepositPct = 0.10;
    citations.push(
      "MCL § 600.2558: Sheriff statutory foreclosure sale fee schedule.",
      "MCL § 207.505 & § 207.525: Combined state ($3.75/k) and county ($0.55/k) transfer tax ($4.30/k).",
      "MCL § 600.3240: Statutory post-sale redemption period (6 months standard, 1 month if abandoned)."
    );
  } else if (st === "NV") {
    scheduleLabel = "Nevada Non-Judicial Trustee Schedule (NRS 107.080 & NRS 375.020)";
    sheriffPoundage = 0;
    transferTax = Math.round((price / 500) * 1.95);
    defaultDepositPct = 0.10;
    citations.push(
      "NRS 107.080: Non-judicial trustee power of sale (0 days post-sale redemption).",
      "NRS 375.020: Real Property Transfer Tax ($1.95 per $500 / $3.90 per $1,000 baseline).",
      "NRS 116.3116: 9-month HOA super-priority assessment primes first deed of trust."
    );
  } else if (st === "TN") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      src.includes("tax")
    );
    if (isTax) {
      scheduleLabel = "Tennessee Chancery / County Tax Sale Schedule (T.C.A. § 67-5-2701 & § 67-4-409)";
      sheriffPoundage = 0;
      transferTax = Math.round((price / 1000) * 3.70);
      defaultDepositPct = 0.10;
      citations.push(
        "T.C.A. § 67-5-2701: 365-day (1 year) statutory tax sale right of redemption with 12% per annum interest.",
        "T.C.A. § 67-4-409: Tennessee state recordation/transfer tax ($0.37 per $100 / $3.70 per $1,000)."
      );
    } else {
      scheduleLabel = "Tennessee Deed of Trust Foreclosure Schedule (T.C.A. § 35-5-101 & § 67-4-409)";
      sheriffPoundage = 0;
      transferTax = Math.round((price / 1000) * 3.70);
      defaultDepositPct = 0.10;
      citations.push(
        "T.C.A. § 35-5-101: Non-judicial deed of trust sale under power (0-day post-sale redemption when waived in deed of trust).",
        "T.C.A. § 67-4-409: Tennessee state recordation/transfer tax ($0.37 per $100 / $3.70 per $1,000)."
      );
    }
  } else if (st === "WA") {
    scheduleLabel = "Washington State Non-Judicial & Tax Foreclosure Schedule (RCW 61.24 & RCW 82.45)";
    sheriffPoundage = 0;
    transferTax = Math.round((price / 1000) * 16.00); // 1.6% combined state & local REET baseline
    defaultDepositPct = 0.10;
    citations.push(
      "RCW 61.24.040: Non-judicial trustee sale under deed of trust (0-day post-sale redemption).",
      "RCW 84.64.080: County tax foreclosure deed sale (immediate deed execution; 30-day appeal window under RCW 84.64.120).",
      "RCW 82.45.060: Washington Real Estate Excise Tax (REET) (1.10% state baseline + 0.50% local typical)."
    );
  } else if (st === "MD") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      src.includes("tax")
    );
    if (isTax) {
      scheduleLabel = "Maryland Tax Sale Certificate Auction Schedule (Md. Code Tax-Prop. § 14-827 & § 13-203)";
      sheriffPoundage = 0;
      transferTax = Math.round((price / 1000) * 5.00);
      defaultDepositPct = 0.10;
      citations.push(
        "Md. Code Tax-Prop. § 14-827: 180-day (6-month) statutory redemption period before bill to foreclose right of redemption.",
        "Md. Code Tax-Prop. § 14-820: County statutory interest rate on tax certificate redemption (12% to 20% typical).",
        "Md. Code Tax-Prop. § 13-203: Maryland state transfer tax (0.5% / $5.00 per $1,000)."
      );
    } else {
      scheduleLabel = "Maryland Judicial Foreclosure Schedule (Md. Rule 14-207 & § 13-203)";
      sheriffPoundage = 0;
      transferTax = Math.round((price / 1000) * 5.00);
      defaultDepositPct = 0.10;
      citations.push(
        "Md. Rule 14-215: Mandatory court ratification of foreclosure sale before deed delivery.",
        "Md. Code Tax-Prop. § 13-203: Maryland state transfer tax (0.5% / $5.00 per $1,000)."
      );
    }
  } else {
    transferTax = Math.round(price * 0.005);
    scheduleLabel = `${st || "State"} Statutory Baseline (Not Yet Modeled)`;
    citations.push(`Statutory fee preset unavailable for state ${st || "unknown"}. Baseline state recording/transfer assumption (0.5% of price); verify county fee schedule.`);
  }

  const parsedDeposit = parsePublishedDepositAmount(params.depositText, price);
  const creditedDeposit = parsedDeposit !== null ? parsedDeposit : Math.round(price * defaultDepositPct);
  if (parsedDeposit !== null) {
    citations.push(`Credited deposit parsed from published deposit terms (${params.depositText}).`);
  }

  return {
    state: st || "US",
    scheduleLabel,
    buyersPremium,
    sheriffPoundage,
    transferTax,
    creditedDeposit,
    registrationFunds: creditedDeposit,
    citations,
    supported: isSupported,
    notice: supportedNotice,
  };
}

export interface StatutoryDeadlinesAndCarry {
  saleDateIso: string | null;
  objectionOrConfirmationDays: number;
  objectionLabel: string | null;
  objectionDeadline: string | null;
  irsRedemptionDays: number;
  irsRedemptionDeadline: string | null;
  stateRedemptionDays: number;
  stateRedemptionDeadline: string | null;
  effectiveLockupDays: number;
  estimatedCarryCost: number | null;
  annualCostOfCapitalPct: number;
  effectiveTaxRatePct?: number;
  insuranceBaseRatePer1000?: number;
  estimatedPropertyTaxCarry?: number | null;
  estimatedInsuranceCarry?: number | null;
  totalHoldingCostCarry?: number | null;
  monthlyHoldingCost?: number | null;
  computedAt?: string;
}

function addDaysIso(baseDateStr: string | null | undefined, days: number): string | null {
  if (!baseDateStr || days <= 0) return null;
  const time = Date.parse(String(baseDateStr).slice(0, 10));
  if (!Number.isFinite(time)) return null;
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

export const EFFECTIVE_TAX_RATE_BY_STATE: Readonly<Record<string, number>> = {
  AL: 0.0041, AK: 0.0118, AZ: 0.0063, AR: 0.0064, CA: 0.0125, CO: 0.0051, CT: 0.0179, DE: 0.0058, DC: 0.0057, FL: 0.0089,
  GA: 0.0092, HI: 0.0029, ID: 0.0067, IL: 0.0200, IN: 0.0085, IA: 0.0152, KS: 0.0141, KY: 0.0086, LA: 0.0055, ME: 0.0124,
  MD: 0.0105, MA: 0.0114, MI: 0.0148, MN: 0.0112, MS: 0.0079, MO: 0.0097, MT: 0.0074, NE: 0.0163, NV: 0.0055, NH: 0.0186,
  NJ: 0.0223, NM: 0.0073, NY: 0.0140, NC: 0.0078, ND: 0.0098, OH: 0.0152, OK: 0.0090, OR: 0.0093, PA: 0.0149, RI: 0.0140,
  SC: 0.0057, SD: 0.0124, TN: 0.0066, TX: 0.0170, UT: 0.0058, VT: 0.0190, VA: 0.0082, WA: 0.0094, WV: 0.0059, WI: 0.0161, WY: 0.0061,
};

export const INSURANCE_BASE_RATE_PER_1000: Readonly<Record<string, number>> = {
  AK: 3.83, AL: 8.40, AR: 8.82, AZ: 3.43, CA: 2.79, CO: 5.78, CT: 4.68, DC: 3.66,
  DE: 3.29, FL: 10.37, GA: 6.24, HI: 2.34, IA: 8.56, ID: 2.99, IL: 8.95, IN: 7.00,
  KS: 12.73, KY: 7.15, LA: 13.53, MA: 3.85, MD: 4.07, ME: 3.72, MI: 4.82, MN: 6.89,
  MO: 9.15, MS: 10.77, MT: 3.83, NC: 4.39, ND: 8.17, NE: 10.96, NH: 2.96, NJ: 3.55,
  NM: 4.64, NV: 3.02, NY: 4.39, OH: 5.88, OK: 13.32, OR: 2.76, PA: 4.79, RI: 4.66,
  SC: 6.33, SD: 6.80, TN: 5.54, TX: 8.94, UT: 2.52, VA: 3.98, VT: 3.54, WA: 2.80,
  WI: 4.16, WV: 6.97, WY: 4.49,
};

export const DEFAULT_NATIONAL_INSURANCE_RATE_PER_1000 = 5.52;
export const DEFAULT_NATIONAL_TAX_RATE = 0.011;

export function computeStatutoryDeadlinesAndCarry(params: {
  saleDate?: string | null;
  state?: string | null;
  source?: string | null;
  distressType?: string | null;
  isTaxSale?: boolean;
  isHomestead?: boolean;
  purchasePrice?: number | string | null;
  redemptionDays?: number | null;
  hasIrsLien?: boolean;
  annualCostOfCapitalPct?: number;
  effectiveTaxRatePct?: number;
  insuranceBaseRatePer1000?: number;
  estimatedPropertyTaxCarry?: number | null;
  estimatedInsuranceCarry?: number | null;
  totalHoldingCostCarry?: number | null;
  monthlyHoldingCost?: number | null;
  computedAt?: string;
}): StatutoryDeadlinesAndCarry {
  const st = (params.state || "").trim().toUpperCase();
  const saleDateIso = params.saleDate && Number.isFinite(Date.parse(String(params.saleDate).slice(0, 10)))
    ? String(params.saleDate).slice(0, 10)
    : null;

  let objectionOrConfirmationDays = 0;
  let objectionLabel: string | null = null;
  if (st === "NC") {
    objectionOrConfirmationDays = 10;
    objectionLabel = "NC 10-day rolling upset-bid window (N.C.G.S. § 45-21.27)";
  } else if (st === "NJ") {
    objectionOrConfirmationDays = 10;
    objectionLabel = "NJ 10-day sheriff deed objection / redemption window (R. 4:65-5)";
  } else if (st === "FL") {
    objectionOrConfirmationDays = 10;
    objectionLabel = "FL 10-day Certificate of Title objection window (Fla. Stat. § 45.031(5))";
  } else if (st === "OH") {
    objectionOrConfirmationDays = 30;
    objectionLabel = "OH 30-day court confirmation & deed delivery window (ORC § 2329.31)";
  } else if (st === "CA") {
    objectionOrConfirmationDays = 45;
    objectionLabel = "CA 45-day post-sale eligible bidder intent & upset period (Cal. Civ. Code § 2924m / SB 1079)";
  } else if (st === "IL") {
    objectionOrConfirmationDays = 30;
    objectionLabel = "IL 30-day court confirmation of judicial sale (735 ILCS 5/15-1508)";
  } else if (st === "NY") {
    objectionOrConfirmationDays = 30;
    objectionLabel = "NY 30-day referee report of sale & deed delivery (RPAPL § 1354)";
  } else if (st === "MI") {
    objectionOrConfirmationDays = 0;
    objectionLabel = "MI non-judicial foreclosure by advertisement (MCL § 600.3201; post-sale redemption governs lockup)";
  } else if (st === "NV") {
    objectionOrConfirmationDays = 0;
    objectionLabel = "NV non-judicial deed of trust trustee sale (NRS 107.080; 0-day post-sale redemption)";
  } else if (st === "TX") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      objectionOrConfirmationDays = 20;
      objectionLabel = "TX 20-day constable deed processing & confirmation period (Tex. Tax Code § 34.01)";
    } else {
      objectionOrConfirmationDays = 0;
      objectionLabel = "TX non-judicial deed of trust sale (Tex. Prop. Code § 51.002; title passes upon deed delivery)";
    }
  } else if (st === "GA") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      objectionOrConfirmationDays = 30;
      objectionLabel = "GA 30-day tax deed execution & recording window (O.C.G.A. § 48-4-40 1-yr redemption applies)";
    } else {
      objectionOrConfirmationDays = 0;
      objectionLabel = "GA non-judicial foreclosure under power of sale (O.C.G.A. § 44-14-162; 0-day post-sale redemption)";
    }
  } else if (st === "TN") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      objectionOrConfirmationDays = 30;
      objectionLabel = "TN 30-day chancery court decree of confirmation window (T.C.A. § 67-5-2701 1-yr redemption applies)";
    } else {
      objectionOrConfirmationDays = 0;
      objectionLabel = "TN non-judicial deed of trust foreclosure under power of sale (T.C.A. § 35-5-101; 0-day redemption)";
    }
  } else if (st === "WA") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      objectionOrConfirmationDays = 30;
      objectionLabel = "WA 30-day tax foreclosure judgment appeal window (RCW 84.64.120; 0-day post-deed redemption)";
    } else {
      objectionOrConfirmationDays = 0;
      objectionLabel = "WA non-judicial trustee sale under deed of trust (RCW 61.24.040; 0-day post-sale redemption)";
    }
  } else if (st === "MD") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      objectionOrConfirmationDays = 30;
      objectionLabel = "MD 30-day tax certificate issuance window (Md. Code Tax-Prop. § 14-827 6-month redemption applies)";
    } else {
      objectionOrConfirmationDays = 30;
      objectionLabel = "MD 30-day circuit court order of ratification window (Md. Rule 14-215)";
    }
  } else if (st === "SC") {
    objectionOrConfirmationDays = 30;
    objectionLabel = "SC 30-day court confirmation & upset-bid window (S.C. Code Ann. § 15-39-720)";
  } else if (st === "VA") {
    objectionOrConfirmationDays = 0;
    objectionLabel = "VA non-judicial deed of trust foreclosure (Va. Code Ann. § 55.1-320; 0-day post-sale redemption)";
  } else if (st === "IN") {
    objectionOrConfirmationDays = 30;
    objectionLabel = "IN 30-day sheriff deed execution & recording window (Ind. Code § 32-29-7-3)";
  } else if (st === "MO") {
    objectionOrConfirmationDays = 0;
    objectionLabel = "MO non-judicial trustee foreclosure (Mo. Rev. Stat. § 443.410; 0-day redemption for 3rd-party)";
  } else if (st === "AZ") {
    objectionOrConfirmationDays = 0;
    objectionLabel = "AZ non-judicial trustee sale under deed of trust (A.R.S. § 33-807; 0-day post-sale redemption)";
  }

  const irsRedemptionDays = params.hasIrsLien ? 120 : 0;
  let stateRedemptionDays = Math.max(0, Math.round(nonNegativeNumber(params.redemptionDays) ?? 0));
  if (stateRedemptionDays === 0 && st === "TX") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      stateRedemptionDays = params.isHomestead ? 730 : 180;
    }
  } else if (stateRedemptionDays === 0 && st === "GA") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      stateRedemptionDays = 365;
    }
  } else if (stateRedemptionDays === 0 && st === "TN") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      stateRedemptionDays = 365;
    }
  } else if (stateRedemptionDays === 0 && st === "MD") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      stateRedemptionDays = 180;
    }
  } else if (stateRedemptionDays === 0 && st === "SC") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      stateRedemptionDays = 365;
    }
  } else if (stateRedemptionDays === 0 && st === "IN") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      stateRedemptionDays = 365;
    }
  } else if (stateRedemptionDays === 0 && st === "MO") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      stateRedemptionDays = 365;
    }
  } else if (stateRedemptionDays === 0 && st === "AZ") {
    const isTax = Boolean(
      params.isTaxSale ||
      params.distressType === "tax_sale" ||
      (typeof params.source === "string" && params.source.toLowerCase().includes("tax"))
    );
    if (isTax) {
      stateRedemptionDays = 1095; // 3 years under A.R.S. § 42-18153
    }
  }
  const effectiveLockupDays = Math.max(objectionOrConfirmationDays, irsRedemptionDays, stateRedemptionDays);
  const annualCostOfCapitalPct = nonNegativeNumber(params.annualCostOfCapitalPct) ?? 10;
  const price = positiveNumber(params.purchasePrice);
  const estimatedCarryCost = price !== null && effectiveLockupDays > 0
    ? Math.round(price * (annualCostOfCapitalPct / 100) * (effectiveLockupDays / 365))
    : null;

  const effTaxRate = params.effectiveTaxRatePct !== undefined
    ? (nonNegativeNumber(params.effectiveTaxRatePct) ?? 0) / 100
    : (EFFECTIVE_TAX_RATE_BY_STATE[st] ?? DEFAULT_NATIONAL_TAX_RATE);
  const insRatePer1000 = params.insuranceBaseRatePer1000 !== undefined
    ? (nonNegativeNumber(params.insuranceBaseRatePer1000) ?? 0)
    : (INSURANCE_BASE_RATE_PER_1000[st] ?? DEFAULT_NATIONAL_INSURANCE_RATE_PER_1000);

  const estimatedPropertyTaxCarry = price !== null && effectiveLockupDays > 0
    ? Math.round(price * effTaxRate * (effectiveLockupDays / 365))
    : null;
  const estimatedInsuranceCarry = price !== null && effectiveLockupDays > 0
    ? Math.round(price * (insRatePer1000 / 1000) * (effectiveLockupDays / 365))
    : null;
  const totalHoldingCostCarry = estimatedCarryCost !== null
    ? estimatedCarryCost + (estimatedPropertyTaxCarry ?? 0) + (estimatedInsuranceCarry ?? 0)
    : null;
  const monthlyHoldingCost = price !== null ? Math.round(price * (annualCostOfCapitalPct / 100 / 12) + price * (effTaxRate / 12) + price * (insRatePer1000 / 1000 / 12)) : null;

  return {
    saleDateIso,
    objectionOrConfirmationDays,
    objectionLabel,
    objectionDeadline: addDaysIso(saleDateIso, objectionOrConfirmationDays),
    irsRedemptionDays,
    irsRedemptionDeadline: addDaysIso(saleDateIso, irsRedemptionDays),
    stateRedemptionDays,
    stateRedemptionDeadline: addDaysIso(saleDateIso, stateRedemptionDays),
    effectiveLockupDays,
    estimatedCarryCost,
    effectiveTaxRatePct: Number((effTaxRate * 100).toFixed(2)),
    insuranceBaseRatePer1000: insRatePer1000,
    estimatedPropertyTaxCarry,
    estimatedInsuranceCarry,
    totalHoldingCostCarry,
    monthlyHoldingCost,
    annualCostOfCapitalPct,
    ...(params.computedAt ? { computedAt: params.computedAt } : {}),
  };
}

export interface LienWaterfallItem {
  id: string;
  name: string;
  type: "super_priority_tax" | "first_mortgage" | "second_mortgage" | "heloc" | "hoa_assessment" | "mechanic_lien" | "judgment_creditor" | "tax_deed" | "other";
  amount: number;
  seniority: number;
  isForeclosingLien: boolean;
  status: "survives_against_purchaser" | "satisfied_from_proceeds" | "partially_satisfied_from_proceeds" | "extinguished_unpaid";
  amountPaidFromProceeds: number;
  remainingBalanceAgainstProperty: number;
}

export interface LienWaterfallResult {
  winningBidAmount: number;
  totalSurvivingDebtOnProperty: number;
  totalEffectiveAcquisitionCost: number;
  surplusProceedsToBorrower: number;
  items: LienWaterfallItem[];
  criticalAlert: string | null;
  summary: string;
}

export function computeLienWaterfall(params: {
  winningBid: number;
  foreclosingLienType: "first_mortgage" | "second_mortgage" | "heloc" | "hoa_assessment" | "tax_deed" | "mechanic_lien";
  foreclosingLienAmount: number;
  delinquentTaxesAmount?: number;
  seniorMortgageAmount?: number;
  subordinateLiens?: Array<{ name: string; amount: number; type?: string }>;
  state?: string;
}): LienWaterfallResult {
  const winningBid = Math.max(0, Number(params.winningBid) || 0);
  const foreclosingAmount = Math.max(0, Number(params.foreclosingLienAmount) || 0);
  const delinquentTaxes = Math.max(0, Number(params.delinquentTaxesAmount) || 0);
  const seniorMortgage = Math.max(0, Number(params.seniorMortgageAmount || (params.foreclosingLienType === "first_mortgage" ? params.foreclosingLienAmount : 0)) || 0);
  const isJuniorForeclosure = params.foreclosingLienType === "second_mortgage" ||
    params.foreclosingLienType === "heloc" ||
    params.foreclosingLienType === "hoa_assessment" ||
    params.foreclosingLienType === "mechanic_lien";

  const items: LienWaterfallItem[] = [];
  let availableProceeds = winningBid;
  let totalSurvivingDebt = 0;
  let criticalAlert: string | null = null;

  if (delinquentTaxes > 0) {
    const paidTaxes = Math.min(availableProceeds, delinquentTaxes);
    availableProceeds -= paidTaxes;
    const remainingTaxes = delinquentTaxes - paidTaxes;
    if (remainingTaxes > 0) {
      totalSurvivingDebt += remainingTaxes;
    }
    items.push({
      id: "tax-lien-01",
      name: "Ad Valorem County/Municipal Real Property Taxes",
      type: "super_priority_tax",
      amount: delinquentTaxes,
      seniority: 1,
      isForeclosingLien: params.foreclosingLienType === "tax_deed",
      status: remainingTaxes > 0 ? "survives_against_purchaser" : "satisfied_from_proceeds",
      amountPaidFromProceeds: paidTaxes,
      remainingBalanceAgainstProperty: remainingTaxes,
    });
  }

  if (seniorMortgage > 0) {
    if (isJuniorForeclosure) {
      totalSurvivingDebt += seniorMortgage;
      criticalAlert = `CRITICAL WARNING: Junior ${params.foreclosingLienType.replace("_", " ").toUpperCase()} foreclosure. The senior 1st mortgage ($${seniorMortgage.toLocaleString()}) SURVIVES against the purchaser! Your true effective acquisition cost is your bid plus this surviving senior mortgage.`;
      items.push({
        id: "senior-mtg-01",
        name: "Senior First Mortgage / Deed of Trust",
        type: "first_mortgage",
        amount: seniorMortgage,
        seniority: 2,
        isForeclosingLien: false,
        status: "survives_against_purchaser",
        amountPaidFromProceeds: 0,
        remainingBalanceAgainstProperty: seniorMortgage,
      });
    } else {
      const paidSenior = Math.min(availableProceeds, seniorMortgage);
      availableProceeds -= paidSenior;
      const unpaidSenior = seniorMortgage - paidSenior;
      items.push({
        id: "foreclosing-mtg-01",
        name: "Foreclosing First Mortgage (Senior Deed of Trust)",
        type: "first_mortgage",
        amount: seniorMortgage,
        seniority: 2,
        isForeclosingLien: true,
        status: unpaidSenior === 0 ? "satisfied_from_proceeds" : "partially_satisfied_from_proceeds",
        amountPaidFromProceeds: paidSenior,
        remainingBalanceAgainstProperty: 0,
      });
    }
  }

  if (isJuniorForeclosure && foreclosingAmount > 0) {
    const paidForeclosing = Math.min(availableProceeds, foreclosingAmount);
    availableProceeds -= paidForeclosing;
    const unpaidForeclosing = foreclosingAmount - paidForeclosing;
    items.push({
      id: "foreclosing-lien-01",
      name: `Foreclosing Lien (${params.foreclosingLienType.replace("_", " ").toUpperCase()})`,
      type: params.foreclosingLienType,
      amount: foreclosingAmount,
      seniority: 3,
      isForeclosingLien: true,
      status: unpaidForeclosing === 0 ? "satisfied_from_proceeds" : "partially_satisfied_from_proceeds",
      amountPaidFromProceeds: paidForeclosing,
      remainingBalanceAgainstProperty: 0,
    });
  }

  if (Array.isArray(params.subordinateLiens) && params.subordinateLiens.length > 0) {
    params.subordinateLiens.forEach((sub, idx) => {
      const subAmount = Math.max(0, Number(sub.amount) || 0);
      const paidSub = Math.min(availableProceeds, subAmount);
      availableProceeds -= paidSub;
      const unpaidSub = subAmount - paidSub;
      items.push({
        id: `subordinate-lien-${idx + 1}`,
        name: sub.name || `Subordinate Lien #${idx + 1}`,
        type: (sub.type as LienWaterfallItem["type"]) || "second_mortgage",
        amount: subAmount,
        seniority: 4 + idx,
        isForeclosingLien: false,
        status: unpaidSub === 0 ? "satisfied_from_proceeds" : (paidSub > 0 ? "partially_satisfied_from_proceeds" : "extinguished_unpaid"),
        amountPaidFromProceeds: paidSub,
        remainingBalanceAgainstProperty: 0,
      });
    });
  }

  const surplusProceedsToBorrower = availableProceeds;
  const totalEffectiveAcquisitionCost = winningBid + totalSurvivingDebt;

  const summary = totalSurvivingDebt > 0
    ? `Winning bid of $${winningBid.toLocaleString()} leaves $${totalSurvivingDebt.toLocaleString()} in surviving priority debt on the property. Total effective acquisition: $${totalEffectiveAcquisitionCost.toLocaleString()}.`
    : `Winning bid of $${winningBid.toLocaleString()} fully extinguishes all noticed subordinate mortgages and liens. Zero surviving lien debt against the purchaser.${surplusProceedsToBorrower > 0 ? ` Surplus proceeds of $${surplusProceedsToBorrower.toLocaleString()} to debtor.` : ""}`;

  return {
    winningBidAmount: winningBid,
    totalSurvivingDebtOnProperty: totalSurvivingDebt,
    totalEffectiveAcquisitionCost,
    surplusProceedsToBorrower,
    items,
    criticalAlert,
    summary,
  };
}


// ============================================================================
// CONSTITUTIONAL SURPLUS ENGINE (Tyler v. Hennepin / Pung v. Isabella)
// ============================================================================

export interface ConstitutionalSurplusResult {
  bidAmount: number | null;
  taxDebtAmount: number | null;
  estimatedSurplus: number | null;
  effectiveSurplusRatio: number | null;
  doctrine: "Tyler_v_Hennepin_2023_Pung_v_Isabella_2026";
  status: "surplus_likely" | "no_surplus_underwater" | "indeterminate_inputs";
  statutoryDisclaimer: string;
  explanation: string;
}

export function computeConstitutionalSurplus(params: {
  openingBid?: number | string | null;
  judgmentDebt?: number | string | null;
  adminFeeRatePct?: number | string | null;
  state?: string | null;
} = {}): ConstitutionalSurplusResult {
  const bidAmount = positiveNumber(params.openingBid);
  const taxDebtAmount = positiveNumber(params.judgmentDebt);
  const adminFeeRate = nonNegativeNumber(params.adminFeeRatePct) ?? 10;

  const statutoryDisclaimer =
    "Per Tyler v. Hennepin County (2023) and Pung v. Isabella County (2026), excess auction proceeds above delinquent tax debt, interest, and statutory administrative costs belong to the prior owner. Taxing jurisdictions cannot retain surplus equity. Claim procedures and response windows vary by state.";

  if (bidAmount === null || taxDebtAmount === null) {
    return {
      bidAmount,
      taxDebtAmount,
      estimatedSurplus: null,
      effectiveSurplusRatio: null,
      doctrine: "Tyler_v_Hennepin_2023_Pung_v_Isabella_2026",
      status: "indeterminate_inputs",
      statutoryDisclaimer,
      explanation: "Surplus proceeds cannot be determined without both a verified bid/sale price and the explicit delinquent debt amount.",
    };
  }

  if (bidAmount <= taxDebtAmount) {
    return {
      bidAmount,
      taxDebtAmount,
      estimatedSurplus: 0,
      effectiveSurplusRatio: 0,
      doctrine: "Tyler_v_Hennepin_2023_Pung_v_Isabella_2026",
      status: "no_surplus_underwater",
      statutoryDisclaimer,
      explanation: `Bid ($${bidAmount.toLocaleString()}) does not exceed delinquent tax debt ($${taxDebtAmount.toLocaleString()}). No surplus proceeds are generated.`,
    };
  }

  const rawDifference = bidAmount - taxDebtAmount;
  const allowableFee = Math.round((rawDifference * adminFeeRate) / 100);
  const estimatedSurplus = Math.max(0, rawDifference - allowableFee);
  const effectiveSurplusRatio = Number((estimatedSurplus / bidAmount).toFixed(4));

  return {
    bidAmount,
    taxDebtAmount,
    estimatedSurplus,
    effectiveSurplusRatio,
    doctrine: "Tyler_v_Hennepin_2023_Pung_v_Isabella_2026",
    status: "surplus_likely",
    statutoryDisclaimer,
    explanation: `Estimated constitutional surplus of $${estimatedSurplus.toLocaleString()} (after ${adminFeeRate}% administrative cost allowance of $${allowableFee.toLocaleString()}) payable to former owner.`,
  };
}

// ============================================================================
// STATE-SPECIFIC PROPERTY TAX REASSESSMENT SHOCK ENGINE
// ============================================================================

export interface StateReassessmentRule {
  state: string;
  ruleName: string;
  effectiveTaxRatePct: number;
  annualCapPct: number | null;
  resetsOnSale: boolean;
  supplementalBillExpected: boolean;
  statutoryReference: string;
}

export const STATE_REASSESSMENT_RULES: Record<string, StateReassessmentRule> = Object.freeze({
  CA: {
    state: "CA",
    ruleName: "CA_PROP_13",
    effectiveTaxRatePct: 1.25,
    annualCapPct: 2,
    resetsOnSale: true,
    supplementalBillExpected: true,
    statutoryReference: "CA BOE Prop 13 (Article XIIIA); calstatepayer 2026",
  },
  TX: {
    state: "TX",
    ruleName: "TX_MARKET_RESET",
    effectiveTaxRatePct: 1.70,
    annualCapPct: 20,
    resetsOnSale: true,
    supplementalBillExpected: false,
    statutoryReference: "TX Comptroller Property Tax Assistance; Tax Code §23.231",
  },
  FL: {
    state: "FL",
    ruleName: "FL_PURCHASE_RESET",
    effectiveTaxRatePct: 0.89,
    annualCapPct: 10,
    resetsOnSale: true,
    supplementalBillExpected: false,
    statutoryReference: "FL Dept. of Revenue; §193.1554 non-homestead cap",
  },
  NJ: {
    state: "NJ",
    ruleName: "NJ_RESET",
    effectiveTaxRatePct: 2.23,
    annualCapPct: null,
    resetsOnSale: true,
    supplementalBillExpected: true,
    statutoryReference: "NJ Treasury Division of Taxation; municipal revaluation cycles",
  },
  NY: {
    state: "NY",
    ruleName: "NY_RESET",
    effectiveTaxRatePct: 1.40,
    annualCapPct: null,
    resetsOnSale: true,
    supplementalBillExpected: false,
    statutoryReference: "NY ORPTS; STAR exemption owner-occupied only",
  },
  IL: {
    state: "IL",
    ruleName: "IL_RESET",
    effectiveTaxRatePct: 2.10,
    annualCapPct: null,
    resetsOnSale: true,
    supplementalBillExpected: false,
    statutoryReference: "IL Dept. of Revenue; fair market value reassessment on sale",
  },
  DEFAULT: {
    state: "US",
    ruleName: "NATIONAL_MEDIAN_TRANSFER",
    effectiveTaxRatePct: 1.15,
    annualCapPct: null,
    resetsOnSale: true,
    supplementalBillExpected: false,
    statutoryReference: "U.S. Census Bureau ACS 5-Year National Median Real Estate Tax Rate",
  },
});

export interface ReassessmentShockResult {
  purchasePrice: number | null;
  state: string;
  priorAnnualTax: number | null;
  reassessedAnnualTax: number | null;
  annualTaxShock: number | null;
  monthlyTaxShock: number | null;
  supplementalBillEstimate: number | null;
  rule: StateReassessmentRule;
  explanation: string;
}

export function computeReassessmentShock(params: {
  purchasePrice?: number | string | null;
  state?: string | null;
  priorAnnualTax?: number | string | null;
  overrideTaxRatePct?: number | string | null;
} = {}): ReassessmentShockResult {
  const purchasePrice = positiveNumber(params.purchasePrice);
  const stateCode = (params.state || "").trim().toUpperCase();
  const rule = STATE_REASSESSMENT_RULES[stateCode] || STATE_REASSESSMENT_RULES.DEFAULT;
  const priorAnnualTax = nonNegativeNumber(params.priorAnnualTax);
  const effectiveRate = positiveNumber(params.overrideTaxRatePct) ?? rule.effectiveTaxRatePct;

  if (purchasePrice === null) {
    return {
      purchasePrice: null,
      state: stateCode || "US",
      priorAnnualTax,
      reassessedAnnualTax: null,
      annualTaxShock: null,
      monthlyTaxShock: null,
      supplementalBillEstimate: null,
      rule,
      explanation: "Reassessment tax shock requires an explicit purchase price or winning bid assumption.",
    };
  }

  const reassessedAnnualTax = Math.round((purchasePrice * effectiveRate) / 100);
  const annualTaxShock = priorAnnualTax !== null ? reassessedAnnualTax - priorAnnualTax : null;
  const monthlyTaxShock = annualTaxShock !== null ? Math.round(annualTaxShock / 12) : null;
  const supplementalBillEstimate = rule.supplementalBillExpected && annualTaxShock !== null && annualTaxShock > 0
    ? Math.round((annualTaxShock / 12) * 6)
    : null;

  let explanation = `${rule.ruleName}: Purchase price ($${purchasePrice.toLocaleString()}) establishes new tax basis at ~${effectiveRate}% effective rate ($${reassessedAnnualTax.toLocaleString()}/year).`;
  if (priorAnnualTax !== null) {
    if (annualTaxShock! > 0) {
      explanation += ` Tax shock increase of +$${annualTaxShock!.toLocaleString()}/year (+$${monthlyTaxShock!.toLocaleString()}/mo) over prior owner bill ($${priorAnnualTax.toLocaleString()}/yr).`;
      if (supplementalBillEstimate !== null) {
        explanation += ` Estimated supplemental bill of ~$${supplementalBillEstimate.toLocaleString()} expected 3-9 months post-closing.`;
      }
    } else {
      explanation += ` Reassessed bill ($${reassessedAnnualTax.toLocaleString()}/yr) is at or below prior bill ($${priorAnnualTax.toLocaleString()}/yr).`;
    }
  }

  return {
    purchasePrice,
    state: stateCode || "US",
    priorAnnualTax,
    reassessedAnnualTax,
    annualTaxShock,
    monthlyTaxShock,
    supplementalBillEstimate,
    rule,
    explanation,
  };
}

// ============================================================================
// DSCR FINANCING & DEBT SERVICE COVERAGE ENGINE
// ============================================================================

export interface DscrCoverageResult {
  monthlyGrossRent: number | null;
  monthlyPitia: number | null;
  dscrRatio: number | null;
  minDscrTarget: number;
  meetsMinDscr: boolean;
  excessCashFlowMonthly: number | null;
  maxPitiaAllowedAtTarget: number | null;
  status: "qualified" | "stressed" | "deficient" | "insufficient_inputs";
  explanation: string;
}

export function computeDscrCoverage(params: {
  monthlyGrossRent?: number | string | null;
  monthlyPrincipalInterest?: number | string | null;
  monthlyReassessedTax?: number | string | null;
  monthlyInsurance?: number | string | null;
  monthlyHoa?: number | string | null;
  minDscrTarget?: number | string | null;
} = {}): DscrCoverageResult {
  const rent = positiveNumber(params.monthlyGrossRent);
  const pi = nonNegativeNumber(params.monthlyPrincipalInterest);
  const tax = nonNegativeNumber(params.monthlyReassessedTax);
  const ins = nonNegativeNumber(params.monthlyInsurance);
  const hoa = nonNegativeNumber(params.monthlyHoa) ?? 0;
  const minTarget = positiveNumber(params.minDscrTarget) ?? 1.20;

  if (rent === null || pi === null || tax === null || ins === null) {
    return {
      monthlyGrossRent: rent,
      monthlyPitia: null,
      dscrRatio: null,
      minDscrTarget: minTarget,
      meetsMinDscr: false,
      excessCashFlowMonthly: null,
      maxPitiaAllowedAtTarget: null,
      status: "insufficient_inputs",
      explanation: "DSCR calculation requires explicit qualifying rent, debt service (P&I), reassessed tax, and insurance.",
    };
  }

  const monthlyPitia = Math.round(pi + tax + ins + hoa);
  if (monthlyPitia <= 0) {
    return {
      monthlyGrossRent: rent,
      monthlyPitia: 0,
      dscrRatio: null,
      minDscrTarget: minTarget,
      meetsMinDscr: false,
      excessCashFlowMonthly: rent,
      maxPitiaAllowedAtTarget: Math.round(rent / minTarget),
      status: "insufficient_inputs",
      explanation: "PITIA must be greater than zero to compute DSCR.",
    };
  }

  const dscrRatio = Number((rent / monthlyPitia).toFixed(3));
  const meetsMinDscr = dscrRatio >= minTarget;
  const excessCashFlowMonthly = Math.round(rent - monthlyPitia);
  const maxPitiaAllowedAtTarget = Math.round(rent / minTarget);

  let status: DscrCoverageResult["status"];
  let explanation: string;

  if (dscrRatio >= minTarget) {
    status = "qualified";
    explanation = `DSCR of ${dscrRatio.toFixed(2)}x exceeds the ${minTarget.toFixed(2)}x requirement with positive monthly cash flow of $${excessCashFlowMonthly.toLocaleString()}/mo.`;
  } else if (dscrRatio >= 1.0) {
    status = "stressed";
    explanation = `DSCR of ${dscrRatio.toFixed(2)}x covers debt service but falls short of the ${minTarget.toFixed(2)}x investor guideline. Maximum permitted PITIA is $${maxPitiaAllowedAtTarget.toLocaleString()}/mo.`;
  } else {
    status = "deficient";
    explanation = `DSCR of ${dscrRatio.toFixed(2)}x is underwater (negative cash flow of $${Math.abs(excessCashFlowMonthly).toLocaleString()}/mo). PITIA exceeds gross rent.`;
  }

  return {
    monthlyGrossRent: rent,
    monthlyPitia,
    dscrRatio,
    minDscrTarget: minTarget,
    meetsMinDscr,
    excessCashFlowMonthly,
    maxPitiaAllowedAtTarget,
    status,
    explanation,
  };
}

// ============================================================================
// STRATEGY CLASSIFICATION ENGINE
// ============================================================================

export type StrategyTag = "wholesale" | "owner_occupy" | "brrrr" | "rental" | "flip";

export interface StrategyClassificationResult {
  strategies: StrategyTag[];
  equitySpreadDollars: number | null;
  equitySpreadPct: number | null;
  criteriaNotes: string[];
}

export function classifyInvestmentStrategies(params: {
  purchasePrice?: number | string | null;
  estimatedValueLow?: number | string | null;
  hasSaleDate?: boolean;
  dscrRatio?: number | null;
} = {}): StrategyClassificationResult {
  const price = positiveNumber(params.purchasePrice);
  const valLow = positiveNumber(params.estimatedValueLow);
  const hasSaleDate = Boolean(params.hasSaleDate);
  const dscr = finiteNumber(params.dscrRatio);

  if (price === null || valLow === null || valLow <= 0) {
    return {
      strategies: [],
      equitySpreadDollars: null,
      equitySpreadPct: null,
      criteriaNotes: ["Requires both purchase price and conservative valuation estimate to classify investment exit strategies."],
    };
  }

  const spreadDollars = Math.max(0, valLow - price);
  const spreadPct = Number((spreadDollars / valLow).toFixed(4));
  const strategies: StrategyTag[] = [];
  const notes: string[] = [];

  if (price <= 400000 && spreadPct >= 0.10) {
    strategies.push("owner_occupy");
    notes.push(`Owner-occupy viable: price $${price.toLocaleString()} is within affordable loan bounds with ${(spreadPct * 100).toFixed(1)}% equity spread.`);
  }

  if (spreadPct >= 0.30) {
    strategies.push("brrrr");
    notes.push(`BRRRR candidate: ${(spreadPct * 100).toFixed(1)}% discount provides substantial margin for rehab and cash-out refinancing.`);
  }

  if ((dscr !== null && dscr >= 1.20) || spreadPct >= 0.20) {
    strategies.push("rental");
    notes.push(`Rental cash-flow candidate: ${(spreadPct * 100).toFixed(1)}% equity spread${dscr ? ` and ${dscr}x DSCR` : ""}.`);
  }

  if (spreadPct >= 0.20) {
    strategies.push("wholesale");
    notes.push(`Wholesale viable: $${spreadDollars.toLocaleString()} gross spread gives ample room for assignment fee.`);
  }

  if (spreadPct >= 0.25 && hasSaleDate) {
    strategies.push("flip");
    notes.push(`Fix-and-flip viable: ${(spreadPct * 100).toFixed(1)}% equity spread with fixed auction sale date for timeline planning.`);
  }

  return {
    strategies,
    equitySpreadDollars: spreadDollars,
    equitySpreadPct: spreadPct,
    criteriaNotes: notes,
  };
}


export type RedemptionRegime =
  | "redeemable_deed_flat_penalty"
  | "redeemable_deed_or_lien_interest"
  | "post_redemption_deed";

export function getTaxInstrumentBadge(state?: string | null, regime?: RedemptionRegime | null): string {
  const st = (state || "").trim().toUpperCase();
  if (["GA", "TX", "TN"].includes(st)) return "Redeemable Tax Deed";
  if (["AZ", "MD", "SC", "IN"].includes(st)) return "Tax Lien Certificate";
  if (["FL", "MI", "WA"].includes(st)) return "Post-Redemption Fee-Simple Deed";
  if (regime === "post_redemption_deed") return "Post-Redemption Fee-Simple Deed";
  if (regime === "redeemable_deed_flat_penalty") return "Redeemable Tax Deed";
  return "Tax Lien Certificate";
}

export interface StatutoryRedemptionYield {
  purchasePrice: number;
  state: string;
  redemptionDays: number;
  statutoryRatePct: number;
  regime: RedemptionRegime;
  yieldType: "penalty" | "interest";
  isFlatPenalty: boolean;
  isAnnualInterest: boolean;
  effectiveYieldPct: number;
  grossProceeds: number;
  netReturn: number;
  netStatutoryReturn: number;
  annualizedIrrPct: number;
  statutoryCitation: string;
  instrumentBadge: string;
}

/**
 * Calculates statutory tax sale redemption yield for investors holding tax deeds/certificates
 * during the statutory redemption period.
 *
 * Classifies statutory redemption into three distinct statutory regimes:
 *  A. redeemable_deed_flat_penalty (GA, TX, SC)
 *  B. redeemable_deed_or_lien_interest (TN, AZ, MD, IN)
 *  C. post_redemption_deed (FL, MI, WA - 0 post-sale redemption days)
 */
export function computeRedemptionYield(params: {
  purchasePrice: number | string | null;
  state?: string | null;
  redemptionDays?: number | null;
  isTaxSale?: boolean | null;
  isHomestead?: boolean | null;
}): StatutoryRedemptionYield | null {
  const price = positiveNumber(params.purchasePrice);
  if (price === null) return null;
  const st = (params.state || "").trim().toUpperCase();

  const callerPassedDays = params.redemptionDays !== undefined && params.redemptionDays !== null;
  const passedDays = callerPassedDays ? Math.max(0, Math.round(nonNegativeNumber(params.redemptionDays) ?? 0)) : null;

  let days = 365;
  let statutoryRatePct = 0;
  let regime: RedemptionRegime = "redeemable_deed_or_lien_interest";
  let yieldType: "penalty" | "interest" = "interest";
  let isFlatPenalty = false;
  let isAnnualInterest = false;
  let statutoryCitation = "Generic statutory interest baseline";
  let effectiveYieldPct = 0;

  if (st === "GA") {
    regime = "redeemable_deed_flat_penalty";
    yieldType = "penalty";
    isFlatPenalty = true;
    isAnnualInterest = false;
    days = passedDays !== null ? passedDays : 365;
    statutoryRatePct = days > 365 ? 40 : 20;
    effectiveYieldPct = statutoryRatePct;
    statutoryCitation = "O.C.G.A. § 48-4-42: " + (days > 365 ? "40% statutory penalty in year two" : "20% statutory penalty in year one") + " on tax deed redemption.";
  } else if (st === "TX") {
    regime = "redeemable_deed_flat_penalty";
    yieldType = "penalty";
    isFlatPenalty = true;
    isAnnualInterest = false;
    const isHomestead = Boolean(params.isHomestead || (passedDays !== null && passedDays === 730));
    if (passedDays !== null) {
      days = passedDays;
    } else if (isHomestead) {
      days = 730;
    } else {
      days = 180;
    }
    if (isHomestead) {
      statutoryRatePct = days > 365 ? 50 : 25;
      statutoryCitation = "Tex. Tax Code § 34.21(a): " + (days > 365 ? "50% statutory penalty in year two (days 366-730)" : "25% statutory penalty in year one") + " on residence homestead / agricultural land tax deed redemption.";
    } else {
      statutoryRatePct = 25;
      statutoryCitation = "Tex. Tax Code § 34.21(e): 25% flat statutory redemption penalty (180-day redemption period) on non-homestead tax deed redemption.";
    }
    effectiveYieldPct = statutoryRatePct;
  } else if (st === "SC") {
    regime = "redeemable_deed_flat_penalty";
    yieldType = "penalty";
    isFlatPenalty = true;
    isAnnualInterest = false;
    days = passedDays !== null ? passedDays : 365;
    if (days <= 90) {
      statutoryRatePct = 3;
    } else if (days <= 180) {
      statutoryRatePct = 6;
    } else if (days <= 270) {
      statutoryRatePct = 9;
    } else {
      statutoryRatePct = 12;
    }
    effectiveYieldPct = statutoryRatePct;
    const tierLabel = days <= 90 ? "3% Q1" : days <= 180 ? "6% Q2" : days <= 270 ? "9% Q3" : "12% Q4";
    statutoryCitation = "S.C. Code Ann. § 12-51-90: " + statutoryRatePct + "% tiered statutory penalty (" + tierLabel + ") on tax sale redemption, capped at bid amount.";
  } else if (st === "TN") {
    regime = "redeemable_deed_or_lien_interest";
    yieldType = "interest";
    isFlatPenalty = false;
    isAnnualInterest = true;
    days = passedDays !== null ? passedDays : 365;
    statutoryRatePct = 12;
    effectiveYieldPct = Number(((statutoryRatePct * days) / 365).toFixed(2));
    statutoryCitation = "T.C.A. § 67-5-2701: 12% per annum simple interest on tax sale redemption (accrues pro-rata).";
  } else if (st === "AZ") {
    regime = "redeemable_deed_or_lien_interest";
    yieldType = "interest";
    isFlatPenalty = false;
    isAnnualInterest = true;
    days = passedDays !== null ? passedDays : 1095;
    statutoryRatePct = 16;
    effectiveYieldPct = Number(((statutoryRatePct * days) / 365).toFixed(2));
    statutoryCitation = "A.R.S. § 42-18153: Up to 16% per annum simple interest bid-down rate on tax certificate redemption.";
  } else if (st === "MD") {
    regime = "redeemable_deed_or_lien_interest";
    yieldType = "interest";
    isFlatPenalty = false;
    isAnnualInterest = true;
    days = passedDays !== null ? passedDays : 180;
    statutoryRatePct = 12;
    effectiveYieldPct = Number(((statutoryRatePct * days) / 365).toFixed(2));
    statutoryCitation = "Md. Code Tax-Prop. § 14-820: 12%–20% county certificate rate on tax certificate redemption (12% baseline).";
  } else if (st === "IN") {
    regime = "redeemable_deed_or_lien_interest";
    yieldType = "interest";
    isFlatPenalty = false;
    isAnnualInterest = true;
    days = passedDays !== null ? passedDays : 365;
    statutoryRatePct = days <= 180 ? 10 : 15;
    effectiveYieldPct = statutoryRatePct;
    statutoryCitation = "IC 6-1.1-25-2: 10% within 6 months, 15% thereafter on minimum bid plus 5% per annum on surplus.";
  } else if (st === "FL") {
    regime = "post_redemption_deed";
    yieldType = "interest";
    isFlatPenalty = false;
    isAnnualInterest = false;
    days = passedDays !== null ? passedDays : 0;
    statutoryRatePct = 0;
    effectiveYieldPct = 0;
    statutoryCitation = "Fla. Stat. § 197.542: Tax deed auction redemption expires upon clerk receiving deed payment (0-day post-sale redemption, immediate fee-simple title; 18% statutory cap under § 197.432 applies to certificate holders only).";
  } else if (st === "MI") {
    regime = "post_redemption_deed";
    yieldType = "interest";
    isFlatPenalty = false;
    isAnnualInterest = false;
    days = passedDays !== null ? passedDays : 0;
    statutoryRatePct = 0;
    effectiveYieldPct = 0;
    statutoryCitation = "MCL § 211.78m: County treasurer tax foreclosure auctions (redemption expires March 31 prior to auction; 0-day post-sale redemption, immediate deed).";
  } else if (st === "WA") {
    regime = "post_redemption_deed";
    yieldType = "interest";
    isFlatPenalty = false;
    isAnnualInterest = false;
    days = passedDays !== null ? passedDays : 0;
    statutoryRatePct = 0;
    effectiveYieldPct = 0;
    statutoryCitation = "RCW 84.64.080: County tax foreclosure deed sale (0-day post-sale redemption; immediate deed execution, 30-day appeal window under RCW 84.64.120).";
  } else if (st === "IL") {
    regime = "redeemable_deed_flat_penalty";
    yieldType = "penalty";
    isFlatPenalty = true;
    isAnnualInterest = false;
    days = passedDays !== null ? passedDays : 180;
    statutoryRatePct = 18;
    effectiveYieldPct = 18;
    statutoryCitation = "35 ILCS 200/21-355: 18% statutory penalty per 6-month period on scavenger/tax sales.";
  } else if (st === "MO") {
    regime = "redeemable_deed_or_lien_interest";
    yieldType = "interest";
    isFlatPenalty = false;
    isAnnualInterest = true;
    days = passedDays !== null ? passedDays : 365;
    statutoryRatePct = 10;
    effectiveYieldPct = Number(((statutoryRatePct * days) / 365).toFixed(2));
    statutoryCitation = "Mo. Rev. Stat. § 140.340: 10% per annum statutory interest on tax sale redemption.";
  } else {
    regime = "redeemable_deed_or_lien_interest";
    yieldType = "interest";
    isFlatPenalty = false;
    isAnnualInterest = true;
    days = passedDays !== null ? passedDays : 365;
    statutoryRatePct = 8;
    effectiveYieldPct = Number(((statutoryRatePct * days) / 365).toFixed(2));
    statutoryCitation = "Generic 8% statutory interest rate baseline.";
  }

  let grossProceeds = price;
  let netReturn = 0;
  let annualizedIrrPct = 0;

  if (regime === "post_redemption_deed") {
    grossProceeds = price;
    netReturn = 0;
    annualizedIrrPct = 0;
  } else if (isFlatPenalty) {
    grossProceeds = Math.round(price * (1 + statutoryRatePct / 100));
    netReturn = grossProceeds - price;
    annualizedIrrPct = days > 0 ? Math.round(((netReturn / price) * (365 / days)) * 1000) / 10 : 0;
  } else if (st === "IN") {
    grossProceeds = Math.round(price * (1 + statutoryRatePct / 100));
    netReturn = grossProceeds - price;
    annualizedIrrPct = days > 0 ? Math.round(((netReturn / price) * (365 / days)) * 1000) / 10 : 0;
  } else {
    const grossMultiplier = 1 + (statutoryRatePct / 100) * (days / 365);
    grossProceeds = Math.round(price * grossMultiplier);
    netReturn = grossProceeds - price;
    annualizedIrrPct = days > 0 ? Math.round(((netReturn / price) * (365 / days)) * 1000) / 10 : 0;
  }

  const netStatutoryReturn = netReturn;
  const instrumentBadge = getTaxInstrumentBadge(st, regime);

  return {
    purchasePrice: price,
    state: st,
    redemptionDays: days,
    statutoryRatePct,
    regime,
    yieldType,
    isFlatPenalty,
    isAnnualInterest,
    effectiveYieldPct,
    grossProceeds,
    netReturn,
    netStatutoryReturn,
    annualizedIrrPct,
    statutoryCitation,
    instrumentBadge,
  };
}
