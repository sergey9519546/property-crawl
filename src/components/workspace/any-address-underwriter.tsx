"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, FileText, Gavel, Landmark, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Fact } from "@/components/evidence/fact";
import { cn } from "@/lib/utils";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "PR",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY",
] as const;

const SOURCE_OPTIONS = [
  { value: "", label: "Off-platform / Unspecified" },
  { value: "sheriff", label: "County Sheriff Sale" },
  { value: "civilview", label: "CivilView Sheriff Portal" },
  { value: "trustee", label: "Non-Judicial Trustee Sale" },
  { value: "tax-deed", label: "County Tax Deed / Tax Sale" },
  { value: "hud", label: "HUD REO (Federal)" },
  { value: "fannie", label: "Fannie Mae HomePath (REO)" },
  { value: "freddie", label: "Freddie Mac HomeSteps (REO)" },
  { value: "va", label: "VA Acquired Property (REO)" },
  { value: "usda", label: "USDA Rural Housing REO" },
  { value: "gsa", label: "GSA Federal Surplus" },
  { value: "treasury", label: "U.S. Treasury Seized Property" },
  { value: "irs", label: "IRS Seized Property Auction" },
] as const;

type CitationSpan = {
  value: string | number;
  quote: string;
  start: number;
  end: number;
  verified: boolean;
};

type UnderwriteResponse = {
  schema: string;
  generatedAt: string;
  inputSummary: {
    address: string;
    state: string;
    county: string | null;
    zip: string | null;
    beds: number | null;
    openingBid: number | null;
    judgment: number | null;
    assessed: number | null;
    saleDate: string | null;
    source: string | null;
    program: string | null;
    saleType: string;
    caseNumber: string | null;
    apn: string | null;
    occupancy: string | null;
    estLow: null;
    estHigh: null;
    dealScore: null;
    fieldOrigins: Record<string, "supplied" | "extracted_from_notice" | "missing">;
  };
  publicBenchmarks: {
    hudSafmr: {
      zip: string;
      bedrooms: number;
      fairMarketRent: number;
      paymentStandard90Pct: number;
      paymentStandard110Pct: number;
      hudAreaName: string;
      bedroomRents: number[];
      source: string;
      asOfFiscalYear: string;
      disclaimer: string;
    } | null;
    safmrRentFloor120Dscr: number | null;
    assessorReading: {
      enrolled: boolean;
      found: boolean;
      countyKey: string | null;
      countyName?: string | null;
      field: string | null;
      rawFigure: number | null;
      marketComparison: number | null;
      ratio: number | null;
      dealScore: number | null;
      citation: string | null;
      withheldReason: string | null;
      isAppraisal: boolean;
    } | null;
    consensus: {
      benchmarkType: string;
      isAppraisal: boolean;
      isBidRecommendation: boolean;
      disclaimer: string;
      evidenceAvailabilityRatio: number;
      availableSourceCount: number;
      sourcesAvailable: string[];
      unobservedReasons: string[];
      assessorRoll: {
        assessedValue: number;
        county?: string | null;
        apn?: string | null;
        marketComparison?: number | null;
        citation?: string | null;
      } | null;
      impliedGrm: number | null;
      stateMacroHpi: {
        state: string;
        quarterPct?: number | null;
        yoyPct?: number | null;
        latestPeriod?: string | null;
        source?: string | null;
      } | null;
      estLow: null;
      estHigh: null;
      dealScore: null;
    };
  };
  riskAndCarry: {
    titleRisk: {
      riskLevel: string;
      plaintiffType: string;
      firstMortgageSurvives: boolean | null;
      canProceedWithBid: boolean;
      statutoryRedemption: {
        state: string;
        days: number;
        label: string;
      };
      irsTaxLienRedemption: {
        hasIrsLien: boolean;
        redemptionDays: number;
        statute: string;
        warning: string | null;
      };
      hoaSuperPriority: {
        isSuperPriorityState: boolean;
        monthsProtected: number;
        statute: string | null;
      };
      bankruptcyStay: {
        hasBankruptcyFiling: boolean;
        stayEffective: boolean;
        serialFilerFlag?: string | null;
      };
      titleWarnings: string[];
      titleActionAdvice: string;
    };
    catchSummary: string | null;
    possessionTimeline: {
      state: string | null;
      saleType: string | null;
      isPostForeclosureReo?: boolean;
      statutoryRedemptionDays?: number | null;
      statutoryRedemptionLabel?: string | null;
      quietTitle: { minDays: number | null; maxDays: number | null; statutory: string | null; notes: string | null };
      writOfPossession: { minDays: number | null; maxDays: number | null; statutory: string | null; notes: string | null };
      carryCost: {
        minHoldDays: number | null;
        maxHoldDays: number | null;
        estimatedHoldDays: number | null;
        totalEstimatedCost: number | null;
        missingInputs: string[];
        basis: string;
      };
      summary: string;
    };
  };
  noticeExtraction: {
    present: boolean;
    truncated: boolean;
    charCount: number;
    fields: {
      caseNumber: string | null;
      judgment: number | null;
      openingBid: number | null;
      apn: string | null;
      occupancy: string | null;
    };
    citations: Record<string, CitationSpan>;
    occupancyFlags: Array<{
      flag: string;
      quote: string;
      start: number;
      end: number;
      verified: boolean;
    }>;
  };
};

function fmtUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not published";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function originBadge(origin?: "supplied" | "extracted_from_notice" | "missing") {
  if (origin === "supplied") return <Badge variant="yours">Supplied</Badge>;
  if (origin === "extracted_from_notice") return <Badge variant="neutral">Notice extract</Badge>;
  return <Badge variant="catch">Missing</Badge>;
}

const CITATION_LABELS: Record<string, string> = {
  caseNumber: "Case / Docket",
  judgment: "Judgment",
  openingBid: "Opening / Upset Bid",
  apn: "APN / Block-Lot",
  occupancy: "Occupancy",
};

export function AnyAddressUnderwriter() {
  const [address, setAddress] = React.useState("");
  const [state, setState] = React.useState("OH");
  const [zip, setZip] = React.useState("");
  const [county, setCounty] = React.useState("");
  const [beds, setBeds] = React.useState("");
  const [openingBid, setOpeningBid] = React.useState("");
  const [judgment, setJudgment] = React.useState("");
  const [assessed, setAssessed] = React.useState("");
  const [saleDate, setSaleDate] = React.useState("");
  const [source, setSource] = React.useState("");
  const [program, setProgram] = React.useState("");
  const [noticeText, setNoticeText] = React.useState("");

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<UnderwriteResponse | null>(null);
  const [activeSpan, setActiveSpan] = React.useState<{ start: number; end: number; label: string } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setActiveSpan(null);

    try {
      const payload = {
        address: address.trim(),
        state,
        zip: zip.trim() || undefined,
        county: county.trim() || undefined,
        beds: beds !== "" ? Number(beds) : undefined,
        openingBid: openingBid.trim() !== "" ? Number(openingBid) : undefined,
        judgment: judgment.trim() !== "" ? Number(judgment) : undefined,
        assessed: assessed.trim() !== "" ? Number(assessed) : undefined,
        saleDate: saleDate.trim() || undefined,
        source: source || undefined,
        program: program.trim() || undefined,
        noticeText: noticeText.trim() ? noticeText : undefined,
      };

      const response = await fetch("/api/underwrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || `Underwrite failed (${response.status})`);
      }
      setResult(json as UnderwriteResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete underwriting request");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setAddress("");
    setState("OH");
    setZip("");
    setCounty("");
    setBeds("");
    setOpeningBid("");
    setJudgment("");
    setAssessed("");
    setSaleDate("");
    setSource("");
    setProgram("");
    setNoticeText("");
    setResult(null);
    setError(null);
    setActiveSpan(null);
  }

  const inputClass =
    "mt-1.5 w-full rounded-control border border-line-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-3";

  const citationsList = result
    ? Object.entries(result.noticeExtraction.citations || {}).map(([key, span]) => ({
        key,
        label: CITATION_LABELS[key] || key,
        ...span,
      }))
    : [];

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-8 lg:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-label font-bold uppercase tracking-widest text-ink-3">
            Off-Platform Distressed Underwriter
          </p>
          <h1 className="mt-2 text-title font-bold text-ink">
            Any-Address Underwriting Engine
          </h1>
          <p className="mt-2 max-w-3xl text-body text-ink-2">
            Evaluate any off-platform property or courthouse notice against published HUD SAFMR rent ceilings,
            enrolled county assessor ratios, statutory title survival rules, and post-sale possession timelines.
            Missing valuations are never fabricated.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="neutral">Zero-Fabrication</Badge>
          <Badge variant="yours">Your Inputs</Badge>
          <Badge variant="catch">Catch First</Badge>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[440px_1fr] lg:items-start">
        <form
          onSubmit={handleSubmit}
          className="rounded-card border border-line bg-card p-5 shadow-card sm:p-6"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lead font-semibold text-ink">Property &amp; Notice Inputs</h2>
            <Button type="button" variant="ghost" size="sm" onClick={handleReset} aria-label="Clear underwriting form">
              <RotateCcw className="size-3.5" />
              Clear
            </Button>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="uw-address" className="text-xs font-semibold text-ink">
                Street Address <span className="text-catch-ink">*</span>
              </label>
              <input
                id="uw-address"
                type="text"
                required
                maxLength={240}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. 1420 Prospect Ave E, Cleveland"
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="uw-state" className="text-xs font-semibold text-ink">
                  State <span className="text-catch-ink">*</span>
                </label>
                <select
                  id="uw-state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className={inputClass}
                >
                  {US_STATES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="uw-zip" className="text-xs font-semibold text-ink">
                  5-Digit ZIP (HUD SAFMR)
                </label>
                <input
                  id="uw-zip"
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  placeholder="44115"
                  className={cn(inputClass, "font-mono tabular-nums")}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="uw-county" className="text-xs font-semibold text-ink">
                  County
                </label>
                <input
                  id="uw-county"
                  type="text"
                  maxLength={120}
                  value={county}
                  onChange={(e) => setCounty(e.target.value)}
                  placeholder="Cuyahoga"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="uw-beds" className="text-xs font-semibold text-ink">
                  Bedrooms (SAFMR)
                </label>
                <select
                  id="uw-beds"
                  value={beds}
                  onChange={(e) => setBeds(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Default (2 BR)</option>
                  <option value="0">0 BR (Efficiency)</option>
                  <option value="1">1 BR</option>
                  <option value="2">2 BR</option>
                  <option value="3">3 BR</option>
                  <option value="4">4 BR</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="uw-bid" className="text-xs font-semibold text-ink">
                  Opening Bid ($)
                </label>
                <input
                  id="uw-bid"
                  type="number"
                  min={0}
                  step="1"
                  value={openingBid}
                  onChange={(e) => setOpeningBid(e.target.value)}
                  placeholder="65000"
                  className={cn(inputClass, "font-mono tabular-nums")}
                />
              </div>
              <div>
                <label htmlFor="uw-judgment" className="text-xs font-semibold text-ink">
                  Judgment ($)
                </label>
                <input
                  id="uw-judgment"
                  type="number"
                  min={0}
                  step="1"
                  value={judgment}
                  onChange={(e) => setJudgment(e.target.value)}
                  placeholder="142500"
                  className={cn(inputClass, "font-mono tabular-nums")}
                />
              </div>
              <div>
                <label htmlFor="uw-assessed" className="text-xs font-semibold text-ink">
                  Assessed ($)
                </label>
                <input
                  id="uw-assessed"
                  type="number"
                  min={0}
                  step="1"
                  value={assessed}
                  onChange={(e) => setAssessed(e.target.value)}
                  placeholder="52500"
                  className={cn(inputClass, "font-mono tabular-nums")}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="uw-sale-date" className="text-xs font-semibold text-ink">
                  Sale Date
                </label>
                <input
                  id="uw-sale-date"
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className={cn(inputClass, "font-mono tabular-nums")}
                />
              </div>
              <div>
                <label htmlFor="uw-source" className="text-xs font-semibold text-ink">
                  Source Channel
                </label>
                <select
                  id="uw-source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className={inputClass}
                >
                  {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="uw-program" className="text-xs font-semibold text-ink">
                Auction / Disposition Program
              </label>
              <input
                id="uw-program"
                type="text"
                maxLength={120}
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                placeholder="e.g. Sheriff Foreclosure, HUD REO, Tax Deed"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="uw-notice" className="text-xs font-semibold text-ink">
                Courthouse / Legal Notice Text (Optional, max 20,000 chars)
              </label>
              <textarea
                id="uw-notice"
                rows={6}
                maxLength={20000}
                value={noticeText}
                onChange={(e) => setNoticeText(e.target.value)}
                placeholder="Paste sheriff notice, trustee notice of sale, or docket snippet to extract case number, judgment, upset bid, APN/Block-Lot, and occupancy flags with exact character offsets..."
                className={cn(inputClass, "font-mono text-xs leading-relaxed")}
              />
            </div>
          </div>

          {error && (
            <Alert variant="catch" role="alert" className="mt-4">
              <AlertTriangle className="size-4" />
              <AlertTitle>Underwriting Request Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="mt-6">
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Running Underwriting Engine...
                </>
              ) : (
                "Run Off-Platform Underwrite"
              )}
            </Button>
          </div>
        </form>

        <div className="space-y-6">
          {!result ? (
            <section className="rounded-card border border-line bg-card p-6 shadow-card">
              <h2 className="text-lead font-semibold text-ink">Awaiting Property Context</h2>
              <p className="mt-2 text-meta text-ink-2">
                Enter an address and 2-letter US state on the left (plus optional ZIP, county assessed figure,
                source channel, and courthouse notice text) to generate a deterministic underwriting dossier.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-control border border-line bg-paper p-3">
                  <p className="text-label font-bold uppercase text-ink-3">1. Published / Supplied</p>
                  <p className="mt-1 text-meta text-ink-2">Separates caller-typed terms from notice-extracted fields and leaves ARV/Deal Score blank when unpublished.</p>
                </div>
                <div className="rounded-control border border-line bg-paper p-3">
                  <p className="text-label font-bold uppercase text-ink-3">2. Public-Record Benchmarks</p>
                  <p className="mt-1 text-meta text-ink-2">Cross-checks HUD SAFMR 1.20x DSCR ceiling, statutory county assessor ratio, and FHFA HPI context.</p>
                </div>
                <div className="rounded-control border border-line bg-paper p-3">
                  <p className="text-label font-bold uppercase text-ink-3">3. Statutory Risk &amp; Carry</p>
                  <p className="mt-1 text-meta text-ink-2">Evaluates lien survival, IRS 25-day/120-day rules, state redemption, writ timeline, and verbatim citations.</p>
                </div>
              </div>
            </section>
          ) : (
            <>
              {result.riskAndCarry.catchSummary && (
                <Alert variant="catch">
                  <ShieldAlert className="size-4" />
                  <AlertTitle>Primary Catch Summary</AlertTitle>
                  <AlertDescription className="text-ink font-medium">
                    {result.riskAndCarry.catchSummary}
                  </AlertDescription>
                </Alert>
              )}

              {/* Section 1: Published / Supplied */}
              <section className="rounded-card border border-line bg-card p-5 shadow-card sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
                  <div>
                    <p className="text-label font-bold uppercase text-ink-3">Evidence Provenance</p>
                    <h2 className="mt-1 text-lead font-semibold text-ink">Published / Supplied Terms</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="neutral">{result.inputSummary.saleType.toUpperCase()}</Badge>
                    {result.inputSummary.source && (
                      <Badge variant="neutral">{result.inputSummary.source.toUpperCase()}</Badge>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-control border border-line bg-paper p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-label font-bold uppercase text-ink-3">Opening Bid</span>
                      {originBadge(result.inputSummary.fieldOrigins.openingBid)}
                    </div>
                    <p className="mt-1.5 font-mono text-body font-bold tabular-nums text-ink">
                      <Fact
                        value={result.inputSummary.openingBid}
                        format="money"
                        origin={result.inputSummary.fieldOrigins.openingBid === "supplied" ? "yours" : "printed"}
                        reason="Not in the notice"
                      />
                    </p>
                  </div>

                  <div className="rounded-control border border-line bg-paper p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-label font-bold uppercase text-ink-3">Court Judgment</span>
                      {originBadge(result.inputSummary.fieldOrigins.judgment)}
                    </div>
                    <p className="mt-1.5 font-mono text-body font-bold tabular-nums text-ink">
                      <Fact
                        value={result.inputSummary.judgment}
                        format="money"
                        origin={result.inputSummary.fieldOrigins.judgment === "supplied" ? "yours" : "printed"}
                        reason="Not in the notice"
                      />
                    </p>
                  </div>

                  <div className="rounded-control border border-line bg-paper p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-label font-bold uppercase text-ink-3">Assessed Figure</span>
                      <Badge variant={result.inputSummary.assessed !== null ? "yours" : "catch"}>
                        {result.inputSummary.assessed !== null ? "Supplied" : "Missing"}
                      </Badge>
                    </div>
                    <p className="mt-1.5 font-mono text-body font-bold tabular-nums text-ink">
                      <Fact
                        value={result.inputSummary.assessed}
                        format="money"
                        origin="yours"
                        reason="Not in the notice"
                      />
                    </p>
                  </div>

                  <div className="rounded-control border border-line bg-paper p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-label font-bold uppercase text-ink-3">ARV / Deal Score</span>
                      <Badge variant="catch">Zero-Fabrication</Badge>
                    </div>
                    <p className="mt-1.5 text-meta font-semibold text-catch-ink">
                      Unpublished (estLow / estHigh / dealScore = null)
                    </p>
                  </div>
                </div>

                <dl className="mt-4 grid gap-3 border-t border-line pt-4 text-meta sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <dt className="text-label font-bold uppercase text-ink-3">Address</dt>
                    <dd className="mt-1 font-medium text-ink">
                      {result.inputSummary.address}, {result.inputSummary.state}
                      {result.inputSummary.zip ? ` ${result.inputSummary.zip}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label font-bold uppercase text-ink-3">Case / Docket</dt>
                    <dd className="mt-1 flex items-center gap-2 font-mono tabular-nums text-ink">
                      <span>{result.inputSummary.caseNumber || "—"}</span>
                      {originBadge(result.inputSummary.fieldOrigins.caseNumber)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label font-bold uppercase text-ink-3">APN / Block-Lot</dt>
                    <dd className="mt-1 flex items-center gap-2 font-mono tabular-nums text-ink">
                      <span>{result.inputSummary.apn || "—"}</span>
                      {originBadge(result.inputSummary.fieldOrigins.apn)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label font-bold uppercase text-ink-3">Occupancy</dt>
                    <dd className="mt-1 flex items-center gap-2 text-ink">
                      <span>{result.inputSummary.occupancy || "Unknown"}</span>
                      {originBadge(result.inputSummary.fieldOrigins.occupancy)}
                    </dd>
                  </div>
                </dl>
              </section>

              {/* Section 2: Public-Record Benchmarks */}
              <section className="rounded-card border border-line bg-card p-5 shadow-card sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
                  <div className="flex items-center gap-2">
                    <Landmark className="size-4 text-ink-2" />
                    <div>
                      <p className="text-label font-bold uppercase text-ink-3">Public-Record Benchmarks</p>
                      <h2 className="text-lead font-semibold text-ink">HUD SAFMR, Rent Ceiling &amp; Assessor Ratio</h2>
                    </div>
                  </div>
                  <Badge variant="neutral">
                    {result.publicBenchmarks.consensus.availableSourceCount}/3 benchmark sources
                  </Badge>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <div className="rounded-control border border-line bg-paper p-4">
                    <p className="text-label font-bold uppercase text-ink-3">HUD SAFMR Rent Floor</p>
                    {result.publicBenchmarks.hudSafmr ? (
                      <>
                        <p className="mt-1.5 font-mono text-title font-bold tabular-nums text-ink">
                          {fmtUsd(result.publicBenchmarks.hudSafmr.fairMarketRent)}
                          <span className="text-meta font-normal text-ink-3"> /mo ({result.publicBenchmarks.hudSafmr.bedrooms}BR)</span>
                        </p>
                        <p className="mt-1 text-meta text-ink-2">
                          {result.publicBenchmarks.hudSafmr.hudAreaName} ({result.publicBenchmarks.hudSafmr.asOfFiscalYear})
                        </p>
                        <p className="mt-2 font-mono text-xs tabular-nums text-ink-3">
                          90%–110% Payment Std: {fmtUsd(result.publicBenchmarks.hudSafmr.paymentStandard90Pct)} –{" "}
                          {fmtUsd(result.publicBenchmarks.hudSafmr.paymentStandard110Pct)}
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-meta text-catch-ink">
                        Supply a valid 5-digit ZIP to look up HUD SAFMR rent benchmarks.
                      </p>
                    )}
                  </div>

                  <div className="rounded-control border border-line bg-paper p-4">
                    <p className="text-label font-bold uppercase text-ink-3">1.20x DSCR Rent Ceiling</p>
                    <p className="mt-1.5 font-mono text-title font-bold tabular-nums text-ink">
                      {result.publicBenchmarks.safmrRentFloor120Dscr !== null
                        ? fmtUsd(result.publicBenchmarks.safmrRentFloor120Dscr)
                        : "Unavailable"}
                    </p>
                    <p className="mt-1 text-meta text-ink-2">
                      Max rent-supported price at 1.20x DSCR (75% LTV, 7.25%, 30yr, 35% OpEx). Not an appraisal or ARV.
                    </p>
                    {result.publicBenchmarks.consensus.impliedGrm !== null && (
                      <p className="mt-2 font-mono text-xs tabular-nums text-ink-2">
                        Implied GRM vs Opening Bid: {result.publicBenchmarks.consensus.impliedGrm}x
                      </p>
                    )}
                  </div>

                  <div className="rounded-control border border-line bg-paper p-4">
                    <p className="text-label font-bold uppercase text-ink-3">County Assessor Reading</p>
                    {result.publicBenchmarks.assessorReading ? (
                      <>
                        <p className="mt-1.5 font-mono text-title font-bold tabular-nums text-ink">
                          {result.publicBenchmarks.assessorReading.marketComparison !== null
                            ? fmtUsd(result.publicBenchmarks.assessorReading.marketComparison)
                            : fmtUsd(result.publicBenchmarks.assessorReading.rawFigure)}
                        </p>
                        <p className="mt-1 text-meta text-ink-2">
                          {result.publicBenchmarks.assessorReading.countyName || result.publicBenchmarks.assessorReading.countyKey || "Un-enrolled county"}
                        </p>
                        {result.publicBenchmarks.assessorReading.citation ? (
                          <p className="mt-2 text-xs leading-relaxed text-ink-3">
                            {result.publicBenchmarks.assessorReading.citation}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs leading-relaxed text-catch-ink">
                            {result.publicBenchmarks.assessorReading.withheldReason}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-2 text-meta text-ink-3">
                        Supply an assessed figure to check statutory county assessment ratio rules.
                      </p>
                    )}
                  </div>
                </div>

                {result.publicBenchmarks.consensus.unobservedReasons.length > 0 && (
                  <details className="mt-4 rounded-control border border-line bg-paper p-3 text-xs text-ink-2">
                    <summary className="cursor-pointer font-semibold text-ink">
                      Unobserved Benchmark Notes ({result.publicBenchmarks.consensus.unobservedReasons.length})
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {result.publicBenchmarks.consensus.unobservedReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <p className="mt-3 text-xs text-ink-3">{result.publicBenchmarks.consensus.disclaimer}</p>
              </section>

              {/* Section 3: Statutory Risk & Carry */}
              <section className="rounded-card border border-line bg-card p-5 shadow-card sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
                  <div className="flex items-center gap-2">
                    <Gavel className="size-4 text-ink-2" />
                    <div>
                      <p className="text-label font-bold uppercase text-ink-3">Statutory Risk &amp; Carry</p>
                      <h2 className="text-lead font-semibold text-ink">Title Survival, Redemption &amp; Possession Timeline</h2>
                    </div>
                  </div>
                  <Badge
                    variant={
                      result.riskAndCarry.titleRisk.riskLevel === "CRITICAL" ||
                      result.riskAndCarry.titleRisk.riskLevel === "HIGH"
                        ? "catch"
                        : "neutral"
                    }
                  >
                    Title Risk: {result.riskAndCarry.titleRisk.riskLevel}
                  </Badge>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-control border border-line bg-paper p-4">
                    <p className="text-label font-bold uppercase text-ink-3">Title Arbitration</p>
                    <dl className="mt-2 space-y-2 text-meta">
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-3">Foreclosing Party</dt>
                        <dd className="font-mono font-semibold text-ink">{result.riskAndCarry.titleRisk.plaintiffType}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-3">1st Mortgage Survives</dt>
                        <dd className="font-semibold text-ink">
                          {result.riskAndCarry.titleRisk.firstMortgageSurvives === true
                            ? "Yes (Senior debt survives)"
                            : result.riskAndCarry.titleRisk.firstMortgageSurvives === false
                              ? "No"
                              : "Unconfirmed"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-3">Statutory Redemption</dt>
                        <dd className="font-mono font-semibold tabular-nums text-ink">
                          {result.riskAndCarry.titleRisk.statutoryRedemption.days} days
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-xs text-ink-2">
                      {result.riskAndCarry.titleRisk.statutoryRedemption.label}
                    </p>
                    <p className="mt-3 rounded-control border border-line bg-card p-2.5 text-xs font-medium text-ink">
                      {result.riskAndCarry.titleRisk.titleActionAdvice}
                    </p>
                  </div>

                  <div className="rounded-control border border-line bg-paper p-4">
                    <p className="text-label font-bold uppercase text-ink-3">Post-Sale Possession &amp; Carry</p>
                    <dl className="mt-2 space-y-2 text-meta">
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-3">Disposition / Sale Type</dt>
                        <dd className="font-mono font-semibold text-ink">
                          {result.riskAndCarry.possessionTimeline.isPostForeclosureReo
                            ? "POST-FORECLOSURE REO"
                            : String(result.riskAndCarry.possessionTimeline.saleType || "sheriff").toUpperCase()}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-3">Writ of Possession</dt>
                        <dd className="font-mono font-semibold tabular-nums text-ink">
                          {result.riskAndCarry.possessionTimeline.writOfPossession.minDays !== null
                            ? `${result.riskAndCarry.possessionTimeline.writOfPossession.minDays}–${result.riskAndCarry.possessionTimeline.writOfPossession.maxDays} days`
                            : "State un-encoded"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-3">Quiet Title Window</dt>
                        <dd className="font-mono font-semibold tabular-nums text-ink">
                          {result.riskAndCarry.possessionTimeline.quietTitle.minDays !== null
                            ? `${result.riskAndCarry.possessionTimeline.quietTitle.minDays}–${result.riskAndCarry.possessionTimeline.quietTitle.maxDays} days`
                            : "State un-encoded"}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-xs text-ink-2">
                      {result.riskAndCarry.possessionTimeline.writOfPossession.statutory || "Consult local property counsel"}
                    </p>
                    <p className="mt-2 text-xs text-ink-3">
                      {result.riskAndCarry.possessionTimeline.carryCost.basis}
                    </p>
                  </div>
                </div>

                {result.riskAndCarry.titleRisk.titleWarnings.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {result.riskAndCarry.titleRisk.titleWarnings.map((warning) => (
                      <li
                        key={warning}
                        className="rounded-control border border-catch/30 bg-catch-wash px-3 py-2 text-xs font-medium text-catch-ink"
                      >
                        {warning}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Section 4: Verbatim Notice Extraction */}
              <section className="rounded-card border border-line bg-card p-5 shadow-card sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-ink-2" />
                    <div>
                      <p className="text-label font-bold uppercase text-ink-3">Citation-Locked Parser</p>
                      <h2 className="text-lead font-semibold text-ink">Verbatim Notice Extraction</h2>
                    </div>
                  </div>
                  <Badge variant={citationsList.length > 0 ? "go" : "neutral"}>
                    {citationsList.length} verified span{citationsList.length === 1 ? "" : "s"}
                  </Badge>
                </div>

                {!result.noticeExtraction.present ? (
                  <p className="mt-4 text-meta text-ink-3">
                    No notice text supplied. Paste a courthouse notice or legal advertisement to extract docket numbers,
                    judgment amounts, upset bids, APNs/Block-Lots, and occupancy flags with character-offset verification.
                  </p>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {citationsList.length === 0 ? (
                        <p className="text-meta text-ink-3">
                          No structured docket, bid, judgment, APN, or occupancy patterns matched the pasted notice.
                        </p>
                      ) : (
                        citationsList.map((cit) => {
                          const isSelected = activeSpan?.start === cit.start && activeSpan?.end === cit.end;
                          return (
                            <button
                              key={`${cit.key}-${cit.start}-${cit.end}`}
                              type="button"
                              onClick={() =>
                                setActiveSpan(isSelected ? null : { start: cit.start, end: cit.end, label: cit.label })
                              }
                              className={cn(
                                "inline-flex items-center gap-2 rounded-control border px-3 py-1.5 text-left text-xs transition",
                                isSelected
                                  ? "border-yours bg-yours-wash text-ink"
                                  : "border-line bg-paper text-ink hover:border-line-strong"
                              )}
                            >
                              <CheckCircle2 className="size-3.5 text-go" />
                              <span className="font-semibold">{cit.label}:</span>
                              <span className="font-mono tabular-nums">&ldquo;{cit.quote}&rdquo;</span>
                              <span className="font-mono text-ink-3 tabular-nums">
                                [{cit.start}..{cit.end}]
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>

                    {result.noticeExtraction.occupancyFlags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-label font-bold uppercase text-ink-3">Occupancy Flags:</span>
                        {result.noticeExtraction.occupancyFlags.map((item) => (
                          <Badge key={`${item.start}-${item.end}`} variant="catch">
                            {item.flag}: &ldquo;{item.quote}&rdquo; [{item.start}..{item.end}]
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="rounded-control border border-line bg-paper p-3">
                      <p className="text-label font-bold uppercase text-ink-3">
                        Source Notice Preview {activeSpan ? `(Highlighting ${activeSpan.label})` : "(Click any citation above to inspect)"}
                      </p>
                      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink-2">
                        {activeSpan && activeSpan.start >= 0 && activeSpan.end <= noticeText.length ? (
                          <>
                            {noticeText.slice(0, activeSpan.start)}
                            <mark className="rounded bg-yours-wash px-0.5 font-semibold text-ink underline decoration-yours">
                              {noticeText.slice(activeSpan.start, activeSpan.end)}
                            </mark>
                            {noticeText.slice(activeSpan.end)}
                          </>
                        ) : (
                          noticeText
                        )}
                      </pre>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
