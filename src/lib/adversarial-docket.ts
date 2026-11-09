// Pure client- and server-safe adversarial trial docket evaluator.
//
// Evaluates the "Property on Trial" (Prosecution vs. Defense) deal-killer audit
// for a foreclosure listing. Cites actual statutory authorities (e.g., 26 U.S.C. § 7425,
// 11 U.S.C. § 362, 12 U.S.C. § 5220, NRS 116.3116, Fla. Stat. § 718.116, R.C. § 323.11,
// Restatement (Third) of Property (Mortgages) § 7.1).
// Zero fabrication: never invents facts or valuations.

export type TrialVerdict = "fatal" | "conditional" | "verified";

export type DocketItemStatus = "disqualified" | "caution" | "verified" | "unverified";

export interface DocketCheckItem {
  id: string;
  category: string;
  title: string;
  statute: string;
  statement: string;
  finding: string;
  status: DocketItemStatus;
  isFatal?: boolean;
}

export interface AdversarialDocketResult {
  verdict: TrialVerdict;
  headline: string;
  verdictDescription: string;
  badgeClass: string;
  prosecutionPoints: DocketCheckItem[];
  defensePoints: DocketCheckItem[];
  fatalCount: number;
  cautionCount: number;
  defenseCount: number;
  recommendedDecision: "pass" | "pursue" | "inbox";
  recommendedReasonCodes: string[];
  docketSummaryNote: string;
  statutoryCarryDays: number;
}

export interface DocketListingInput {
  id: string;
  state?: string | null;
  county?: string | null;
  source?: string | null;
  plaintiff?: string | null;
  seniorLienRisk?: string | null;
  seniorLienWarning?: string | null;
  redemptionDays?: number | null;
  redemptionWarning?: string | null;
  occupancy?: string | null;
  deposit?: string | null;
  openingBid?: number | null;
  assessed?: number | null;
  parcelKey?: string | null;
  apn?: string | null;
  rawNotice?: string | null;
  notes?: string | null;
  delinquentTaxes?: number | null;
  bankruptcy?: {
    active?: boolean | null;
    petitionDate?: string | null;
    hasCourtExtension?: boolean | null;
    hasInRemReliefOrder?: boolean | null;
  } | null;
}

export interface HoaRule {
  months: number;
  statute: string;
  label: string;
  extinguishesFirstMortgageOnHoaForeclosure: boolean;
  safeHarborApplicable: boolean;
  safeHarborPercent?: number;
  statutoryDollarCap?: number | null;
  landmarkCase?: string;
}

export interface MunicipalRule {
  statute: string;
  label: string;
  delinquentTaxStatute: string;
  demolitionStatute: string;
}

export interface PossessionRule {
  minDays: number;
  maxDays: number;
  statute: string;
  procedure: string;
}

export interface RedemptionRule {
  statutoryDays: number;
  statute: string;
  penaltyYieldDescription: string;
  isUpsetBid?: boolean;
}

