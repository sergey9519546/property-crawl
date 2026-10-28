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
  depositText?: string | null;
}): StatutoryFeePreset | null {
  const price = positiveNumber(params.purchasePrice);
  if (price === null) return null;
  const st = (params.state || "").trim().toUpperCase();
  const src = (params.source || "").trim().toLowerCase();
  const citations: string[] = [];
  const isSupported = ["NJ", "OH", "FL", "PA", "NC", "TX", "CA", "GA", "IL", "NY"].includes(st);
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
    citations.push("Texas Const. art. VIII § 29: $0 state real estate transfer tax.");
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
    scheduleLabel = "Georgia Non-Judicial Foreclosure Schedule (O.C.G.A. § 44-14-162 & § 48-6-1)";
    sheriffPoundage = 0;
    transferTax = Math.round(price / 1000);
    defaultDepositPct = 0.10;
    citations.push(
      "O.C.G.A. § 44-14-162: Non-judicial foreclosure under power of sale (first Tuesday auction).",
      "O.C.G.A. § 48-6-1: Georgia Real Estate Transfer Tax ($1.00 per $1,000 of consideration)."
    );
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
}

function addDaysIso(baseDateStr: string | null | undefined, days: number): string | null {
  if (!baseDateStr || days <= 0) return null;
  const time = Date.parse(String(baseDateStr).slice(0, 10));
  if (!Number.isFinite(time)) return null;
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

export function computeStatutoryDeadlinesAndCarry(params: {
  saleDate?: string | null;
  state?: string | null;
  purchasePrice?: number | string | null;
  redemptionDays?: number | null;
  hasIrsLien?: boolean;
  annualCostOfCapitalPct?: number;
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
  }

  const irsRedemptionDays = params.hasIrsLien ? 120 : 0;
  const stateRedemptionDays = Math.max(0, Math.round(nonNegativeNumber(params.redemptionDays) ?? 0));
  const effectiveLockupDays = Math.max(objectionOrConfirmationDays, irsRedemptionDays, stateRedemptionDays);
  const annualCostOfCapitalPct = nonNegativeNumber(params.annualCostOfCapitalPct) ?? 10;
  const price = positiveNumber(params.purchasePrice);
  const estimatedCarryCost = price !== null && effectiveLockupDays > 0
    ? Math.round(price * (annualCostOfCapitalPct / 100) * (effectiveLockupDays / 365))
    : null;

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
    annualCostOfCapitalPct,
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
