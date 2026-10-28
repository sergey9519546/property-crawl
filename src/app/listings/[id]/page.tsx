import { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { ArrowLeft, CalendarDays, ExternalLink, Gavel, MapPin, TrendingUp, AlertTriangle, Clock, FileText, Download, FileCheck2 } from "lucide-react";
import { Listing, SOURCES } from "@/data/listings";
import { getExactSourceListingUrl } from "@/lib/listing-links";
import { displayDate, safeImageUrl } from "@/lib/listing-display";
import { combineStatusTones, listingOfferAvailability, listingStatusClass, listingStatusTone } from "@/lib/listing-status";
import { serializeJsonLd } from "@/lib/json-ld";
import { redemptionLabel } from "@/lib/underwriting";
import { Fact } from "@/components/evidence/fact";
import { GapLedger } from "@/components/evidence/gap-ledger";
import { DocketAgent } from "@/components/terminal/docket-agent";
import { BiddingSimulator } from "@/components/terminal/bidding-simulator";
import { Parcel3DVisualizer } from "@/components/terminal/parcel-3d-visualizer";
import { ListingCompare, ListingCompareToggle } from "@/components/listings/listing-compare";
import { PropertyIntelligence } from "@/components/listings/property-intelligence";
import { ListingMedia } from "@/components/listings/listing-media";
import { ListingWatchlistToggle } from "@/components/listings/listing-watchlist-toggle";
import { inspectSecondaryMedia } from "@server/scrapers/secondary-property-media";
import { arbitrateTitleRisk } from "@server/intelligence/title-risk-engine";
import { AssessorReading } from "@/components/listings/assessor-reading";
import { inspectMapLocation } from "@/lib/listing-map-policy";
import { sourceDisplayText } from "@/lib/source-display";
import { bandForScore, scoreBandLabel, DEAL_SCORE_MEANING } from "@/lib/score-bands";
import { listingCatch } from "@/lib/listing-catch";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { CaseAction } from "@/components/research/case-action";
import { SaleMechanics } from "@/components/listings/sale-mechanics";
import { PropertyDocuments } from "@/components/listings/property-documents";
import { EnrichmentView } from "@/components/listings/enrichment-view";
import { NearbyComps } from "@/components/listings/nearby-comps";
import { DueDiligenceChecklist } from "@/components/terminal/due-diligence-checklist";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
};

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function formatMoney(value: unknown, fallback = "Not published") {
  const numeric = finiteNumber(value);
  return numeric === null ? fallback : `$${Math.round(numeric).toLocaleString()}`;
}

function publishedText(value: unknown, fallback = "Not published") {
  return typeof value === "string" && value.trim() && !/^(?:—|unknown|n\/a|00000)$/i.test(value.trim()) ? value.trim() : fallback;
}

function optionalPublishedText(value: unknown): string | null {
  const rendered = publishedText(value, "");
  return rendered || null;
}

function observedBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function formatObservedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(timestamp)
    : value;
}

function isObservedSourceRecord(listing: Listing) {
  const provenance = listing.provenance;
  if (!provenance || typeof provenance !== "object") return false;
  const observedAt = listing.sourceObservedAt ?? provenance.observedAt;
  const timestamp = typeof observedAt === "string" ? Date.parse(observedAt) : Number.NaN;
  const exactSourceUrl = getExactSourceListingUrl(listing, SOURCES[listing.source]?.websiteUrl);
  return provenance.origin === "live"
    && provenance.observed === true
    && provenance.recordKind === "source_record"
    && typeof provenance.publisher === "string"
    && provenance.publisher.trim().length > 0
    && (typeof provenance.recordId === "string" || typeof provenance.recordId === "number")
    && Number.isFinite(timestamp)
    && timestamp <= Date.now() + 5 * 60_000
    && Boolean(exactSourceUrl);
}

function verifiedPublisherPhoto(listing: Listing) {
  if (!isObservedSourceRecord(listing)) return undefined;
  const media = listing.provenance?.media;
  const photoEvidence = media && typeof media === "object"
    ? (media as Record<string, unknown>).photo
    : null;
  if (!photoEvidence || typeof photoEvidence !== "object") return undefined;
  const evidence = photoEvidence as Record<string, unknown>;
  if (evidence.origin !== "publisher_record" || evidence.verification !== "source_extracted") return undefined;
  const evidenceRecord = getExactSourceListingUrl({ ...listing, sourceUrl: typeof evidence.sourceRecordUrl === "string" ? evidence.sourceRecordUrl : null });
  if (!evidenceRecord || evidenceRecord !== getExactSourceListingUrl(listing)) return undefined;
  if (evidence.url && safeImageUrl(evidence.url) !== safeImageUrl(listing.photo)) return undefined;
  return safeImageUrl(listing.photo);
}