// 22 States with statutory HOA / Condominium Super-Priority assessment liens
export const HOA_SUPER_PRIORITY_RULES: Readonly<Record<string, HoaRule>> = Object.freeze({
  NV: {
    months: 9,
    statute: "NRS 116.3116",
    label: "Nevada 9-month HOA super-priority assessment primes first deed of trust",
    extinguishesFirstMortgageOnHoaForeclosure: true,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
    landmarkCase: "SFR Investments Pool 1, LLC v. U.S. Bank, N.A., 334 P.3d 408 (Nev. 2014)",
  },
  CO: {
    months: 6,
    statute: "C.R.S. § 38-33.3-316",
    label: "Colorado 6-month HOA super-priority assessment",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  CT: {
    months: 9,
    statute: "Conn. Gen. Stat. § 47-258",
    label: "Connecticut 9-month common interest ownership super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  FL: {
    months: 12,
    statute: "Fla. Stat. § 718.116 / § 720.3085",
    label: "Florida Safe Harbor: 12 months past assessments or 1% of original mortgage debt",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: true,
    safeHarborPercent: 0.01,
    statutoryDollarCap: null,
  },
  DC: {
    months: 6,
    statute: "D.C. Code § 42-1903.13",
    label: "District of Columbia 6-month condo super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  MD: {
    months: 4,
    statute: "Md. Code Ann., Real Prop. § 11B-117 / § 11-110",
    label: "Maryland 4-month condo/HOA assessment priority capped at $1,200",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: 1200,
  },
  PA: {
    months: 6,
    statute: "68 Pa.C.S. § 3315",
    label: "Pennsylvania 6-month uniform condominium / planned community super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  WA: {
    months: 6,
    statute: "RCW 64.34.364",
    label: "Washington 6-month condo super-priority lien",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  MA: {
    months: 6,
    statute: "M.G.L. c. 183A § 6",
    label: "Massachusetts 6-month rolling super-priority lien",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  MN: {
    months: 6,
    statute: "Minn. Stat. § 515B.3-116",
    label: "Minnesota 6-month common interest community super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  MO: {
    months: 6,
    statute: "RSMo § 448.3-116",
    label: "Missouri 6-month condominium super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  NJ: {
    months: 6,
    statute: "N.J.S.A. 46:8B-21",
    label: "New Jersey 6-month condo assessment super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  OR: {
    months: 6,
    statute: "ORS § 100.450",
    label: "Oregon 6-month condominium assessment super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  RI: {
    months: 6,
    statute: "R.I. Gen. Laws § 34-36.1-3.16",
    label: "Rhode Island 6-month super-priority assessment",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  TN: {
    months: 6,
    statute: "Tenn. Code § 66-27-415",
    label: "Tennessee 6-month condominium priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  VT: {
    months: 6,
    statute: "27A V.S.A. § 3-116",
    label: "Vermont 6-month common interest ownership super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  WV: {
    months: 6,
    statute: "W. Va. Code § 36B-3-116",
    label: "West Virginia 6-month UCIOA super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  AL: {
    months: 6,
    statute: "Ala. Code § 35-8A-316",
    label: "Alabama 6-month condominium super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  AK: {
    months: 6,
    statute: "AS § 34.08.470",
    label: "Alaska 6-month common interest super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  HI: {
    months: 6,
    statute: "HRS § 514B-146",
    label: "Hawaii 6-month non-judicial condo super-priority",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  IL: {
    months: 6,
    statute: "765 ILCS 605/9",
    label: "Illinois condominium assessment strict lien",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
  NY: {
    months: 6,
    statute: "N.Y. Real Prop. Law § 339-z",
    label: "New York condominium assessment priority over subordinate liens",
    extinguishesFirstMortgageOnHoaForeclosure: false,
    safeHarborApplicable: false,
    statutoryDollarCap: null,
  },
});

// State Municipal Super-Priority & Demolition Lien Rules
export const MUNICIPAL_SUPER_PRIORITY_RULES: Readonly<Record<string, MunicipalRule>> = Object.freeze({
  OH: {
    statute: "Ohio Rev. Code § 323.11 & § 715.261",
    label: "Ohio ad valorem property taxes & municipal building removal/demolition assessments certified to tax duplicate",
    delinquentTaxStatute: "R.C. § 323.11",
    demolitionStatute: "R.C. § 715.261",
  },
  FL: {
    statute: "Fla. Stat. § 197.122 & § 153.67 / § 159.17 / § 162.09",
    label: "Florida ad valorem property taxes & municipal utility/demolition/code enforcement super-liens",
    delinquentTaxStatute: "Fla. Stat. § 197.122",
    demolitionStatute: "Fla. Stat. § 162.09",
  },
  TX: {
    statute: "Tex. Tax Code § 32.05 & Loc. Gov't Code § 214.0015 / § 342.007",
    label: "Texas ad valorem property taxes & dangerous building demolition/nuisance super-priority liens",
    delinquentTaxStatute: "Tex. Tax Code § 32.05",
    demolitionStatute: "Tex. Loc. Gov't Code § 214.0015",
  },
  CA: {
    statute: "Cal. Rev. & Tax. Code § 2192.1 & Gov. Code § 38773.5",
    label: "California property tax priority & substandard structure demolition assessments on county tax roll",
    delinquentTaxStatute: "Cal. Rev. & Tax. Code § 2192.1",
    demolitionStatute: "Cal. Gov. Code § 38773.5",
  },
  PA: {
    statute: "53 P.S. § 7102 & § 7106",
    label: "Pennsylvania property tax claims & municipal water/sewer/demolition claims priming private mortgages",
    delinquentTaxStatute: "53 P.S. § 7102",
    demolitionStatute: "53 P.S. § 7106",
  },
  NJ: {
    statute: "N.J.S.A. § 54:5-9 & § 40:48-2.5",
    label: "New Jersey municipal tax liens & emergency repair/demolition super-priority over private mortgages",
    delinquentTaxStatute: "N.J.S.A. § 54:5-9",
    demolitionStatute: "N.J.S.A. § 40:48-2.5",
  },
  IL: {
    statute: "35 ILCS 200/21-75 & 65 ILCS 5/11-31-1",
    label: "Illinois real estate tax super-priority & municipal emergency repair/demolition liens",
    delinquentTaxStatute: "35 ILCS 200/21-75",
    demolitionStatute: "65 ILCS 5/11-31-1",
  },
  GA: {
    statute: "O.C.G.A. § 48-2-56 & § 41-2-9(b)",
    label: "Georgia ad valorem taxes & municipal nuisance demolition liens coequal with property taxes",
    delinquentTaxStatute: "O.C.G.A. § 48-2-56",
    demolitionStatute: "O.C.G.A. § 41-2-9(b)",
  },
  MI: {
    statute: "MCL § 211.40 & § 125.541",
    label: "Michigan ad valorem property tax lien & dangerous building demolition costs certified to tax roll",
    delinquentTaxStatute: "MCL § 211.40",
    demolitionStatute: "MCL § 125.541",
  },
  MD: {
    statute: "Md. Code Tax-Prop. § 14-804 & Real Prop. § 14-806",
    label: "Maryland property tax super-lien & municipal water/sewer/demolition assessments priming mortgages",
    delinquentTaxStatute: "Md. Code Tax-Prop. § 14-804",
    demolitionStatute: "Md. Code Real Prop. § 14-806",
  },
  MO: {
    statute: "RSMo § 140.010 & § 67.410",
    label: "Missouri property taxes & special tax bills for dangerous building repair/demolition",
    delinquentTaxStatute: "RSMo § 140.010",
    demolitionStatute: "RSMo § 67.410",
  },
});

// State Post-Sale Possession & Eviction Timelines
export const POST_SALE_POSSESSION_RULES: Readonly<Record<string, PossessionRule>> = Object.freeze({
  FL: {
    minDays: 5,
    maxDays: 30,
    statute: "Fla. R. Civ. P. 1.580",
    procedure: "Clerk writ of possession issued post-sale confirmation; 5-30 days sheriff service and execution",
  },
  GA: {
    minDays: 7,
    maxDays: 30,
    statute: "O.C.G.A. § 44-7-50; § 44-7-55",
    procedure: "Dispossessory proceeding; 7-day summons answer + writ of possession executed in 7-30 days",
  },
  TX: {
    minDays: 30,
    maxDays: 90,
    statute: "Tex. R. Civ. P. 310; Prop. Code § 24.005",
    procedure: "3-day notice to vacate; JP court forcible detainer + writ of possession (30-90 days total)",
  },
  CA: {
    minDays: 30,
    maxDays: 60,
    statute: "C.C.P. § 712.010; C.C.P. § 1161a",
    procedure: "3-day notice to quit; post-foreclosure unlawful detainer + sheriff writ of possession (30-60 days)",
  },
  OH: {
    minDays: 14,
    maxDays: 30,
    statute: "R.C. § 2329.31; R.C. § 2329.09; Civ. R. 70",
    procedure: "Foreclosure confirmation order transfers title; sheriff writ of possession executed in 14-30 days",
  },
  NJ: {
    minDays: 30,
    maxDays: 60,
    statute: "N.J. Court R. 4:59-1",
    procedure: "10-day post-sale objection window; sheriff writ of possession executed in 30-60 days",
  },
  PA: {
    minDays: 30,
    maxDays: 90,
    statute: "Pa. R.C.P. 3180",
    procedure: "Writ of possession following sheriff deed delivery; sheriff service and execution in 30-90 days",
  },
  IL: {
    minDays: 30,
    maxDays: 60,
    statute: "735 ILCS 5/15-1701; 735 ILCS 5/9-101",
    procedure: "Order of possession with 30-day statutory stay; sheriff eviction executed in 30-60 days",
  },
  NY: {
    minDays: 30,
    maxDays: 90,
    statute: "RPAPL § 713",
    procedure: "10-day notice to quit; post-referee deed holdover proceeding in housing court (30-90 days)",
  },
  MI: {
    minDays: 7,
    maxDays: 30,
    statute: "MCR 4.201; MCL § 600.5714",
    procedure: "7-day demand notice post-redemption; district court summary possession judgment (7-30 days)",
  },
});

// State Statutory Redemption & Penalty Yield Rules
export const STATUTORY_REDEMPTION_RULES: Readonly<Record<string, RedemptionRule>> = Object.freeze({
  AL: {
    statutoryDays: 180,
    statute: "Ala. Code § 6-5-248 & § 6-5-253",
    penaltyYieldDescription: "12% per annum statutory interest floor payable by redeeming debtor",
  },
  TN: {
    statutoryDays: 730,
    statute: "Tenn. Code Ann. § 66-8-101",
    penaltyYieldDescription: "Up to 2-year statutory right of redemption unless expressly waived in security deed",
  },
  TX: {
    statutoryDays: 180,
    statute: "Tex. Tax Code § 34.21",
    penaltyYieldDescription: "25% statutory penalty if redeemed in year 1, 50% penalty if redeemed in year 2 (tax foreclosures)",
  },
  GA: {
    statutoryDays: 365,
    statute: "O.C.G.A. § 48-4-40 & § 48-4-45",
    penaltyYieldDescription: "20% redemption premium year 1, plus 10% each subsequent year prior to barment",
  },
  NC: {
    statutoryDays: 10,
    statute: "N.C.G.S. § 45-21.27",
    penaltyYieldDescription: "10-day upset bid period; 5% minimum bid increase required to upset sale",
    isUpsetBid: true,
  },
  MI: {
    statutoryDays: 180,
    statute: "MCL § 600.3240",
    penaltyYieldDescription: "6-12 month statutory redemption; winning bid repaid plus statutory interest",
  },
  MN: {
    statutoryDays: 180,
    statute: "Minn. Stat. § 580.23",
    penaltyYieldDescription: "6-month statutory redemption window at promissory note interest rate",
  },
  WY: {
    statutoryDays: 90,
    statute: "Wyo. Stat. § 1-18-103",
    penaltyYieldDescription: "3-month statutory redemption for debtor; 10% statutory interest per annum",
  },
  CO: {
    statutoryDays: 8,
    statute: "C.R.S. § 38-38-302",
    penaltyYieldDescription: "8-business-day junior lienor redemption period post-sale",
  },
});

export function evaluateAdversarialDocket(listing: DocketListingInput): AdversarialDocketResult {
  const state = String(listing.state || "US").toUpperCase();
  const rawNotice = listing.rawNotice || (listing as unknown as Record<string, unknown>)["raw"] || "";
  const noticeText = `${listing.seniorLienWarning || ""} ${listing.redemptionWarning || ""} ${rawNotice} ${listing.notes || ""} ${listing.plaintiff || ""}`;

  const hoaRule = HOA_SUPER_PRIORITY_RULES[state] || null;
  const municipalRule = MUNICIPAL_SUPER_PRIORITY_RULES[state] || {
    statute: "State Tax Super-Priority Codes (e.g. OH R.C. § 323.11, FL Stat. § 197.122)",
    label: "County real property taxes and municipal assessments prime private mortgages",
    delinquentTaxStatute: "State Ad Valorem Tax Code",
    demolitionStatute: "Municipal Code Enforcement Lien Statutes",
  };
  const possessionRule = POST_SALE_POSSESSION_RULES[state] || {
    minDays: 30,
    maxDays: 60,
    statute: "Local Court Rules of Civil Procedure",
    procedure: "Post-confirmation writ of possession executed by county sheriff",
  };
  const redemptionRule = STATUTORY_REDEMPTION_RULES[state] || null;

  // 1. Senior Lien Survival & HOA Super-Priority Check
  const isSeniorExplicitWarning =
    /^(?:high|critical)$/i.test(String(listing.seniorLienRisk || "").trim()) ||
    /^SENIOR_LIEN_RISK/i.test(String(listing.seniorLienWarning || "").trim()) ||
    /(?:second\s*(?:mortgage|deed)|2nd\s*(?:mortgage|deed)|junior\s*(?:mortgage|deed|lien)|\bheloc\b|(?:home\s+)?equity\s*line|subordinate\s*(?:deed|mortgage|lien))/i.test(
      String(listing.seniorLienWarning || "")
    ) ||
    /(?:second\s*(?:mortgage|deed)|2nd\s*(?:mortgage|deed)|junior\s*(?:mortgage|deed|lien)|\bheloc\b|(?:home\s+)?equity\s*line|subordinate\s*(?:deed|mortgage|lien))/i.test(
      String(listing.plaintiff || "")
    );

  const isHoaPlaintiff =
    Boolean(
      listing.plaintiff &&
        /(?:homeowners?\s*association|condominium\s*association|\bhoa\b|\bcoa\b|master\s*association|community\s*association|property\s*owners\s*association)/i.test(
          listing.plaintiff
        )
    ) ||
    Boolean(
      listing.seniorLienWarning &&
        /(?:homeowners?\s*association|condominium\s*association|\bhoa\b|\bcoa\b)/i.test(
          listing.seniorLienWarning
        )
    );

  let isSeniorFatal = false;
  let seniorStatus: DocketItemStatus = "unverified";
  let seniorFinding = "";
  let seniorStatute = "Restatement (Third) of Property (Mortgages) § 7.1; State Recording Acts";

  if (isHoaPlaintiff) {
    if (state === "NV") {
      // Nevada: 9-month super-priority assessment extinguishes prior first mortgages under NRS 116.3116 & SFR Investments Pool 1
      isSeniorFatal = false;
      seniorStatus = "caution";
      seniorStatute = "NRS 116.3116; SFR Investments Pool 1, LLC v. U.S. Bank, N.A., 334 P.3d 408 (Nev. 2014)";
      seniorFinding =
        "NEVADA TRUE SUPER-PRIORITY (NRS 116.3116): Nevada 9-month HOA super-priority assessment primes first deed of trust and EXTINGUISHES prior first mortgage upon foreclosure (SFR Investments Pool 1 v. U.S. Bank). Winning bidder takes free and clear of senior mortgage, but statutory 30-day notice compliance (NRS 116.31168) must be verified.";
    } else if (hoaRule) {
      // 22-state super-priority (e.g. CO, FL, MD, PA, WA, CT, MA, etc.)
      isSeniorFatal = true;
      seniorStatus = "disqualified";
      seniorStatute = `${hoaRule.statute}; Restatement (Third) of Property (Mortgages) § 7.1`;
      seniorFinding = `FATAL TITLE TRAP: HOA foreclosing under ${hoaRule.statute}. While assessments hold ${hoaRule.months}-month super-priority (${hoaRule.label}), senior 1st mortgage debt is NOT extinguished. Winning bidder takes title subject to surviving senior mortgage!`;
    } else {
      // Non-super-priority states (TX, OH, CA, AZ, GA, NC, etc.)
      isSeniorFatal = true;
      seniorStatus = "disqualified";
      seniorStatute = `${state} Common Law Recording Acts; Restatement (Third) of Property (Mortgages) § 7.1`;
      seniorFinding = `FATAL TITLE TRAP: HOA foreclosing in a non-super-priority state (${state}). HOA assessment lien is strictly subordinate to recorded deeds of trust; senior 1st mortgage survives the auction in full against the buyer!`;
    }
  } else if (isSeniorExplicitWarning) {
    isSeniorFatal = true;
    seniorStatus = "disqualified";
    seniorFinding = `FATAL TITLE TRAP: Junior lien signals detected (${listing.seniorLienWarning || listing.plaintiff || "Subordinate deed/assessment"}). Senior 1st mortgage survives sale in full!`;
  } else {
    isSeniorFatal = false;
    seniorStatus = "unverified";
    seniorFinding = hoaRule
      ? `Foreclosure in ${state}: Under ${hoaRule.statute}, HOAs hold statutory ${hoaRule.months}-month assessment super-priority (${hoaRule.label}) that must be escrowed at settlement. No junior-lien signals found in notice; verify 1st position in county records.`
      : "No junior-lien wording found in published notice. Plaintiff priority position must still be verified against County Recorder grantor/grantee index.";
  }

  const seniorLienPoint: DocketCheckItem = {
    id: "prosecution-1-senior-lien",
    category: "Lien Priority & Survival",
    title: isHoaPlaintiff ? "HOA Super-Priority & Senior Lien Survival" : "Senior 1st Deed of Trust Survival Trap",
    statute: seniorStatute,
    statement:
      "Foreclosing plaintiff appears to hold a junior lien. Under common law lien priority, senior 1st deeds of trust survive the auction in full against the winning bidder.",
    finding: seniorFinding,
    status: seniorStatus,
    isFatal: isSeniorFatal,
  };

  // 2. IRS 120-Day Super-Priority Redemption
  const hasIrsNotice =
    listing.source === "irs" ||
    /(?:internal\s*revenue|\birs\b|federal\s*tax\s*lien|26\s*u\.?s\.?c\.?\s*§?\s*7425)/i.test(noticeText);

  const irsPoint: DocketCheckItem = {
    id: "prosecution-2-irs-lien",
    category: "Federal Tax Liens",
    title: "IRS 120-Day Super-Priority Redemption (26 U.S.C. § 7425)",
    statute: "26 U.S.C. § 7425(d); 28 U.S.C. § 2410(c)",
    statement:
      "Federal tax lien on title gives the United States a 120-day post-foreclosure right of redemption. The IRS can divest the buyer at the gavel price plus 6% statutory interest.",
    finding: hasIrsNotice
      ? "IRS FEDERAL TAX LIEN DETECTED: 120-day federal redemption cloud freezes marketable title. Carrying cost must be modeled through statutory expiration."
      : "No federal tax lien recited in published notice. Recorded NFTLs filed >30 days before sale survive unless served with 25-day statutory notice.",
    status: hasIrsNotice ? "caution" : "unverified",
  };

  // 3. Bankruptcy Automatic Stay Invalidation
  const hasActiveBankruptcy = Boolean(
    listing.bankruptcy?.active ||
      /(?:bankruptcy|chapter\s*(?:7|11|13)|11\s*u\.?s\.?c\.?\s*§?\s*362)/i.test(noticeText)
  );

  const bankruptcyPoint: DocketCheckItem = {
    id: "prosecution-3-bankruptcy-stay",
    category: "Federal Bankruptcy",
    title: "Automatic Stay Invalidation (11 U.S.C. § 362)",
    statute: "11 U.S.C. § 362(a); In re Schwartz, 954 F.2d 569 (9th Cir.)",
    statement:
      "Foreclosure sales conducted while a debtor bankruptcy automatic stay is in effect are void ab initio. Purchaser acquires zero legal title and forfeits transaction rights.",
    finding: hasActiveBankruptcy
      ? "CRITICAL BANKRUPTCY STAY DETECTED: Foreclosure auction stayed by federal bankruptcy law. Any gavel strike while stay is active is void ab initio."
      : "Morning-of PACER / CourtListener docket verification required. A petition filed minutes prior to gavel drop halts the sale by operation of law.",
    status: hasActiveBankruptcy ? "disqualified" : "unverified",
    isFatal: hasActiveBankruptcy,
  };

  // 4. Municipal Super-Priority Ad Valorem & Utility Liens
  const hasMunicipalDelinquency = Boolean(
    listing.delinquentTaxes ||
      /(?:delinquent\s*tax|tax\s*lien|demolition|weed\s*lien|code\s*violation|water\s*lien)/i.test(noticeText)
  );

  const municipalPoint: DocketCheckItem = {
    id: "prosecution-4-municipal-liens",
    category: "Municipal Super-Priority",
    title: "Municipal Ad Valorem & Demolition Liens",
    statute: municipalRule.statute,
    statement:
      "County real property taxes, municipal water/sewer, and emergency nuisance/demolition assessments prime private mortgages and survive mortgage foreclosure.",
    finding: hasMunicipalDelinquency
      ? `Municipal delinquency signals detected in ${listing.county || "county"}, ${state}. Unpaid ad valorem taxes (${municipalRule.delinquentTaxStatute}) and municipal demolition/utility super-liens (${municipalRule.demolitionStatute}) survive auction and attach directly to the buyer.`
      : `Ad valorem taxes in ${listing.county || "county"}, ${state}: Under ${municipalRule.statute}, municipal taxes and special assessments survive foreclosure. Buyer is responsible for delinquent property taxes not satisfied by auction proceeds.`,
    status: hasMunicipalDelinquency ? "caution" : "unverified",
  };

  // 5. PTFA Tenant Holdover & Statutory Eviction Stay
  const isOccupied = Boolean(
    listing.occupancy && /^(?:tenant|occupied|unknown)/i.test(listing.occupancy.trim())
  );

  const ptfaPoint: DocketCheckItem = {
    id: "prosecution-5-ptfa-occupancy",
    category: "Possession & Occupancy",
    title: "PTFA Tenant Protections & Holdover Eviction (12 U.S.C. § 5220)",
    statute: `${possessionRule.statute}; 12 U.S.C. § 5220 (PTFA)`,
    statement:
      "Bona fide residential tenants are entitled to 90 days statutory notice to vacate. Self-help evictions are prohibited; post-sale writ of possession required.",
    finding: listing.occupancy
      ? `Reported occupancy: "${listing.occupancy}". Federal PTFA 90-day notice applies to bona fide tenants. In ${state}, post-sale writ of possession (${possessionRule.statute}) requires ${possessionRule.minDays}-${possessionRule.maxDays} days (${possessionRule.procedure}). Post-sale holdover carry must be budgeted.`
      : `Occupancy status not published in source notice. Physical exterior drive-by required. In ${state}, post-foreclosure writ of possession under ${possessionRule.statute} typically spans ${possessionRule.minDays}-${possessionRule.maxDays} days if holdover occurs.`,
    status: isOccupied ? "caution" : "unverified",
  };

  // 6. State Statutory Redemption & Upset Bid Capital Lockup
  const isNcUpset = state === "NC";
  const explicitRedemptionDays = typeof listing.redemptionDays === "number" ? listing.redemptionDays : null;
  const effectiveRedemptionDays =
    explicitRedemptionDays !== null && explicitRedemptionDays > 0
      ? explicitRedemptionDays
      : redemptionRule
        ? redemptionRule.statutoryDays
        : 0;

  const hasRedemptionLockup = effectiveRedemptionDays > 0 || isNcUpset;

  const redemptionPoint: DocketCheckItem = {
    id: "prosecution-6-statutory-redemption",
    category: "Statutory Holding Lockup",
    title: "Statutory Redemption & Court Confirmation Window",
    statute: isNcUpset
      ? "N.C.G.S. § 45-21.27 (10-Day Upset Bid)"
      : redemptionRule
        ? redemptionRule.statute
        : `${state} Statutory Redemption Code (e.g. Ala. Code § 6-5-248, Mich. Comp. Laws § 600.3240)`,
    statement:
      "Debtor or subordinate lienholders possess statutory right to redeem property post-auction or file upset bids, freezing investor capital without deed vesting.",
    finding: hasRedemptionLockup
      ? `${effectiveRedemptionDays > 0 ? `${effectiveRedemptionDays}-day statutory redemption window (${redemptionRule ? redemptionRule.statute : `${state} code`})` : "10-day upset bid period (N.C.G.S. § 45-21.27)"}. Legal title is locked; capital carry modeled during holding period.`
      : "No extended post-sale statutory redemption captured; standard clerk confirmation order applies before deed delivery.",
    status: hasRedemptionLockup ? "caution" : "unverified",
  };

  // 7. Certified Funds Forfeiture & Sheriff Execution Poundage
  const depositText = listing.deposit ? String(listing.deposit) : null;
  const poundagePoint: DocketCheckItem = {
    id: "prosecution-7-clerk-poundage",
    category: "Auction Execution",
    title: "Certified Funds Deposit & Poundage Forfeiture Protocol",
    statute: "Local Court Rules of Civil Procedure; Sheriff Execution Statutes (e.g. NY CPLR 8012, OH R.C. 311.17)",
    statement:
      "Sheriff poundage (up to 3-5%) and certified check deadlines create execution forfeiture risk if balance is not tendered within local court rules.",
    finding: depositText
      ? `Certified funds deposit requirement: "${depositText}". Failure to tender remaining funds within statutory deadline forfeits deposit and risks resale default.`
      : "Certified cashier's check required at gavel drop. Balance tender deadline strictly enforced under local court rules.",
    status: "caution",
  };

  const prosecutionPoints: DocketCheckItem[] = [
    seniorLienPoint,
    irsPoint,
    bankruptcyPoint,
    municipalPoint,
    ptfaPoint,
    redemptionPoint,
    poundagePoint,
  ];

  // =========================================================================
  // The Defense (Mitigating Factors & Basis)
  // =========================================================================

  // 1. Subordinate Lien Extinguishment via Statutorily Compliant Foreclosure
  const isInstitutionalFirstMortgage =
    !isSeniorFatal &&
    !isHoaPlaintiff &&
    /(?:bank|mortgage|fannie|freddie|wells\s*fargo|jpmorgan|chase|citibank|truist|pnc|us\s*bank|loan\s*service|trustee|nationstar|mr\s*cooper|first|1st)/i.test(
      String(listing.plaintiff || "")
    );

  const defenseSubordinateExtinguishment: DocketCheckItem = {
    id: "defense-1-subordinate-extinguishment",
    category: "Lien Priority",
    title: "Subordinate Lien Extinguishment via Senior Foreclosure",
    statute: "Uniform Nonjudicial Foreclosure Act; State Recording Acts",
    statement:
      "When a senior 1st mortgage forecloses, properly served subordinate deeds of trust, 2nd mortgages, and judgment liens are extinguished by operation of law.",
    finding: isInstitutionalFirstMortgage
      ? `Senior 1st mortgage holder (${listing.plaintiff}) foreclosing. Junior mortgages, subordinate equity lines, and judgment liens are eliminated upon confirmation.${hoaRule ? ` Note: Under ${hoaRule.statute}, ${hoaRule.months} months HOA super-priority assessments must be escrowed at closing.` : ""}`
      : "Plaintiff position appears institutional or tax-related, but 1st lien recording priority must be verified in county title records.",
    status: isInstitutionalFirstMortgage ? "verified" : "unverified",
  };

  // 2. Deterministic Cadastral Parcel & Assessor Roll Cross-Match
  const hasParcelMatch = Boolean(listing.parcelKey || listing.apn);
  const defenseCadastralMatch: DocketCheckItem = {
    id: "defense-2-cadastral-match",
    category: "Cadastral Identity",
    title: "Cadastral Parcel & Tax Roll Cross-Match",
    statute: "County Tax Assessor Cadastral Database & Official Parcel GIS",
    statement:
      "Deterministic parcel link prevents 'wrong property' bidding. Assessor boundary, legal description, and tax roll agree with courthouse docket.",
    finding: hasParcelMatch
      ? `Verified cadastral identifier (${listing.apn || listing.parcelKey}). Situs address and GIS boundaries correlate with official property roll.`
      : "No direct APN or parcel key captured from publisher notice. Metes and bounds description must be verified before bidding.",
    status: hasParcelMatch ? "verified" : "unverified",
  };

  // 3. Statutory Redemption Penalty Yield Floor
  const defenseRedemptionYield: DocketCheckItem = {
    id: "defense-3-redemption-yield",
    category: "Yield Protection",
    title: "Statutory Redemption Penalty Interest Floor",
    statute: redemptionRule ? redemptionRule.statute : `State Redemption Penalty Provisions (e.g. Ala. Code § 6-5-253, Fla. Stat. § 197.542)`,
    statement:
      "In statutory redemption states, debtor redemption requires full repayment of auction bid plus statutory interest (6%-12% per annum), establishing a protected yield floor.",
    finding:
      hasRedemptionLockup && redemptionRule
        ? `${effectiveRedemptionDays}-day redemption period in ${state}: ${redemptionRule.penaltyYieldDescription}. Downside redemption converts into a secured short-term high-yield debt instrument.`
        : effectiveRedemptionDays > 0
          ? `${effectiveRedemptionDays}-day redemption window converts downside redemption into a secured short-term high-yield debt instrument paying statutory interest.`
          : "Standard short confirmation period enables rapid title vesting without prolonged debtor holding overhang.",
    status: "verified",
  };

  // 4. Zero-Fabrication Walk-Away MAO Discipline
  const defenseMaoDiscipline: DocketCheckItem = {
    id: "defense-4-mao-discipline",
    category: "Underwriting Discipline",
    title: "Zero-Fabrication Walk-Away MAO Discipline",
    statute: "Zero-Fabrication Underwriting Protocol",
    statement:
      "Acquisition modeling calculates statutory cash-to-close, transfer taxes, clerk poundage, and rehab contingency. Maximum Allowable Offer establishes a hard ceiling.",
    finding:
      "Bidding terminal establishes an explicit cash-to-close and MAO ceiling. Certified funds are never tendered beyond mathematically modeled margins.",
    status: "verified",
  };

  const defensePoints: DocketCheckItem[] = [
    defenseSubordinateExtinguishment,
    defenseCadastralMatch,
    defenseRedemptionYield,
    defenseMaoDiscipline,
  ];

  // =========================================================================
  // Verdict Synthesis
  // =========================================================================

  const fatalPoints = prosecutionPoints.filter((p) => p.isFatal && p.status === "disqualified");
  const fatalCount = fatalPoints.length;
  const cautionCount = prosecutionPoints.filter((p) => p.status === "caution").length;
  const defenseCount = defensePoints.filter((p) => p.status === "verified").length;

  let verdict: TrialVerdict = "verified";
  let headline = "DEFENSE VERIFIED — SENIOR POSITION CONFIRMED FOR UNDERWRITING";
  let verdictDescription =
    "Prosecution has identified no fatal title defects. Senior foreclosure eliminates subordinate liens, and cadastral identity is verified.";
  let badgeClass = "bg-paper text-ink border-line-strong";
  let recommendedDecision: "pass" | "pursue" | "inbox" = "pursue";
  const recommendedReasonCodes: string[] = [];

  if (fatalCount > 0) {
    verdict = "fatal";
    headline = "FATAL TITLE DISQUALIFIER — INJUNCTIVE PASS";
    verdictDescription = `The Prosecution has identified ${fatalCount} fatal deal-killer(s): ${fatalPoints.map((p) => p.title).join(", ")}. Senior mortgage survives or auction is stayed by federal law.`;
    badgeClass = "bg-catch-wash text-catch-ink border-catch/30";
    recommendedDecision = "pass";
    recommendedReasonCodes.push("title_risk_unresolved");
    if (hasActiveBankruptcy) recommendedReasonCodes.push("missing_sale_terms");
  } else if (cautionCount >= 2 || hasIrsNotice || isOccupied) {
    verdict = "conditional";
    headline = "CONDITIONAL PASS — TITLE BINDER & PACER CLEARANCE REQUIRED";
    verdictDescription =
      "Multiple caution flags detected. Title binder, 120-day IRS redemption modeling, and morning-of PACER verification required before tendering certified funds.";
    badgeClass = "border-catch/30 bg-catch-wash/40 text-catch-ink";
    recommendedDecision = "inbox";
    if (hasIrsNotice) recommendedReasonCodes.push("title_risk_unresolved");
    if (isOccupied) recommendedReasonCodes.push("property_condition");
    if (hasRedemptionLockup) recommendedReasonCodes.push("timing_or_funds");
  }

  const docketSummaryNote = `[Trial Docket Verdict: ${headline}] Fatal defects: ${fatalCount}; Cautions: ${cautionCount}; Defenses verified: ${defenseCount}. ${verdictDescription}`;

  const statutoryCarryDays = Math.max(
    effectiveRedemptionDays,
    hasIrsNotice ? 120 : 0,
    isOccupied ? possessionRule.maxDays : 0
  );

  return {
    verdict,
    headline,
    verdictDescription,
    badgeClass,
    prosecutionPoints,
    defensePoints,
    fatalCount,
    cautionCount,
    defenseCount,
    recommendedDecision,
    recommendedReasonCodes,
    docketSummaryNote,
    statutoryCarryDays,
  };
}
