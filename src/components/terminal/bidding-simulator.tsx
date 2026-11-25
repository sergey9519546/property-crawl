"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Listing } from "@/data/listings";
import { AlertTriangle, Banknote, Calculator, CheckCircle2, Download, FileJson, FileText, Scale, ShieldCheck, Sparkles } from "lucide-react";
import { classifyInvestmentStrategies, computeCashToClose, computeConstitutionalSurplus, computeDscrCoverage, computeMaxAllowableOffer, computeReassessmentShock, computeRedemptionYield, computeSafmrRentFloor, computeStatutoryDeadlinesAndCarry, computeStatutoryFeePreset, computeTargetPriceScenario, isTaxSaleContext, publishedRedemptionDays } from "@/lib/underwriting";
import { fetchAssessorReadingCached } from "@/components/listings/assessor-reading";
import { computeRedemptionExpectedValue } from "@/lib/redemption-ev";
import { displayMoney, positiveNumber } from "@/lib/listing-display";
import { readUnderwriteScenario, syncScenarioToDealFile, writeUnderwriteScenario } from "@/lib/underwrite-scenario";
import { addLocalWatchlistId } from "@/lib/watchlist-sync";
import { useResolvedWorkspaceSession } from "@/components/workspace/workspace-shell";
import { StatutoryDeadlinesTimeline } from "@/components/terminal/statutory-deadlines-timeline";
import { TitleRiskForensics } from "@/components/terminal/title-risk-forensics";
import { useLocale } from "@/components/i18n/locale-provider";

interface BiddingSimulatorProps { listing: Listing; publishedUpsetEstimate?: number | null; }

type ScenarioField = "registrationFunds" | "creditedDeposit" | "buyersPremium" | "sheriffPoundage" | "transferTax" | "delinquentTaxes" | "settlementCosts";

const fieldLabels: Record<ScenarioField, string> = {
  registrationFunds: "Registration funds",
  creditedDeposit: "Deposit credited to price",
  buyersPremium: "Buyer’s premium",
  sheriffPoundage: "Sheriff / trustee fee",
  transferTax: "Transfer tax",
  delinquentTaxes: "Taxes or debt buyer must satisfy",
  settlementCosts: "Other settlement / recording costs",
};

const acquisitionFields: ScenarioField[] = ["buyersPremium", "sheriffPoundage", "transferTax", "delinquentTaxes", "settlementCosts"];

const strategyLabels: Record<string, { label: string; desc: string }> = {
  wholesale: { label: "Wholesale", desc: "Equity spread supports assignment" },
  owner_occupy: { label: "Owner-Occupy", desc: "Under conforming limit with equity margin" },
  brrrr: { label: "BRRRR", desc: ">=30% spread allows refinance extraction" },
  rental: { label: "Long-Term Rental", desc: "Rent assumptions & equity support cash flow" },
  flip: { label: "Fix & Flip", desc: ">=25% discount with scheduled auction date" },
};

