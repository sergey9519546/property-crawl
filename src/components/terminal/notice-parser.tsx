"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Bookmark, FileSearch, FileText, LoaderCircle } from "lucide-react";
import { PropertyListing } from "./property-data";

interface NoticeParserProps {
  onSaveToWatchlist: (listing: PropertyListing) => void;
}

type FieldStatus = "extracted_from_notice" | "derived_from_explicit_notice_fraction" | "not_found";

interface NoticeExtraction {
  property_address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  parcel_or_lot: string | null;
  sale_date: string | null;
  sale_time: string | null;
  sale_type: string | null;
  plaintiff_or_seller: string | null;
  defendant: string | null;
  judgment_amount: number | null;
  appraised_value: number | null;
  deposit_terms: string | null;
  attorney: string | null;
  case_number: string | null;
  opening_bid: number | null;
  opening_bid_basis: "stated_in_notice" | "derived_from_explicit_notice_fraction" | null;
  statutory_bid_fraction: number | null;
  estLow: null;
  estHigh: null;
  mid: null;
  equity: null;
  dealScore: null;
  cash_to_close: null;
  evidence: Record<string, string | null>;
  field_status: Record<string, FieldStatus>;
  verification_status: "unverified_extraction";
  raw_notice: string;
}

interface ParseResponse {
  parsed: NoticeExtraction;
  confidence: number;
  confidenceMeaning: string;
  strategy: string;
  cached: boolean;
  reviewRequired: boolean;
  unverifiedCandidates?: Record<string, unknown>;
}

const SAMPLE = [
  "NOTICE OF SHERIFF'S SALE: Cuyahoga County Court of Common Pleas, Case No. CV-26-994412.",
  "Fifth Third Bank vs. Estate of Eleanor Vance.",
  "Premises located at 1248 W 76th St, Cleveland, OH 44102.",
  "Permanent Parcel No. 002-14-082.",
  "Appraised by three disinterested freeholders at $145,000.",
  "Minimum opening bid is two-thirds appraised value: $96,666.67.",
  "Sale will be held on Thursday, October 15, 2026 at 10:00 AM.",
  "Deposit of $5,000 required by certified check.",
  "Attorney: Manley Deas Kochalski LLC."
].join("\n");

const REQUIRED_REVIEW_FIELDS = [
  ["property_address", "property address"],
  ["state", "state"],
  ["case_number", "court case number"],
  ["opening_bid", "opening bid"],
  ["sale_date", "sale date"],
  ["deposit_terms", "deposit terms"],
  ["attorney", "attorney of record"]
] as const;

function textValue(value: string | null) {
  return value || "Not found in notice";
}

