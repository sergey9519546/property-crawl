import { listingFactOrigin } from "@/lib/evidence";
import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, CalendarDays, ExternalLink, Gavel, MapPin, TrendingUp, AlertTriangle, Info, Clock, FileText, Download, FileCheck2 } from "lucide-react";
import { Listing, SOURCES } from "@/data/listings";
import { getExactSourceListingUrl, getSourceLinkPresentation } from "@/lib/listing-links";
import { safeImageUrl } from "@/lib/listing-display";
import { combineStatusTones, listingOfferAvailability, listingStatusClass, listingStatusTone } from "@/lib/listing-status";
import { serializeJsonLd } from "@/lib/json-ld";
import { formatCountyDisplayName, getCountyCadastralGisLink } from "@/lib/county-seo";
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
import { SOURCE_HOSTS, hostnameMatches } from "@server/scrapers/source-policy";
import { hasParcelBoundaryCoverage } from "@/lib/parcel-boundary-coverage";
import { arbitrateTitleRisk } from "@server/intelligence/title-risk-engine";
import { AssessorReading } from "@/components/listings/assessor-reading";
import { inspectMapLocation } from "@/lib/listing-map-policy";
import { sourceDisplayText } from "@/lib/source-display";
import { bandForScore, scoreBandLabel, DEAL_SCORE_MEANING } from "@/lib/score-bands";
import { listingCatch } from "@/lib/listing-catch";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";
import { LOCALE_META } from "@/lib/i18n/config";
import { formatLocaleNumber, interpolate, selectPlural } from "@/lib/i18n/translator";
import { localizeOccupancy, localizePropType, localizeSaleKind, localizedListingCatch } from "@/lib/i18n/domain";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { CaseAction } from "@/components/research/case-action";
import { SaleMechanics } from "@/components/listings/sale-mechanics";
import { PropertyDocuments } from "@/components/listings/property-documents";
import { EnrichmentView } from "@/components/listings/enrichment-view";
import { NearbyComps } from "@/components/listings/nearby-comps";
import { DueDiligenceChecklist } from "@/components/terminal/due-diligence-checklist";
import { AiBriefingCard } from "@/components/listings/ai-briefing-card";

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
  return (provenance.origin === "live" || provenance.origin === "email_notice")
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

function isAllowedPublisherImageHost(candidateUrl: string, listing: Listing, publisherPhoto: string, exactSourceUrl: string | null) {
  try {
    const candidateHost = new URL(candidateUrl).hostname;
    const photoHost = new URL(publisherPhoto).hostname;
    if (candidateHost.toLowerCase() === photoHost.toLowerCase()) return true;
    if (exactSourceUrl) {
      const pageHost = new URL(exactSourceUrl).hostname;
      if (hostnameMatches(candidateHost, pageHost)) return true;
    }
    const sourceKey = listing.source?.trim().toLowerCase() ?? "";
    const allowedRoots = (SOURCE_HOSTS as Record<string, readonly string[] | undefined>)[sourceKey] ?? [];
    if (allowedRoots.some((root) => hostnameMatches(candidateHost, root))) return true;
    if (sourceKey === "gsa" && hostnameMatches(candidateHost, "cloudfront.net")) return true;
    return false;
  } catch {
    return false;
  }
}

function resolveVerifiedPublisherGallery(listing: Listing, publisherPhoto: string | undefined, exactSourceUrl: string | null): string[] {
  if (!publisherPhoto || !exactSourceUrl) return [];
  const provenance = listing.provenance && typeof listing.provenance === "object" ? listing.provenance : {};
  const media = provenance.media && typeof provenance.media === "object" ? (provenance.media as Record<string, unknown>) : {};
  const gallery: string[] = [];
  const seen = new Set<string>();
  const rejectedGalleryUrls = new Set<string>();

  if (Array.isArray(media.gallery)) {
    for (const entry of media.gallery) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const url = safeImageUrl(item.url);
  
  
      if (!url) continue;
      const record = getExactSourceListingUrl({
        ...listing,
        sourceUrl: typeof item.sourceRecordUrl === "string" ? item.sourceRecordUrl : null,
      });
      if (record !== exactSourceUrl) {
        rejectedGalleryUrls.add(url);
        continue;
      }
      if (!seen.has(url)) {
        seen.add(url);
        gallery.push(url);
        if (gallery.length === 12) return gallery;
      }
    }
  }

  // When verified publisher photo proof passed and listing.images was hydrated
  // from persisted images[], append host-verified publisher URLs while keeping
  // mismatched media.gallery items and unverified external hosts excluded.
  if (Array.isArray(listing.images) && (gallery.length === 0 || listing.images.length > gallery.length)) {
    for (const candidate of listing.images) {
      const url = safeImageUrl(candidate);
      if (!url || seen.has(url) || rejectedGalleryUrls.has(url)) continue;
      if (!isAllowedPublisherImageHost(url, listing, publisherPhoto, exactSourceUrl)) continue;
      seen.add(url);
      gallery.push(url);
      if (gallery.length === 12) break;
    }
  }

  return gallery;
}

// Page-title noun for the sale type. Sheriff Sale stays the default so the
// title still matches the Sheriff Sale | PerfectProperty contract; other
// programs get their own label instead of being mislabeled as sheriff sales.
function saleTitleKind(listing: Listing): string {
  const program = String((listing as { auctionProgram?: unknown }).auctionProgram ?? "");
  switch (listing.source) {
    case "hud": return "HUD REO Sale";
    case "gsa": return "Federal Surplus Property";
    case "irs": return "IRS Seizure Auction";
    case "treasury": return "Treasury Auction";
    case "usda": return "USDA REO Sale";
    case "fdic": return "FDIC Property Sale";
    case "fannie": case "freddie": return "Agency REO Sale";
    case "trustee": return "Trustee Sale";
    case "landbank": return "Land Bank Sale";
    case "servicelink": return /short sale/i.test(program) ? "Short Sale Auction" : "Bank-Owned Auction";
    default: return "Sheriff Sale";
  }
}

