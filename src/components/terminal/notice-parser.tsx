"use client";
import React, { useState } from "react";
import { PropertyListing } from "./property-data";
import { FileText, CheckCircle2, Bookmark, Sparkles, AlertCircle } from "lucide-react";

interface NoticeParserProps {
  onSaveToWatchlist: (listing: PropertyListing) => void;
}

function parseDateString(raw: string): string {
  try {
    const cleaned = raw.replace(/,/g, "").trim();
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return raw.slice(0, 20).trim();
}

function parseNoticeText(text: string): Record<string, any> | null {
  if (!text.trim() || text.trim().length < 40) return null;
  const addrRe = /(?:located at|premises(?:\s+located)?(?:\s+at)?|property(?:\s+at)?|address(?:\s+is)?)\s*:?\s*([0-9][^,\n.]{5,60})/i;
  const addrMatch = text.match(addrRe);
  const rawAddress = addrMatch ? addrMatch[1].trim() : "";
  const cityStateZipRe = /([A-Za-z\s]{2,}),\s*([A-Z]{2})\s+(\d{5})/;
  const cszMatch = (rawAddress + " " + text).match(cityStateZipRe);
  const city = cszMatch ? cszMatch[1].trim() : "Unknown";
  const state = cszMatch ? cszMatch[2] : "OH";
  const zip = cszMatch ? cszMatch[3] : "00000";
  const countyMatch = text.match(/([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+County(?:\s+Court)?/i);
  const county = countyMatch ? countyMatch[1].trim() : city;
  const streetAddress = rawAddress
    ? `${rawAddress}, ${city}, ${state} ${zip}`
    : `${city}, ${state} ${zip}`;
  const bidRe = /(?:opening\s+bid|minimum\s+bid|two[-\s]thirds[^$]*|minimum\s+opening\s+bid[^$]*)\$?([\d,]+(?:\.\d{2})?)/i;
  const bidMatch = text.match(bidRe);
  const bid = bidMatch ? Math.round(parseFloat(bidMatch[1].replace(/,/g, ""))) : 0;
  const appraisedRe = /(?:appraised(?:\s+at)?|appraised\s+value(?:\s+of)?)[^$]*\$?([\d,]+)/i;
  const appraisedMatch = text.match(appraisedRe);
  const appraised = appraisedMatch ? parseInt(appraisedMatch[1].replace(/,/g, ""), 10) : (bid ? Math.round(bid / 0.67) : 0);
  const openingBid = bid || Math.round(appraised * 0.667);
  const estLow = Math.round(appraised * 0.93);
  const estHigh = Math.round(appraised * 1.22);
  const mid = Math.round((estLow + estHigh) / 2);
  const equity = mid - openingBid;
  const ratio = mid > 0 ? openingBid / mid : 0.67;
  const dealScore = Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)));
  const dateRe = /(?:sale|auction|held on|scheduled for)[^A-Z0-9]*([A-Z][a-z]+(?:,?\s+[A-Z][a-z]+)?\s+\d{1,2},?\s+\d{4})/i;
  const dateMatch = text.match(dateRe);
  const saleDate = dateMatch ? parseDateString(dateMatch[1]) : "";
  const caseRe = /[Cc]ase\s*[Nn]o\.?\s*([A-Z0-9\-\/]+)/i;
  const caseMatch = text.match(caseRe);
  const caseNumber = caseMatch ? caseMatch[1].trim() : "Not found";
  const vsRe = /^([^.\n]{3,60}?)\s+vs?s?\.?\s+([^.\n]{3,60})/im;
  const vsMatch = text.match(vsRe);
  const plaintiff = vsMatch ? vsMatch[1].trim() : "Unknown";
  const defendant = vsMatch ? vsMatch[2].trim() : "Unknown";
  const judgmentRe = /(?:judgment|debt|amount)[^$]*\$?([\d,]+(?:\.\d{2})?)/i;
  const judgmentMatch = text.match(judgmentRe);
  const judgmentAmount = judgmentMatch ? Math.round(parseFloat(judgmentMatch[1].replace(/,/g, ""))) : Math.round(openingBid * 1.12);
  const depositRe = /[Dd]eposit\s+(?:of\s+)?([^.\n]{5,60})/i;
  const depositMatch = text.match(depositRe);
  const depositTerms = depositMatch ? depositMatch[1].trim() : "See court order";
  const attRe = /[Aa]ttorney(?:\s+of\s+[Rr]ecord)?:?\s*([A-Z][^.\n]{4,60})/i;
  const attMatch = text.match(attRe);
  const attorney = attMatch ? attMatch[1].trim() : "Unknown";
  const parcelRe = /[Pp]arcel\s*(?:[Nn]o\.?|[Ii][Dd]\.?|[Nn]umber)?\s*:?\s*([0-9][0-9\-]+)/i;
  const parcelMatch = text.match(parcelRe);
  const parcel = parcelMatch ? parcelMatch[1].trim() : "Not found";
  return { property_address: streetAddress, city, county, state, zip, parcel_or_lot: parcel, sale_date: saleDate, sale_type: "Sheriff Sale", plaintiff_or_seller: plaintiff, defendant, judgment_amount: judgmentAmount, deposit_terms: depositTerms, attorney, case_number: caseNumber, openingBid, estLow, estHigh, mid, equity, dealScore };
}