// Share one bounded lookup between metadata and content in this render only.
const getListing = cache(async (id: string): Promise<Listing | null> => {
  const listingId = decodeURIComponent(id);
  try {
    const apiUrl = process.env.PROPERTY_API_URL || "http://localhost:3000";
    const res = await fetch(`${apiUrl}/api/listings/${encodeURIComponent(listingId)}`, {
      cache: "no-store", signal: AbortSignal.timeout(5_000)
    });
    if (res.ok) {
      return (await res.json()) as Listing;
    }
  } catch (_) {}
  return null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListing(id);

  if (!listing) {
    return {
      title: "Listing Unavailable | PerfectProperty",
      description: "This property record is currently unavailable from the listing service."
    };
  }

  const location = [publishedText(listing.county, ""), listing.state].filter(Boolean).join(", ");
  const title = `${listing.address}${location ? ` | ${location}` : ""} | PerfectProperty`;
  const isDemo = !isObservedSourceRecord(listing);
  const publisherPhoto = verifiedPublisherPhoto(listing);
  const description = [
    isDemo ? `Demonstration property profile for ${listing.address}.` : `Auction-source record for ${listing.address}.`,
    positiveNumber(listing.openingBid) !== null ? `Published opening amount: ${formatMoney(listing.openingBid)}.` : null,
    finiteNumber(listing.dealScore) !== null
      ? `Modeled Deal Score: ${finiteNumber(listing.dealScore)}/99${scoreBandLabel(listing.dealScore) ? ` (${scoreBandLabel(listing.dealScore)})` : ""}. Triage only, not an appraisal.`
      : null,
    "Verify every auction term with the upstream record before bidding.",
  ].filter(Boolean).join(" ");

  return {
    title,
    description,
    robots: isDemo ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description,
      type: "website",
      images: publisherPhoto ? [{ url: publisherPhoto, alt: listing.address }] : []
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: publisherPhoto ? [publisherPhoto] : []
    }
  };
}

