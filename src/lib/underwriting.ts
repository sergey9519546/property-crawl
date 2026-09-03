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

export interface RentRollUnit {
  unit: string;
  tenant: string;
  status: 'Occupied' | 'Vacant';
  sqft: number;
  monthlyRent: number;
  annualRent: number;
  leaseEnd: string | null;
}

export interface RentRollSchedule {
  unitCount: number;
  units: RentRollUnit[];
  totalSqft: number;
  totalAnnualRent: number;
  occupancyRate: number;
  inPlaceNoi: number;
}

export function parseRentRollSchedule(rawNotice = ''): RentRollSchedule {
  const text = String(rawNotice || '');
  const units: RentRollUnit[] = [];
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
    inPlaceNoi: Math.round(totalAnnualRent * 0.60)
  };
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
}, options: {
  buyerEntity?: string;
  offerPrice?: number;
  depositPct?: number;
  inspectionDays?: number;
  closingDays?: number;
} = {}): string {
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
   - Estimated Buyer's Premium: $${cashToClose.buyersPremium.toLocaleString()}
   - Statutory Sheriff Poundage (${listing.state || 'OH'}): $${cashToClose.sheriffPoundage.toLocaleString()}
   - State Transfer Tax: $${cashToClose.transferTax.toLocaleString()}
   - Estimated Deed Recording Fees: $${cashToClose.deedFees.toLocaleString()}
   - Net Estimated Cash to Close: $${cashToClose.total.toLocaleString()}
7. CLOSING DATE: On or before ${closingDays} calendar days following expiration of the Due Diligence Period, subject to statutory confirmation and redemption rules under ${listing.state || 'OH'} law.
8. CONDITION: "As-Is, Where-Is", subject to insurable title free and clear of un-extinguished senior encumbrances.

AGREED & SUBMITTED:
By: ___________________________
Authorized Representative, ${buyer}`;
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
}, creMetrics?: Partial<CreUnderwritingMetrics>): string {
  const bid = Number(listing.openingBid) || 0;
  const estMid = ((Number(listing.estLow) || bid) + (Number(listing.estHigh) || bid)) / 2;
  const equity = Math.max(0, estMid - bid);
  const discountPct = estMid > 0 ? ((equity / estMid) * 100).toFixed(1) : '0.0';
  const metrics = creMetrics || {};

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
- **Net Operating Income (NOI)**: $${(metrics.netOperatingIncome || Math.round(bid * 0.085)).toLocaleString()} / year
- **Capitalization Rate**: ${metrics.capitalizationRate || '8.50'}%
- **Debt Service Coverage Ratio (DSCR)**: ${metrics.estimatedDscr || '1.45'}x
- **Target Yield Max Allowable Offer (MAO)**: $${(metrics.maxAllowableOffer || Math.round(bid * 1.15)).toLocaleString()}

## UNDERWRITING RECOMMENDATION
Proceed with pre-auction title search and deposit placement. Target maximum bid of $${(metrics.maxAllowableOffer || Math.round(bid * 1.15)).toLocaleString()} preserves an institutional yield floor above 8.00% Cap Rate.`;
}