export function NoticeParser({ onSaveToWatchlist }: NoticeParserProps) {
  const [rawText, setRawText] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedResult, setParsedResult] = useState<Record<string, any> | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

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

  const handleParse = () => {
    if (!rawText.trim()) return;
    setIsParsing(true);
    setParseError(null);
    setParsedResult(null);
    setTimeout(() => {
      const result = parseNoticeText(rawText);
      if (!result) {
        setParseError("Not enough data found. Paste a complete foreclosure notice with a dollar amount, address, and sale date.");
      } else if (!result.openingBid || result.openingBid === 0) {
        setParseError("Could not extract a bid amount. Ensure the notice includes wording like opening bid or appraised at a dollar value.");
      } else {
        setParsedResult(result);
      }
      setIsParsing(false);
    }, 300);
  };

  const handleAddToWatchlist = () => {
    if (!parsedResult) return;
    const newListing: PropertyListing = {
      id: "PARSE-" + Date.now().toString(36).toUpperCase(),
      source: "sheriff",
      state: parsedResult.state,
      county: parsedResult.county,
      city: parsedResult.city,
      zip: parsedResult.zip,
      address: parsedResult.property_address,
      lat: 41.488,
      lng: -81.728,
      beds: 3,
      baths: 1,
      sqft: 1400,
      year: null,
      propType: "Single Family",
      openingBid: parsedResult.openingBid,
      estLow: parsedResult.estLow,
      estHigh: parsedResult.estHigh,
      assessed: parsedResult.openingBid,
      mid: parsedResult.mid,
      ratio: parsedResult.openingBid / parsedResult.mid,
      equity: parsedResult.equity,
      dealScore: parsedResult.dealScore,
      saleDate: parsedResult.sale_date,
      plaintiff: parsedResult.plaintiff_or_seller,
      defendant: parsedResult.defendant,
      judgment: parsedResult.judgment_amount,
      attorney: parsedResult.attorney,
      occupancy: "Unknown",
      deposit: parsedResult.deposit_terms,
      photo: "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80",
      raw: rawText
    };
    onSaveToWatchlist(newListing);
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-[#0F172A]" />
          <h3 className="text-lg font-bold text-[#111827]">Legal Notice Parser</h3>
        </div>
        <button onClick={() => { setRawText(SAMPLE); setParsedResult(null); setParseError(null); }} className="text-xs font-semibold text-[#0F172A] hover:underline">
          Paste sample notice
        </button>
      </div>
      <textarea
        value={rawText}
        onChange={(e) => { setRawText(e.target.value); setParsedResult(null); setParseError(null); }}
        placeholder="Paste raw foreclosure notice, gazette clipping, or court docket text here..."
        aria-label="Raw legal notice"
        className="w-full h-36 p-4 rounded-xl border border-[#D1D5DB] text-xs font-mono text-[#111827] focus:outline-none focus:border-[#0F172A] focus:ring-2 focus:ring-[#0F172A]/20"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#6B7280]">Structured extraction for supported court notice formats</span>
        <button
          onClick={handleParse}
          disabled={isParsing || !rawText.trim()}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white hover:bg-[#1E293B] disabled:opacity-50 transition gap-1.5"
        >
          <Sparkles className="w-4 h-4 text-[#FDBC15] fill-[#FDBC15]" />
          <span>{isParsing ? "Extracting..." : "Parse Notice"}</span>
        </button>
      </div>
      {parseError && (
        <div className="mt-2 p-3 rounded-xl border border-amber-200 bg-amber-50 flex items-start gap-2 text-xs text-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{parseError}</span>
        </div>
      )}
      {parsedResult && (
        <div className="mt-4 p-4 rounded-xl border border-[#16A34A]/30 bg-[#E7FAEF] space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-[#16A34A] flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              {Object.keys(parsedResult).length} fields extracted · Deal Score: {parsedResult.dealScore}/100
            </span>
            <button
              onClick={handleAddToWatchlist}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#0F172A] text-white text-xs font-bold rounded-lg hover:bg-[#1E293B] transition"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Add to Watchlist</span>
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-white p-3 rounded-lg border border-[#E5E7EB]">
            <div><span className="text-[#6B7280] block">Address:</span> <strong className="text-[#111827]">{parsedResult.property_address}</strong></div>
            <div><span className="text-[#6B7280] block">City, State:</span> <strong className="text-[#111827]">{parsedResult.city}, {parsedResult.state}</strong></div>
            <div><span className="text-[#6B7280] block">Opening Bid:</span> <strong className="text-[#16A34A]">${parsedResult.openingBid.toLocaleString()}</strong></div>
            <div><span className="text-[#6B7280] block">Auction Date:</span> <strong className="text-[#111827]">{parsedResult.sale_date || "—"}</strong></div>
            <div><span className="text-[#6B7280] block">Plaintiff:</span> <strong className="text-[#111827] break-words">{parsedResult.plaintiff_or_seller}</strong></div>
            <div><span className="text-[#6B7280] block">Case No.:</span> <strong className="text-[#111827]">{parsedResult.case_number}</strong></div>
            <div><span className="text-[#6B7280] block">Est. Value:</span> <strong className="text-[#111827]">${parsedResult.estLow.toLocaleString()}–${parsedResult.estHigh.toLocaleString()}</strong></div>
            <div><span className="text-[#6B7280] block">Built-in Equity:</span> <strong className="text-[#16A34A]">+${parsedResult.equity.toLocaleString()}</strong></div>
          </div>

          {/* Multi-Parcel & Title Risk Annotations */}
          {/(?:tract\s+[12]|parcel\s+(?:one|two|[12])|lot\s+[12]|permanent parcel nos|parcels:)/i.test(rawText) && (
            <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <div>
                <strong className="block font-bold">Multi-Parcel / Tract Notice Detected</strong>
                <span>This legal advertisement references multiple parcels or tracts. Ensure opening bid applies to the desired parcel.</span>
              </div>
            </div>
          )}

          {/(?:second mortgage|heloc|subordinate mortgage|hoa assessment|condominium association|junior lien)/i.test(rawText) && (
            <div className="p-3 rounded-lg border border-red-300 bg-red-50 text-red-900 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
              <div>
                <strong className="block font-bold">Junior Lien Foreclosure Alert</strong>
                <span>Notice text indicates action by a junior creditor or HOA. Senior 1st mortgage may survive sale under state law.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
