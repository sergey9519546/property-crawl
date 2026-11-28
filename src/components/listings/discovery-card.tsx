"use client";

import { listingFactOrigin } from "@/lib/evidence";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Bookmark, Loader2 } from "lucide-react";
import { Fact } from "@/components/evidence/fact";
import { ListingThumbnail } from "@/components/listings/listing-thumbnail";
import { TriageChips } from "@/components/listings/triage-chips";
import { CaseAction } from "@/components/research/case-action";
import { SOURCES, type PropertyListing } from "@/components/terminal/property-data";
import { displayDate, knownNumber } from "@/lib/listing-display";
import { sourceDisplayText } from "@/lib/source-display";
import { bandForScore } from "@/lib/score-bands";
import { useLocale } from "@/components/i18n/locale-provider";
import { localizeDisplayDate, localizeNumberText } from "@/lib/i18n/domain";
import { formatUsd } from "@/lib/i18n/translator";

const DISTRESS_STAGE_BADGE: Record<string, { label: string; className: string }> = {
  reo: { label: "REO", className: "bg-paper text-ink-2" },
  pre_foreclosure: { label: "Pre-FC", className: "bg-paper text-ink-2" },
  scheduled: { label: "Scheduled", className: "bg-go-wash text-go" },
  tax_sale: { label: "Tax sale", className: "bg-paper text-ink-2" },
};