function enteredAmount(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function BiddingSimulator({ listing, publishedUpsetEstimate }: BiddingSimulatorProps) {
  const { messages: m } = useLocale();
  const workspaceSession = useResolvedWorkspaceSession();
  const dealSyncTimerRef = React.useRef<number | null>(null);
  const [rehabBudget, setRehabBudget] = useState(25_000);
  const [targetMargin, setTargetMargin] = useState(30);
  const [scenario, setScenario] = useState<Record<ScenarioField, string>>({
    registrationFunds: "", creditedDeposit: "", buyersPremium: "", sheriffPoundage: "", transferTax: "", delinquentTaxes: "", settlementCosts: "",
  });
  const [customValuation, setCustomValuation] = useState<string>("");
  const [customOpeningBid, setCustomOpeningBid] = useState<string>("");
  const [isImportingAssessor, setIsImportingAssessor] = useState(false);
  const [assessorError, setAssessorError] = useState<string | null>(null);
  const [simulationBreakdown, setSimulationBreakdown] = useState<string | null>(null);
  const [runningSimulation, setRunningSimulation] = useState(false);
  const [appliedPresetCitations, setAppliedPresetCitations] = useState<string[] | null>(null);
  const [isHomestead, setIsHomestead] = useState<boolean>(Boolean(listing.isHomestead));
  const [ltvPct, setLtvPct] = useState<number>(80);
  const [interestRatePct, setInterestRatePct] = useState<number>(7.25);
  const [monthlyInsurance, setMonthlyInsurance] = useState<number>(125);
  const [redemptionProbabilityPct, setRedemptionProbabilityPct] = useState<number>(75);
  const [packetExporting, setPacketExporting] = useState<"json" | "markdown" | null>(null);
  const [packetExportNotice, setPacketExportNotice] = useState<string | null>(null);
  const publishedRedemption = publishedRedemptionDays(listing);
  const [holdingMonths, setHoldingMonths] = useState<number>(() => {
    if (publishedRedemption !== null && publishedRedemption > 0) {
      return Math.max(1, Math.round(publishedRedemption / 30));
    }
    return 6;
  });

  useEffect(() => {
    const stored = readUnderwriteScenario(listing.id);
    if (!stored) return;
    setScenario({
      registrationFunds: stored.registrationFunds,
      creditedDeposit: stored.creditedDeposit,
      buyersPremium: stored.buyersPremium,
      sheriffPoundage: stored.sheriffPoundage,
      transferTax: stored.transferTax,
      delinquentTaxes: stored.delinquentTaxes,
      settlementCosts: stored.settlementCosts,
    });
    setRehabBudget(stored.rehabBudget);
    setTargetMargin(stored.targetMargin);
    if (stored.customValuation) {
      setCustomValuation(stored.customValuation);
    }
    if (stored.customOpeningBid) {
      setCustomOpeningBid(stored.customOpeningBid);
    }
    if (typeof stored.holdingMonths === "number" && stored.holdingMonths > 0) {
      setHoldingMonths(stored.holdingMonths);
    }
    if (typeof stored.isHomestead === "boolean") {
      setIsHomestead(stored.isHomestead);
    }
    if (typeof stored.ltvPct === "number") {
      setLtvPct(stored.ltvPct);
    }
    if (typeof stored.interestRatePct === "number") {
      setInterestRatePct(stored.interestRatePct);
    }
    if (typeof stored.monthlyInsurance === "number") {
      setMonthlyInsurance(stored.monthlyInsurance);
    }
    if (typeof stored.redemptionProbabilityPct === "number") {
      setRedemptionProbabilityPct(stored.redemptionProbabilityPct);
    }
  }, [listing.id]);

  useEffect(() => {
    const stored = readUnderwriteScenario(listing.id);
    if (typeof stored?.holdingMonths === "number" && stored.holdingMonths > 0) {
      return;
    }
    if (publishedRedemption !== null && publishedRedemption > 0) {
      setHoldingMonths(Math.max(1, Math.round(publishedRedemption / 30)));
    } else {
      setHoldingMonths(6);
    }
  }, [listing.id, publishedRedemption]);

  const rawPublishedOpeningBid = positiveNumber(listing.openingBid);
  const publishedMidpoint = (listing.estLow !== null && listing.estLow !== undefined && listing.estHigh !== null && listing.estHigh !== undefined && Number(listing.estHigh) >= Number(listing.estLow)) ? (Number(listing.estLow) + Number(listing.estHigh)) / 2 : null;
  const publisherValuation = positiveNumber(listing.mid) ?? publishedMidpoint ?? positiveNumber(listing.estHigh) ?? positiveNumber(listing.estLow);
  const isNominalStartingBid = rawPublishedOpeningBid !== null && rawPublishedOpeningBid <= 1000 && (publisherValuation === null || publisherValuation >= 10000);
  const publishedOpeningBid = isNominalStartingBid ? null : rawPublishedOpeningBid;
  const provenance = listing.provenance && typeof listing.provenance === "object" ? listing.provenance : {};
  const publishedUpset = positiveNumber(publishedUpsetEstimate ?? (provenance.approximateUpsetPrice as { amount?: unknown } | null | undefined)?.amount);
  // publishedUpsetEstimate is supplied by the detail SSR page to keep the grid payload stripped.
  const publishedJudgment = positiveNumber(listing.judgment);
  const customOpeningBidNum = (() => { const val = enteredAmount(customOpeningBid); return val !== null && val > 0 ? val : null; })();
  const openingBid = publishedOpeningBid ?? customOpeningBidNum;
  const isCustomOpeningBid = publishedOpeningBid === null && customOpeningBidNum !== null;
  const customValuationNum = enteredAmount(customValuation);
  const estimatedValue = customValuationNum ?? publisherValuation;
  const isCustomValuation = customValuationNum !== null;

  const hudSafmr = listing.hudSafmr;
  const safmrRentFloor = hudSafmr && hudSafmr.fairMarketRent > 0
    ? computeSafmrRentFloor({ monthlyRent: hudSafmr.fairMarketRent })
    : null;

  const amounts = Object.fromEntries(Object.entries(scenario).map(([field, value]) => [field, enteredAmount(value)])) as Record<ScenarioField, number | null>;
  const cash = computeCashToClose({ openingBid: openingBid ?? 0, purchasePrice: openingBid ?? 0, ...amounts });
  const otherAcquisitionCosts = acquisitionFields.every((field) => amounts[field] !== null)
    ? acquisitionFields.reduce((total, field) => total + (amounts[field] ?? 0), 0)
    : null;
  const reverseScenario = openingBid !== null
    ? computeTargetPriceScenario({ estimatedValue, targetMarginPct: targetMargin, rehabBudget, currentPrice: openingBid, otherAcquisitionCosts })
    : null;
  const standaloneMao = estimatedValue !== null && estimatedValue > 0
    ? computeMaxAllowableOffer({
        estimatedValue,
        targetMarginPct: targetMargin,
        rehabBudget,
        otherAcquisitionCosts,
      })
    : null;

  const calculateMao = (rehab: number, margin: number, customVal: string | null, customBid: string | null, scenarioMap: Record<ScenarioField, string>) => {
    const customValNum = customVal !== null && customVal !== "" && Number.isFinite(Number(customVal)) ? Number(customVal) : null;
    const activeEstimatedValue = customValNum ?? publisherValuation;
    if (activeEstimatedValue === null || activeEstimatedValue <= 0) return null;
    const activeAmounts = Object.fromEntries(Object.entries(scenarioMap).map(([field, value]) => [field, enteredAmount(value)])) as Record<ScenarioField, number | null>;
    const activeOtherAcquisitionCosts = acquisitionFields.every((field) => activeAmounts[field] !== null)
      ? acquisitionFields.reduce((total, field) => total + (activeAmounts[field] ?? 0), 0)
      : null;
    const customBidNum = customBid !== null && customBid !== "" && Number.isFinite(Number(customBid)) ? Number(customBid) : null;
    const activeOpeningBid = (customBidNum !== null && customBidNum > 0) ? customBidNum : (publishedOpeningBid ?? null);
    if (activeOpeningBid !== null && activeOtherAcquisitionCosts !== null) {
      const freshScenario = computeTargetPriceScenario({
        estimatedValue: activeEstimatedValue,
        targetMarginPct: margin,
        rehabBudget: rehab,
        currentPrice: activeOpeningBid,
        otherAcquisitionCosts: activeOtherAcquisitionCosts,
      });
      if (freshScenario) return freshScenario.maxPurchasePrice;
    }
    return computeMaxAllowableOffer({
      estimatedValue: activeEstimatedValue,
      targetMarginPct: margin,
      rehabBudget: rehab,
      otherAcquisitionCosts: activeOtherAcquisitionCosts,
    });
  };

  const persistScenario = (
    next: Record<ScenarioField, string>,
    rehab = rehabBudget,
    margin = targetMargin,
    customVal = customValuation,
    customBid = customOpeningBid,
    months = holdingMonths,
    homestead = isHomestead,
    ltv = ltvPct,
    rate = interestRatePct,
    insurance = monthlyInsurance,
    redemptionProb = redemptionProbabilityPct,
  ) => {
    const payload = {
      ...next,
      rehabBudget: rehab,
      targetMargin: margin,
      customValuation: customVal,
      customOpeningBid: customBid,
      holdingMonths: months,
      isHomestead: homestead,
      ltvPct: ltv,
      interestRatePct: rate,
      monthlyInsurance: insurance,
      redemptionProbabilityPct: redemptionProb,
      maxAllowableOffer: calculateMao(rehab, margin, customVal, customBid, next),
    };
    writeUnderwriteScenario(listing.id, payload);
    const canSyncRemote = Boolean(workspaceSession?.authenticated || workspaceSession?.memberTools);
    if (dealSyncTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(dealSyncTimerRef.current);
    }
    if (typeof window !== "undefined") {
      dealSyncTimerRef.current = window.setTimeout(() => {
        void syncScenarioToDealFile(listing.id, payload, {
          fetchImpl: canSyncRemote ? undefined : null,
        });
      }, 350);
    }
  };

  const updateHoldingMonths = (months: number) => {
    setHoldingMonths(months);
    persistScenario(scenario, rehabBudget, targetMargin, customValuation, customOpeningBid, months);
  };

  const updateHomestead = (homestead: boolean) => {
    setIsHomestead(homestead);
    persistScenario(scenario, rehabBudget, targetMargin, customValuation, customOpeningBid, holdingMonths, homestead);
  };

  const updateScenario = (field: ScenarioField, value: string) => {
    if (value !== "" && (!/^\d*(?:\.\d{0,2})?$/.test(value) || Number(value) < 0)) return;
    const next = { ...scenario, [field]: value };
    setScenario(next);
    persistScenario(next, rehabBudget, targetMargin, customValuation, customOpeningBid);
    setSimulationBreakdown(null);
  };

  const updateCustomValuation = (val: string) => {
    if (val !== "" && (!/^\d*(?:\.\d{0,2})?$/.test(val) || Number(val) < 0)) return;
    setCustomValuation(val);
    persistScenario(scenario, rehabBudget, targetMargin, val, customOpeningBid);
    setSimulationBreakdown(null);
  };

  const updateCustomOpeningBid = (val: string) => {
    if (val !== "" && (!/^\d*(?:\.\d{0,2})?$/.test(val) || Number(val) < 0)) return;
    setCustomOpeningBid(val);
    persistScenario(scenario, rehabBudget, targetMargin, customValuation, val);
    setSimulationBreakdown(null);
  };

  // The bid-cost model and the max-allowable-offer calculation do not need the
  // same inputs. Cost to close is arithmetic over the PUBLISHED opening amount
  // plus costs the buyer enters, so it is answerable whenever the publisher gave
  // us an opening bid. MAO is a statement about what the property is worth, so it
  // requires a supported valuation band and is withheld when none exists.
  //
  // Gating the whole panel on a valuation meant that with estLow/estHigh null
  // across the inventory (they are, on every record) this component rendered
  // its amber notice and nothing else - including the cash model it had already
  // computed and never displayed. That is dead code behind a gate the cost model
  // does not need.




  const handleImportAssessor = async () => {
    setIsImportingAssessor(true);
    setAssessorError(null);
    try {
      const data = await fetchAssessorReadingCached(listing.id);
      const figure = data?.marketComparison;
      if (figure && Number.isFinite(figure) && figure > 0) {
        const rounded = Math.round(figure).toString();
        updateCustomValuation(rounded);
      } else {
        setAssessorError(data?.withheldReason || "No figure available from county assessor.");
      }
    } catch {
      setAssessorError("Could not reach county assessor layer.");
    } finally {
      setIsImportingAssessor(false);
    }
  };

  const statutoryPreset = openingBid !== null ? computeStatutoryFeePreset({ purchasePrice: openingBid, state: listing.state, source: listing.source, depositText: typeof listing.deposit === "string" ? listing.deposit : null }) : null;
  const applyStatutoryPreset = () => {
    if (!statutoryPreset) return;
    const next: Record<ScenarioField, string> = {
      registrationFunds: String(statutoryPreset.registrationFunds),
      creditedDeposit: String(statutoryPreset.creditedDeposit),
      buyersPremium: String(statutoryPreset.buyersPremium),
      sheriffPoundage: String(statutoryPreset.sheriffPoundage),
      transferTax: String(statutoryPreset.transferTax),
      delinquentTaxes: scenario.delinquentTaxes || "0",
      settlementCosts: scenario.settlementCosts || "0",
    };
    setScenario(next);
    persistScenario(next, rehabBudget, targetMargin, customValuation);
    setAppliedPresetCitations([statutoryPreset.scheduleLabel, ...statutoryPreset.citations]);
    setSimulationBreakdown(null);
  };
  const hasIrsNoticeFlag = listing.source === "irs" || /(?:internal\s*revenue|federal\s*tax\s*lien|26\s*u\.?s\.?c\.?\s*§?\s*7425)/i.test(`${listing.seniorLienWarning || ""} ${listing.redemptionWarning || ""}`);
  const isTaxCandidate = isTaxSaleContext(listing);
  const deadlinesAndCarry = computeStatutoryDeadlinesAndCarry({
    saleDate: listing.saleDate,
    state: listing.state,
    source: listing.source,
    distressType: listing.distressType,
    auctionProgram: listing.auctionProgram,
    program: listing.program,
    notes: listing.notes,
    purchasePrice: cash.totalAcquisitionCost ?? openingBid ?? 0,
    marketValue: estimatedValue,
    taxAssessedValue: listing.assessed ?? null,
    redemptionDays: publishedRedemption,
    hasIrsLien: hasIrsNoticeFlag,
    seniorLienWarning: listing.seniorLienWarning,
    redemptionWarning: listing.redemptionWarning,
    isTaxSale: isTaxCandidate,
    isHomestead,
  });
  const statutoryCarry = deadlinesAndCarry;
  const reassessmentShock = openingBid !== null ? computeReassessmentShock({ purchasePrice: openingBid, state: listing.state }) : null;
  const isTaxSale = Boolean(isTaxCandidate || statutoryCarry.stateRedemptionDays > 0);
  const simulatedDays = holdingMonths * 30;
  const redemptionEv = isTaxSale && openingBid !== null
    ? computeRedemptionExpectedValue({
        winningBid: openingBid,
        assumedArv: estimatedValue,
        redemptionProbability: Math.max(0, Math.min(1, redemptionProbabilityPct / 100)),
        stateCode: listing.state,
        isHomestead,
        expectedHoldingMonths: holdingMonths,
      })
    : null;
  const redemptionYield = isTaxSale && openingBid !== null
    ? computeRedemptionYield({
        purchasePrice: openingBid,
        state: listing.state,
        redemptionDays: simulatedDays,
        isTaxSale: true,
        isHomestead,
      })
    : null;
  const rawRealizedBid = (listing as { realizedBid?: unknown }).realizedBid;
  const realizedBid = typeof rawRealizedBid === "number" ? rawRealizedBid : null;
  const surplusAnalysis = realizedBid !== null && realizedBid > 0 && typeof listing.judgment === "number" && listing.judgment > 0
    ? computeConstitutionalSurplus({ openingBid: realizedBid, judgmentDebt: listing.judgment })
    : null;
  const modeledDscr = hudSafmr && openingBid !== null ? (() => {
    const loanAmount = openingBid * Math.max(0, Math.min(1, ltvPct / 100));
    const r = Math.max(0, interestRatePct) / 100 / 12;
    const monthlyPrincipalInterest =
      loanAmount <= 0
        ? 0
        : r === 0
          ? Math.round(loanAmount / 360)
          : Math.round((loanAmount * (r * Math.pow(1 + r, 360))) / (Math.pow(1 + r, 360) - 1));
    const monthlyReassessedTax = Math.round((reassessmentShock?.reassessedAnnualTax ?? 0) / 12);
    return computeDscrCoverage({
      monthlyGrossRent: hudSafmr.fairMarketRent,
      monthlyPrincipalInterest,
      monthlyReassessedTax,
      monthlyInsurance: Math.max(0, monthlyInsurance),
      minDscrTarget: 1.20,
    });
  })() : null;

  const handleSignedPacketExport = async (format: "json" | "markdown") => {
    setPacketExporting(format);
    setPacketExportNotice(null);
    try {
      const payload = {
        disposition: "UNDERWRITE",
        maxAllowableOffer: reverseScenario?.maxPurchasePrice ?? standaloneMao ?? openingBid ?? null,
        rehabBudget,
        targetMargin,
        customValuation: customValuation || undefined,
        customOpeningBid: customOpeningBid || undefined,
        holdingMonths,
        isHomestead,
        isTaxSale,
        ...Object.fromEntries(
          Object.entries(scenario).filter(([, val]) => val !== ""),
        ),
      };
      const res = await fetch(
        `/api/listings/${encodeURIComponent(listing.id)}/packet?format=${format}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: format === "markdown" ? "text/markdown" : "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      if (res.status === 401 || res.status === 403 || res.status === 503) {
        setPacketExportNotice("Sign in / unlock operator session for server-signed POST export, or use the direct download links.");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Export returned HTTP ${res.status}`);
      }
      const text = await res.text();
      const mime = format === "markdown" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8";
      const ext = format === "markdown" ? "md" : "json";
      const blobUrl = URL.createObjectURL(new Blob([text], { type: mime }));
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `decision-packet-${listing.id}.${ext}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setPacketExportNotice(`Server-signed ${format.toUpperCase()} packet exported.`);
    } catch (err) {
      setPacketExportNotice(err instanceof Error ? err.message : "Signed packet export failed.");
    } finally {
      setPacketExporting(null);
    }
  };
  const strategyClassification = estimatedValue !== null && openingBid !== null ? classifyInvestmentStrategies({
    purchasePrice: openingBid,
    estimatedValueLow: estimatedValue,
    hasSaleDate: Boolean(listing.saleDate),
    dscrRatio: modeledDscr?.dscrRatio ?? null,
  }) : null;

  const affirmZeroCosts = () => {
    const next = { ...scenario, buyersPremium: "0", sheriffPoundage: "0", transferTax: "0", delinquentTaxes: "0", settlementCosts: "0" };
    setScenario(next);
    persistScenario(next, rehabBudget, targetMargin, customValuation);
    setSimulationBreakdown(null);
  };

  const handleRunSimulation = () => {
    if (openingBid === null) return;
    setRunningSimulation(true);

    if (reverseScenario && cash.totalAcquisitionCost !== null) {
      const costLine = otherAcquisitionCosts === null
        ? "Other acquisition costs are incomplete, so they are excluded from the target."
        : `Other acquisition costs you entered total ${displayMoney(otherAcquisitionCosts)}.`;
      const reductionLine = reverseScenario.priceReductionNeeded > 0
        ? `The published opening amount is ${displayMoney(reverseScenario.priceReductionNeeded)} above that target.`
        : `The published opening amount is ${displayMoney(Math.max(0, reverseScenario.maxPurchasePrice - openingBid))} below that target.`;
      const feasibilityLine = reverseScenario.targetAchievableAtCurrentPrice
        ? `Reaching the target at the opening amount requires ${displayMoney(reverseScenario.costReductionNeeded)} of cost reduction.`
        : "The target is not achievable at the opening amount, even with zero other acquisition costs.";
      const valuationLabel = isCustomValuation
        ? `entered ARV assumption ${displayMoney(estimatedValue)} (investor assumption, not a publisher appraisal)`
        : `valuation midpoint ${displayMoney(estimatedValue)}`;
      setSimulationBreakdown([
        `1. Maximum Allowable Offer = ${valuationLabel} minus ${targetMargin}% target margin, ${displayMoney(rehabBudget)} rehab budget, and entered settlement costs.`,
        `2. Target purchase ceiling: ${displayMoney(reverseScenario.maxPurchasePrice)}. ${costLine} ${reductionLine}`,
        `3. Feasibility: ${feasibilityLine}`,
        `4. Statutory Due Diligence: ${listing.redemptionWarning || (publishedRedemption !== null ? `${publishedRedemption}-day statutory redemption window applies.` : statutoryCarry.stateRedemptionDays > 0 ? `${statutoryCarry.stateRedemptionDays}-day statutory tax-sale redemption baseline applies.` : "Check local statutory redemption.")} ${listing.seniorLienWarning || "Verify senior judicial and municipal liens before bidding."}`,
      ].join("\n\n"));
    } else {
      const totalCost = cash.totalAcquisitionCost !== null
        ? displayMoney(cash.totalAcquisitionCost)
        : `At least ${displayMoney(openingBid)} + unresolved buyer fees`;
      const cashToClose = cash.cashDueAtSettlement !== null
        ? displayMoney(cash.cashDueAtSettlement)
        : "Unresolved until deposit and registration funds are entered";
      
      setSimulationBreakdown([
        `1. Acquisition Cost Model: Published opening amount is ${displayMoney(openingBid)}. Modeled total acquisition cost: ${totalCost} (with ${displayMoney(rehabBudget)} estimated rehab). Estimated cash to close: ${cashToClose}.`,
        `2. Statutory Redemption: ${listing.redemptionWarning || (publishedRedemption !== null ? `${publishedRedemption}-day statutory redemption period under ${listing.state || "state"} law.` : statutoryCarry.stateRedemptionDays > 0 ? `${statutoryCarry.stateRedemptionDays}-day statutory tax-sale redemption baseline under ${listing.state || "state"} law.` : "No statutory redemption period detected; verify clerk docket.")}`,
        `3. Title & Lien Risk: ${listing.seniorLienWarning || "No senior lien phrase detected. Certified title search must be performed before tender of cashier's check."}`,
        `4. Bidding Discipline: In distressed judicial auctions, opening amounts reflect petitioner debt or upset statutory minimums, not property value. Ensure rehab plus holding costs remain under 70% of verified local tax assessor or CMA value.`,
      ].join("\n\n"));
    }
    setRunningSimulation(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      {openingBid === null && (
        <div className="rounded-2xl border border-catch/30 bg-catch-wash p-5 text-ink shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" />
            <div className="flex-1">
              <h3 className="text-sm font-bold">{m.detailUi.simUnavailableHeading}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{isNominalStartingBid ? `Published $${Math.round(rawPublishedOpeningBid!).toLocaleString("en-US")} is a nominal starting bid placeholder (lender reserve / upset price undisclosed), so no acquisition scenario is modeled until you enter an assumed bid.` : "This record carries no published opening amount, so no bid scenario can be modeled. Nothing is inferred from the address or the county. Statutory deadlines, lien forensics, and packet export remain available below."}</p>
              <div className="mt-3 border-t border-catch/30 pt-3">
                <label htmlFor="custom-opening-bid-input" className="block text-xs font-semibold text-ink">
                  Model scenario with your target or assumed opening bid:
                </label>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <div className="flex items-center rounded-control border border-line-strong bg-card px-3 focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">
                    <span className="text-xs font-bold text-ink-3">$</span>
                    <input
                      id="custom-opening-bid-input"
                      inputMode="decimal"
                      value={customOpeningBid}
                      onChange={(event) => updateCustomOpeningBid(event.target.value)}
                      placeholder="e.g. 85000"
                      aria-label="Target bid or assumed opening amount"
                      className="w-32 bg-transparent px-2 py-1.5 text-xs font-semibold text-yours outline-none focus-visible:shadow-none"
                    />
                  </div>
                </div>
                {publishedOpeningBid === null && (publishedUpset !== null || publishedJudgment !== null) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {publishedUpset !== null && (
                      <button
                        type="button"
                        onClick={() => updateCustomOpeningBid(String(Math.round(publishedUpset)))}
                        className="rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 shadow-sm transition hover:bg-paper"
                      >
                        Use published upset ({displayMoney(publishedUpset)})
                      </button>
                    )}
                    {publishedJudgment !== null && (
                      <button
                        type="button"
                        onClick={() => updateCustomOpeningBid(String(Math.round(publishedJudgment)))}
                        className="rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 shadow-sm transition hover:bg-paper"
                      >
                        Use Court Judgment ({displayMoney(publishedJudgment)}) as Upset Estimate <span className="ml-1 text-ink-3">(Scenario input)</span>
                      </button>
                    )}
                  </div>
                )}
                <p className="mt-1.5 text-xs text-ink-3">
                  Entering an assumed opening bid enables cash-to-close and statutory fee modeling for this session as an investor assumption.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="space-y-5 rounded-2xl border border-line bg-card p-5 shadow-sm">
        <div className="flex items-start gap-2">
          <Calculator className="mt-0.5 h-5 w-5 text-ink" />
          <div>
            <h3 className="text-base font-bold text-ink">{estimatedValue === null ? m.detailUi.simCostModelHeading : m.detailUi.simMaoHeading}</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-3">{estimatedValue === null
              ? "Costs below are modeled from the published opening amount and the assumptions you enter. No fee is inferred from the source or state; enter 0 only when zero is your deliberate assumption. A maximum allowable offer is not shown because this record has no supported valuation."
              : "No fee is inferred from the source or state. Enter a published amount or your own assumption; enter 0 only when zero is your deliberate assumption."}</p>
          </div>
        </div>
        {openingBid !== null && (<>

        {isCustomOpeningBid && (
          <div className="rounded-xl border border-yours/30 bg-yours-wash px-3.5 py-2.5 text-xs text-ink">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-yours" />
                <span>Modeled from assumed target bid: <strong>{displayMoney(openingBid)}</strong> (investor assumption — opening bid unpublished)</span>
              </div>
              <button
                type="button"
                onClick={() => updateCustomOpeningBid("")}
                className="text-xs font-bold text-ink-2 underline underline-offset-2 hover:text-ink"
              >
                Reset bid
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.entries(fieldLabels).map(([field, label]) => (
            <label key={field} className="space-y-1 text-xs font-semibold text-ink-2">
              <span>{label}</span>
              <div className="flex items-center rounded-control border border-line-strong bg-card px-3 focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">
                <span className="text-ink-3">$</span>
                <input inputMode="decimal" value={scenario[field as ScenarioField]} onChange={(event) => updateScenario(field as ScenarioField, event.target.value)} placeholder="Unresolved" aria-label={`${label} assumption`} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm font-semibold text-yours outline-none focus-visible:shadow-none" />
              </div>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={affirmZeroCosts} className="text-xs font-bold text-ink-2 underline underline-offset-2">Explicitly set all acquisition-cost fields to $0</button>
          {statutoryPreset && (
            <button type="button" onClick={applyStatutoryPreset} className="rounded-lg border border-line-strong bg-paper px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-line">
              {statutoryPreset.supported === false ? `Apply generic baseline (${statutoryPreset.state} not modeled)` : `Apply ${statutoryPreset.state} statutory schedule preset`}
            </button>
          )}
        </div>
        {statutoryPreset?.supported === false && statutoryPreset.notice && <p role="note" data-testid="statutory-unsupported-notice" className="rounded-xl border border-catch/30 bg-catch-wash p-3 text-xs text-ink">{statutoryPreset.notice}</p>}
        {appliedPresetCitations && (
          <div className="rounded-xl border border-line-strong bg-paper p-3 text-xs leading-relaxed text-ink-2">
            <p className="font-bold">Applied statutory schedule assumption ({appliedPresetCitations[0]}):</p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {appliedPresetCitations.slice(1).map((cite) => <li key={cite}>{cite}</li>)}
            </ul>
            <p className="mt-1 text-xs text-ink-3">Explicit scenario assumptions only — verify exact county clerk / sheriff fee sheet before bidding.</p>
          </div>
        )}
        </>)}
        <StatutoryDeadlinesTimeline
          saleDate={listing.saleDate}
          state={listing.state}
          openingBid={openingBid}
          isHomestead={isHomestead}
          onHomesteadChange={updateHomestead}
          deadlinesAndCarry={deadlinesAndCarry}
        />
        <TitleRiskForensics
          plaintiff={listing.plaintiff}
          seniorLienRisk={listing.seniorLienRisk}
          seniorLienWarning={listing.seniorLienWarning}
          judgment={listing.judgment}
          openingBid={openingBid}
          state={listing.state}
          source={listing.source}
        />
        {redemptionYield && (
          <div className="rounded-xl rounded-xl border border-line bg-card p-3.5 text-xs text-ink space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-ink">Tax Deed Redemption Yield &amp; Penalty Model</span>
                <span className="rounded-md bg-paper px-2 py-0.5 text-xs font-extrabold text-ink-2 border border-line">
                  {redemptionYield.legalRegime}
                </span>
                {redemptionYield.instrumentBadge && (
                  <span className="rounded-md bg-card px-2 py-0.5 text-xs font-semibold text-ink-2 border border-line">
                    {redemptionYield.instrumentBadge}
                  </span>
                )}
              </div>
              {redemptionYield.regime === "post_redemption_deed" ? (
                <span className="rounded-md bg-paper px-2 py-0.5 font-bold text-ink border border-line">
                  0-Day Post-Sale Redemption (Immediate Fee-Simple Title)
                </span>
              ) : (
                <span className="rounded-md bg-paper px-2 py-0.5 font-extrabold text-ink border border-line">
                  +{redemptionYield.penaltyRatePct}% {redemptionYield.isFlatPenalty ? "statutory penalty" : "annual yield"} ({redemptionYield.annualizedYieldPct}% annualized)
                </span>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-line bg-card/60 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-2">Simulate redemption in month:</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[1, 3, 6, 12, 24].map((mo) => (
                    <button
                      key={mo}
                      type="button"
                      onClick={() => updateHoldingMonths(mo)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition ${
                        holdingMonths === mo
                          ? "bg-ink text-white border-ink shadow-xs"
                          : "bg-card text-ink border-line hover:border-ink/30"
                      }`}
                    >
                      {mo} mo
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="24"
                  step="1"
                  value={holdingMonths}
                  onChange={(e) => updateHoldingMonths(Number(e.target.value))}
                  className="w-full accent-ink"
                  aria-label="Holding duration in months"
                />
                <span className="text-xs font-bold text-ink whitespace-nowrap min-w-[3.5rem] text-right">
                  {holdingMonths} mo ({simulatedDays}d)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
              <div className="rounded-lg border border-line bg-card p-2.5">
                <span className="text-xs text-ink-3 uppercase font-semibold block">
                  {redemptionYield.yieldType === "penalty" ? "Penalty Rate" : "Interest Rate"}
                </span>
                <span className="text-sm font-bold text-ink">
                  {redemptionYield.penaltyRatePct}%
                </span>
              </div>
              <div className="rounded-lg border border-line bg-card p-2.5">
                <span className="text-xs text-ink-3 uppercase font-semibold block">Gross Payout if Redeemed</span>
                <span className="text-sm font-bold text-ink">
                  {displayMoney(redemptionYield.redemptionPayout)}
                </span>
              </div>
              <div className="rounded-lg border border-line bg-card p-2.5">
                <span className="text-xs text-ink-3 uppercase font-semibold block">Investor Yield / Profit</span>
                <span className="text-sm font-bold text-ink">
                  {redemptionYield.penaltyAmount > 0 ? `+${displayMoney(redemptionYield.penaltyAmount)}` : "$0 (Direct Title Acquisition)"}
                </span>
              </div>
              <div className="rounded-lg border border-line bg-card p-2.5">
                <span className="text-xs text-ink-3 uppercase font-semibold block">Annualized Return (IRR)</span>
                <span className="text-sm font-bold text-ink">
                  {redemptionYield.annualizedYieldPct}% annualized
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-line bg-card/60 p-2.5 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                <span className="font-semibold text-ink-2">Statutory Redemption Period:</span>
                <span className="font-medium text-ink">{redemptionYield.redemptionPeriodLabel}</span>
              </div>
              <p className="text-xs text-ink-3 leading-relaxed">{redemptionYield.statute}</p>
              {redemptionYield.regime === "redeemable_deed_flat_penalty" && (
                <p className="text-xs text-ink-2 font-medium leading-relaxed">
                  Flat statutory penalty does not prorate per-diem; full penalty is owed upon redemption regardless of exact day.
                </p>
              )}
              {redemptionYield.regime === "redeemable_deed_or_lien_interest" && (
                <p className="text-xs text-ink-2 font-medium leading-relaxed">
                  Accrues simple statutory interest over holding duration.
                </p>
              )}
              {redemptionYield.regime === "post_redemption_deed" && (
                <p className="text-xs text-ink-2 font-medium leading-relaxed">
                  Immediate title upon deed issuance; no post-sale redemption right survives the gavel drop.
                </p>
              )}
            </div>

            {redemptionEv && (
              <div className="rounded-lg border border-line bg-card/60 p-2.5 space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-ink">Dual-Outcome Tax Deed EV ({redemptionProbabilityPct}% Redeem / {100 - redemptionProbabilityPct}% Acquire)</span>
                  <span className="font-extrabold text-yours">
                    {redemptionEv.expectedNetProfit !== null ? displayMoney(redemptionEv.expectedNetProfit) : "ARV Needed for Blended EV"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                  <label htmlFor="redemption-probability-pct" className="font-medium text-ink-2">
                    Assumed redemption probability:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="redemption-probability-pct"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={redemptionProbabilityPct}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setRedemptionProbabilityPct(next);
                        persistScenario(scenario, rehabBudget, targetMargin, customValuation, customOpeningBid, holdingMonths, isHomestead, ltvPct, interestRatePct, monthlyInsurance, next);
                      }}
                      className="w-28 accent-ink"
                      aria-label="Assumed redemption probability percent"
                    />
                    <span className="font-bold text-ink min-w-[2.5rem] text-right">{redemptionProbabilityPct}%</span>
                  </div>
                </div>
                <p className="text-xs text-ink-3 leading-relaxed">
                  {redemptionEv.status === "benchmarked" && redemptionEv.blendedIrr !== null
                    ? `Blended Expected Net Return factoring ${redemptionEv.expectedHoldingMonths}mo holding carry: ${displayMoney(redemptionEv.expectedNetProfit ?? 0)} (${redemptionEv.blendedIrr}% blended annualized IRR).`
                    : "Zero-Fabrication Invariant: Blended acquisition expected value requires explicit buyer-supplied ARV assumption above."}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="space-y-4 border-t border-line pt-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-semibold text-ink-2"><label htmlFor="rehab-budget">Rehab assumption</label><span className="text-yours">{displayMoney(rehabBudget)}</span></div>
            <input id="rehab-budget" type="range" min="0" max="150000" step="5000" value={rehabBudget} onChange={(event) => { const next = Number(event.target.value); setRehabBudget(next); persistScenario(scenario, next, targetMargin); }} className="w-full accent-[var(--color-yours)]" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-semibold text-ink-2"><label htmlFor="target-margin">Target profit margin</label><span className="text-yours">{targetMargin}%</span></div>
            <input id="target-margin" type="range" min="10" max="40" step="5" value={targetMargin} onChange={(event) => { const next = Number(event.target.value); setTargetMargin(next); persistScenario(scenario, rehabBudget, next); }} className="w-full accent-[var(--color-yours)]" />
          </div>
        </div>

        {openingBid === null && (
          <div className="space-y-3 border-t border-line pt-4">
            {estimatedValue === null ? (
              <div className="rounded-xl border border-catch/30 bg-catch-wash p-4 text-ink">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-catch-ink" />
                  <div>
                    <h4 className="text-xs font-bold">Walk-Away Max Bid (MAO) requires a valuation assumption</h4>
                    <p className="mt-1 text-xs leading-relaxed text-ink-2">Enter your target ARV, import the county assessor figure, or apply the HUD SAFMR rent-floor scenario below to compute your Walk-Away Max Bid even before an opening bid is published.</p>
                  </div>
                </div>
                <div className="mt-3 border-t border-catch/30 pt-3">
                  <label htmlFor="custom-valuation-input" className="block text-xs font-semibold text-ink">
                    Model Walk-Away Max Bid (MAO) with your target ARV or benchmark assumption:
                  </label>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <div className="flex items-center rounded-control border border-line-strong bg-card px-3 focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">
                      <span className="text-xs font-bold text-ink-3">$</span>
                      <input
                        id="custom-valuation-input"
                        inputMode="decimal"
                        value={customValuation}
                        onChange={(event) => updateCustomValuation(event.target.value)}
                        placeholder="e.g. 185000"
                        aria-label="Target ARV or valuation assumption"
                        className="w-32 bg-transparent px-2 py-1.5 text-xs font-semibold text-yours outline-none focus-visible:shadow-none"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isImportingAssessor}
                      onClick={handleImportAssessor}
                      className="rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 shadow-sm transition hover:bg-paper disabled:opacity-50"
                    >
                      {isImportingAssessor ? "Reading assessor…" : "Import Assessor Figure"}
                    </button>
                    {safmrRentFloor !== null && hudSafmr && (
                      <button
                        type="button"
                        onClick={() => updateCustomValuation(String(safmrRentFloor))}
                        className="rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 shadow-sm transition hover:bg-paper"
                      >
                        Use 1.20× DSCR Rent-Floor ({displayMoney(safmrRentFloor)} from HUD SAFMR {displayMoney(hudSafmr.fairMarketRent)}/mo) <span className="ml-1 text-ink-3">(Scenario input)</span>
                      </button>
                    )}
                    {assessorError && (
                      <span className="text-xs text-catch-ink">{assessorError}</span>
                    )}
                  </div>
                </div>
              </div>
            ) : standaloneMao !== null ? (
              <div className="space-y-3">
                {isCustomValuation && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-yours/30 bg-yours-wash px-3.5 py-2.5 text-xs text-ink">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-yours" />
                      <span>Modeled from entered ARV assumption: <strong>{displayMoney(estimatedValue)}</strong> (investor assumption — not a publisher appraisal)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateCustomValuation("")}
                      className="text-xs font-bold text-ink-2 underline underline-offset-2 hover:text-ink"
                    >
                      Reset assumption
                    </button>
                  </div>
                )}
                <div className="rounded-xl border border-line bg-paper p-3.5" data-testid="walk-away-mao-card">
                  <p className="text-xs font-bold uppercase text-ink-3">Walk-Away Max Bid (MAO)</p>
                  <p className="mt-1 text-xl font-extrabold text-yours">{displayMoney(standaloneMao)}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    {displayMoney(estimatedValue)} valuation minus {targetMargin}% target margin ({displayMoney(Math.round(estimatedValue * (targetMargin / 100)))}) and {displayMoney(rehabBudget)} rehab{otherAcquisitionCosts !== null ? ` minus ${displayMoney(otherAcquisitionCosts)} entered acquisition costs` : " (before closing costs — enter an assumed opening bid above to model statutory fees)"}. Saved to your active underwriting scenario.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {openingBid !== null && (<>
        {cash.totalAcquisitionCost !== null ? (
          <div className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-paper p-3">
              <p className="text-xs font-bold uppercase text-ink-3">Acquisition cost at the opening amount</p>
              <p className="text-xl font-extrabold text-yours">{displayMoney(cash.totalAcquisitionCost)}</p>
              <p className="mt-1 text-xs text-ink-3">The published opening amount plus the acquisition costs you entered.</p>
            </div>
            {amounts.registrationFunds !== null && amounts.creditedDeposit !== null && cash.cashDueAtSettlement !== null ? (
              <div className="rounded-xl border border-line bg-paper p-3">
                <p className="text-xs font-bold uppercase text-ink-3">Cash to close</p>
                <p className="text-xl font-extrabold text-yours">{displayMoney(cash.cashDueAtSettlement)}</p>
                <p className="mt-1 text-xs text-ink-3">Acquisition cost minus the deposit credited to the price. Registration funds are not added again.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-catch/30 bg-catch-wash p-3 text-xs text-ink">Cash to close stays blank until registration funds and the credited deposit are both entered.</div>
            )}
          </div>
        ) : (
          <div className="flex gap-3 rounded-xl border border-catch/30 bg-catch-wash p-4 text-xs text-ink"><AlertTriangle className="h-4 w-4 shrink-0" /><p>Unknown taxes, debt, and fees are not treated as $0. Every acquisition-cost field needs a value before any total can be shown.</p></div>
        )}

        {estimatedValue === null ? (
          <div className="rounded-xl border border-catch/30 bg-catch-wash p-4 text-ink">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-catch-ink" />
              <div>
                <h4 className="text-xs font-bold">Price scenario unavailable</h4>
                <p className="mt-1 text-xs leading-relaxed text-ink-2">A maximum allowable offer is a statement about what this property is worth, and this record carries no supported comparable-sale valuation, so none is shown. The published opening amount is {displayMoney(openingBid)}; the cost model above uses only that amount and the assumptions you entered.</p>
              </div>
            </div>
            <div className="mt-3 border-t border-catch/30 pt-3">
              <label htmlFor="custom-valuation-input" className="block text-xs font-semibold text-ink">
                Model MAO with your target ARV or county assessor figure:
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="flex items-center rounded-control border border-line-strong bg-card px-3 focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">
                  <span className="text-xs font-bold text-ink-3">$</span>
                  <input
                    id="custom-valuation-input"
                    inputMode="decimal"
                    value={customValuation}
                    onChange={(event) => updateCustomValuation(event.target.value)}
                    placeholder="e.g. 185000"
                    aria-label="Target ARV or valuation assumption"
                    className="w-32 bg-transparent px-2 py-1.5 text-xs font-semibold text-yours outline-none focus-visible:shadow-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={isImportingAssessor}
                  onClick={handleImportAssessor}
                  className="rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 shadow-sm transition hover:bg-paper disabled:opacity-50"
                >
                  {isImportingAssessor ? "Reading assessor…" : "Import Assessor Figure"}
                </button>
                {safmrRentFloor !== null && hudSafmr && (
                  <button
                    type="button"
                    onClick={() => updateCustomValuation(String(safmrRentFloor))}
                    className="rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 shadow-sm transition hover:bg-paper"
                  >
                    Use 1.20× DSCR Rent-Floor ({displayMoney(safmrRentFloor)} from HUD SAFMR {displayMoney(hudSafmr.fairMarketRent)}/mo) <span className="ml-1 text-ink-3">(Scenario input)</span>
                  </button>
                )}
                {assessorError && (
                  <span className="text-xs text-catch-ink">{assessorError}</span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-ink-3">
                Entering an assumption enables MAO modeling for this session. It will be labeled as an investor assumption, not a publisher appraisal.
              </p>
            </div>
          </div>
        ) : reverseScenario ? (
          <div className="space-y-3">
            {isCustomValuation && (
              <div className="flex items-center justify-between rounded-xl border border-yours/30 bg-yours-wash px-3.5 py-2.5 text-xs text-ink">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-yours" />
                  <span>Modeled from entered ARV assumption: <strong>{displayMoney(estimatedValue)}</strong> (investor assumption — not a publisher appraisal)</span>
                </div>
                <button
                  type="button"
                  onClick={() => updateCustomValuation("")}
                  className="text-xs font-bold text-ink-2 underline underline-offset-2 hover:text-ink"
                >
                  Reset assumption
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-2">
              <div className="rounded-xl border border-line bg-paper p-3"><p className="text-xs font-bold uppercase text-ink-3">Maximum price meeting target</p><p className="text-xl font-extrabold text-yours">{displayMoney(reverseScenario.maxPurchasePrice)}</p><p className="mt-1 text-xs text-ink-3">After explicit costs, rehab, and target profit.</p></div>
              <div className="rounded-xl border border-line bg-paper p-3"><p className="text-xs font-bold uppercase text-ink-3">Change needed at opening amount</p><p className="text-xl font-extrabold text-yours">{displayMoney(reverseScenario.priceReductionNeeded)}</p><p className="mt-1 text-xs text-ink-3">Required price reduction if costs stay unchanged.</p></div>
              <div className="rounded-xl border border-line bg-paper p-3 sm:col-span-2">
                <p className="text-xs font-bold uppercase text-ink-3">Cost alternative</p>
                <p className="mt-1 text-sm font-bold text-yours">At the opening amount, other acquisition costs may total at most {displayMoney(reverseScenario.maxOtherAcquisitionCostsAtCurrentPrice)}.</p>
                <p className="mt-1 text-xs text-ink-3">{reverseScenario.targetAchievableAtCurrentPrice ? `Required cost reduction: ${displayMoney(reverseScenario.costReductionNeeded)}.` : "The target cannot be achieved at the current price, even with zero other acquisition costs."} Registration funds and a credited deposit affect timing and liquidity; a credited deposit is not counted twice.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {standaloneMao !== null && (
              <div className="rounded-xl border border-line bg-paper p-3.5" data-testid="walk-away-mao-card">
                <p className="text-xs font-bold uppercase text-ink-3">Walk-Away Max Bid (MAO) — Pre-Closing Costs</p>
                <p className="mt-1 text-xl font-extrabold text-yours">{displayMoney(standaloneMao)}</p>
                <p className="mt-1 text-xs text-ink-3">Valuation minus {targetMargin}% target margin and {displayMoney(rehabBudget)} rehab before unresolved acquisition costs.</p>
              </div>
            )}
            <div className="flex gap-3 rounded-xl border border-catch/30 bg-catch-wash p-4 text-xs text-ink"><AlertTriangle className="h-4 w-4 shrink-0" /><p>Target price remains unresolved until every acquisition-cost field has a value. Unknown taxes, debt, and fees are not treated as $0.</p></div>
          </div>
        )}
        </>)}
      </div>

      {openingBid !== null && reverseScenario && (
        <div className={`flex gap-3 rounded-xl border p-4 text-sm ${reverseScenario.priceReductionNeeded > 0 ? "border-catch/30 bg-catch-wash text-ink" : "border-line-strong bg-paper text-ink-2"}`}>
          {reverseScenario.priceReductionNeeded > 0 ? <AlertTriangle className="h-5 w-5 shrink-0 text-catch-ink" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-ink-3" />}
          <p>{reverseScenario.priceReductionNeeded > 0 ? <>The opening amount is {displayMoney(reverseScenario.priceReductionNeeded)} above the price that meets this scenario&apos;s target.</> : <>The opening amount meets this scenario&apos;s target with {displayMoney(reverseScenario.maxPurchasePrice - (openingBid ?? 0))} of price headroom.</>}</p>
        </div>
      )}

      {/* Export Decision Packet */}
      <div className="rounded-2xl border border-line bg-card p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">
              <Download className="h-4 w-4 text-yours" />
              <span>Export Decision Packet</span>
            </h4>
            <p className="mt-0.5 text-xs text-ink-3">
              Export complete forensic underwriting dossier with your active scenario assumptions, statutory carry schedule, and checksum.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <a
            href={`/api/listings/${encodeURIComponent(listing.id)}/packet?format=json&disposition=UNDERWRITE&maxAllowableOffer=${encodeURIComponent(String(reverseScenario?.maxPurchasePrice ?? openingBid ?? ""))}&rehabBudget=${encodeURIComponent(String(rehabBudget))}&targetMargin=${encodeURIComponent(String(targetMargin))}&transferTax=${encodeURIComponent(scenario.transferTax)}&registrationFunds=${encodeURIComponent(scenario.registrationFunds)}&creditedDeposit=${encodeURIComponent(scenario.creditedDeposit)}&sheriffPoundage=${encodeURIComponent(scenario.sheriffPoundage)}&buyersPremium=${encodeURIComponent(scenario.buyersPremium)}&settlementCosts=${encodeURIComponent(scenario.settlementCosts)}&delinquentTaxes=${encodeURIComponent(scenario.delinquentTaxes)}&customValuation=${encodeURIComponent(customValuation)}&customOpeningBid=${encodeURIComponent(customOpeningBid)}&holdingMonths=${encodeURIComponent(String(holdingMonths))}&isHomestead=${encodeURIComponent(String(isHomestead))}&isTaxSale=${encodeURIComponent(String(isTaxSale))}`}
            target="_blank"
            rel="noopener noreferrer"
            download={`decision-packet-${listing.id}.json`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-paper px-3 py-1.5 text-xs font-bold text-ink shadow-sm transition hover:bg-card hover:border-yours"
          >
            <FileJson className="h-3.5 w-3.5 text-yours" />
            <span>Download JSON Packet</span>
          </a>
          <a
            href={`/api/listings/${encodeURIComponent(listing.id)}/packet?format=markdown&disposition=UNDERWRITE&maxAllowableOffer=${encodeURIComponent(String(reverseScenario?.maxPurchasePrice ?? openingBid ?? ""))}&rehabBudget=${encodeURIComponent(String(rehabBudget))}&targetMargin=${encodeURIComponent(String(targetMargin))}&transferTax=${encodeURIComponent(scenario.transferTax)}&registrationFunds=${encodeURIComponent(scenario.registrationFunds)}&creditedDeposit=${encodeURIComponent(scenario.creditedDeposit)}&sheriffPoundage=${encodeURIComponent(scenario.sheriffPoundage)}&buyersPremium=${encodeURIComponent(scenario.buyersPremium)}&settlementCosts=${encodeURIComponent(scenario.settlementCosts)}&delinquentTaxes=${encodeURIComponent(scenario.delinquentTaxes)}&customValuation=${encodeURIComponent(customValuation)}&customOpeningBid=${encodeURIComponent(customOpeningBid)}&holdingMonths=${encodeURIComponent(String(holdingMonths))}&isHomestead=${encodeURIComponent(String(isHomestead))}&isTaxSale=${encodeURIComponent(String(isTaxSale))}`}
            target="_blank"
            rel="noopener noreferrer"
            download={`decision-packet-${listing.id}.md`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-paper px-3 py-1.5 text-xs font-bold text-ink shadow-sm transition hover:bg-card hover:border-yours"
          >
            <FileText className="h-3.5 w-3.5 text-yours" />
            <span>Download Markdown Memo</span>
          </a>
          <button
            type="button"
            disabled={packetExporting !== null}
            onClick={() => handleSignedPacketExport("json")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-bold text-ink shadow-sm transition hover:border-yours disabled:opacity-60"
          >
            <FileJson className="h-3.5 w-3.5 text-ink-2" />
            <span>{packetExporting === "json" ? "Exporting..." : "Signed POST JSON"}</span>
          </button>
          <button
            type="button"
            disabled={packetExporting !== null}
            onClick={() => handleSignedPacketExport("markdown")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-bold text-ink shadow-sm transition hover:border-yours disabled:opacity-60"
          >
            <FileText className="h-3.5 w-3.5 text-ink-2" />
            <span>{packetExporting === "markdown" ? "Exporting..." : "Signed POST Markdown"}</span>
          </button>
          <Link
            href="/bid-sheet"
            onClick={() => addLocalWatchlistId(listing.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-yours/30 bg-yours-wash px-3 py-1.5 text-xs font-bold text-yours shadow-sm transition hover:bg-card"
          >
            <Banknote className="h-3.5 w-3.5" />
            <span>Send to Morning Bid Sheet</span>
          </Link>
        </div>
        {packetExportNotice && (
          <p className="text-xs text-ink-3" role="status">
            {packetExportNotice}
          </p>
        )}
      </div>

      {/* Statutory Tax Reset, Surplus & Rental Coverage */}
      <div className="space-y-4 rounded-2xl border border-line bg-card p-5 shadow-sm">
        <div className="flex items-start gap-2">
          <Scale className="mt-0.5 h-5 w-5 text-ink" />
          <div>
            <h4 className="text-sm font-bold text-ink">Statutory Tax Reset, Surplus &amp; Rental Coverage</h4>
            <p className="mt-0.5 text-xs text-ink-3">
              Post-sale tax reassessment shock, constitutional surplus equity recovery, and historical HUD SAFMR rent benchmarks.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Post-Sale Tax Reassessment */}
          <div className="rounded-xl border border-line bg-paper p-3.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-ink-3">Post-Sale Tax Reassessment</span>
              {reassessmentShock && (
                <span className="rounded bg-line px-1.5 py-0.5 text-xs font-semibold text-ink-2">{reassessmentShock.rule.ruleName}</span>
              )}
            </div>
            {reassessmentShock && openingBid !== null ? (
              <>
                <p className="text-lg font-extrabold text-yours">
                  {reassessmentShock.reassessedAnnualTax !== null ? `${displayMoney(reassessmentShock.reassessedAnnualTax)}/yr` : "Unresolved"}
                </p>
                <p className="text-xs text-ink-2">
                  Reassessed annual tax ({reassessmentShock.reassessedAnnualTax !== null ? displayMoney(reassessmentShock.reassessedAnnualTax) : "Unresolved"}/yr at {reassessmentShock.rule.effectiveTaxRatePct}% statutory basis on {displayMoney(openingBid)} purchase price).
                </p>
                <p className="text-xs text-ink-3 leading-tight">
                  Citation: {reassessmentShock.rule.statutoryReference}
                </p>
              </>
            ) : (
              <p className="text-xs text-ink-3">
                Enter an assumed opening bid above to model statutory post-sale tax reassessment for {listing.state || "this state"}.
              </p>
            )}
          </div>

          {/* HUD FY2025 SAFMR Rent Benchmark */}
          {hudSafmr ? (
            <div className="rounded-xl border border-line bg-paper p-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-ink-3">HUD FY2025 SAFMR Rent Benchmark</span>
                <span className="rounded bg-line px-1.5 py-0.5 text-xs font-semibold text-ink-2">{hudSafmr.bedrooms}BR • ZIP {hudSafmr.zip}</span>
              </div>
              <p className="text-lg font-extrabold text-yours">
                {displayMoney(hudSafmr.fairMarketRent)}/mo
              </p>
              <p className="text-xs text-ink-2">
                Published Section 8 Fair Market Rent ({displayMoney(hudSafmr.fairMarketRent)}/mo for {hudSafmr.bedrooms}BR in ZIP {hudSafmr.zip}, 90%–110% payment standard {displayMoney(hudSafmr.paymentStandard90Pct)}–{displayMoney(hudSafmr.paymentStandard110Pct)}/mo).
              </p>
              {safmrRentFloor !== null && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => updateCustomValuation(String(safmrRentFloor))}
                    className="rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 shadow-sm transition hover:bg-paper"
                  >
                    Use 1.20× DSCR Rent-Floor ({displayMoney(safmrRentFloor)} from HUD SAFMR {displayMoney(hudSafmr.fairMarketRent)}/mo) <span className="ml-1 text-ink-3">(Scenario input)</span>
                  </button>
                </div>
              )}
              {modeledDscr && (
                <div className="mt-1 pt-1.5 border-t border-line text-xs space-y-2">
                  <div className="flex items-center justify-between gap-1 text-ink">
                    <span className="font-semibold">Modeled DSCR Scenario ({ltvPct}% LTV, {interestRatePct}% 30-yr P&amp;I + {displayMoney(Math.round((reassessmentShock?.reassessedAnnualTax ?? 0) / 12))}/mo tax + {displayMoney(monthlyInsurance)}/mo insurance):</span>
                    <span className={`font-bold ${modeledDscr.status === "qualified" ? "text-yours" : "text-catch-ink"}`}>
                      {modeledDscr.dscrRatio ? `${modeledDscr.dscrRatio}x` : "N/A"} ({modeledDscr.status})
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="space-y-0.5 text-label font-medium text-ink-2">
                      <span>LTV %</span>
                      <input
                        type="number"
                        min="0"
                        max="95"
                        step="5"
                        value={ltvPct}
                        aria-label="Modeled DSCR LTV percentage"
                        onChange={(e) => {
                          const parsed = Number(e.target.value);
                          const next = Number.isFinite(parsed) ? Math.max(0, Math.min(95, parsed)) : 0;
                          setLtvPct(next);
                          persistScenario(scenario, rehabBudget, targetMargin, customValuation, customOpeningBid, holdingMonths, isHomestead, next, interestRatePct, monthlyInsurance, redemptionProbabilityPct);
                        }}
                        className="w-full rounded border border-line-strong bg-card px-2 py-1 text-xs font-semibold text-ink outline-none focus:border-yours"
                      />
                    </label>
                    <label className="space-y-0.5 text-label font-medium text-ink-2">
                      <span>Rate %</span>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        step="0.125"
                        value={interestRatePct}
                        aria-label="Modeled DSCR interest rate percentage"
                        onChange={(e) => {
                          const parsed = Number(e.target.value);
                          const next = Number.isFinite(parsed) ? Math.max(0, Math.min(20, parsed)) : 0;
                          setInterestRatePct(next);
                          persistScenario(scenario, rehabBudget, targetMargin, customValuation, customOpeningBid, holdingMonths, isHomestead, ltvPct, next, monthlyInsurance, redemptionProbabilityPct);
                        }}
                        className="w-full rounded border border-line-strong bg-card px-2 py-1 text-xs font-semibold text-ink outline-none focus:border-yours"
                      />
                    </label>
                    <label className="space-y-0.5 text-label font-medium text-ink-2">
                      <span>Ins. $/mo</span>
                      <input
                        type="number"
                        min="0"
                        max="5000"
                        step="25"
                        value={monthlyInsurance}
                        aria-label="Modeled DSCR monthly insurance assumption"
                        onChange={(e) => {
                          const parsed = Number(e.target.value);
                          const next = Number.isFinite(parsed) ? Math.max(0, Math.min(5000, parsed)) : 0;
                          setMonthlyInsurance(next);
                          persistScenario(scenario, rehabBudget, targetMargin, customValuation, customOpeningBid, holdingMonths, isHomestead, ltvPct, interestRatePct, next, redemptionProbabilityPct);
                        }}
                        className="w-full rounded border border-line-strong bg-card px-2 py-1 text-xs font-semibold text-ink outline-none focus:border-yours"
                      />
                    </label>
                  </div>
                  <p className="text-xs text-ink-3 leading-tight">
                    {modeledDscr.explanation}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-paper p-3.5 space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-ink-3">HUD FY2025 SAFMR Rent Benchmark</span>
              <p className="text-xs text-ink-3">
                No statutory HUD SAFMR benchmark record published for ZIP {listing.zip || "unrecorded"}. Section 8 payment standards must be verified through the local housing authority.
              </p>
            </div>
          )}
        </div>

        {/* Constitutional Surplus (Tyler v. Hennepin) */}
        {surplusAnalysis && (
          <div className="rounded-xl border border-line-strong bg-paper p-3.5 space-y-1 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-bold text-ink">
                <ShieldCheck className="h-4 w-4 text-yours shrink-0" />
                <span>Constitutional Surplus Analysis (Tyler v. Hennepin / Pung Doctrine)</span>
              </div>
              {surplusAnalysis.estimatedSurplus !== null && (
                <span className="text-sm font-extrabold text-yours">
                  {displayMoney(surplusAnalysis.estimatedSurplus)}
                </span>
              )}
            </div>
            <p className="text-ink-2 leading-relaxed">
              Estimated surplus: {surplusAnalysis.estimatedSurplus !== null ? displayMoney(surplusAnalysis.estimatedSurplus) : "None"}. {surplusAnalysis.explanation}
            </p>
            <p className="text-xs text-ink-3 leading-tight">
              {surplusAnalysis.statutoryDisclaimer}
            </p>
          </div>
        )}

        {/* Strategy Classification Badges */}
        {estimatedValue !== null && strategyClassification && (
          <div className="border-t border-line pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink">Modeled Investment Exit Strategies:</span>
              <span className="text-xs text-ink-3">Based on conservative equity spread &amp; DSCR</span>
            </div>
            {strategyClassification.strategies.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {strategyClassification.strategies.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-yours/40 bg-yours-wash px-2.5 py-1 text-xs font-semibold text-ink"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-yours" />
                    <span>{strategyLabels[tag]?.label ?? tag}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-3">No strategies qualified under conservative hurdle rates (requires &gt;=10% discount to ARV).</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2.5 rounded-xl border border-line bg-paper p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink"><Sparkles className="h-3.5 w-3.5 fill-ink-3 text-ink-3" /><span>Deterministic Scenario Breakdown</span></div>
          <button disabled={openingBid === null || runningSimulation} onClick={handleRunSimulation} className="rounded-lg bg-ink px-2.5 py-1 text-xs font-bold text-white shadow-sm transition hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40">{simulationBreakdown ? "Re-run explanation" : "Explain scenario & risks"}</button>
        </div>
        {runningSimulation && <p className="animate-pulse text-xs text-ink-3">Checking the entered scenario...</p>}
        {simulationBreakdown && <div className="whitespace-pre-line border-t border-line pt-2 text-xs leading-relaxed text-ink-2">{simulationBreakdown}</div>}
      </div>
    </div>
  );
}
