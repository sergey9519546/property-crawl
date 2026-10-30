"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Bookmark, FileText, Loader2 } from "lucide-react";
import { Fact } from "@/components/evidence/fact";
import { ListingThumbnail } from "@/components/listings/listing-thumbnail";
import { TriageChips } from "@/components/listings/triage-chips";
import { CaseAction } from "@/components/research/case-action";
import { SOURCES, type PropertyListing } from "@/components/terminal/property-data";
import { displayDate, knownNumber } from "@/lib/listing-display";
import { sourceDisplayText } from "@/lib/source-display";
import { bandForScore } from "@/lib/score-bands";

// Distress stage → label + Tailwind classes for the badge.
const DISTRESS_STAGE_BADGE: Record<string, { label: string; className: string }> = {
  reo: { label: "REO", className: "bg-paper text-ink-2" },
  pre_foreclosure: { label: "Pre-FC", className: "bg-paper text-ink-2" },
  scheduled: { label: "Scheduled", className: "bg-go-wash text-go" },
  tax_sale: { label: "Tax sale", className: "bg-paper text-ink-2" },
};

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

type Props = {
  listing: PropertyListing;
  href: string;
  saved: boolean;
  saving: boolean;
  onSave: (id: string) => void;
  compared: boolean;
  compareFull: boolean;
  onCompare: (id: string) => void;
};