function readable(value: string) {
  if (value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/\b[a-z]+/g, (word) =>
    /^(n|s|e|w|ne|nw|se|sw|us)$/.test(word) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1));
}
function addressLines(listing: PropertyListing) {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export const DiscoveryCard = React.memo(function DiscoveryCard({ listing, href, saved, saving, onSave, compared, compareFull, onCompare }: Props) {
  const { locale, messages: m, format } = useLocale();
  const { street, locality } = addressLines(listing);
  const observed = (listing.provenance?.origin === "live" || listing.provenance?.origin === "email_notice") && listing.provenance?.observed === true;
  const archived = listing.provenance?.origin === "archive";
  const program = listing.program || listing.auctionProgram;
  const lifecycle = listing.lifecycle || listing.lifecycleStatus;
  const stale = listing.sourceFreshness?.status === "stale";
  const facts = [
    listing.propType && listing.propType !== "Unknown" ? sourceDisplayText(listing.propType) : null,
    knownNumber(listing.beds) !== null ? `${listing.beds} ${m.listingsUi.bedShort}` : null,
    knownNumber(listing.baths) !== null ? `${listing.baths} ${m.listingsUi.bathShort}` : null,
    knownNumber(listing.sqft) !== null ? `${localizeNumberText(Number(listing.sqft), locale)} ${m.listingsUi.sqFtUnit}` : null,
  ].filter(Boolean);
  const completeness = listing.evidenceCompleteness;
  const quality = listing.researchQuality;
  const opportunity = listing.opportunity;
  const effectiveDealScore = knownNumber(listing.dealScore) ?? knownNumber(listing.opportunity?.dealScore);
  const qualityBadge = quality
    ? quality.band === 'strong'
      ? { label: format(m.listingsUi.evidenceScore, { score: quality.score }), className: 'bg-paper text-ink' }
      : quality.band === 'usable'
        ? { label: format(m.listingsUi.evidenceScore, { score: quality.score }), className: 'bg-paper text-ink-2' }
        : { label: format(m.listingsUi.evidenceScore, { score: quality.score }), className: 'bg-catch-wash text-catch-ink' }
    : null;
  const urgencyBadge = opportunity && ['imminent', 'near_term'].includes(opportunity.urgency)
    ? {
        label: opportunity.urgency === 'imminent'
          ? `${m.states.saleLabel} ${opportunity.daysToSale}d`
          : `${m.states.saleLabel} ~${opportunity.daysToSale}d`,
        className: opportunity.urgency === 'imminent'
          ? 'bg-go-fill text-ink'
          : 'bg-go-wash text-go',
      }
    : null;

  const mediaProv = listing.provenance && typeof listing.provenance === "object"
    ? (listing.provenance as {
        media?: {
          photo?: unknown;
          secondary?: { provider?: unknown; sourceRecordUrl?: unknown; verification?: unknown };
        };
      }).media
    : undefined;
  const secondaryMeta = !mediaProv?.photo && mediaProv?.secondary?.verification === "exact_address_match"
    ? mediaProv.secondary
    : undefined;
  const photoProvider = typeof secondaryMeta?.provider === "string" ? secondaryMeta.provider : undefined;
  const photoSourceUrl = typeof secondaryMeta?.sourceRecordUrl === "string" && secondaryMeta.sourceRecordUrl.startsWith("https://")
    ? secondaryMeta.sourceRecordUrl
    : undefined;

  return <article className="relative flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-card shadow-card transition-shadow hover:shadow-raised" aria-label={listing.address}>
    <div className="relative z-20 shrink-0">
      <ListingThumbnail listingId={listing.id} address={listing.address} propType={listing.propType} source={listing.source} photo={listing.photo} photoCount={Array.isArray(listing.images) && listing.images.length > 0 ? listing.images.length : (listing.photo ? 1 : 0)} observed={observed} photoProvider={photoProvider} photoSourceUrl={photoSourceUrl} layout="card" />
      {program ? <span className="absolute left-3 top-3 z-20 max-w-[calc(100%-5rem)] rounded-control bg-card/95 px-2.5 py-1.5 text-xs font-semibold text-ink-2 shadow-sm">{sourceDisplayText(program)}</span> : null}
      <button type="button" onClick={() => onSave(listing.id)} disabled={saving} aria-label={format(saved ? m.listingsUi.removeFromWatchlistAddress : m.listingsUi.addToWatchlistAddress, { address: listing.address })} aria-pressed={saved} className="absolute right-3 top-3 z-20 grid h-11 w-11 place-items-center rounded-full border border-line bg-card text-ink-2 shadow-sm transition hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 disabled:opacity-60">
        {saving ? <Loader2 size={17} className="animate-spin" /> : <Bookmark size={17} className={saved ? "fill-ink text-ink" : ""} />}
      </button>
    </div>
    <div className="flex flex-1 flex-col p-4 sm:p-5">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink-3">
        <span className="font-medium text-ink-3">{sourceDisplayText(SOURCES[listing.source]?.label || listing.source)}</span>
        {lifecycle ? <><span aria-hidden>·</span><span>{sourceDisplayText(lifecycle.replace(/_/g, " "))}</span></> : null}
        {!observed ? <span className="rounded bg-catch-wash px-1.5 py-0.5 text-catch-ink">{archived ? m.listingsUi.datedArchive : m.listingsUi.demoUnverified}</span> : null}
        {(() => {
          const verdict = listing.sourceFreshness?.status;
          const staleFlag = verdict
            ? verdict === "stale"
            : Boolean(listing.triage && listing.triage.staleDays > 30);
          if (!staleFlag) return null;
          const { ageHours, cadenceHours } = listing.sourceFreshness || {};
          const explain = typeof ageHours === "number" && typeof cadenceHours === "number"
            ? `Publisher record last observed ${Math.round(ageHours)}h ago; ${SOURCES[listing.source]?.label || listing.source} refreshes every ${cadenceHours}h.`
            : "The publisher record is past its refresh cadence.";
          return (
            <span className="rounded bg-catch-wash px-1.5 py-0.5 text-xs font-semibold text-catch-ink" title={explain}>
              {m.listingsUi.staleBadge}
            </span>
          );
        })()}
        {(() => {
          const stage = listing.triage?.distressStage;
          if (!stage || stage === "unknown") return null;
          const badge = DISTRESS_STAGE_BADGE[stage];
          if (!badge) return null;
          const stageLabel = locale === "en"
            ? badge.label
            : (m.listingsUi.distressStages[stage as keyof typeof m.listingsUi.distressStages] ?? badge.label);
          return <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${badge.className}`}>{stageLabel}</span>;
        })()}
        {listing.crossSourceMatches && listing.crossSourceMatches.length > 0 ? (
          <span
            className="rounded bg-paper px-1.5 py-0.5 text-xs font-semibold text-ink"
            title={listing.crossSourceMatches.map((item) => `${sourceDisplayText(item.source)}${item.openingBid != null ? ` (${formatUsd(locale, Number(item.openingBid))})` : ""}`).join("\n")}
          >
            {format(m.listingsUi.sourcesCount, { count: listing.crossSourceMatches.length + 1 })}
          </span>
        ) : null}
        {qualityBadge ? (
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-semibold ${qualityBadge.className}`}
            title={quality?.note || "Research evidence quality"}
          >
            {qualityBadge.label}
          </span>
        ) : null}
        {urgencyBadge ? (
          <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${urgencyBadge.className}`} title={opportunity?.note || "Sale urgency"}>
            {urgencyBadge.label}
          </span>
        ) : null}
      </div>
      <h2 className="text-lg font-semibold leading-6 tracking-tight text-ink"><Link href={href} prefetch={false} className="rounded-control hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 after:absolute after:inset-0 after:z-10 after:content-['']">{street}</Link></h2>
      {locality ? <p className="mt-1 text-sm text-ink-3">{locality}</p> : null}
      <TriageChips listing={listing} className="mt-1.5" />
      {facts.length ? <p className="mt-2 text-xs text-ink-3">{facts.join(" · ")}</p> : null}
      {listing.catchSummary ? (
        <p className="mt-2 rounded-control bg-catch-wash px-2 py-1.5 text-xs leading-relaxed text-catch-ink">
          <span className="font-bold">{m.listingsUi.catchLabel}: </span>{listing.catchSummary}
        </p>
      ) : null}
      <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-line py-3">
        <div>
          <dt className="text-xs text-ink-3">{m.listingsUi.openingAmountLabel}</dt>
          <dd className="mt-1 min-h-7 text-xl font-semibold tracking-tight text-ink">
            <Fact origin={listingFactOrigin(listing, "openingBid")} value={listing.openingBid} format="money" />
            {(() => {
              const bid = knownNumber(listing.openingBid);
              const priorRaw = knownNumber((listing as { peakOpeningBid?: unknown; initialOpeningBid?: unknown }).peakOpeningBid)
                ?? knownNumber((listing as { initialOpeningBid?: unknown }).initialOpeningBid);
              return bid !== null && bid > 0 && priorRaw !== null && Math.round(priorRaw) > Math.round(bid) ? (
                <del className="ml-1.5 text-xs font-normal text-ink-3 line-through">{formatUsd(locale, Math.round(priorRaw))}</del>
              ) : null;
            })()}
          </dd>
          {knownNumber(listing.openingBid) === null && knownNumber(listing.judgment) !== null ? (
            <p className="mt-1 text-xs text-ink-3">{m.listingsUi.judgmentPrefix} <span className="font-semibold text-ink">{formatUsd(locale, Number(listing.judgment))}</span></p>
          ) : knownNumber(listing.assessed) !== null ? (
            <p className="mt-1 text-xs text-ink-3">{m.listingsUi.assessedPrefix} <span className="font-medium text-ink-2">{formatUsd(locale, Number(listing.assessed))}</span></p>
          ) : null}
        </div>
        <div>
          <dt className="text-xs text-ink-3">{m.listingsUi.saleDateLabel}</dt>
          <dd className="mt-1 min-h-7 text-sm font-semibold leading-7 text-ink"><Fact origin={listingFactOrigin(listing, "saleDate")} value={listing.saleDate} format="date" /></dd>
          {opportunity && knownNumber(opportunity.rank) !== null ? (
            <p className="mt-1 text-xs text-ink-3">{m.listingsUi.rankPrefix} <span className="font-medium text-ink-2">{opportunity.rank}/100</span></p>
          ) : null}
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-label text-ink-3">
        <span title={sourceDisplayText(listing.discoveryStatus || "Freshness unknown")} className={stale ? "font-medium text-catch-ink" : ""}>
          {archived ? m.listingsUi.sourceArchived : stale ? m.listingsUi.sourceRefreshDue : observed ? m.listingsUi.sourceObserved : m.listingsUi.sourceUnverified}
          {listing.sourceObservedAt ? ` · ${locale === "en" ? displayDate(listing.sourceObservedAt) : localizeDisplayDate(listing.sourceObservedAt, locale, m.listingsUi.dateUnavailable)}` : ` · ${m.listingsUi.dateUnavailable}`}
        </span>
        {completeness ? <span title={completeness.missing.length ? `Not available in this record: ${completeness.missing.map(field => field.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ")}` : "All tracked details are available in this record"}>{format(m.listingsUi.detailsAvailable, { known: completeness.known, total: completeness.total })}</span> : null}
        {effectiveDealScore !== null ? (() => {
          const band = bandForScore(effectiveDealScore);
          const isAssessor = listing.opportunity?.valuationBasis === 'enrolled_assessor_registry';
          return (
            <span
              className={band ? 'font-semibold text-ink' : ''}
              title={band?.desc || (isAssessor ? 'Assessor-benchmarked deal score' : 'Modeled Deal Score')}
            >
              {band ? `${band.label} ${effectiveDealScore}` : `Deal score ${effectiveDealScore}/99`}
              {isAssessor ? ` ${m.listingsUi.assessorTag}` : ''}
            </span>
          );
        })() : null}
      </div>
      <div className="relative z-20 mt-auto grid gap-2 pt-4">
        <button type="button" aria-pressed={compared} aria-label={`${compared ? m.listingsUi.removeBtn : m.listingsUi.compareBtn}: ${listing.address}`} disabled={compareFull && !compared} onClick={() => onCompare(listing.id)} className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-card px-3 text-xs font-semibold text-ink-2 transition hover:border-ink-3 hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 disabled:cursor-not-allowed disabled:opacity-50">
          {compared ? m.listingsUi.inCompareBtn : compareFull ? m.listingsUi.compareFullBtn : m.listingsUi.compareBtn}
        </button>
        <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr]">
          <Link href={href} prefetch={false} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-ink px-3 text-xs font-semibold text-white transition hover:bg-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3 focus-visible:ring-offset-2">{m.listingsUi.viewPropertyBtn} <ArrowUpRight size={14} /></Link>
          <CaseAction listingId={listing.id} label={m.listingsUi.researchBtn} className="h-11 border-line bg-card font-semibold text-ink-2 hover:border-ink-3 hover:bg-paper" />
        </div>
      </div>
    </div>
  </article>;
});