// Share one bounded lookup between metadata and content in this render only.
type ListingFetchResult =
  | { status: "ok"; listing: Listing }
  | { status: "not_found" }
  | { status: "unavailable"; statusCode?: number };

const getListing = cache(async (id: string): Promise<ListingFetchResult> => {
  let listingId = id;
  try { listingId = decodeURIComponent(id); } catch { return { status: "not_found" }; }
  try {
    const apiUrl = process.env.PROPERTY_API_URL || "http://localhost:3000";
    const res = await fetch(`${apiUrl}/api/listings/${encodeURIComponent(listingId)}`, {
      cache: "no-store", signal: AbortSignal.timeout(15_000)
    });
    if (res.ok) {
      return { status: "ok", listing: (await res.json()) as Listing };
    }
    if (res.status === 404) {
      return { status: "not_found" };
    }
    return { status: "unavailable", statusCode: res.status };
  } catch (_) {}
  return { status: "unavailable" };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const { id } = await params;
  const listingResult = await getListing(id);
  const listing = listingResult.status === "ok" ? listingResult.listing : null;

  if (!listing) {
    return {
      title: listingResult.status === "not_found" ? (locale === "en" ? "Listing Not Found | PerfectProperty" : m.meta.listingNotFoundTitle) : (locale === "en" ? "Listing Unavailable | PerfectProperty" : m.meta.listingUnavailableTitle),
      description: listingResult.status === "not_found"
        ? "This property record was not found in the listing service."
        : "This property record is currently unavailable from the listing service.",
      robots: { index: false, follow: false },
    };
  }

  const countyName = publishedText(listing.county, "");
  const location = [countyName ? formatCountyDisplayName(countyName) : "", listing.state].filter(Boolean).join(", ");
  const title = `${listing.address}${location ? ` (${location})` : ""} ${localizeSaleKind(saleTitleKind(listing), m, locale)} | PerfectProperty`;
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

  const canonicalUrl = `/listings/${encodeURIComponent(id)}`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    robots: isDemo ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: "PerfectProperty",
      type: "website",
      images: publisherPhoto
        ? [{ url: publisherPhoto, alt: listing.address }]
        : [
            {
              url: "/og-image.png",
              width: 1200,
              height: 630,
              alt: listing.address,
            },
          ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [publisherPhoto || "/og-image.png"],
    },
  };
}