// Memoized on purpose: the workbench re-renders whenever any of its own state
// moves (a triage chip, the watchlist, the loading flag), and each card
// re-derives the address, the score band, several number parses, and the date
// and money formatting. All of that is a pure function of `listing`, so a card
// whose props are unchanged has nothing to recompute. `onSave` takes the id so
// the callback identity can stay stable across renders; an inline closure here
// would defeat the comparison, which is the usual way a memoized list stops
// paying off.
//
// Measured alongside the memoized search field, with an instrument that has no
// frame-wait floor in it: typing 19 characters over 48 cards went 302.0 ms ->
// 316.7 ms, about 16 ms per keystroke either way. No measurable benefit here.
//
// What it does buy is a ceiling: a card whose props are unchanged has nothing to
// recompute. That stops mattering at 48 cards and would not at 500. See
// discovery-workbench.tsx for the full numbers, the two claims that were
// withdrawn, and the harness bug that produced them.
export const DiscoveryCard = React.memo(function DiscoveryCard({ listing, href, saved, saving, onSave, compared, compareFull, onCompare }: Props) {
  const { street, locality } = addressLines(listing);
  const observed = listing.provenance?.origin === "live" && listing.provenance?.observed === true;
  const archived = listing.provenance?.origin === "archive";
  const program = listing.program || listing.auctionProgram;
  const lifecycle = listing.lifecycle || listing.lifecycleStatus;
  const stale = listing.sourceFreshness?.status === "stale";
  const facts = [
    knownNumber(listing.beds) !== null ? `${listing.beds} bed` : null,
    knownNumber(listing.baths) !== null ? `${listing.baths} bath` : null,
    knownNumber(listing.sqft) !== null ? `${Number(listing.sqft).toLocaleString("en-US")} sq ft` : null,
  ].filter(Boolean);
  const completeness = listing.evidenceCompleteness;
  const quality = listing.researchQuality;
  const opportunity = listing.opportunity;
  const qualityBadge = quality
    ? quality.band === 'strong'
      ? { label: `Evidence ${quality.score}`, className: 'bg-paper text-ink' }
      : quality.band === 'usable'
        ? { label: `Evidence ${quality.score}`, className: 'bg-paper text-ink-2' }
        : quality.band === 'thin'
          ? { label: `Evidence ${quality.score}`, className: 'bg-catch-wash text-catch-ink' }
          : { label: `Evidence ${quality.score}`, className: 'bg-catch-wash text-catch-ink' }
    : null;
  const urgencyBadge = opportunity && ['imminent', 'near_term'].includes(opportunity.urgency)
    ? {
        label: opportunity.urgency === 'imminent'
          ? `Sale ${opportunity.daysToSale}d`
          : `Sale ~${opportunity.daysToSale}d`,
        className: opportunity.urgency === 'imminent'
          ? 'bg-go-fill text-ink'
          : 'bg-go-wash text-go',
      }
    : null;

  return <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-sm transition-shadow hover:shadow-md" aria-label={listing.address}>
    <div className="relative shrink-0">
      <ListingThumbnail listingId={listing.id} address={listing.address} photo={listing.photo} observed={observed} layout="card" />
      {program ? <span className="absolute left-3 top-3 max-w-[calc(100%-5rem)] rounded-md bg-card/95 px-2.5 py-1.5 text-xs font-semibold text-ink-2 shadow-sm">{sourceDisplayText(program)}</span> : null}
      <button type="button" onClick={() => onSave(listing.id)} disabled={saving} aria-label={`${saved ? "Remove from" : "Add to"} watchlist: ${listing.address}`} aria-pressed={saved} className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full border border-line bg-card text-ink-2 shadow-sm transition hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 disabled:opacity-60">
        {saving ? <Loader2 size={17} className="animate-spin" /> : <Bookmark size={17} className={saved ? "fill-ink text-ink" : ""} />}
      </button>
    </div>
    <div className="flex flex-1 flex-col p-4 sm:p-5">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
        <span className="font-medium text-ink-3">{sourceDisplayText(SOURCES[listing.source]?.label || listing.source)}</span>
        {lifecycle ? <><span aria-hidden>·</span><span>{sourceDisplayText(lifecycle.replace(/_/g, " "))}</span></> : null}
        {!observed ? <span className="rounded bg-catch-wash px-1.5 py-0.5 text-catch-ink">{archived ? "Dated archive" : "Demo / unverified"}</span> : null}
        {(() => {
          // Prefer the server's verdict. It is cadence-aware per source, so a
          // record 11 hours old against a 6-hour cadence is stale, while a
          // 40-day-old fl-dor record on a 720-hour cadence is not. The old
          // `triage.staleDays > 30` test could express neither: it floored to
          // 0 under 24 hours, so with background collection off every ServiceLink
          // listing read as current while /api/health reported all 7,497 as past
          // cadence. That test is kept only as the fallback for a response that
          // carries no freshness verdict at all.
          const verdict = listing.sourceFreshness?.status;
          const stale = verdict
            ? verdict === "stale"
            : Boolean(listing.triage && listing.triage.staleDays > 30);
          if (!stale) return null;
          const { ageHours, cadenceHours } = listing.sourceFreshness || {};
          const explain = typeof ageHours === "number" && typeof cadenceHours === "number"
            ? `Publisher record last observed ${Math.round(ageHours)}h ago; ${SOURCES[listing.source]?.label || listing.source} refreshes every ${cadenceHours}h.`
            : "The publisher record is past its refresh cadence.";
          return (
            <span className="rounded bg-catch-wash px-1.5 py-0.5 text-xs font-semibold text-catch-ink" title={explain}>
              Stale
            </span>
          );
        })()}
        {(() => {
          const stage = listing.triage?.distressStage;
          if (!stage || stage === "unknown") return null;
          const badge = DISTRESS_STAGE_BADGE[stage];
          if (!badge) return null;
          return <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>;
        })()}
        {listing.crossSourceMatches && listing.crossSourceMatches.length > 0 ? (
          <span
            className="rounded bg-paper px-1.5 py-0.5 text-xs font-semibold text-ink"
            title={listing.crossSourceMatches.map((m) => `${sourceDisplayText(m.source)}${m.openingBid != null ? ` ($${Number(m.openingBid).toLocaleString("en-US")})` : ""}`).join("\n")}
          >
            {listing.crossSourceMatches.length + 1} sources
          </span>
        ) : null}
        {qualityBadge ? (
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-semibold ${qualityBadge.className}`}
            title={quality?.note || 'Research evidence quality'}
          >
            {qualityBadge.label}
          </span>
        ) : null}
        {urgencyBadge ? (
          <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${urgencyBadge.className}`} title={opportunity?.note || 'Sale urgency'}>
            {urgencyBadge.label}
          </span>
        ) : null}
      </div>
      <h2 className="text-lg font-semibold leading-6 tracking-tight text-ink"><Link href={href} prefetch={false} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3">{street}</Link></h2>
      {locality ? <p className="mt-1 text-sm text-ink-3">{locality}</p> : null}
      <TriageChips listing={listing} className="mt-1.5" />
      {facts.length ? <p className="mt-2 text-xs text-ink-3">{facts.join(" · ")}</p> : null}
      <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-line py-3">
        <div><dt className="text-xs text-ink-3">Opening amount</dt><dd className="mt-1 min-h-7 text-xl font-semibold tracking-tight text-ink"><Fact value={listing.openingBid} format="money" /></dd></div>
        <div><dt className="text-xs text-ink-3">Sale date</dt><dd className="mt-1 min-h-7 text-sm font-semibold leading-7 text-ink"><Fact value={listing.saleDate} format="date" /></dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-3">
        <span title={sourceDisplayText(listing.discoveryStatus || "Freshness unknown")} className={stale ? "font-medium text-catch-ink" : ""}>{archived ? "Archived source record" : stale ? "Source refresh due" : observed ? "Source record observed" : "Source record unverified"}{listing.sourceObservedAt ? ` · ${displayDate(listing.sourceObservedAt)}` : " · date unavailable"}</span>
        {completeness ? <span title={completeness.missing.length ? `Not available in this record: ${completeness.missing.map(field => field.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ")}` : "All tracked details are available in this record"}>{completeness.known} of {completeness.total} details available</span> : null}
        {listing.hasDocuments === true ? <span className="inline-flex items-center gap-1"><FileText size={12} /> Documents</span> : null}
        {knownNumber(listing.dealScore) !== null ? (() => {
          const band = bandForScore(listing.dealScore);
          return (
            <span title={band?.desc || "Modeled Deal Score. Review the inputs in property details."}>
              {band ? `${band.label} ${listing.dealScore}` : `Modeled score ${listing.dealScore}/99`}
            </span>
          );
        })() : null}
        {opportunity && knownNumber(opportunity.rank) !== null ? <span title={opportunity.note}>Opportunity rank {opportunity.rank}/100</span> : null}
      </div>
      <div className="mt-auto grid gap-2 pt-4">
        <button type="button" aria-pressed={compared} aria-label={`${compared ? "Remove from" : "Add to"} compare: ${listing.address}`} disabled={compareFull && !compared} onClick={() => onCompare(listing.id)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line-strong bg-card px-3 text-xs font-semibold text-ink-2 transition hover:border-ink-3 hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 disabled:cursor-not-allowed disabled:opacity-50">
          {compared ? "In compare" : compareFull ? "Compare is full" : "Compare"}
        </button>
        <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr]">
          <Link href={href} prefetch={false} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-3 text-xs font-semibold text-white transition hover:bg-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 focus-visible:ring-offset-2">View property <ArrowUpRight size={14} /></Link>
          <CaseAction listingId={listing.id} label="Research" className="h-11 border-line bg-card font-semibold text-ink-2 hover:border-ink-3 hover:bg-paper" />
        </div>
      </div>
    </div>
  </article>;
});