function moneyValue(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "Not found in notice"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function ExtractedField({ label, value, evidence }: { label: string; value: string; evidence?: string | null }) {
  const missing = value === "Not found in notice";
  return (
    <div className={`rounded-xl border p-3 ${missing ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`}>
      <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</span>
      <strong className={`mt-1 block break-words text-xs ${missing ? "text-amber-800" : "text-slate-950"}`}>{value}</strong>
      {evidence ? <span className="mt-1.5 block line-clamp-2 text-[10px] leading-4 text-slate-500">Evidence: “{evidence}”</span> : null}
    </div>
  );
}

export function NoticeParser({ onSaveToWatchlist }: NoticeParserProps) {
  const [rawText, setRawText] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parseResponse, setParseResponse] = useState<ParseResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  const parsedResult = parseResponse?.parsed ?? null;
  const missingReviewFields = useMemo(() => {
    if (!parsedResult) return [];
    return REQUIRED_REVIEW_FIELDS
      .filter(([field]) => parsedResult.field_status[field] === "not_found")
      .map(([, label]) => label);
  }, [parsedResult]);

  const handleParse = async () => {
    if (!rawText.trim()) return;
    setIsParsing(true);
    setParseError(null);
    setNeedsUnlock(false);
    setParseResponse(null);
    try {
      const response = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noticeText: rawText })
      });
      const body = await response.json().catch(() => null);
      if (response.status === 401) { setNeedsUnlock(true); throw new Error("Unlock your workspace, then return here to extract the notice. Your text will stay on this page."); }
      if (!response.ok || !body?.parsed) throw new Error(body?.error || "The notice could not be parsed.");
      setParseResponse(body as ParseResponse);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "The notice could not be parsed.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleAddToWatchlist = () => {
    if (!parsedResult) return;
    const address = parsedResult.property_address;
    const state = parsedResult.state;
    if (!address || !state) {
      setParseError("A source-stated property address and state are required before this extraction can be added.");
      return;
    }

    const source = parsedResult.sale_type?.toLowerCase().includes("sheriff") ? "sheriff" : "notice";
    const newListing: PropertyListing = {
      id: `PARSE-${Date.now().toString(36).toUpperCase()}`,
      source,
      state,
      county: parsedResult.county,
      city: parsedResult.city,
      zip: parsedResult.zip,
      address,
      lat: null,
      lng: null,
      beds: null,
      baths: null,
      sqft: null,
      year: null,
      propType: null,
      openingBid: parsedResult.opening_bid,
      estLow: null,
      estHigh: null,
      assessed: parsedResult.appraised_value,
      mid: null,
      ratio: null,
      equity: null,
      dealScore: null,
      saleDate: parsedResult.sale_date,
      plaintiff: parsedResult.plaintiff_or_seller,
      defendant: parsedResult.defendant,
      judgment: parsedResult.judgment_amount,
      attorney: parsedResult.attorney,
      occupancy: null,
      deposit: parsedResult.deposit_terms,
      photo: null,
      images: [],
      sourceUrl: null,
      raw: rawText,
      status: null,
      provenance: {
        origin: "user_notice",
        observed: true,
        recordKind: "unverified_extraction",
        verificationStatus: parsedResult.verification_status,
        evidence: parsedResult.evidence
      }
    };
    onSaveToWatchlist(newListing);
  };

  const canSave = Boolean(parsedResult?.property_address && parsedResult?.state);
  const llmCandidateCount = Object.keys(parseResponse?.unverifiedCandidates || {}).length;

  return (
    <div className="space-y-4 rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-[#0F172A]" />
          <div>
            <h3 className="text-lg font-bold text-[#111827]">Legal Notice Evidence Extractor</h3>
            <p className="text-xs text-slate-500">Extracts stated facts; it does not complete missing fields.</p>
          </div>
        </div>
        <button type="button" onClick={() => { setRawText(SAMPLE); setParseResponse(null); setParseError(null); }} className="text-xs font-semibold text-[#0F172A] hover:underline">
          Paste sample notice
        </button>
      </div>

      <textarea
        value={rawText}
        onChange={(event) => { setRawText(event.target.value); setParseResponse(null); setParseError(null); }}
        placeholder="Paste raw foreclosure notice, gazette clipping, or court docket text here…"
        aria-label="Raw legal notice"
        className="h-36 w-full rounded-xl border border-[#D1D5DB] p-4 font-mono text-xs text-[#111827] focus:border-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[#6B7280]">All extracted fields require comparison with the source document.</span>
        <button
          type="button"
          onClick={handleParse}
          disabled={isParsing || !rawText.trim()}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white transition hover:bg-[#1E293B] disabled:opacity-50"
        >
          {isParsing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4 text-[#FDBC15]" />}
          <span>{isParsing ? "Extracting…" : "Extract stated facts"}</span>
        </button>
      </div>

      {parseError ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{parseError}{needsUnlock ? <a href="/listings" target="_blank" rel="noopener noreferrer" className="mt-2 block font-semibold underline underline-offset-2">Open workspace in a new tab</a> : null}</span>
        </div>
      ) : null}

      {parsedResult ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4 animate-in fade-in">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2 text-xs text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong className="block font-extrabold">Unverified extraction — source review required</strong>
                <span>{parseResponse?.confidenceMeaning || "Completeness is not factual verification."}</span>
                {llmCandidateCount > 0 ? <span className="mt-1 block">{llmCandidateCount} AI candidate field(s) were kept separate and were not promoted into these facts.</span> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddToWatchlist}
              disabled={!canSave}
              title={canSave ? "Add this unverified extraction" : "A source-stated address and state are required"}
              className="inline-flex items-center gap-1 rounded-lg bg-[#0F172A] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#1E293B] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Bookmark className="h-3.5 w-3.5" />
              <span>{canSave ? "Add extraction" : "Needs address + state"}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ExtractedField label="Address" value={textValue(parsedResult.property_address)} evidence={parsedResult.evidence.property_address} />
            <ExtractedField label="City / State" value={parsedResult.city || parsedResult.state ? `${parsedResult.city || "City not found"}, ${parsedResult.state || "state not found"}` : "Not found in notice"} evidence={parsedResult.evidence.state} />
            <ExtractedField label="Opening bid" value={moneyValue(parsedResult.opening_bid)} evidence={parsedResult.evidence.opening_bid} />
            <ExtractedField label="Appraised value" value={moneyValue(parsedResult.appraised_value)} evidence={parsedResult.evidence.appraised_value} />
            <ExtractedField label="Auction date" value={textValue(parsedResult.sale_date)} evidence={parsedResult.evidence.sale_date} />
            <ExtractedField label="Auction time" value={textValue(parsedResult.sale_time)} evidence={parsedResult.evidence.sale_time} />
            <ExtractedField label="Sale type" value={textValue(parsedResult.sale_type)} evidence={parsedResult.evidence.sale_type} />
            <ExtractedField label="Case number" value={textValue(parsedResult.case_number)} evidence={parsedResult.evidence.case_number} />
            <ExtractedField label="Plaintiff / seller" value={textValue(parsedResult.plaintiff_or_seller)} evidence={parsedResult.evidence.plaintiff_or_seller} />
            <ExtractedField label="Defendant" value={textValue(parsedResult.defendant)} evidence={parsedResult.evidence.defendant} />
            <ExtractedField label="Judgment" value={moneyValue(parsedResult.judgment_amount)} evidence={parsedResult.evidence.judgment_amount} />
            <ExtractedField label="Deposit" value={textValue(parsedResult.deposit_terms)} evidence={parsedResult.evidence.deposit_terms} />
            <ExtractedField label="Attorney" value={textValue(parsedResult.attorney)} evidence={parsedResult.evidence.attorney} />
            <ExtractedField label="Parcel / lot" value={textValue(parsedResult.parcel_or_lot)} evidence={parsedResult.evidence.parcel_or_lot} />
          </div>

          {parsedResult.opening_bid_basis === "derived_from_explicit_notice_fraction" ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
              Opening bid was calculated only because the notice explicitly states the {parsedResult.statutory_bid_fraction ? `${(parsedResult.statutory_bid_fraction * 100).toFixed(2)}%` : "statutory"} fraction of its stated appraisal. Verify the calculation before use.
            </div>
          ) : null}

          {missingReviewFields.length > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
              <strong className="block text-slate-950">Evidence gaps</strong>
              <span className="mt-1 block">Not found: {missingReviewFields.join(", ")}. Consult the official notice, docket, and sale terms; these values were not estimated.</span>
            </div>
          ) : null}

          {/(?:tract\s+[12]|parcel\s+(?:one|two|[12])|lot\s+[12]|permanent parcel nos|parcels:)/i.test(rawText) ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div><strong className="block font-bold">Multiple parcel references detected</strong><span>Confirm which stated facts apply to each parcel in the official docket.</span></div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
