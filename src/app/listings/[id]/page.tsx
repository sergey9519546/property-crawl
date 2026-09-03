import { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarDays, ExternalLink, Gavel, MapPin, TrendingUp, AlertTriangle, ShieldCheck, Scale, Clock, DollarSign, Calculator } from "lucide-react";
import { Listing, LISTINGS, SOURCES } from "@/data/listings";
import { getExactSourceListingUrl } from "@/lib/listing-links";
import { computeCashToClose, redemptionLabel } from "@/lib/underwriting";
import { Logo } from "@/components/site/logo";

type Props = {
  params: Promise<{ id: string }>;
};

async function getListing(id: string): Promise<Listing | null> {
  const listingId = decodeURIComponent(id);
  const localMatch = LISTINGS.find((item) => item.id === listingId);
  if (localMatch) return localMatch;

  try {
    const apiUrl = process.env.PROPERTY_API_URL || "http://localhost:3000";
    const res = await fetch(`${apiUrl}/api/listings/${encodeURIComponent(listingId)}`, {
      cache: "no-store",
      next: { revalidate: 0 }
    });
    if (res.ok) {
      return (await res.json()) as Listing;
    }
  } catch (_) {}

  return null;
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

  const title = `${listing.address} | ${listing.county} County, ${listing.state} | PerfectProperty`;
  const description = `Foreclosure auction listing for ${listing.address}. Deal Score: ${listing.dealScore}/100. Opening Bid: $${listing.openingBid.toLocaleString()}. Built-in Equity: +$${listing.equity.toLocaleString()}.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: listing.photo ? [{ url: listing.photo, alt: listing.address }] : []
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: listing.photo ? [listing.photo] : []
    }
  };
}

export default async function ListingPage({ params }: Props) {
  const { id } = await params;
  const listing = await getListing(id);

  if (!listing) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F5F6F7] px-6 text-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Listing unavailable</h1>
          <p className="mt-3 text-slate-600">This record is no longer present in the live feed.</p>
          <Link href="/#live-feed" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">
            <ArrowLeft className="h-4 w-4" /> Back to the live feed
          </Link>
        </div>
      </main>
    );
  }

  const source = SOURCES[listing.source];
  const exactSourceUrl = getExactSourceListingUrl(listing, source?.websiteUrl);
  const cashToClose = computeCashToClose({ openingBid: listing.openingBid, state: listing.state, source: listing.source });
  const redemptionDays = listing.redemptionDays ?? 0;
  const seniorLienRisk = (listing.seniorLienRisk || "").toLowerCase();
  const isHighRisk = seniorLienRisk === "high";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: listing.address,
    description: `Foreclosure auction listing for ${listing.address}, ${listing.county} County, ${listing.state} ${listing.zip}. Deal Score: ${listing.dealScore}/100.`,
    image: listing.photo || undefined,
    offers: {
      "@type": "AggregateOffer",
      price: listing.openingBid,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      validFrom: listing.saleDate
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: listing.address,
      addressLocality: listing.city || listing.county,
      addressRegion: listing.state,
      postalCode: listing.zip,
      addressCountry: "US"
    },
    geo: Number.isFinite(listing.lat) && Number.isFinite(listing.lng) && listing.lat !== 0 && listing.lng !== 0 ? {
      "@type": "GeoCoordinates",
      latitude: listing.lat,
      longitude: listing.lng
    } : undefined
  };

  return (
    <main className="min-h-screen bg-[#F5F6F7] text-slate-950">
      {/* Schema.org RealEstateListing JSON-LD for Google Rich Results */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
          <Link href="/" aria-label="PerfectProperty home"><Logo className="text-[18px]" /></Link>
          <Link href="/#live-feed" className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-slate-950">
            <ArrowLeft className="h-4 w-4" /> Live feed
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-10 lg:grid-cols-[1.3fr_0.7fr] lg:px-8 lg:py-14">
        <section>
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <img src={listing.photo} alt={listing.address} className="h-[320px] w-full object-cover sm:h-[460px]" />
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-emerald-700">
                <span>{source?.label ?? listing.source}</span>
                <span aria-hidden="true">·</span>
                <span>Deal score {listing.dealScore}/100</span>
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{listing.address}</h1>
              <p className="mt-3 flex items-center gap-2 text-slate-600"><MapPin className="h-4 w-4" /> {listing.county} County, {listing.state} {listing.zip}</p>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Notice and auction details</h2>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Plaintiff</dt><dd className="mt-1 font-semibold">{listing.plaintiff}</dd></div>
              <div><dt className="text-slate-500">Defendant</dt><dd className="mt-1 font-semibold">{listing.defendant}</dd></div>
              <div><dt className="text-slate-500">Attorney</dt><dd className="mt-1 font-semibold">{listing.attorney}</dd></div>
              <div><dt className="text-slate-500">Deposit terms</dt><dd className="mt-1 font-semibold">{listing.deposit}</dd></div>
            </dl>
          </div>

          {/* Title Risk & Senior Lien Priority */}
          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Scale className="h-5 w-5 text-slate-900" />
                <span>Title Risk & Lien Survival Arbitration</span>
              </h2>
              <span className={`text-xs font-extrabold uppercase px-3 py-1 rounded-full ${
                isHighRisk ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
              }`}>
                {isHighRisk ? "Senior Lien Survival Hazard" : "Clean Senior Foreclosure"}
              </span>
            </div>
            <div className={`p-4 rounded-2xl border text-xs flex items-start gap-3 ${
              isHighRisk
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}>
              {isHighRisk ? (
                <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
              ) : (
                <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
              )}
              <div>
                <strong className="block font-bold">
                  {isHighRisk ? "High Title Risk: Junior Creditor Foreclosure" : "Senior Foreclosure Proceeding"}
                </strong>
                <p className="mt-1">
                  {isHighRisk
                    ? "Notice indicates execution by a junior claimant (second mortgage, HELOC, or HOA assessment). Any pre-existing first mortgage survives this foreclosure and remains encumbered on the deed."
                    : "Action brought by senior first mortgagee or taxing authority. Junior mortgages, subordinate mechanics liens, and judgments will be extinguished upon court confirmation of sale."}
                </p>
              </div>
            </div>
          </div>

          {/* Statutory Redemption Caveat */}
          {(listing.redemptionWarning || redemptionDays > 0) && (
            <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-6 sm:p-8 text-xs text-amber-950 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold flex items-center gap-2 text-amber-950">
                  <Clock className="h-5 w-5 text-amber-700" />
                  <span>Statutory Right of Redemption</span>
                </h2>
                <span className="font-extrabold text-[11px] uppercase px-2.5 py-0.5 rounded bg-amber-200 text-amber-950">
                  {redemptionLabel(redemptionDays)}
                </span>
              </div>
              <p className="leading-relaxed">
                {listing.redemptionWarning || `A statutory right of redemption of ${redemptionLabel(redemptionDays).toLowerCase()} applies to this ${listing.state} sale under state law.`}
              </p>
            </div>
          )}

          {/* Cash-to-Close Fee Schedule */}
          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-slate-900" />
                <span>Statutory Cash-to-Close Fee Schedule</span>
              </h2>
              <span className="text-xs font-extrabold text-emerald-700">
                Est. Total ${cashToClose.total.toLocaleString()}
              </span>
            </div>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl text-xs">
              <div className="p-3.5 flex justify-between">
                <span className="text-slate-600">Opening Bid (Purchase Price)</span>
                <span className="font-bold text-slate-950">${cashToClose.openingBid.toLocaleString()}</span>
              </div>
              <div className="p-3.5 flex justify-between">
                <span className="text-slate-600">Buyer's Premium</span>
                <span className="font-semibold text-slate-700">${cashToClose.buyersPremium.toLocaleString()}</span>
              </div>
              <div className="p-3.5 flex justify-between">
                <span className="text-slate-600">Sheriff / Trustee Statutory Poundage</span>
                <span className="font-semibold text-slate-700">${cashToClose.sheriffPoundage.toLocaleString()}</span>
              </div>
              <div className="p-3.5 flex justify-between">
                <span className="text-slate-600">State / County Transfer Conveyance</span>
                <span className="font-semibold text-slate-700">${cashToClose.transferTax.toLocaleString()}</span>
              </div>
              <div className="p-3.5 flex justify-between">
                <span className="text-slate-600">Deed Recording & Docket Filing Fees</span>
                <span className="font-semibold text-slate-700">${cashToClose.deedFees.toLocaleString()}</span>
              </div>
              <div className="p-3.5 flex justify-between bg-slate-50 rounded-b-2xl">
                <span className="font-bold text-slate-950">Total Liquid Cash Required to Close</span>
                <span className="font-extrabold text-emerald-700">${cashToClose.total.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-5 lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8">
            <h2 className="text-lg font-bold">Deal snapshot</h2>
            <dl className="mt-6 space-y-4">
              <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-slate-400"><Gavel className="h-4 w-4" /> Opening bid</dt><dd className="text-xl font-bold">${listing.openingBid.toLocaleString()}</dd></div>
              <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-slate-400"><TrendingUp className="h-4 w-4" /> Est. value</dt><dd className="font-bold">${listing.estLow.toLocaleString()}–${listing.estHigh.toLocaleString()}</dd></div>
              <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-slate-400"><DollarSign className="h-4 w-4" /> Built-in equity</dt><dd className="font-bold text-emerald-400">+${listing.equity.toLocaleString()}</dd></div>
              <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-slate-400"><CalendarDays className="h-4 w-4" /> Auction</dt><dd className="font-bold">{listing.saleDate}</dd></div>
            </dl>

            <div className="mt-6 pt-5 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1"><Calculator className="h-3.5 w-3.5" /> 70% Rule MAO:</span>
                <span className="font-bold text-emerald-400">
                  ${Math.max(0, Math.round(listing.mid * 0.7 - 25000 - (cashToClose.total - listing.openingBid))).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Deal Score:</span>
                <span className="font-bold text-emerald-400">{listing.dealScore}/100</span>
              </div>
            </div>
          </div>

          {exactSourceUrl ? (
            <a href={exactSourceUrl} target="_blank" rel="noreferrer" data-testid="exact-source-listing-link" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-center text-sm font-bold text-white hover:bg-emerald-700">
              Open exact source listing <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <div data-testid="exact-source-listing-unavailable" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-950">
              <strong className="block">Exact upstream record not supplied</strong>
              No generic portal link is shown. The record above is the exact listing page available in this feed.
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
