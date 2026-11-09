// src/lib/redemption-ev.ts
//
// Dual-Outcome Penalty Redemption vs. Acquisition Expected Value Engine.
//
// Models tax deeds in statutory penalty and interest states:
// - Texas (Tex. Tax Code § 34.21): 25% year 1, 50% year 2 (homestead) or 25% flat (non-homestead)
// - Georgia (O.C.G.A. § 48-4-42): 20% year 1, 40% year 2
// - South Carolina (S.C. Code Ann. § 12-51-90): Tiered quarterly penalty 3%, 6%, 9%, 12% capped at bid
// - Tennessee (T.C.A. § 67-5-2701): 12% per annum simple interest accrued pro-rata
// - Iowa (Iowa Code § 447.1): 2% per month (24% per annum) statutory interest
//
// Dual Outcomes:
// Scenario A (Redemption): Owner redeems within statutory window, returning (bid + penalty amount / simple interest).
// Scenario B (Acquisition): Owner fails to redeem, buyer acquires property (ARV - holding costs - quiet title legal fees).
//
// Zero-Fabrication Invariant:
// If assumedArv is null, undefined, or unsupplied, marks acquisition payoff as unbenchmarked without guessing.

export interface RedemptionEvParams {
  winningBid: number;
  assumedArv?: number | null;
  redemptionProbability: number; // 0.0 to 1.0 (e.g. 0.80)
  stateCode: string; // 'TX' | 'GA' | 'TN' | 'IA' | 'SC' | string
  isHomestead?: boolean;
  quietTitleEstimate?: number; // default $3,500 if not provided
  holdingCostsMonthly?: number; // e.g. taxes, insurance, property preservation
  expectedHoldingMonths?: number; // default based on state statutory redemption window
  redemptionDays?: number;
}

export interface RedemptionEvResult {
  status: "benchmarked" | "unbenchmarked_arv";
  arvSupplied: boolean;
  stateCode: string;
  isHomestead: boolean;
  statutoryRegime: string;
  statutoryCitation: string;
  statutoryRatePct: number;
  expectedHoldingMonths: number;
  winningBid: number;
  assumedArv: number | null;
  redemptionProbability: number;
  acquisitionProbability: number;

  // Scenario A: Owner Redeems
  scenarioRedemption: {
    grossProceeds: number;
    penaltyOrInterestAmount: number;
    netProfit: number;
    roiPct: number;
  };

  // Scenario B: Owner Fails to Redeem (Buyer Acquires Property)
  scenarioAcquisition: {
    assumedArv: number | null;
    quietTitleFees: number;
    totalHoldingCosts: number;
    netAcquisitionCost: number;
    netProfit: number | null;
    roiPct: number | null;
  };

  // Expected Value Synthesis
  redemptionPayoff: number;
  netRedemptionProfit: number;
  acquisitionPayoff: number | null;
  netAcquisitionProfit: number | null;
  expectedNetProfit: number | null;
  expectedEv: number | null;
  blendedIrr: number | null;
  breakEvenRedemptionProbability: number | null;
  missingInputs: string[];
  notes?: string;
}

