import { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarDays, ExternalLink, Gavel, MapPin, TrendingUp, AlertTriangle, Scale, Clock, DollarSign } from "lucide-react";
import { Listing, LISTINGS, SOURCES } from "@/data/listings";
import { getExactSourceListingUrl } from "@/lib/listing-links";
import { safeImageUrl } from "@/lib/listing-display";
import { serializeJsonLd } from "@/lib/json-ld";
import { redemptionLabel } from "@/lib/underwriting";
import { DocketAgent } from "@/components/terminal/docket-agent";
import { PropertyIntelligence } from "@/components/listings/property-intelligence";
import { ListingMedia } from "@/components/listings/listing-media";
import { ListingWatchlistToggle } from "@/components/listings/listing-watchlist-toggle";
import { inspectSecondaryMedia } from "@/lib/scrapers/secondary-property-media";
import { inspectMapLocation } from "@/lib/listing-map-policy";
import { sourceDisplayText } from "@/lib/source-display";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { CaseAction } from "@/components/research/case-action";
import { SaleMechanics } from "@/components/listings/sale-mechanics";
import { Logo } from "@/components/site/logo";

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

async function getListing(id: string): Promise<Listing | null> {
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

  const localMatch = LISTINGS.find((item) => item.id === listingId);
  return localMatch
    ? {
        ...localMatch,
        sourceUrl: null,
        status: "demo",
        provenance: {
          ...(localMatch.provenance ?? {}),
          publisher: "PerfectProperty demo fixture",
          recordKind: "demo",
        },
      }
    : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListing(id);

  if (!listing) {
    return {
      title: "Listing Unavailable | PerfectProperty",
      description: "This distressed property record is no longer present in the active feed."
    };
  }

  const location = [publishedText(listing.county, ""), listing.state].filter(Boolean).join(", ");
  const title = `${listing.address}${location ? ` | ${location}` : ""} | PerfectProperty`;
  const isDemo = !isObservedSourceRecord(listing);
  const publisherPhoto = verifiedPublisherPhoto(listing);
  const description = [
    isDemo ? `Demonstration property profile for ${listing.address}.` : `Auction-source record for ${listing.address}.`,
    positiveNumber(listing.openingBid) !== null ? `Published opening amount: ${formatMoney(listing.openingBid)}.` : null,
    finiteNumber(listing.dealScore) !== null ? `Modeled Deal Score: ${finiteNumber(listing.dealScore)}/100.` : null,
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
          <p className="mt-3 text-slate-600">This record is no longer present in the live feed.</p>
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
  const seniorLienRisk = (listing.seniorLienRisk || "").toLowerCase();
  const isHighRisk = seniorLienRisk === "high";
  const provenance = listing.provenance && typeof listing.provenance === "object" ? listing.provenance : {};
  const isDemo = !isObservedSourceRecord(listing);
  const publisherPhoto = verifiedPublisherPhoto(listing);
  // Secondary media is allowed only when the publisher did not supply a
  // verified photo; the shared inspector checks exact-address provenance.
  const secondaryMedia = publisherPhoto
    ? { accepted: false, url: null, gallery: [], provider: null, sourceRecordUrl: null }
    : inspectSecondaryMedia(listing);
  const sourceIdentifiers = [
    ["Property ID", provenance.propertyId],
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
  const propertyFacts = [
    ["Property type", publishedText(listing.propType)],
    ["Occupancy", publishedText(listing.occupancy)],
    ["County", publishedText(listing.county)],
  ] as [string, string][];
  const optionalPropertyFacts: [string, string | null][] = [
    ["Bedrooms", positiveNumber(listing.beds)?.toLocaleString() ?? null],
    ["Bathrooms", positiveNumber(listing.baths)?.toLocaleString() ?? null],
    ["Interior area", positiveNumber(listing.sqft) !== null ? `${positiveNumber(listing.sqft)?.toLocaleString()} sq ft` : null],
    ["Year built", positiveNumber(listing.year)?.toString() ?? null],
    ["Assessed value", positiveNumber(listing.assessed) !== null ? formatMoney(positiveNumber(listing.assessed)) : null],
  ];
  const missingOptionalPropertyFacts = optionalPropertyFacts.filter(([, value]) => value === null).map(([label]) => label.toLowerCase());
  propertyFacts.push(...optionalPropertyFacts.filter((fact): fact is [string, string] => fact[1] !== null));

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
      availability: "https://schema.org/InStock",
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

      <header className="border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
          <Link href="/" aria-label="PerfectProperty home"><Logo className="text-[18px]" /></Link>
          <Link href={returnTo} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-700">
            <ArrowLeft className="h-4 w-4" /> Back to results
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 px-5 py-10 lg:grid-cols-[minmax(0,2fr)_minmax(320px,0.9fr)] lg:px-8 lg:py-12">
        <div className="min-w-0 lg:col-span-2">
          {isDemo && (
            <div data-testid="demo-listing-disclosure" className="mb-5 border-l-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950">
              <strong>Unverified snapshot record. </strong>This stored record has no verified collection evidence. Confirm status, location, and terms at the upstream record.
            </div>
          )}
          <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">{listing.address}</h1>
          <p className="mt-2 flex min-w-0 items-start gap-2 text-lg text-slate-600"><MapPin className="mt-1 h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{[publishedText(listing.city, ""), publishedText(listing.state, ""), publishedText(listing.zip, ""), publishedText(listing.county, "") ? `${publishedText(listing.county, "").replace(/\s+county$/i, "")} County` : null].filter(Boolean).join(" · ") || "Location not published"}</span></p>
          <p className="mt-2 text-sm text-slate-600"><span className="font-semibold text-slate-900">{sourceDisplayText(publishedText(provenance.publisher, source?.label ?? listing.source))}</span>{observedAt ? <> <span aria-hidden>·</span> Source observed {observedAt} UTC</> : null}</p>
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
              lat={mapLocation.accepted ? finiteNumber(listing.lat) : null}
              lng={mapLocation.accepted ? finiteNumber(listing.lng) : null}
              locationDisclosure={isDemo ? "Unverified snapshot location — confirm the parcel at the source." : undefined}
            />
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-slate-950 shadow-sm lg:hidden">
            <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Auction details</h2><span className="text-sm font-medium text-emerald-700">{isDemo ? "Verify at source" : publishedText(listing.status, "Verify at source")}</span></div>
            <p className="mt-4 text-3xl font-bold tracking-tight">{formatMoney(openingBid)}</p><p className="mt-1 text-sm text-slate-600">Published opening amount</p>
            <dl className="mt-4 divide-y divide-slate-200 border-y border-slate-200"><div className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-slate-600">Reported sale date</dt><dd className="text-right font-semibold">{publishedText(listing.saleDate)}</dd></div><div className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-slate-600">Status</dt><dd className="text-right font-semibold">{isDemo ? "Verify at source" : publishedText(listing.status, "Verify at source")}</dd></div></dl>
            {exactSourceUrl ? <a href={exactSourceUrl} target="_blank" rel="noreferrer" className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1E293B]">Open exact source listing <ExternalLink className="h-4 w-4" /></a> : <p className="mt-4 text-xs text-slate-600"><strong className="text-slate-900">Exact upstream record not supplied. </strong>No generic portal link is shown.</p>}
            <div className="mt-3"><ListingWatchlistToggle listingId={listing.id} /></div>
            <div className="mt-2"><CaseAction listingId={listing.id} label="Open research case" /></div>
          </div>

          <nav aria-label="Property record sections" className="mt-7 flex max-w-full gap-7 overflow-x-auto border-b border-slate-200 text-sm font-semibold text-slate-600">
            <a href="#property-facts" className="whitespace-nowrap border-b-2 border-slate-950 px-1 pb-3 text-slate-950">Overview</a>
            <a href="#auction-details" className="whitespace-nowrap px-1 pb-3 hover:text-slate-950">Auction &amp; terms</a>
            <a href="#documents-title" className="whitespace-nowrap px-1 pb-3 hover:text-slate-950">Documents &amp; evidence</a>
            <a href="#evidence-dossier" className="whitespace-nowrap px-1 pb-3 hover:text-slate-950">Evidence dossier</a>
            <a href="#modeled-research" className="whitespace-nowrap px-1 pb-3 hover:text-slate-950">Research tools</a>
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
            {missingOptionalPropertyFacts.length ? <p className="mt-3 text-sm text-slate-500">Not published: {missingOptionalPropertyFacts.join(", ")}.</p> : null}
          </div>

          <div id="auction-details" className="mt-8 scroll-mt-6 border-t border-slate-200 pt-6">
            <h2 className="text-xl font-bold">Auction &amp; terms</h2>
            <dl className="mt-4 grid gap-x-10 gap-y-4 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Plaintiff</dt><dd className="mt-1 font-semibold">{publishedText(listing.plaintiff)}</dd></div>
              <div><dt className="text-slate-500">Defendant</dt><dd className="mt-1 font-semibold">{publishedText(listing.defendant)}</dd></div>
              <div><dt className="text-slate-500">Attorney</dt><dd className="mt-1 font-semibold">{publishedText(listing.attorney)}</dd></div>
              <div><dt className="text-slate-500">Deposit terms</dt><dd className="mt-1 font-semibold">{publishedText(listing.deposit)}</dd></div>
            </dl>
          </div>

          <div id="documents-title" className="mt-8 border-t border-slate-200 pt-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Source record</h2>
              </div>
              <span className={`text-xs font-semibold ${exactSourceUrl ? "text-emerald-700" : "text-amber-800"}`}>
                {exactSourceUrl ? "Exact publisher page" : "Exact URL unavailable"}
              </span>
            </div>
            <dl className="mt-4 divide-y divide-slate-200 border-y border-slate-200 text-sm">
              {sourceIdentifiers.map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3"><dt className="text-slate-600">{label}</dt><dd className="break-words text-right font-semibold text-slate-950">{String(value)}</dd></div>)}
              {exactSourceUrl && <div className="flex justify-between gap-4 py-3"><dt className="text-slate-600">Exact publisher page</dt><dd><a href={exactSourceUrl} target="_blank" rel="noreferrer" className="text-slate-900 hover:text-slate-700" aria-label="Open exact publisher page"><ExternalLink className="h-5 w-5" /></a></dd></div>}
            </dl>
            {listing.source === "civilview" && provenance.detailUrlRequiresCountySession === true && (
              <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-900">
                CivilView detail pages use a county browser session. If the exact link redirects to the source index, open the county search first and then return to the exact record link.
              </p>
            )}
          </div>

          <SaleMechanics listing={listing} exactSourceUrl={exactSourceUrl} />

          <div id="market-evidence" className="mt-6 scroll-mt-6 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-sky-700">Decision evidence</p>
            <h2 className="mt-1 text-xl font-bold">Market evidence</h2>
            {positiveNumber(listing.assessed) !== null || (estLow !== null && estHigh !== null) ? (
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Reported assessed value</dt><dd className="mt-1 text-lg font-bold text-slate-950">{formatMoney(positiveNumber(listing.assessed))}</dd><p className="mt-1 text-xs text-slate-500">Shown only when present in the normalized source record.</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Valuation range</dt><dd className="mt-1 text-lg font-bold text-slate-950">{estLow !== null && estHigh !== null ? `${formatMoney(estLow)}–${formatMoney(estHigh)}` : "Not modeled"}</dd><p className="mt-1 text-xs text-slate-500">No comparable-sale claims are shown until exact comp evidence is captured.</p></div>
              </dl>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                No source-backed assessment, valuation range, or comparable-sale evidence has been captured for this record.
              </div>
            )}
          </div>

          <div id="evidence-dossier" className="mt-8 scroll-mt-6">
            <PropertyIntelligence key={listing.id} listingId={listing.id} />
          </div>

          {/* Modeled title-risk signal; never presented as a completed title search. */}
            <details id="modeled-research" className="mt-8 rounded-2xl border border-slate-200 bg-white px-5 py-1 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-bold text-slate-950">Modeled research scenarios <span className="text-sm font-normal text-slate-500">Assumptions, not verified property facts</span></summary>
            <div className="border-t border-slate-200 pb-5 pt-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Scale className="h-5 w-5 text-slate-900" />
                <span>Modeled title-risk signal</span>
              </h2>
              <span className={`text-xs font-extrabold uppercase px-3 py-1 rounded-full ${
                isHighRisk ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
              }`}>
                {isHighRisk ? "Possible senior-lien risk" : "Source review required"}
              </span>
            </div>
            <div className={`p-4 rounded-2xl border text-xs flex items-start gap-3 ${
              isHighRisk
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-amber-200 bg-amber-50 text-amber-950"
            }`}>
              <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${isHighRisk ? "text-red-600" : "text-amber-600"}`} />
              <div>
                <strong className="block font-bold">
                  {isHighRisk ? "Possible junior-creditor signal" : "No senior-lien warning in normalized fields"}
                </strong>
                <p className="mt-1">
                  {isHighRisk
                    ? "The normalized notice may indicate a junior claimant. Confirm lien priority and every surviving encumbrance from official court and recorder documents before bidding."
                    : "The normalized source fields do not include a senior-lien warning. This is not a title search and does not establish that liens will be extinguished."}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
              <strong className="block text-slate-900">Official documents not captured</strong>
              The app will not invent a title package. Court filings, sale terms, deeds, and lien evidence must be attached from exact official URLs before they can appear here.
            </div>
          </div>

          {/* Modeled redemption review; confirm against official sale terms. */}
          {(listing.redemptionWarning || (redemptionDays !== null && redemptionDays > 0)) && (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 text-xs text-amber-950 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold flex items-center gap-2 text-amber-950">
                  <Clock className="h-5 w-5 text-amber-700" />
                  <span>Modeled redemption review</span>
                </h2>
                <span className="font-extrabold text-[11px] uppercase px-2.5 py-0.5 rounded bg-amber-200 text-amber-950">
                  {redemptionDays !== null ? redemptionLabel(redemptionDays) : "Official terms required"}
                </span>
              </div>
              <p className="leading-relaxed">
                {listing.redemptionWarning || (redemptionDays !== null ? `The state-level model suggests a possible ${redemptionLabel(redemptionDays).toLowerCase()} review window for this ${listing.state} sale.` : "The source indicates a redemption review may apply, but no duration was captured.")}
              </p>
              <p className="leading-relaxed font-semibold">Confirm the applicable period and exceptions in the official court, deed, and auction documents.</p>
            </div>
          )}

          {/* Fail-closed official-record evidence check. */}
          <div className="mt-6">
            <DocketAgent listing={listing as any} />
          </div>

          <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-xl font-bold"><DollarSign className="h-5 w-5 text-slate-900" /><span>Cash requirement inputs</span></h2><span className="rounded bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase text-amber-900">Total unresolved</span></div>
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 text-xs">
              <div className="flex justify-between gap-4 p-3.5"><span className="text-slate-600">Published opening amount</span><span className="font-bold text-slate-950">{formatMoney(openingBid)}</span></div>
              <div className="flex justify-between gap-4 p-3.5"><span className="text-slate-600">Published registration / deposit text</span><span className="max-w-[60%] text-right font-semibold text-slate-700">{publishedText(listing.deposit)}</span></div>
              <div className="flex justify-between gap-4 p-3.5"><span className="text-slate-600">Deposit credited toward purchase</span><span className="font-semibold text-amber-800">Unknown</span></div>
              <div className="flex justify-between gap-4 p-3.5"><span className="text-slate-600">Buyer premium or statutory fee</span><span className="font-semibold text-amber-800">Unknown</span></div>
              <div className="flex justify-between gap-4 p-3.5"><span className="text-slate-600">Settlement, transfer, and recording costs</span><span className="font-semibold text-amber-800">Unknown</span></div>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">Source and state names are not fee evidence. Link published terms or enter explicit assumptions in a research case before calculating a total.</p>
          </div></div>
          </details>
        </section>

        <aside className="hidden min-w-0 space-y-5 lg:sticky lg:top-8 lg:block lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-950 shadow-sm sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Auction details</h2>
              <span className="text-sm font-medium text-emerald-700">{isDemo ? "Verify at source" : publishedText(listing.status, "Verify at source")}</span>
            </div>
            <p className="mt-5 text-4xl font-bold tracking-tight">{formatMoney(openingBid)}</p><p className="mt-1 text-sm text-slate-600">Published opening amount</p>
            <dl className="mt-4 divide-y divide-slate-200 border-y border-slate-200 py-1 space-y-0">
              <div className="flex items-center justify-between gap-4 py-4"><dt className="flex items-center gap-2 text-slate-600"><CalendarDays className="h-4 w-4" /> Reported sale date</dt><dd className="text-right font-semibold">{publishedText(listing.saleDate)}</dd></div>
              <div className="flex items-center justify-between gap-4 py-4"><dt className="text-slate-600">Status</dt><dd className="text-right font-semibold">{isDemo ? "Verify at source" : publishedText(listing.status, "Verify at source")}</dd></div>
              <div className="flex items-center justify-between gap-4"><dt className="text-slate-400">Deposit terms</dt><dd className="max-w-[55%] text-right text-sm font-semibold">{publishedText(listing.deposit)}</dd></div>
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
            <div className="mt-2"><CaseAction listingId={listing.id} label="Open research case" /></div>
          </div>
        </aside>
      </div>
    </main>
    </WorkspaceShell>
  );
}