export default async function ListingPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const requestedReturn = typeof query.returnTo === "string" ? query.returnTo : "";
  const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : "/listings";
  const listing = await getListing(id);

  if (!listing) {
    return (
      <WorkspaceShell>
      <main className="grid min-h-screen place-items-center bg-[#F5F6F7] px-6 text-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Listing unavailable</h1>
          <p className="mt-3 text-slate-600">The listing service could not provide this record. Try again or return to results.</p>
          <Link href={returnTo} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">
            <ArrowLeft className="h-4 w-4" /> Back to results
          </Link>
        </div>
      </main>
      </WorkspaceShell>
    );
  }

  const source = SOURCES[listing.source];
  const exactSourceUrl = getExactSourceListingUrl(listing, source?.websiteUrl);
  const openingBid = positiveNumber(listing.openingBid);
  const estLow = positiveNumber(listing.estLow);
  const estHigh = positiveNumber(listing.estHigh);
  const redemptionDays = finiteNumber(listing.redemptionDays);
  const provenance = listing.provenance && typeof listing.provenance === "object" ? listing.provenance : {};
  const derivedRedemption = provenance.derivedFields
    && typeof provenance.derivedFields === "object"
    && (provenance.derivedFields as { redemption?: unknown }).redemption
    && typeof (provenance.derivedFields as { redemption?: unknown }).redemption === "object"
    ? (provenance.derivedFields as { redemption: { days?: unknown } }).redemption
    : null;
  const modeledRedemptionDays = derivedRedemption
    ? finiteNumber(derivedRedemption.days) ?? redemptionDays
    : null;
  const showRedemptionReview = Boolean(derivedRedemption)
    || Boolean(listing.redemptionWarning)
    || (redemptionDays !== null && redemptionDays > 0);
  const sourceFacts = provenance.sourceFacts && typeof provenance.sourceFacts === "object" ? provenance.sourceFacts as Record<string, unknown> : {};
  const isDemo = !isObservedSourceRecord(listing);
  const publisherPhoto = verifiedPublisherPhoto(listing);
  // Secondary media is allowed only when the publisher did not supply a
  // verified photo; the shared inspector checks exact-address provenance.
  const secondaryMedia = publisherPhoto
    ? { accepted: false, url: null, gallery: [], provider: null, sourceRecordUrl: null }
    : inspectSecondaryMedia(listing);
  const sourceIdentifiers = [
    ["Property ID", provenance.propertyId ?? sourceFacts.propertyId],
    ["Sheriff / sale number", provenance.sheriffNumber],
    ["Court case", provenance.courtCaseNumber],
    ["Parcel", provenance.parcelNumber],
    ["Amount source", provenance.openingBidSource],
  ].filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number");
  const media = provenance.media && typeof provenance.media === "object" ? provenance.media as Record<string, unknown> : {};
  const gallery = publisherPhoto && Array.isArray(media.gallery) ? media.gallery.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const url = safeImageUrl(item.url);
    const record = getExactSourceListingUrl({ ...listing, sourceUrl: typeof item.sourceRecordUrl === "string" ? item.sourceRecordUrl : null });
    return url && record === exactSourceUrl ? [url] : [];
  }).slice(0, 12) : [];
  const detailPhoto = publisherPhoto ?? (secondaryMedia.accepted ? secondaryMedia.url : undefined);
  const detailGallery = publisherPhoto ? gallery : (secondaryMedia.accepted ? secondaryMedia.gallery : []);
  const mapLocation = inspectMapLocation(listing);
  const observedAt = isDemo ? null : formatObservedAt(listing.sourceObservedAt ?? provenance.observedAt);
  const saleTime = optionalPublishedText(sourceFacts.tpsSaleTime ?? sourceFacts.saleTime);
  const saleTimezone = optionalPublishedText(sourceFacts.publisherTimeZone ?? sourceFacts.saleTimezone);
  const saleLocation = optionalPublishedText(sourceFacts.tpsSaleLocation ?? sourceFacts.saleLocation);
  const reportedSaleSchedule = [displayDate(listing.saleDate), [saleTime, saleTimezone].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  const occupancy = optionalPublishedText(listing.occupancy);
  const interiorAccessAvailable = observedBoolean(sourceFacts.interiorAccessAvailable);
  const hasPublishedAccessState = Boolean(occupancy) || interiorAccessAvailable !== null;
  const accessNeedsAttention = interiorAccessAvailable === false || Boolean(occupancy && /occupied/i.test(occupancy) && !/unoccupied/i.test(occupancy));
  const accessHeadline = [occupancy, interiorAccessAvailable === null ? null : interiorAccessAvailable ? "Interior access available" : "No interior access"].filter(Boolean).join(" · ");
  const statusLabel = isDemo ? "Verify at source" : publishedText(listing.lifecycleStatus || listing.status, "Verify at source").replace(/^Status:\s*/i, "").replace(/_/g, " ");
  const statusTone = isDemo ? "neutral" : combineStatusTones([listingStatusTone(statusLabel), listingStatusTone(String(listing.status || ""))]);
  const statusClass = listingStatusClass(statusTone);
  const citySuffix = optionalPublishedText(listing.city);
  const addressParts = listing.address.split(",").map((part) => part.trim());
  const headlineAddress = citySuffix && addressParts.length >= 3 && addressParts[1]?.toLowerCase() === citySuffix.toLowerCase() ? addressParts[0] : listing.address;
  const propertyFacts = [
    ["Property type", <Fact key="propType" value={listing.propType} />],
    ["Occupancy", <Fact key="occupancy" value={listing.occupancy} />],
    ["County", <Fact key="county" value={listing.county} />],
  ] as [string, React.ReactNode][];
  const optionalPropertyFacts: [string, string | null][] = [
    ["Bedrooms", positiveNumber(listing.beds)?.toLocaleString() ?? null],
    ["Bathrooms", positiveNumber(listing.baths)?.toLocaleString() ?? null],
    ["Interior area", positiveNumber(listing.sqft) !== null ? `${positiveNumber(listing.sqft)?.toLocaleString()} sq ft` : null],
    ["Year built", positiveNumber(listing.year)?.toString() ?? null],
    ["Assessed value", positiveNumber(listing.assessed) !== null ? formatMoney(positiveNumber(listing.assessed)) : null],
  ];
  const missingOptionalPropertyFacts = optionalPropertyFacts.filter(([, value]) => value === null).map(([label]) => label.toLowerCase());
  propertyFacts.push(...optionalPropertyFacts.filter((fact): fact is [string, string] => fact[1] !== null).map(([label, value]): [string, React.ReactNode] => [label, <Fact key={label} value={value} />]));
  const titleRules = /^[A-Za-z]{2}$/.test(listing.state || "")
    ? arbitrateTitleRisk({
        plaintiff: listing.plaintiff || "",
        state: listing.state,
        raw: typeof listing.raw === "string" ? listing.raw : "",
      })
    : null;

  const scoreBand = bandForScore(listing.dealScore);
  const catchSummary = listingCatch(listing, (titleRules?.titleWarnings ?? []).filter((w): w is string => typeof w === "string" && w.length > 0));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: listing.address,
    description: `Auction-source record for ${listing.address}${listing.county ? `, ${listing.county} County` : ""}, ${listing.state}${listing.zip ? ` ${listing.zip}` : ""}.`,
    image: publisherPhoto,
    offers: openingBid !== null ? {
      "@type": "AggregateOffer",
      price: openingBid,
      priceCurrency: "USD",
      availability: listingOfferAvailability(statusTone),
      validFrom: publishedText(listing.saleDate, "") || undefined,
    } : undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: listing.address,
      addressLocality: listing.city || listing.county,
      addressRegion: listing.state,
      postalCode: listing.zip,
      addressCountry: "US"
    },
    geo: mapLocation.accepted ? {
      "@type": "GeoCoordinates",
      latitude: listing.lat,
      longitude: listing.lng
    } : undefined
  };

  return (
    <WorkspaceShell>
    <main className="min-h-screen bg-[#F5F6F7] text-slate-950">
      {/* Demo fallbacks are deliberately excluded from structured listing data. */}
      {!isDemo && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}

      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-6 px-5 py-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,0.9fr)] lg:gap-8 lg:px-8 lg:py-12">
        <div className="min-w-0 lg:col-span-2">
          <Link href={returnTo} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950">
            <ArrowLeft className="h-4 w-4" /> Back to results
          </Link>
          {isDemo && (
            <div data-testid="demo-listing-disclosure" className="mb-5 border-l-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950">
              <strong>Unverified snapshot record. </strong>This stored record has no verified collection evidence. Confirm status, location, and terms at the upstream record.
            </div>
          )}
          <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">{headlineAddress}</h1>
          <p className="mt-2 flex min-w-0 items-start gap-2 text-lg text-slate-600"><MapPin className="mt-1 h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{[publishedText(listing.city, ""), publishedText(listing.state, ""), publishedText(listing.zip, ""), publishedText(listing.county, "") ? `${publishedText(listing.county, "").replace(/\s+county$/i, "")} County` : null].filter(Boolean).join(" · ") || "Location not published"}</span></p>
          <p className="mt-2 text-sm text-slate-600"><span className="font-semibold text-slate-900">{sourceDisplayText(publishedText(provenance.publisher, source?.label ?? listing.source))}</span>{observedAt ? <> <span aria-hidden>·</span> Source observed {observedAt} UTC</> : null}</p>
          <section data-testid="listing-catch" aria-label="Deal Score and the catch" className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              {scoreBand ? (
                <span data-testid="deal-score-badge" className="rounded-full px-3 py-1 text-sm font-bold" style={{ background: `${scoreBand.color}${scoreBand.alpha}`, color: scoreBand.color }}>
                  Deal Score {Math.round(Number(listing.dealScore))}/99 · {scoreBand.label}
                </span>
              ) : (
                <span data-testid="deal-score-badge" className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-700">Deal Score unavailable</span>
              )}
              <span className="text-xs text-slate-600">{scoreBand ? scoreBand.desc : "Needs a published opening amount and value range."} {DEAL_SCORE_MEANING}</span>
            </div>
            <h2 className="mt-4 text-base font-bold text-slate-950">{catchSummary.flags.length ? `The catch: ${catchSummary.flags.length} thing${catchSummary.flags.length === 1 ? "" : "s"} to check before bidding` : "Nothing flagged in what this listing publishes. Title, liens and condition are still unchecked."}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-800">{[...catchSummary.notes, ...catchSummary.flags].join(" ")}</p>
          </section>
          <GapLedger className="mt-4" listing={{ id: listing.id, occupancy: listing.occupancy, seniorLienRisk: listing.seniorLienRisk, deposit: listing.deposit, redemptionDays: listing.redemptionDays, redemptionWarning: listing.redemptionWarning, openingBid: listing.openingBid, saleDate: listing.saleDate, sourceUrl: exactSourceUrl }} />
          {(openingBid !== null || optionalPublishedText(listing.saleDate) || saleTime) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 pt-3 text-sm lg:hidden">
              {openingBid !== null ? <p><span className="text-slate-600">Opening amount </span><strong className="text-slate-950">{formatMoney(openingBid)}</strong></p> : null}
              {optionalPublishedText(listing.saleDate) || saleTime ? <p><span className="text-slate-600">Reported sale </span><strong className="text-slate-950"><Fact value={listing.saleDate} format="date" />{[saleTime, saleTimezone].filter(Boolean).length ? ` · ${[saleTime, saleTimezone].filter(Boolean).join(" ")}` : null}</strong></p> : null}
              <span data-testid="listing-status" data-status-tone={statusTone} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>{statusLabel}</span>
            </div>
          )}
        </div>
        <section className="min-w-0">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <ListingMedia
              listingId={listing.id}
              address={listing.address}
              photo={detailPhoto}
              gallery={detailGallery}
              photoOrigin={publisherPhoto ? "publisher" : secondaryMedia.accepted ? "secondary" : undefined}
              photoProvider={secondaryMedia.accepted ? secondaryMedia.provider : undefined}
              photoSourceUrl={secondaryMedia.accepted ? secondaryMedia.sourceRecordUrl : undefined}
              sourceLabel={publishedText(provenance.publisher, source?.label ?? listing.source)}
              lat={mapLocation.accepted ? finiteNumber(listing.lat) : null}
              lng={mapLocation.accepted ? finiteNumber(listing.lng) : null}
              locationDisclosure={isDemo ? "Unverified snapshot location — confirm the parcel at the source." : undefined}
            />
          </div>

          {hasPublishedAccessState && (
            <div data-testid="publisher-access-notice" className={`mt-5 flex items-start gap-3 rounded-2xl border p-4 text-sm leading-relaxed ${accessNeedsAttention ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 bg-white text-slate-700"}`}>
              <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${accessNeedsAttention ? "text-amber-700" : "text-slate-500"}`} />
              <p><strong className="text-slate-950">{accessHeadline}</strong><span className="block text-xs">Publisher reported. Confirm current access and inspection rules on the exact listing.</span></p>
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-slate-950 shadow-sm lg:hidden">
            <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Auction details</h2><span data-testid="listing-status" data-status-tone={statusTone} className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass}`}>{statusLabel}</span></div>
            <p className="mt-4 text-3xl font-bold tracking-tight">{openingBid !== null ? formatMoney(openingBid) : reportedSaleSchedule}</p><p className="mt-1 text-sm text-slate-600">{openingBid !== null ? "Published opening amount" : "Reported sale"}</p>
            <dl className="mt-4 divide-y divide-slate-200 border-y border-slate-200">{openingBid !== null ? <div className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-slate-600">Reported sale</dt><dd className="text-right font-semibold"><Fact value={listing.saleDate} format="date" />{[saleTime, saleTimezone].filter(Boolean).length ? ` · ${[saleTime, saleTimezone].filter(Boolean).join(" ")}` : null}</dd></div> : <div className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-slate-600">Opening amount</dt><dd className="font-semibold"><Fact value={openingBid} format="money" /></dd></div>}{saleLocation ? <div className="py-3 text-sm"><dt className="text-slate-600">Sale location</dt><dd className="mt-1 font-semibold leading-relaxed">{saleLocation}</dd></div> : null}</dl>
            {exactSourceUrl ? <a href={exactSourceUrl} target="_blank" rel="noreferrer" className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1E293B]">Open exact source listing <ExternalLink className="h-4 w-4" /></a> : <p className="mt-4 text-xs text-slate-600"><strong className="text-slate-900">Exact upstream record not supplied. </strong>No generic portal link is shown.</p>}
            <div className="mt-3"><ListingWatchlistToggle listingId={listing.id} /></div>
            <div className="mt-2"><ListingCompareToggle listingId={listing.id} className="h-12 w-full" /></div>
            <div className="mt-2"><CaseAction listingId={listing.id} className="h-12 rounded-lg" label="Open research workspace" /></div>
            <div className="mt-2 flex flex-col gap-1.5">
              <a
                href="#due-diligence-binder"
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50/60 px-4 text-xs font-semibold text-emerald-950 shadow-xs transition hover:bg-emerald-100/70"
              >
                <FileCheck2 className="h-4 w-4 text-emerald-700" />
                7-Point Due Diligence & Waterfall
              </a>
              <Link
                href={`/research/${encodeURIComponent(listing.id)}/export`}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
              >
                <FileText className="h-4 w-4 text-slate-600" />
                View Decision Packet Dossier
              </Link>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`/api/listings/${encodeURIComponent(listing.id)}/packet`}
                  target="_blank"
                  rel="noreferrer"
                  download={`decision-packet-${listing.id}.json`}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  <Download className="h-3.5 w-3.5 text-slate-500" />
                  JSON Packet
                </a>
                <a
                  href={`/api/listings/${encodeURIComponent(listing.id)}/packet?format=markdown`}
                  target="_blank"
                  rel="noreferrer"
                  download={`decision-packet-${listing.id}.md`}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  <Download className="h-3.5 w-3.5 text-slate-500" />
                  Markdown
                </a>
              </div>
            </div>
          </div>

          <nav aria-label="Property record sections" className="mt-7 flex max-w-full gap-7 overflow-x-auto border-b border-slate-200 text-sm font-semibold text-slate-600">
            <a href="#property-facts" className="whitespace-nowrap border-b-2 border-slate-950 px-1 pb-3 text-slate-950">Overview</a>
            <a href="#auction-details" className="whitespace-nowrap px-1 pb-3 hover:text-slate-950">Auction</a>
            <a href="#property-documents" className="whitespace-nowrap px-1 pb-3 hover:text-slate-950">Documents</a>
            <a href="#evidence-dossier" className="whitespace-nowrap px-1 pb-3 hover:text-slate-950">Research &amp; history</a>
          </nav>

          <div id="property-facts" className="mt-6 scroll-mt-6 py-5">
            <h2 className="text-xl font-bold">Property overview</h2>
            <dl className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
              {propertyFacts.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 py-3 text-sm">
                  <dt className="font-medium text-slate-600">{label}</dt>
                  <dd className="font-semibold text-slate-950">{value}</dd>
                </div>
              ))}
            </dl>
            {/* slate-600, not slate-500: this sits on the #f5f6f7 card and
                slate-500 measures 4.4:1 there, just under the 4.5:1 floor.
                It is the one string on the page that must not be hard to read:
                it is the notice saying the publisher did not publish these
                facts. Every other text-slate-500 on this page is on white,
                where it passes at 4.68:1, so this was the only one flagged. */}
            {missingOptionalPropertyFacts.length ? <p className="mt-3 text-sm text-slate-600">Not published: {missingOptionalPropertyFacts.join(", ")}.</p> : null}
          </div>

          <SaleMechanics listing={listing} exactSourceUrl={exactSourceUrl} />
          <div className="mt-6"><PropertyDocuments evidence={listing.documentEvidence} publisherUrl={exactSourceUrl} /></div>

          <details id="documents-title" className="mt-6 scroll-mt-6 rounded-2xl border border-slate-200 bg-white px-5 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-bold text-slate-950"><span>Publisher record and identifiers</span><span className={`text-xs font-semibold ${exactSourceUrl ? "text-emerald-700" : "text-amber-800"}`}>{exactSourceUrl ? "Exact page linked" : "Exact URL unavailable"}</span></summary>
            <div className="border-t border-slate-200 pb-5 pt-3">
              {sourceIdentifiers.length ? <dl className="divide-y divide-slate-200 text-sm">{sourceIdentifiers.map(([label, identifier]) => <div key={label} className="flex justify-between gap-4 py-3"><dt className="text-slate-600">{label}</dt><dd className="break-words text-right font-semibold text-slate-950">{String(identifier)}</dd></div>)}</dl> : <p className="py-3 text-sm text-slate-600">No additional publisher identifiers were supplied.</p>}
              {exactSourceUrl ? <a href={exactSourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-slate-900 underline hover:text-slate-700">Open exact publisher page <ExternalLink className="h-4 w-4" /></a> : null}
              {listing.source === "civilview" && provenance.detailUrlRequiresCountySession === true ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-900">CivilView detail pages use a county browser session. If the exact link redirects to the source index, open the county search first and then return to the exact record link.</p> : null}
            </div>
          </details>

          <div id="market-evidence" className="mt-6 scroll-mt-6 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-sky-700">Decision evidence</p>
            <h2 className="mt-1 text-xl font-bold">Market evidence</h2>
            {positiveNumber(listing.assessed) !== null || (estLow !== null && estHigh !== null) ? (
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Stored assessed value</dt><dd className="mt-1 text-lg font-bold text-slate-950">{formatMoney(positiveNumber(listing.assessed))}</dd></div>
                <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Stored valuation range</dt><dd className="mt-1 text-lg font-bold text-slate-950">{estLow !== null && estHigh !== null ? `${formatMoney(estLow)}–${formatMoney(estHigh)}` : "—"}</dd></div>
              </dl>
            ) : null}
            <AssessorReading listingId={listing.id} />
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-800" data-testid="title-rules-check">
              <p className="font-bold text-slate-950">Rules check from the published plaintiff and the state table. Not a title opinion, not a bid instruction, and not a statement that this auction is open.</p>
              <p className="mt-2">Plaintiff: {publishedText(listing.plaintiff)}</p>
              {occupancy ? <p className="mt-2">Occupancy published as {occupancy}.</p> : null}
              {optionalPublishedText(listing.deposit) ? <p className="mt-2">Deposit terms published as {optionalPublishedText(listing.deposit)}.</p> : null}
              {titleRules ? (
                <>
                <ul className="mt-3 space-y-2">
                  <li>Classifier: {titleRules.plaintiffType}. Risk label: {titleRules.riskLevel}.</li>
                  {(titleRules.instrumentPriority?.instrumentNumber || titleRules.instrumentPriority?.bookPage || titleRules.instrumentPriority?.recordedDate) ? (
                    <li data-testid="title-instrument-reference">
                      Recorded instrument reference: {[
                        titleRules.instrumentPriority.instrumentNumber ? `Instrument #${titleRules.instrumentPriority.instrumentNumber}` : null,
                        titleRules.instrumentPriority.bookPage ? `Book ${titleRules.instrumentPriority.bookPage.book}, Page ${titleRules.instrumentPriority.bookPage.page}` : null,
                        titleRules.instrumentPriority.recordedDate ? `Recorded ${titleRules.instrumentPriority.recordedDate}` : null,
                      ].filter(Boolean).join(" · ")}.
                    </li>
                  ) : null}
                  {titleRules.hoaSuperPriority?.isSuperPriorityState ? (
                    <li className="font-medium text-amber-900">
                      HOA Super-Priority Assessment Rule: {titleRules.hoaSuperPriority.statute} ({titleRules.hoaSuperPriority.monthsProtected} months protected baseline).
                    </li>
                  ) : null}
                  {titleRules.titleWarnings.filter((warning): warning is string => typeof warning === "string" && warning.length > 0).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
                {titleRules.firstMortgageSurvives && (
                  <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 font-bold text-rose-950">
                    CRITICAL TITLE DEFECT: Foreclosing party is a junior lienholder. Senior 1st mortgage survives this auction!
                  </div>
                )}
              </>
              ) : <p className="mt-2">State was not published, so the statute table was not applied.</p>}
            </div>
          </div>

          <div id="evidence-dossier" className="mt-8 scroll-mt-6">
            <PropertyIntelligence key={listing.id} listingId={listing.id} documentsShown />
            {/* Parcel enrichment, mounted for the records that can actually use
                it. 114 of 6,539 live records (1.7%) carry a parcelKey - all from
                fl-dor-cadastral (100) and treasury (14) - because most publishers
                report no parcel identifier, so buildParcelKey() has nothing to
                derive from. The other 98.3% see nothing at all rather than an
                empty "shares the parcelKey null" panel, which is what an
                unconditional mount would have shown nearly every visitor.

                An earlier attempt at this mount was written and then withdrawn
                because it could not be shown to render: the only evidence
                available was a built bundle, where a stale build and a false
                conditional produce identical HTML. The parcelKey is on the SSR
                payload either way, so the page could not tell them apart. That
                was a measurement problem, not a code problem - see
                test/enrichment-mount-contract.test.js, which now drives the
                real stack and asserts the section appears for a parcel-bearing
                listing and is absent for one without. */}
            {listing.parcelKey ? <EnrichmentView parcelKey={listing.parcelKey} /> : null}
          </div>

          {/* Cross-source bake-off: when multiple sources publish the same parcel. */}
          {Array.isArray(listing.crossSourceMatches) && listing.crossSourceMatches.length > 0 && (
            <div className="mt-8 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-indigo-950">Cross-source observations</h2>
              <p className="mt-1 text-xs leading-relaxed text-indigo-800">
                Multiple sources publish records for this parcel. Both observations are retained; the fresher record is preferred.
              </p>
              <dl className="mt-4 space-y-3">
                <div className="rounded-xl border border-indigo-200 bg-white p-3">
                  <dt className="text-xs font-semibold text-slate-600">{sourceDisplayText(publishedText(provenance.publisher, source?.label ?? listing.source))}{listing.bakeOff?.preferredSource === listing.source ? <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">Preferred</span> : null}</dt>
                  <dd className="mt-1 text-lg font-bold text-slate-950">{formatMoney(listing.openingBid)}</dd>
                  {observedAt ? <dd className="mt-0.5 text-xs text-slate-500">Observed {observedAt} UTC</dd> : null}
                </div>
                {listing.crossSourceMatches.map((match) => (
                  <div key={match.listingId} className="rounded-xl border border-indigo-200 bg-white p-3">
                    <dt className="text-xs font-semibold text-slate-600">{sourceDisplayText(match.source)}{listing.bakeOff?.preferredSource === match.source ? <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">Preferred</span> : null}</dt>
                    <dd className="mt-1 text-lg font-bold text-slate-950">{formatMoney(match.openingBid)}</dd>
                    {match.observedAt ? <dd className="mt-0.5 text-xs text-slate-500">Observed {formatObservedAt(match.observedAt)}</dd> : null}
                  </div>
                ))}
              </dl>
              {listing.bakeOff?.reason ? (
                <p className="mt-3 text-xs leading-relaxed text-indigo-900">
                  <strong>Preferred:</strong> {sourceDisplayText(listing.bakeOff.preferredSource)} — {listing.bakeOff.reason} (confidence {(listing.bakeOff.confidence * 100).toFixed(0)}%)
                </p>
              ) : null}
            </div>
          )}

          {/* Modeled title-risk signal; never presented as a completed title search. */}
            <details id="modeled-research" className="mt-8 rounded-2xl border border-slate-200 bg-white px-5 py-1 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-bold text-slate-950">Modeled research scenarios <span className="text-sm font-normal text-slate-500">Assumptions, not verified property facts</span></summary>
            <div className="border-t border-slate-200 pb-5 pt-5">
          {/* Modeled redemption review; confirm against official sale terms. */}
          {showRedemptionReview && (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 text-xs text-amber-950 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold flex items-center gap-2 text-amber-950">
                  <Clock className="h-5 w-5 text-amber-700" />
                  <span>Modeled redemption review</span>
                </h2>
                <span className="font-extrabold text-[11px] uppercase px-2.5 py-0.5 rounded bg-amber-200 text-amber-950">
                  {derivedRedemption
                    ? (modeledRedemptionDays !== null ? `${Math.round(modeledRedemptionDays)}-day state table` : "State table unset")
                    : (redemptionDays !== null ? redemptionLabel(redemptionDays) : "Official terms required")}
                </span>
              </div>
              <p className="leading-relaxed">
                {derivedRedemption
                  ? `State-table baseline only${modeledRedemptionDays !== null ? `: ${Math.round(modeledRedemptionDays)} days for ${listing.state || "this state"}` : ""}. Not a term recorded on this sale.`
                  : (listing.redemptionWarning || (redemptionDays !== null ? `The state-level model suggests a possible ${redemptionLabel(redemptionDays).toLowerCase()} review window for this ${listing.state} sale.` : "The source indicates a redemption review may apply, but no duration was captured."))}
              </p>
              <p className="leading-relaxed font-semibold">Confirm the applicable period and exceptions in the official court, deed, and auction documents.</p>
            </div>
          )}

          {/* Fail-closed official-record evidence check. */}
          <div className="mt-6">
            <DocketAgent listing={listing as any} />
          </div>

          </div>
          </details>
          <div className="mt-8 space-y-8">
            <BiddingSimulator listing={listing} />
            <DueDiligenceChecklist listing={listing} />
            <ListingCompare listingId={listing.id} label={listing.address} />
            <Parcel3DVisualizer listing={listing} />
            <NearbyComps listingId={listing.id} targetAddress={listing.address} targetSqft={listing.sqft} targetOpeningBid={openingBid} />
          </div>
        </section>

        <aside className="hidden min-w-0 space-y-5 lg:sticky lg:top-8 lg:block lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-950 shadow-sm sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Auction details</h2>
              <span data-testid="listing-status" data-status-tone={statusTone} className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass}`}>{statusLabel}</span>
            </div>
            <p className="mt-5 text-4xl font-bold tracking-tight">{openingBid !== null ? formatMoney(openingBid) : reportedSaleSchedule}</p><p className="mt-1 text-sm text-slate-600">{openingBid !== null ? "Published opening amount" : "Reported sale"}</p>
            <dl className="mt-4 divide-y divide-slate-200 border-y border-slate-200 py-1 space-y-0">
              {openingBid !== null ? <div className="flex items-start justify-between gap-4 py-4"><dt className="flex shrink-0 items-center gap-2 text-slate-600"><CalendarDays className="h-4 w-4" /> Reported sale</dt><dd className="text-right font-semibold"><Fact value={listing.saleDate} format="date" />{[saleTime, saleTimezone].filter(Boolean).length ? ` · ${[saleTime, saleTimezone].filter(Boolean).join(" ")}` : null}</dd></div> : <div className="flex items-center justify-between gap-4 py-4"><dt className="text-slate-600">Opening amount</dt><dd className="text-sm font-semibold"><Fact value={openingBid} format="money" /></dd></div>}
              {saleLocation ? <div className="py-4"><dt className="flex items-center gap-2 text-slate-600"><MapPin className="h-4 w-4" /> Sale location</dt><dd className="mt-2 text-sm font-semibold leading-relaxed">{saleLocation}</dd></div> : null}
              <div className="flex items-center justify-between gap-4 py-4"><dt className="text-slate-600">Deposit terms</dt><dd className="max-w-[55%] text-right text-sm font-semibold"><Fact value={listing.deposit} /></dd></div>
            </dl>
            <p className="mt-5 text-xs leading-relaxed text-slate-500">Confirm current sale terms with the publisher.</p>
            {exactSourceUrl ? (
              <a href={exactSourceUrl} target="_blank" rel="noreferrer" data-testid="exact-source-listing-link" className="mt-5 flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-5 py-3 text-center text-sm font-semibold text-white hover:bg-[#1E293B]">
                Open exact source listing <ExternalLink className="h-4 w-4" />
              </a>
            ) : (
              <p data-testid="exact-source-listing-unavailable" className="mt-5 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-600"><strong className="text-slate-900">Exact upstream record not supplied. </strong>No generic portal link is shown.</p>
            )}
            <div className="mt-3"><ListingWatchlistToggle listingId={listing.id} /></div>
            <div className="mt-2"><ListingCompareToggle listingId={listing.id} className="h-12 w-full" /></div>
            <div className="mt-2"><CaseAction listingId={listing.id} className="h-12 rounded-lg" label="Open research workspace" /></div>
            <div className="mt-2 flex flex-col gap-1.5">
              <a
                href="#due-diligence-binder"
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50/60 px-4 text-xs font-semibold text-emerald-950 shadow-xs transition hover:bg-emerald-100/70"
              >
                <FileCheck2 className="h-4 w-4 text-emerald-700" />
                7-Point Due Diligence & Waterfall
              </a>
              <Link
                href={`/research/${encodeURIComponent(listing.id)}/export`}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
              >
                <FileText className="h-4 w-4 text-slate-600" />
                View Decision Packet Dossier
              </Link>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`/api/listings/${encodeURIComponent(listing.id)}/packet`}
                  target="_blank"
                  rel="noreferrer"
                  download={`decision-packet-${listing.id}.json`}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  <Download className="h-3.5 w-3.5 text-slate-500" />
                  JSON Packet
                </a>
                <a
                  href={`/api/listings/${encodeURIComponent(listing.id)}/packet?format=markdown`}
                  target="_blank"
                  rel="noreferrer"
                  download={`decision-packet-${listing.id}.md`}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  <Download className="h-3.5 w-3.5 text-slate-500" />
                  Markdown
                </a>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
    </WorkspaceShell>
  );
}
