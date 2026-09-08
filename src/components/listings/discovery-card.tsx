"use client";

import Link from "next/link";
import { ArrowUpRight, Bookmark, FileText, Loader2 } from "lucide-react";
import { ListingThumbnail } from "@/components/listings/listing-thumbnail";
import { CaseAction } from "@/components/research/case-action";
import { SOURCES, type PropertyListing } from "@/components/terminal/property-data";
import { displayDate, displayMoney, knownNumber } from "@/lib/listing-display";
import { sourceDisplayText } from "@/lib/source-display";

// Format publisher capitalization for display only; the source address stays intact.
function readable(value: string) {
  if (value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/\b[a-z]+/g, (word) =>
    /^(n|s|e|w|ne|nw|se|sw|us)$/.test(word) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1));
}
function addressLines(listing: PropertyListing) {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Only remove the locality when it matches the separately published fields.
  const suffix = listing.city && listing.state
    ? new RegExp(`,?\\s+${escape(listing.city)}[,\\s]+${escape(listing.state)}(?:[,\\s]+\\d{5}(?:-\\d{4})?)?\\s*$`, "i") : null;
  const street = suffix ? listing.address.replace(suffix, "").trim().replace(/,$/, "") : listing.address;
  return {
    street: readable(street || listing.address),
    locality: [listing.city && readable(listing.city), [listing.state, listing.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
  };
}

type Props = { listing: PropertyListing; href: string; saved: boolean; saving: boolean; onSave: () => void };

export function DiscoveryCard({ listing, href, saved, saving, onSave }: Props) {
  const { street, locality } = addressLines(listing);
  const observed = listing.provenance?.origin === "live" && listing.provenance?.observed === true;
  const archived = listing.provenance?.origin === "archive";
  const program = listing.program || listing.auctionProgram;
  const lifecycle = listing.lifecycle || listing.lifecycleStatus;
  const stale = listing.sourceFreshness?.status === "stale";
  const amount = knownNumber(listing.openingBid);
  const facts = [
    knownNumber(listing.beds) !== null ? `${listing.beds} bed` : null,
    knownNumber(listing.baths) !== null ? `${listing.baths} bath` : null,
    knownNumber(listing.sqft) !== null ? `${Number(listing.sqft).toLocaleString()} sq ft` : null,
  ].filter(Boolean);
  const completeness = listing.evidenceCompleteness;

  return <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md" aria-label={listing.address}>
    <div className="relative shrink-0">
      <ListingThumbnail listingId={listing.id} address={listing.address} photo={listing.photo} observed={observed} layout="card" />
      {program ? <span className="absolute left-3 top-3 max-w-[calc(100%-5rem)] rounded-md bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-sm">{sourceDisplayText(program)}</span> : null}
      <button type="button" onClick={onSave} disabled={saving} aria-label={`${saved ? "Remove from" : "Add to"} watchlist: ${listing.address}`} aria-pressed={saved} className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-60">
        {saving ? <Loader2 size={17} className="animate-spin" /> : <Bookmark size={17} className={saved ? "fill-slate-900 text-slate-900" : ""} />}
      </button>
    </div>
    <div className="flex flex-1 flex-col p-4 sm:p-5">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <span className="font-medium text-slate-600">{sourceDisplayText(SOURCES[listing.source]?.label || listing.source)}</span>
        {lifecycle ? <><span aria-hidden>·</span><span>{sourceDisplayText(lifecycle.replace(/_/g, " "))}</span></> : null}
        {!observed ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900">{archived ? "Dated archive" : "Demo / unverified"}</span> : null}
      </div>
      <h2 className="text-lg font-semibold leading-6 tracking-tight text-slate-950"><Link href={href} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">{street}</Link></h2>
      {locality ? <p className="mt-1 text-sm text-slate-500">{locality}</p> : null}
      {facts.length ? <p className="mt-2 text-xs text-slate-600">{facts.join(" · ")}</p> : null}
      <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-slate-100 py-3">
        <div><dt className="text-xs text-slate-500">Opening amount</dt><dd className={`mt-1 ${amount === null ? "text-sm font-medium text-slate-500" : "text-xl font-semibold tracking-tight text-slate-950"}`}>{displayMoney(listing.openingBid)}</dd></div>
        <div><dt className="text-xs text-slate-500">Sale date</dt><dd className={`mt-1 text-sm ${listing.saleDate ? "font-semibold text-slate-950" : "font-medium text-slate-500"}`}>{displayDate(listing.saleDate)}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-500">
        <span title={sourceDisplayText(listing.discoveryStatus || "Freshness unknown")} className={stale ? "font-medium text-amber-800" : ""}>{archived ? "Archive" : stale ? "Refresh due" : observed ? "Observed" : "Unverified"}{listing.sourceObservedAt ? ` ${displayDate(listing.sourceObservedAt)}` : " · date unavailable"}</span>
        {completeness ? <span title={completeness.missing.length ? `Missing: ${completeness.missing.map(field => field.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ")}` : "All tracked details available"}>{completeness.known}/{completeness.total} details available</span> : null}
        {listing.hasDocuments === true ? <span className="inline-flex items-center gap-1"><FileText size={12} /> Documents</span> : null}
        {knownNumber(listing.dealScore) !== null ? <span title="Modeled Deal Score. Review the inputs in property details.">Modeled score {listing.dealScore}/99</span> : null}
      </div>
      <div className="mt-auto grid grid-cols-[1.2fr_1fr] gap-2 pt-4">
        <Link href={href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2">View property <ArrowUpRight size={14} /></Link>
        <CaseAction listingId={listing.id} label="Research" className="h-11 border-slate-200 bg-white font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50" />
      </div>
    </div>
  </article>;
}