export default async function ListingPage({ params, searchParams }: Props) {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const dUi = m.detailUi;
  const intlLocale = LOCALE_META[locale].intlLocale;
  const { id } = await params;
  const query = await searchParams;
  const requestedReturn = typeof query.returnTo === "string" ? query.returnTo : "";
  const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : "/listings";
  if ((await getListing(id)).status === "not_found") {
    notFound();
  }
  const listingResult = await getListing(id);
  const listing = listingResult.status === "ok" ? listingResult.listing : null;

  if (!listing) {
    return (
      <WorkspaceShell>
      <main className="grid min-h-screen place-items-center bg-paper px-6 text-center">
        <div>
          <h1 className="text-3xl font-bold text-ink">{dUi.listingUnavailable}</h1>
          <p className="mt-3 text-ink-3">The listing service could not provide this record{listingResult.status === "unavailable" && listingResult.statusCode ? ` (HTTP ${listingResult.statusCode})` : ""}. Try again or return to results.</p>
          <Link href={returnTo} className="mt-6 inline-flex items-center gap-2 rounded-control bg-ink px-4 py-3 text-sm font-bold text-white">
            <ArrowLeft className="h-4 w-4" /> {dUi.backToResults}
          </Link>
        </div>
      </main>
      </WorkspaceShell>
    );
  }

  const source = SOURCES[listing.source];
  const listingProv = listing.provenance && typeof listing.provenance === "object" ? listing.provenance as Record<string, unknown> : {};
  const mapLocationGis = inspectMapLocation(listing);
  const gisLink = getCountyCadastralGisLink(listing.state, listing.county, {
    address: listing.address,
    apn: (listing as { assessorParcel?: { canonicalApn?: string | null } }).assessorParcel?.canonicalApn
      ?? (typeof listingProv.parcelNumber === "string" ? listingProv.parcelNumber : null),
    lat: mapLocationGis.accepted ? finiteNumber(listing.lat) : null,
    lng: mapLocationGis.accepted ? finiteNumber(listing.lng) : null,
  });
  const sourceLink = getSourceLinkPresentation(listing, source?.websiteUrl, source?.label);
  const exactSourceUrl = sourceLink.exactUrl ?? getExactSourceListingUrl(listing, source?.websiteUrl);
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
  const showRedemptionReview = !(["hud", "gsa", "usda", "fannie", "freddie", "fdic"].includes(listing.source) && !/internal revenue|federal tax lien/i.test(`${listing.seniorLienWarning ?? ""} ${listing.redemptionWarning ?? ""}`)) && (Boolean(derivedRedemption)
    || Boolean(listing.redemptionWarning)
    || (redemptionDays !== null && redemptionDays > 0));
  const sourceFacts = provenance.sourceFacts && typeof provenance.sourceFacts === "object" ? provenance.sourceFacts as Record<string, unknown> : {};
  const publishedUpsetAmount = positiveNumber((provenance.approximateUpsetPrice as { amount?: unknown } | null | undefined)?.amount ?? sourceFacts.upsetPrice);
  const publishedUpsetSource = optionalPublishedText((provenance.approximateUpsetPrice as { source?: unknown } | null | undefined)?.source);
  const publishedJudgmentAmount = positiveNumber(listing.judgment);
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
  const gallery = resolveVerifiedPublisherGallery(listing, publisherPhoto, exactSourceUrl);







  const detailPhoto = publisherPhoto ?? (secondaryMedia.accepted ? secondaryMedia.url : undefined);
  const detailGallery = publisherPhoto ? gallery : (secondaryMedia.accepted ? secondaryMedia.gallery : []);
  const mapLocation = inspectMapLocation(listing);
  const observedAt = isDemo ? null : formatObservedAt(listing.sourceObservedAt ?? provenance.observedAt);
  const saleTime = optionalPublishedText(sourceFacts.tpsSaleTime ?? sourceFacts.saleTime);
  const saleTimezone = optionalPublishedText(sourceFacts.publisherTimeZone ?? sourceFacts.saleTimezone);
  const saleLocation = optionalPublishedText(sourceFacts.tpsSaleLocation ?? sourceFacts.saleLocation);

  const occupancy = optionalPublishedText(listing.occupancy);
  const interiorAccessAvailable = observedBoolean(sourceFacts.interiorAccessAvailable);
  const hasPublishedAccessState = Boolean(occupancy) || interiorAccessAvailable !== null;
  const accessNeedsAttention = interiorAccessAvailable === false || Boolean(occupancy && /occupied/i.test(occupancy) && !/unoccupied/i.test(occupancy));
  const localizedOccupancy = localizeOccupancy(occupancy, m, locale);
  const accessHeadline = [localizedOccupancy, interiorAccessAvailable === null ? null : interiorAccessAvailable ? dUi.interiorAccessYes : dUi.interiorAccessNo].filter(Boolean).join(" · ");
  const statusLabel = isDemo ? dUi.verifyAtSource : publishedText(listing.lifecycleStatus || listing.status, dUi.verifyAtSource).replace(/^Status:\s*/i, "").replace(/_/g, " ");
  const statusTone = isDemo ? "neutral" : combineStatusTones([listingStatusTone(statusLabel), listingStatusTone(String(listing.status || ""))]);
  const statusClass = listingStatusClass(statusTone);
  const citySuffix = optionalPublishedText(listing.city);
  const addressParts = listing.address.split(",").map((part) => part.trim());
  const headlineAddress = citySuffix && addressParts.length >= 3 && addressParts[1]?.toLowerCase() === citySuffix.toLowerCase() ? addressParts[0] : listing.address;
  const propertyFacts = [
    [dUi.typeLabel, <Fact key="propType" origin={listingFactOrigin(listing, "propType")} value={localizePropType(listing.propType, m, locale)} />],
    [locale === "en" ? "Occupancy" : m.detailUi.occupancyPublishedAs.split(":")[0], <Fact key="occupancy" origin={listingFactOrigin(listing, "occupancy")} value={localizeOccupancy(listing.occupancy, m, locale)} />],
    ["County", <Fact key="county" origin={listingFactOrigin(listing, "county")} value={listing.county} />],
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
    ? arbitrateTitleRisk({ ...listing,
        plaintiff: listing.plaintiff || "",
        state: listing.state,
        raw: typeof listing.raw === "string" ? listing.raw : "",
      })
    : null;

  const scoreBand = bandForScore(listing.dealScore);
  const assessedValue = positiveNumber(listing.assessed);
  const safmrRent = positiveNumber(listing.hudSafmr?.fairMarketRent);
  const hasAssessorEnrollment = hasParcelBoundaryCoverage(listing.state, listing.county);
  const stateCode = optionalPublishedText(listing.state)?.toUpperCase() ?? null;
  const hasStateHpi = Boolean(stateCode && /^[A-Z]{2}$/.test(stateCode) && !["PR", "VI", "GU", "MP", "AS"].includes(stateCode));
  const benchmarkHints: string[] = [];
  if (assessedValue !== null) {
    benchmarkHints.push(`Assessed value ${formatMoney(assessedValue)}`);
  } else if (hasAssessorEnrollment) {
    benchmarkHints.push("County assessor roll lookup available");
  }
  if (safmrRent !== null) {
    const isNonRes = /\b(office|commercial|warehouse|lab|industrial|parking|courthouse|land)\b/i.test(String(listing.propType || ""));
    benchmarkHints.push(`${isNonRes ? "Residential 2BR " : ""}HUD SAFMR ${formatMoney(safmrRent)}/mo${listing.hudSafmr?.zip ? ` (ZIP ${listing.hudSafmr.zip})` : ""}`);
  }
  if (hasStateHpi && stateCode) {
    benchmarkHints.push(`FHFA ${stateCode} HPI context`);
  }
  // Federal/agency REO dispositions are not mortgage or tax foreclosures, so a
  // state redemption baseline would misstate them. An IRS lien is the exception.
  const noStateRedemption = ["hud", "gsa", "usda", "fannie", "freddie", "fdic"].includes(listing.source) && !/internal revenue|federal tax lien/i.test(`${listing.seniorLienWarning ?? ""} ${listing.redemptionWarning ?? ""}`);
  const catchInput = noStateRedemption ? { ...listing, redemptionDays: null, redemptionWarning: null } : listing;
  const catchWarnings = (titleRules?.titleWarnings ?? []).filter((w): w is string => typeof w === "string" && w.length > 0);
  const catchSummary = locale === "en" ? listingCatch(catchInput, catchWarnings) : localizedListingCatch(catchInput, catchWarnings, locale);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: listing.address,
    description: `Auction-source record for ${listing.address}${listing.county ? `, ${formatCountyDisplayName(listing.county)}` : ""}, ${listing.state}${listing.zip ? ` ${listing.zip}` : ""}.`,
    datePosted: publishedText(provenance.observedAt ?? listing.saleDate, "") || undefined,
    image: publisherPhoto,
    offers: openingBid !== null ? {
      "@type": "Offer",
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
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-paper text-ink outline-none">
      {/* Demo fallbacks are deliberately excluded from structured listing data. */}
      {!isDemo && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}

      <div className="mx-auto grid max-w-[1220px] grid-cols-1 gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1.48fr)_minmax(340px,1fr)] lg:gap-8 lg:px-8 lg:py-8">
        <div className="min-w-0 lg:col-span-2">
          <Link href={returnTo} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-ink-3 hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> {dUi.backToResults}
          </Link>
          {isDemo && (
            <div data-testid="demo-listing-disclosure" className="mb-5 border-l-2 border-catch bg-catch-wash px-4 py-3 text-sm leading-relaxed text-catch-ink">
              <strong>{dUi.unverifiedBannerBold} </strong>{dUi.unverifiedBannerBody}
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{headlineAddress}</h1>
          <p className="mt-2 flex min-w-0 items-start gap-2 text-base text-ink-3 sm:text-lg"><MapPin className="mt-1 h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{[publishedText(listing.city, ""), publishedText(listing.state, ""), publishedText(listing.zip, ""), publishedText(listing.county, "") ? formatCountyDisplayName(publishedText(listing.county, "")) : null].filter(Boolean).join(" · ") || dUi.locationNotPublished}</span></p>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-3"><span className="rounded-full border border-line bg-card px-2.5 py-0.5 text-xs font-semibold text-ink-2">{localizeSaleKind(saleTitleKind(listing), m, locale)}</span><span className="font-semibold text-ink">{sourceDisplayText(publishedText(provenance.publisher, source?.label ?? listing.source))}</span>{observedAt ? <> <span aria-hidden>·</span> {interpolate(dUi.sourceObservedPrefix, { date: observedAt })}</> : null}</p>
        </div>

        {/* Hero Visual + 4-Tile Property Vitals (above the fold on desktop and mobile) */}
        <div className="min-w-0 space-y-4 lg:col-start-1">
          <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
            <ListingMedia
              listingId={listing.id}
              address={listing.address}
              state={listing.state}
              county={listing.county}
              apn={listing.apn || listing.parcelKey || null}
              propType={listing.propType}
              source={listing.source}
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
          <dl aria-label={dUi.vitalsAria} className="grid grid-cols-2 gap-3 rounded-card border border-line bg-card p-4 shadow-sm sm:grid-cols-4">
            <div><dt className="text-label font-semibold uppercase tracking-wider text-ink-3">{dUi.typeLabel}</dt><dd className="mt-1 truncate text-sm font-bold text-ink">{localizePropType(listing.propType, m, locale) || m.common.notPublished}</dd></div>
            <div><dt className="text-label font-semibold uppercase tracking-wider text-ink-3">{dUi.layoutLabel}</dt><dd className="mt-1 text-sm font-bold text-ink">{[positiveNumber(listing.beds) !== null ? `${positiveNumber(listing.beds)} ${dUi.bdShort}` : null, positiveNumber(listing.baths) !== null ? `${positiveNumber(listing.baths)} ${dUi.baShort}` : null].filter(Boolean).join(" / ") || m.common.notPublished}</dd></div>
            <div><dt className="text-label font-semibold uppercase tracking-wider text-ink-3">{dUi.livingAreaLabel}</dt><dd className="mt-1 text-sm font-bold text-ink">{positiveNumber(listing.sqft) !== null ? `${formatLocaleNumber(locale, positiveNumber(listing.sqft)!)} ${dUi.sqFtUnit}` : m.common.notPublished}</dd></div>
            <div><dt className="text-label font-semibold uppercase tracking-wider text-ink-3">{dUi.yearBuiltLabel}</dt><dd className="mt-1 text-sm font-bold text-ink">{positiveNumber(listing.year) !== null ? String(positiveNumber(listing.year)) : m.common.notPublished}</dd></div>
          </dl>
          {hasPublishedAccessState && (
            <div data-testid="publisher-access-notice" className={`flex items-start gap-3 rounded-control border p-4 text-sm leading-relaxed ${accessNeedsAttention ? "border-catch/30 bg-catch-wash text-catch-ink" : "border-line bg-card text-ink-2"}`}>
              {accessNeedsAttention ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" aria-hidden /> : <Info className="mt-0.5 h-5 w-5 shrink-0 text-ink-3" aria-hidden />}
              <p><strong className="text-ink">{accessHeadline}</strong><span className="block text-xs">{dUi.accessPublisherNote}</span></p>
            </div>
          )}
        </div>

        {/* Single Unified Auction & Action Decision Rail (above the fold on desktop, ordered before Property overview on mobile) */}
        <aside className="min-w-0 space-y-5 lg:col-start-2 lg:row-start-2 lg:self-start">
          <div className="rounded-card border border-line bg-card p-5 text-ink shadow-card sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">{dUi.auctionDetailsTitle}</h2>
              <span data-testid="listing-status" data-status-tone={statusTone} className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass}`}>{statusLabel}</span>
            </div>
            <p className={openingBid !== null ? "mt-4 text-3xl font-bold tracking-tight sm:text-4xl" : "mt-4 text-2xl font-bold tracking-tight text-ink sm:text-3xl"}>{openingBid !== null ? formatMoney(openingBid) : dUi.openingAmountMissing}</p>
            {(() => {
              const priorRaw = (listing as { peakOpeningBid?: number | null; initialOpeningBid?: number | null }).peakOpeningBid
                ?? (listing as { initialOpeningBid?: number | null }).initialOpeningBid;
              return openingBid !== null && typeof priorRaw === "number" && Number.isFinite(priorRaw) && priorRaw > openingBid ? (
                <p className="mt-0.5 text-xs font-medium text-ink-3">
                  <span className="line-through">{formatMoney(priorRaw)}</span>
                </p>
              ) : null;
            })()}
            <p className="mt-1 text-sm text-ink-3">{openingBid !== null ? dUi.openingAmountPublished : dUi.confirmReservePrompt}</p>
            {openingBid === null && (publishedUpsetAmount !== null || publishedJudgmentAmount !== null) && (
              <div data-testid="published-upset-judgment-callout" className="rounded-control border border-line bg-paper p-3.5 mt-3 text-xs space-y-2">
                {publishedUpsetAmount !== null && (
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-ink-2">{dUi.approxUpsetEstimate}</span>
                      <span className="text-sm font-bold text-ink">{formatMoney(publishedUpsetAmount)}</span>
                    </div>
                    <p className="mt-0.5 text-ink-3 leading-relaxed">
                      {dUi.qualifiedUpsetNote}{publishedUpsetSource ? ` (${sourceDisplayText(publishedUpsetSource)})` : ""}.
                    </p>
                  </div>
                )}
                {publishedJudgmentAmount !== null && (
                  <div className={publishedUpsetAmount !== null ? "border-t border-line pt-2 flex items-baseline justify-between gap-2" : "flex items-baseline justify-between gap-2"}>
                    <span className="font-semibold text-ink-2">{dUi.executionJudgmentLabel}</span>
                    <span className="text-sm font-bold text-ink">{formatMoney(publishedJudgmentAmount)}</span>
                  </div>
                )}
              </div>
            )}
            <dl className="mt-4 divide-y divide-line border-y border-line py-1">
              <div className="flex items-start justify-between gap-4 py-3.5 text-sm"><dt className="flex shrink-0 items-center gap-2 text-ink-3"><CalendarDays className="h-4 w-4" aria-hidden /> {dUi.reportedSaleLabel}</dt><dd className="text-right font-semibold"><Fact origin={listingFactOrigin(listing, "saleDate")} value={listing.saleDate} format="date" />{[saleTime, saleTimezone].filter(Boolean).length ? ` · ${[saleTime, saleTimezone].filter(Boolean).join(" ")}` : null}</dd></div>
              {saleLocation ? <div className="py-3.5 text-sm"><dt className="flex items-center gap-2 text-ink-3"><MapPin className="h-4 w-4" /> {dUi.saleLocationLabel}</dt><dd className="mt-1.5 font-semibold leading-relaxed">{saleLocation}</dd></div> : null}
              <div className="flex items-center justify-between gap-4 py-3.5 text-sm"><dt className="text-ink-3">{dUi.depositTermsLabel}</dt><dd className="max-w-[55%] text-right font-semibold"><Fact origin={listingFactOrigin(listing, "deposit")} value={listing.deposit} /></dd></div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-ink-3">{dUi.confirmTermsNote}</p>
            {sourceLink.primaryUrl ? (
              <div className="mt-4 space-y-2">
                {sourceLink.sessionGateUrl && sourceLink.sessionGateLabel ? (
                  <a href={sourceLink.sessionGateUrl} target="_blank" rel="noreferrer" className="flex min-h-10 items-center justify-center gap-2 rounded-control border border-line-strong bg-paper px-4 py-2 text-center text-xs font-bold text-ink hover:bg-line">
                    {sourceLink.sessionGateLabel} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
                <a href={sourceLink.primaryUrl} target="_blank" rel="noreferrer" data-testid="exact-source-listing-link" className="flex min-h-11 items-center justify-center gap-2 rounded-control bg-ink px-5 py-3 text-center text-sm font-semibold text-white hover:bg-ink-2">
                  {sourceLink.kind === "direct_property" ? dUi.openExactSource : sourceLink.primaryLabel} <ExternalLink className="h-4 w-4" />
                </a>
                {sourceLink.rawEvidenceUrl && sourceLink.rawEvidenceLabel ? (
                  <a href={sourceLink.rawEvidenceUrl} target="_blank" rel="noreferrer" className="flex min-h-9 items-center justify-center gap-1.5 rounded-control border border-line px-3 py-2 text-center text-xs font-semibold text-ink-2 hover:bg-paper">
                    {sourceLink.rawEvidenceLabel} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
                {(sourceLink.hint || sourceLink.referenceId) ? (
                  <p className="rounded-control bg-paper px-3 py-2.5 text-xs leading-relaxed text-ink-3">
                    {sourceLink.referenceId ? <strong className="mb-0.5 block text-ink">{sourceLink.referenceId}</strong> : null}
                    {sourceLink.hint}
                  </p>
                ) : null}
              </div>
            ) : (
              <p data-testid="exact-source-listing-unavailable" className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ink-3"><strong className="text-ink">{dUi.exactUpstreamMissingTitle} </strong>{dUi.exactUpstreamMissingBody}</p>
            )}
            <div className="mt-3"><ListingWatchlistToggle listingId={listing.id} /></div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ListingCompareToggle listingId={listing.id} className="h-11 w-full" />
              <CaseAction listingId={listing.id} className="h-11 rounded-control" label={dUi.researchWorkspaceBtn} />
            </div>
            <div className="mt-3 border-t border-line pt-3 flex flex-col gap-1.5">
              <a
                href="#due-diligence-binder"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-control border border-line-strong bg-paper px-4 text-xs font-semibold text-ink shadow-xs transition hover:bg-line"
              >
                <FileCheck2 className="h-4 w-4 text-ink-3" />
                {dUi.ddWaterfallBtn}
              </a>
              <Link
                href={`/research/${encodeURIComponent(listing.id)}/export`}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-control border border-line-strong bg-card px-4 text-xs font-semibold text-ink-2 shadow-sm transition hover:bg-paper"
              >
                <FileText className="h-4 w-4 text-ink-3" />
                {dUi.decisionDossierBtn}
              </Link>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`/api/listings/${encodeURIComponent(listing.id)}/packet`}
                  target="_blank"
                  rel="noreferrer"
                  download={`decision-packet-${listing.id}.json`}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-control border border-line bg-paper px-2 text-xs font-medium text-ink-2 transition hover:bg-line"
                >
                  <Download className="h-3.5 w-3.5 text-ink-3" />
                  JSON Packet
                </a>
                <a
                  href={`/api/listings/${encodeURIComponent(listing.id)}/packet?format=markdown`}
                  target="_blank"
                  rel="noreferrer"
                  download={`decision-packet-${listing.id}.md`}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-control border border-line bg-paper px-2 text-xs font-medium text-ink-2 transition hover:bg-line"
                >
                  <Download className="h-3.5 w-3.5 text-ink-3" />
                  Markdown
                </a>
              </div>
            </div>
          </div>
        </aside>

        {/* Primary Evidence, Gaps & Deep Underwriting Stream */}
        <section className="min-w-0 lg:col-span-2">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
            <section data-testid="listing-catch" aria-label="Deal Score and the catch" className="rounded-card border border-line bg-card p-5 shadow-card">
            <div className="flex flex-wrap items-center gap-3">
              {scoreBand ? (
                <span data-testid="deal-score-badge" className="rounded-full px-3 py-1 text-sm font-bold" style={{ background: `${scoreBand.color}${scoreBand.alpha}`, color: scoreBand.color }}>
                  {interpolate(dUi.dealScoreBadge, { score: Math.round(Number(listing.dealScore)), label: scoreBand.label })}
                </span>
              ) : (
                <span data-testid="deal-score-badge" className="rounded-full bg-line px-3 py-1 text-sm font-bold text-ink-2">{dUi.dealScoreUnavailable}</span>
              )}
              <span className="text-xs text-ink-3">{scoreBand ? (locale === "en" ? scoreBand.desc : "") : dUi.dealScoreNeedsRange} {locale === "en" ? DEAL_SCORE_MEANING : dUi.dealScoreMeaning}</span>
            </div>
            {!scoreBand && (
              <p data-testid="benchmark-context-summary" className="mt-2.5 text-xs leading-relaxed text-ink-2">
                {benchmarkHints.length > 0 ? (
                  <>
                    <span className="font-semibold text-ink">{dUi.publicBenchmarksLabel}</span>{" "}
                    {benchmarkHints.join(" · ")}.{" "}
                    <a href="#market-evidence" className="font-semibold text-ink underline hover:text-ink-2">{dUi.marketEvidenceLink}</a>
                    {" · "}
                    <a href="#evidence-dossier" className="font-semibold text-ink underline hover:text-ink-2">{dUi.dossierBenchmarksLink}</a>
                  </>
                ) : (
                  <>{dUi.noBenchmarksPre} <a href="#market-evidence" className="font-semibold text-ink underline hover:text-ink-2">{dUi.marketEvidenceLink}</a> and <a href="#evidence-dossier" className="font-semibold text-ink underline hover:text-ink-2">{dUi.tabResearch}</a> below.</>
                )}
              </p>
            )}
            <h2 className="mt-4 text-base font-bold text-ink">{catchSummary.flags.length ? selectPlural(locale, catchSummary.flags.length, dUi.catchHeadlineCount) : dUi.catchHeadlineNone}</h2>
            {catchSummary.notes.length ? <p className="mt-2 text-sm leading-relaxed text-ink-2">{catchSummary.notes.join(" ")}</p> : null}
            {catchSummary.flags.length ? <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2 marker:text-catch">{catchSummary.flags.map((flag, i) => <li key={i}>{flag}</li>)}</ul> : null}
          </section>
          {/* A state-table redemption baseline or a pattern-matched lien signal is modeled, not published, so it must not close the gap (same rule as signals.js). */}
          <GapLedger className="" listing={{ id: listing.id, state: listing.state, county: listing.county, gisUrl: gisLink?.url ?? null, occupancy: listing.occupancy, seniorLienRisk: (provenance.derivedFields as { seniorLienRisk?: unknown } | undefined)?.seniorLienRisk ? null : listing.seniorLienRisk, deposit: listing.deposit, redemptionDays: derivedRedemption ? null : listing.redemptionDays, redemptionWarning: derivedRedemption ? null : listing.redemptionWarning, openingBid: listing.openingBid, saleDate: listing.saleDate, sourceUrl: exactSourceUrl }} />
          </div>
          <div className="mt-6">
            <AiBriefingCard listingId={listing.id} />
          </div>
          <nav aria-label={dUi.sectionNavAria} className="sticky top-0 z-10 -mx-1 mt-6 flex max-w-full gap-6 overflow-x-auto border-b border-line bg-paper/95 px-1 pt-2 text-sm font-semibold text-ink-3 backdrop-blur-sm">
            <a href="#property-facts" className="whitespace-nowrap border-b-2 border-ink px-1 pb-3 text-ink">{dUi.tabOverview}</a>
            <a href="#auction-details" className="whitespace-nowrap px-1 pb-3 hover:text-ink">{dUi.tabSaleTerms}</a>
            <a href="#property-documents" className="whitespace-nowrap px-1 pb-3 hover:text-ink">{dUi.tabDocuments}</a>
            <a href="#market-evidence" className="whitespace-nowrap px-1 pb-3 hover:text-ink">{dUi.tabMarket}</a>
            <a href="#evidence-dossier" className="whitespace-nowrap px-1 pb-3 hover:text-ink">{dUi.tabResearch}</a>
            <a href="#due-diligence-binder" className="whitespace-nowrap px-1 pb-3 hover:text-ink">{dUi.tabDueDiligence}</a>
          </nav>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          <div id="property-facts" className="scroll-mt-6 py-5">
            <h2 className="text-xl font-bold">{dUi.propertyOverviewTitle}</h2>
            <dl className="mt-3 divide-y divide-line border-y border-line">
              {propertyFacts.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 py-3 text-sm">
                  <dt className="font-medium text-ink-3">{label}</dt>
                  <dd className="font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {/* text-ink-3, the lightest text token allowed on light surfaces: this sits on
                the paper page background (5.9:1, above the 4.5:1 floor).
                It is the one string on the page that must not be hard to read:
                it is the notice saying the publisher did not publish these
                facts. Every other ink-3 string on this page is on a card surface,
                which is lighter than paper, so this was the only one at risk. */}
            {missingOptionalPropertyFacts.length ? <p className="mt-3 text-sm text-ink-3">{interpolate(dUi.notPublishedFields, { fields: missingOptionalPropertyFacts.join(", ") })}</p> : null}
          </div>

          <div className="scroll-mt-6"><SaleMechanics listing={listing} exactSourceUrl={exactSourceUrl} labels={dUi} locale={locale} /></div>
          </div>
          <div className="mt-6 scroll-mt-6"><PropertyDocuments evidence={listing.documentEvidence} publisherUrl={exactSourceUrl} locale={locale} intlLocale={intlLocale} labels={dUi} /></div>

          <details id="documents-title" className="mt-6 scroll-mt-6 rounded-card border border-line bg-card px-5 shadow-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-bold text-ink"><span>{dUi.publisherRecordSummary}</span><span className={`text-xs font-semibold ${exactSourceUrl ? "text-ink-2" : "text-catch-ink"}`}>{exactSourceUrl ? dUi.exactPageLinked : dUi.exactUrlUnavailable}</span></summary>
            <div className="border-t border-line pb-5 pt-3">
              {sourceIdentifiers.length ? <dl className="divide-y divide-line text-sm">{sourceIdentifiers.map(([label, identifier]) => <div key={label} className="flex justify-between gap-4 py-3"><dt className="text-ink-3">{label}</dt><dd className="break-words text-right font-semibold text-ink">{String(identifier)}</dd></div>)}</dl> : <p className="py-3 text-sm text-ink-3">{dUi.noPublisherIds}</p>}
              {exactSourceUrl ? <a href={exactSourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-ink underline hover:text-ink-2">{dUi.openExactPublisher} <ExternalLink className="h-4 w-4" /></a> : null}
              {listing.source === "civilview" && provenance.detailUrlRequiresCountySession === true ? <p className="mt-4 rounded-control bg-paper p-4 text-xs leading-relaxed text-ink">CivilView detail pages use a county browser session. If the exact link redirects to the source index, open the county search first and then return to the exact record link.</p> : null}
            </div>
          </details>

          <div id="market-evidence" className="mt-6 scroll-mt-6 rounded-card border border-line bg-card p-6 shadow-card sm:p-8">
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-ink-2">{dUi.decisionEvidenceEyebrow}</p>
            <h2 className="mt-1 text-xl font-bold">{dUi.marketEvidenceTitle}</h2>
            {positiveNumber(listing.assessed) !== null || (estLow !== null && estHigh !== null) ? (
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-control bg-paper p-4"><dt className="text-xs font-bold uppercase tracking-wide text-ink-3">{dUi.storedAssessedValue}</dt><dd className="mt-1 text-lg font-bold text-ink">{formatMoney(positiveNumber(listing.assessed))}</dd></div>
                <div className="rounded-control bg-paper p-4"><dt className="text-xs font-bold uppercase tracking-wide text-ink-3">{dUi.storedValuationRange}</dt><dd className="mt-1 text-lg font-bold text-ink">{estLow !== null && estHigh !== null ? `${formatMoney(estLow)}–${formatMoney(estHigh)}` : "—"}</dd></div>
              </dl>
            ) : null}
            <AssessorReading listingId={listing.id} hasServerParcelKey={Boolean(listing.parcelKey)} />
            <div className="mt-5 rounded-control border border-line bg-paper p-4 text-xs leading-relaxed text-ink-2" data-testid="title-rules-check">
              <p className="font-bold text-ink">{dUi.rulesCheckLead}</p>
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
                    <li className="font-medium text-catch-ink">
                      HOA Super-Priority Assessment Rule: {titleRules.hoaSuperPriority.statute} ({titleRules.hoaSuperPriority.monthsProtected} months protected baseline).
                    </li>
                  ) : null}
                  {titleRules.titleWarnings.filter((warning): warning is string => typeof warning === "string" && warning.length > 0).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
                {titleRules.firstMortgageSurvives && (
                  <div className="mt-3 rounded-control border border-catch/30 bg-catch-wash p-3 font-bold text-catch-ink">
                    {dUi.criticalSeniorDefect}
                  </div>
                )}
              </>
              ) : <p className="mt-2">{dUi.stateMissingNotice}</p>}
            </div>
          </div>

          <div id="evidence-dossier" className="mt-8 scroll-mt-6">
            <PropertyIntelligence key={listing.id} listingId={listing.id} lat={listing.lat ?? null} lng={listing.lng ?? null} documentsShown />
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
            <div className="mt-8 rounded-card border border-line bg-paper p-5 shadow-card">
              <h2 className="text-sm font-bold text-ink">{dUi.crossSourceTitle}</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">
                Multiple sources publish records for this parcel. Both observations are retained; the fresher record is preferred.
              </p>
              <dl className="mt-4 space-y-3">
                <div className="rounded-control border border-line bg-card p-3">
                  <dt className="text-xs font-semibold text-ink-3">{sourceDisplayText(publishedText(provenance.publisher, source?.label ?? listing.source))}{listing.bakeOff?.preferredSource === listing.source ? <span className="ml-2 rounded-control bg-line px-1.5 py-0.5 text-label font-bold text-ink-2">Preferred</span> : null}</dt>
                  <dd className="mt-1 text-lg font-bold text-ink">{formatMoney(listing.openingBid)}</dd>
                  {observedAt ? <dd className="mt-0.5 text-xs text-ink-3">Observed {observedAt} UTC</dd> : null}
                </div>
                {listing.crossSourceMatches.map((match) => (
                  <div key={match.listingId} className="rounded-control border border-line bg-card p-3">
                    <dt className="text-xs font-semibold text-ink-3"><Link href={`/listings/${encodeURIComponent(match.listingId)}?returnTo=${encodeURIComponent(returnTo)}`} className="underline underline-offset-2 hover:text-ink">{sourceDisplayText(match.source)} ({match.listingId})</Link>{listing.bakeOff?.preferredSource === match.source ? <span className="ml-2 rounded-control bg-line px-1.5 py-0.5 text-label font-bold text-ink-2">Preferred</span> : null}</dt>
                    <dd className="mt-1 text-lg font-bold text-ink">{formatMoney(match.openingBid)}</dd>
                    {match.observedAt ? <dd className="mt-0.5 text-xs text-ink-3">Observed {formatObservedAt(match.observedAt)}</dd> : null}
                  </div>
                ))}
              </dl>
              {listing.bakeOff?.reason ? (
                <p className="mt-3 text-xs leading-relaxed text-ink-2">
                  <strong>Preferred:</strong> {sourceDisplayText(listing.bakeOff.preferredSource)} — {listing.bakeOff.reason} (confidence {(listing.bakeOff.confidence * 100).toFixed(0)}%)
                </p>
              ) : null}
            </div>
          )}

          {/* Modeled title-risk signal; never presented as a completed title search. */}
            <details id="modeled-research" className="mt-8 rounded-card border border-line bg-card px-5 py-1 shadow-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-bold text-ink">Modeled research scenarios <span className="text-sm font-normal text-ink-3">Assumptions, not verified property facts</span></summary>
            <div className="border-t border-line pb-5 pt-5">
          {/* Modeled redemption review; confirm against official sale terms. */}
          {showRedemptionReview && (
            <div className="mt-6 rounded-control border border-catch/30 bg-catch-wash p-5 text-xs text-catch-ink space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold flex items-center gap-2 text-catch-ink">
                  <Clock className="h-5 w-5 text-catch-ink" />
                  <span>Modeled redemption review</span>
                </h2>
                <span className="font-extrabold text-label uppercase px-2.5 py-0.5 rounded-control bg-catch/15 text-catch-ink">
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
            <BiddingSimulator listing={listing} publishedUpsetEstimate={publishedUpsetAmount} />
            <DueDiligenceChecklist listing={listing} className="scroll-mt-6" />
            <ListingCompare listingId={listing.id} label={listing.address} />
            <div className={hasAssessorEnrollment ? "grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start" : "space-y-4"}>
              {hasAssessorEnrollment ? <Parcel3DVisualizer listing={listing} /> : <p className="rounded-control border border-line bg-card px-4 py-2.5 text-xs text-ink-3" data-testid="parcel-boundary-not-enrolled">Parcel boundary GIS not enrolled for this state/county{listing.state ? ` (${[publishedText(listing.county, ""), listing.state].filter(Boolean).join(", ")})` : ""}.</p>}
              <NearbyComps listingId={listing.id} targetAddress={listing.address} targetSqft={listing.sqft} targetOpeningBid={openingBid} />
            </div>
            {gisLink && (
              <div className="rounded-card border border-line bg-card p-5 text-ink shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-0.5 text-label font-bold uppercase tracking-wider text-ink-2">
                      <MapPin className="h-3 w-3 text-ink-2" />
                      {gisLink.authorityType === "county_assessor_gis" ? "Official County Assessor GIS" : "Statewide Cadastral GIS"}
                    </div>
                    <h3 className="text-sm font-bold text-ink">
                      {gisLink.portalName}
                    </h3>
                    <p className="text-xs text-ink-3 max-w-xl leading-relaxed">
                      {gisLink.instructions}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {gisLink.coordinateMapUrl && gisLink.coordinateMapUrl !== gisLink.url ? (
                      <a
                        href={gisLink.coordinateMapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 rounded-control border border-line-strong bg-card px-3.5 py-2 text-xs font-semibold text-ink hover:bg-paper transition"
                      >
                        Pin Parcel Coordinates <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    <a
                      href={gisLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 rounded-control border border-line-strong bg-paper px-3.5 py-2 text-xs font-semibold text-ink-2 hover:bg-line transition"
                    >
                      {gisLink.isDirectParcelLink ? "Open Direct Parcel GIS" : "Open County GIS"} <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        
      </div>
    </main>
    </WorkspaceShell>
  );
}