export function computeRedemptionExpectedValue(params: RedemptionEvParams): RedemptionEvResult {
  const winningBid = Number.isFinite(params.winningBid) && params.winningBid > 0 ? params.winningBid : 0;
  const state = String(params.stateCode || "").trim().toUpperCase();
  const isHomestead = Boolean(params.isHomestead);
  const probRedeem = Math.max(0, Math.min(1, Number.isFinite(params.redemptionProbability) ? params.redemptionProbability : 0.75));
  const probAcquire = Number((1 - probRedeem).toFixed(4));

  // Determine state statutory regime and default holding duration
  let holdingMonths = Number.isFinite(params.expectedHoldingMonths) && (params.expectedHoldingMonths as number) > 0
    ? (params.expectedHoldingMonths as number)
    : 12;

  let statutoryRatePct = 0;
  let statutoryRegime = "Statutory Interest";
  let statutoryCitation = "General statutory redemption framework";

  if (state === "TX") {
    statutoryRegime = "Flat Statutory Penalty";
    if (isHomestead) {
      holdingMonths = params.expectedHoldingMonths || 24;
      if (holdingMonths > 12) {
        statutoryRatePct = 50;
        statutoryCitation = "Tex. Tax Code § 34.21(a): 50% statutory penalty in year two (months 13-24) on residence homestead / agricultural land.";
      } else {
        statutoryRatePct = 25;
        statutoryCitation = "Tex. Tax Code § 34.21(a): 25% statutory penalty in year one (months 1-12) on residence homestead / agricultural land.";
      }
    } else {
      holdingMonths = Math.min(params.expectedHoldingMonths || 6, 6);
      statutoryRatePct = 25;
      statutoryCitation = "Tex. Tax Code § 34.21(e): 25% flat statutory redemption penalty (180-day redemption window) on non-homestead property.";
    }
  } else if (state === "GA") {
    statutoryRegime = "Flat Statutory Penalty";
    holdingMonths = params.expectedHoldingMonths || 12;
    if (holdingMonths > 12) {
      statutoryRatePct = 40;
      statutoryCitation = "O.C.G.A. § 48-4-42: 40% statutory penalty in year two on tax deed redemption prior to deed barment.";
    } else {
      statutoryRatePct = 20;
      statutoryCitation = "O.C.G.A. § 48-4-42: 20% statutory penalty in year one on tax deed redemption.";
    }
  } else if (state === "SC") {
    statutoryRegime = "Tiered Statutory Penalty";
    holdingMonths = params.expectedHoldingMonths || 12;
    if (holdingMonths <= 3) {
      statutoryRatePct = 3;
    } else if (holdingMonths <= 6) {
      statutoryRatePct = 6;
    } else if (holdingMonths <= 9) {
      statutoryRatePct = 9;
    } else {
      statutoryRatePct = 12;
    }
    statutoryCitation = `S.C. Code Ann. § 12-51-90: ${statutoryRatePct}% tiered statutory penalty on tax sale redemption (capped at bid amount).`;
  } else if (state === "TN") {
    statutoryRegime = "Simple Statutory Interest";
    holdingMonths = params.expectedHoldingMonths || 12;
    const annualRate = 12; // 12% per year
    statutoryRatePct = Number(((annualRate * holdingMonths) / 12).toFixed(2));
    statutoryCitation = "T.C.A. § 67-5-2701: 12% per annum simple interest accrued pro-rata during 1-year redemption window.";
  } else if (state === "IA") {
    statutoryRegime = "Monthly Statutory Interest";
    holdingMonths = params.expectedHoldingMonths || 12;
    const monthlyRate = 2; // 2% per month (24% per year)
    statutoryRatePct = Number((monthlyRate * holdingMonths).toFixed(2));
    statutoryCitation = "Iowa Code § 447.1: 2% per month (24% per annum) statutory interest on tax sale redemption.";
  } else {
    holdingMonths = params.expectedHoldingMonths || 12;
    statutoryRatePct = Number(((8 * holdingMonths) / 12).toFixed(2));
    statutoryCitation = "Baseline 8% statutory redemption interest.";
  }

  // Scenario A: Redemption Payoff
  const penaltyOrInterestAmount = Number(((winningBid * statutoryRatePct) / 100).toFixed(2));
  const redemptionPayoff = Number((winningBid + penaltyOrInterestAmount).toFixed(2));
  const netRedemptionProfit = penaltyOrInterestAmount;
  const redemptionRoiPct = winningBid > 0 ? Number(((netRedemptionProfit / winningBid) * 100).toFixed(2)) : 0;

  // Scenario B: Acquisition Costs
  const quietTitleFees = Number.isFinite(params.quietTitleEstimate)
    ? Math.max(0, params.quietTitleEstimate as number)
    : 3500;
  const monthlyHolding = Number.isFinite(params.holdingCostsMonthly)
    ? Math.max(0, params.holdingCostsMonthly as number)
    : 0;
  const totalHoldingCosts = Number((monthlyHolding * holdingMonths).toFixed(2));
  const netAcquisitionCost = Number((winningBid + quietTitleFees + totalHoldingCosts).toFixed(2));

  // Check Zero-Fabrication Invariant for ARV
  const hasValidArv = Number.isFinite(params.assumedArv) && (params.assumedArv as number) > 0;

  if (!hasValidArv) {
    return {
      status: "unbenchmarked_arv",
      arvSupplied: false,
      stateCode: state,
      isHomestead,
      statutoryRegime,
      statutoryCitation,
      statutoryRatePct,
      expectedHoldingMonths: holdingMonths,
      winningBid,
      assumedArv: null,
      redemptionProbability: probRedeem,
      acquisitionProbability: probAcquire,
      scenarioRedemption: {
        grossProceeds: redemptionPayoff,
        penaltyOrInterestAmount,
        netProfit: netRedemptionProfit,
        roiPct: redemptionRoiPct,
      },
      scenarioAcquisition: {
        assumedArv: null,
        quietTitleFees,
        totalHoldingCosts,
        netAcquisitionCost,
        netProfit: null,
        roiPct: null,
      },
      redemptionPayoff,
      netRedemptionProfit,
      acquisitionPayoff: null,
      netAcquisitionProfit: null,
      expectedNetProfit: null,
      expectedEv: null,
      blendedIrr: null,
      breakEvenRedemptionProbability: null,
      missingInputs: ["assumedArv"],
      notes: "Assumed ARV was not provided. Acquisition payoff and expected value cannot be computed without an explicit buyer-supplied ARV assumption (Zero-Fabrication Invariant).",
    };
  }

  const arv = params.assumedArv as number;
  const acquisitionPayoff = Number((arv - quietTitleFees - totalHoldingCosts).toFixed(2));
  const netAcquisitionProfit = Number((acquisitionPayoff - winningBid).toFixed(2));
  const acquisitionRoiPct = winningBid > 0 ? Number(((netAcquisitionProfit / winningBid) * 100).toFixed(2)) : 0;

  // Expected Value Calculation
  const expectedNetProfit = Number(((probRedeem * netRedemptionProfit) + (probAcquire * netAcquisitionProfit)).toFixed(2));
  const expectedEv = Number(((probRedeem * redemptionPayoff) + (probAcquire * acquisitionPayoff)).toFixed(2));

  // Blended Annualized IRR
  let blendedIrr: number | null = null;
  if (winningBid > 0) {
    const years = Math.max(0.25, holdingMonths / 12);
    const totalReturnMultiple = (winningBid + expectedNetProfit) / winningBid;
    if (totalReturnMultiple > 0) {
      blendedIrr = Number((((Math.pow(totalReturnMultiple, 1 / years) - 1)) * 100).toFixed(2));
    }
  }

  // Break-even redemption probability calculation:
  // p * netRedemption + (1 - p) * netAcquisition = 0
  // p * (netRedemption - netAcquisition) = -netAcquisition
  // p = netAcquisition / (netAcquisition - netRedemption)
  let breakEvenRedemptionProbability: number | null = null;
  const denom = netAcquisitionProfit - netRedemptionProfit;
  if (Math.abs(denom) > 0.0001) {
    const rawBreakEven = netAcquisitionProfit / denom;
    if (rawBreakEven >= 0 && rawBreakEven <= 1) {
      breakEvenRedemptionProbability = Number(rawBreakEven.toFixed(4));
    } else if (netRedemptionProfit >= 0 && netAcquisitionProfit >= 0) {
      // Both scenarios are profitable; break-even is achieved at 0.0 (all probabilities are profitable)
      breakEvenRedemptionProbability = 0;
    }
  }

  return {
    status: "benchmarked",
    arvSupplied: true,
    stateCode: state,
    isHomestead,
    statutoryRegime,
    statutoryCitation,
    statutoryRatePct,
    expectedHoldingMonths: holdingMonths,
    winningBid,
    assumedArv: arv,
    redemptionProbability: probRedeem,
    acquisitionProbability: probAcquire,
    scenarioRedemption: {
      grossProceeds: redemptionPayoff,
      penaltyOrInterestAmount,
      netProfit: netRedemptionProfit,
      roiPct: redemptionRoiPct,
    },
    scenarioAcquisition: {
      assumedArv: arv,
      quietTitleFees,
      totalHoldingCosts,
      netAcquisitionCost,
      netProfit: netAcquisitionProfit,
      roiPct: acquisitionRoiPct,
    },
    redemptionPayoff,
    netRedemptionProfit,
    acquisitionPayoff,
    netAcquisitionProfit,
    expectedNetProfit,
    expectedEv,
    blendedIrr,
    breakEvenRedemptionProbability,
    missingInputs: [],
  };
}
