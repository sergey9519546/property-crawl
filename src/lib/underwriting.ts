// Client-safe statutory underwriting helpers (pure functions, no CJS imports).
// Mirrors the server-side `server/ai/legal-rules.js` computeCashToClose so the
// marketing UI and watchlist export produce the same cash-to-close figures the
// scraper-derived feed already carries as `listing.cashToClose`.

export interface CashToClose {
  openingBid: number;
  buyersPremium: number;
  sheriffPoundage: number;
  transferTax: number;
  deedFees: number;
  total: number;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  }
  return fallback;
}

export function computeCashToClose(params: {
  openingBid: number;
  state: string;
  source: string;
  deedFees?: number;
}): CashToClose {
  const bid = toNumber(params.openingBid);
  const src = (params.source || "").toLowerCase();
  const st = (params.state || "OH").toUpperCase().trim();
  const deedFees = toNumber(params.deedFees, 500);

  // Buyer's Premium (typically 5% for online marketplaces).
  const buyersPremiumRate =
    src.includes("bid4assets") || src.includes("govdeals") || src.includes("auction")
      ? 0.05
      : 0;
  const buyersPremium = Math.round(bid * buyersPremiumRate);

  // Sheriff Poundage / Statutory Commission (2-3%).
  const isSheriffSale =
    src.includes("sheriff") ||
    src.includes("civilview") ||
    src.includes("trustee") ||
    (src.includes("bid4assets") && (st === "PA" || st === "OH"));
  const poundageRate = isSheriffSale
    ? st === "OH"
      ? 0.02
      : st === "NJ"
        ? 0.025
        : st === "PA"
          ? 0.02
          : 0.02
    : 0;
  const sheriffPoundage = Math.round(bid * poundageRate);

  // Transfer Tax ($1-$4 per $1,000 depending on state).
  const transferTaxRate =
    st === "NJ" ? 0.005 : st === "PA" ? 0.02 : st === "OH" ? 0.004 : 0.002;
  const transferTax = Math.round(bid * transferTaxRate);

  const total = bid + buyersPremium + sheriffPoundage + transferTax + deedFees;

  return { openingBid: bid, buyersPremium, sheriffPoundage, transferTax, deedFees, total };
}

export function redemptionLabel(days: number): string {
  const d = Math.max(0, Math.round(Number(days) || 0));
  if (d === 0) return "No post-sale redemption";
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

export function computeCreMetrics(params: {
  sqft?: number;
  openingBid: number;
  estimatedValue?: number;
  propType?: string;
  marketRentPerSqftAnnual?: number;
  expenseRatio?: number;
  ltv?: number;
}): CreUnderwritingMetrics {
  const sqft = toNumber(params.sqft, 2400);
  const bid = toNumber(params.openingBid, 100000);
  const isCommercial = (params.propType || "").toLowerCase().includes("commercial") || (params.propType || "").toLowerCase().includes("multi");

  const rentPerSqft = toNumber(params.marketRentPerSqftAnnual, isCommercial ? 15 : 18);
  const grossPotentialRent = Math.round(sqft * rentPerSqft);
  const effectiveGrossIncome = Math.round(grossPotentialRent * 0.95);
  const opexRatio = toNumber(params.expenseRatio, 0.40);
  const operatingExpenses = Math.round(effectiveGrossIncome * opexRatio);
  const netOperatingIncome = Math.max(0, effectiveGrossIncome - operatingExpenses);

  const capitalizationRate = bid > 0 ? Number(((netOperatingIncome / bid) * 100).toFixed(2)) : 0;
  const loanAmount = bid * (params.ltv || 0.75);
  const annualDebtService = Math.round(loanAmount * 0.077);
  const estimatedDscr = annualDebtService > 0 ? Number((netOperatingIncome / annualDebtService).toFixed(2)) : 1.5;
  const maxAllowableOffer = Math.max(0, Math.round((netOperatingIncome / 0.08) * 0.85));

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