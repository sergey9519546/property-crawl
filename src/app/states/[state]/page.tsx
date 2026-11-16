import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { STATE_NAMES } from "@/lib/hero-market-suggestions";
import {
  countyToSlug,
  getStatutoryRedemption,
  getStatutoryFeeSchedule,
  buildCountyFaqSchema,
} from "@/lib/county-seo";
import { serializeJsonLd } from "@/lib/json-ld";
import { CountyRow, loadStateCounties as loadStateCountiesImpl } from "@/lib/state-coverage";
import { Gavel, Scale, Calculator, AlertTriangle, ArrowLeft } from "lucide-react";

const VALID_STATE_CODES = new Set(Object.keys(STATE_NAMES));

function parseValidStateCode(raw?: string): string | null {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(code) && VALID_STATE_CODES.has(code) ? code : null;
}

const getCachedStateCounties = cache(async (state: string) => loadStateCountiesImpl(state));

export async function generateMetadata({ params }: { params: Promise<{ state: string }> }): Promise<Metadata> {
  const { state: raw } = await params;
  const state = parseValidStateCode(raw);
  if (!state) {
    return {
      title: "State Not Found | PerfectProperty",
      description: "Browse foreclosure and sheriff sale listings by recognized two-letter US state code.",
      robots: { index: false, follow: false },
    };
  }
  const { total, counties, error } = await loadStateCounties(state);
  const stateName = STATE_NAMES[state] || state;
  const isEmptyKnownState = total === 0 && counties.length === 0 && !error;
  const title = `${state} Foreclosure & Sheriff Sales | PerfectProperty`;
  const description = `Browse ${stateName} (${state}) sheriff sales, foreclosure auctions, and tax deed listings by county. Check statutory redemption rules and opening bids before you bid.`;
  const canonicalUrl = `/states/${state}`;
  return {
    title,
    description,
    ...(isEmptyKnownState ? { robots: { index: false, follow: false } } : {}),
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: "PerfectProperty",
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}

export const dynamic = "force-dynamic";

export async function loadStateCounties(state: string): Promise<{ total: number; counties: CountyRow[]; error: string | null }> {
  return getCachedStateCounties(state);
}

export default async function StateCountiesPage({ params }: { params: Promise<{ state: string }> }) {
  const { state: raw } = await params;
  const state = parseValidStateCode(raw);

  if (!state) {
    notFound();
  }

  const { total, counties, error } = await loadStateCounties(state);
  if (total === 0 && counties.length === 0 && !error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-ink">
        <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-3">Browse by state</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">
          No active {STATE_NAMES[state] || state} ({state}) auctions indexed yet
        </h1>
        <p className="mt-4 text-sm leading-6 text-ink-3">
          No live auction or distressed property inventory is currently active for {STATE_NAMES[state] || state}. Return to the state directory or search active markets.
        </p>
        <div className="mt-6 flex flex-wrap gap-4">
          <Link href="/states" className="inline-flex items-center gap-2 text-sm font-semibold text-ink underline">
            <ArrowLeft className="h-4 w-4" /> All states
          </Link>
          <Link href="/listings" className="text-sm font-semibold text-ink underline">
            Browse all active listings
          </Link>
        </div>
      </main>
    );
  }
  const redemption = getStatutoryRedemption(state);
  const hasRule = !redemption.label.startsWith("Statutory redemption details require");
  const feeSchedule = getStatutoryFeeSchedule(state);

  const siteBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_ORIGIN || "https://property-crawl.onrender.com").replace(/\/+$/, "");
  const breadcrumbsSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: siteBaseUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "States",
        item: `${siteBaseUrl}/states`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: state,
        item: `${siteBaseUrl}/states/${state}`,
      },
    ],
  };

  const stateFaqSchema = buildCountyFaqSchema({
    state,
    county: `${state} Statewide`,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbsSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(stateFaqSchema) }}
      />

      <main className="mx-auto max-w-4xl px-6 py-16 text-ink">
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-xs font-medium text-ink-3">
          <Link href="/" className="hover:text-ink transition-colors">Home</Link>
          <span>/</span>
          <Link href="/states" className="hover:text-ink transition-colors">States</Link>
          <span>/</span>
          <span className="text-ink font-semibold">{state}</span>
        </nav>

        <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-label font-semibold uppercase tracking-[0.12em] text-ink-2">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signature ring-1 ring-ink/20" />
          Browse by state
        </p>
        <h1 className="mt-5 text-balance text-display font-semibold tracking-tight text-ink sm:text-5xl">
          Foreclosure and government property auctions in {state}
        </h1>
        <p className="mt-4 max-w-[680px] text-lead leading-relaxed text-ink-2">
          Pick a county to see its upcoming sales and listings. Under each county name you can see where the sale notices come from.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm font-semibold">
          {total > 0 ? (
            <Link href={`/listings?state=${state}`} className="rounded-control bg-ink px-5 py-3 text-white transition hover:bg-ink-2">
              Browse all {total} {state} listings
            </Link>
          ) : null}
          <Link href="/states" className="text-ink underline hover:text-ink-2">
            All states
          </Link>
        </div>

        {/* Statutory Redemption Catch Banner */}
        {hasRule ? (
          <div className="mt-8 rounded-card border border-catch/30 bg-catch-wash p-5 text-catch-ink shadow-sm">
            <div className="flex items-start gap-3">
              <Scale className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" />
              <div>
                <p className="text-label font-semibold uppercase tracking-[0.12em]">
                  The catch to check in {state}: redemption rule
                </p>
                <p className="mt-1 text-sm leading-relaxed">{redemption.label}</p>

                {/* Upset bid callout */}
                {redemption.upsetBid && redemption.upsetBid.hasUpsetBid && (
                  <div className="mt-3 rounded-control border border-catch/40 bg-card p-3 text-xs text-ink">
                    <span className="font-bold text-catch-ink">Statutory Upset Bid Period ({redemption.upsetBid.statute}):</span>{" "}
                    {redemption.upsetBid.description}
                  </div>
                )}

                {/* Homestead vs Non-Homestead Callout */}
                {redemption.homesteadDistinction && redemption.homesteadDistinction.hasDistinction && (
                  <div className="mt-3 rounded-control border border-catch/40 bg-card p-3 text-xs text-ink">
                    <span className="font-bold text-catch-ink">Homestead vs. Non-Homestead Schedule ({redemption.homesteadDistinction.statute}):</span>{" "}
                    {redemption.homesteadDistinction.description}
                  </div>
                )}

                <p className="mt-2 text-xs">
                  <Link href="/resources" className="font-semibold underline">
                    More catches in the buyer&apos;s guide &rarr;
                  </Link>
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* State Statutory Fee Schedule Overview */}
        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-ink-2" />
              <h2 className="text-base font-bold text-ink">
                {state} Statutory Fee &amp; Auction Schedule
              </h2>
            </div>
            <span className="text-xs font-semibold text-ink-3">
              {feeSchedule.scheduleLabel}
            </span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Standard Deposit</div>
              <div className="mt-1 text-base font-bold text-ink">
                {feeSchedule.depositRequirement}
              </div>
              <div className="mt-1 text-label text-ink-3">
                Certified funds required at auction
              </div>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Transfer Tax / Doc Stamps</div>
              <div className="mt-1 text-sm font-semibold text-ink">
                {feeSchedule.transferTaxCitation}
              </div>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Sheriff Poundage</div>
              <div className="mt-1 text-sm font-semibold text-ink">
                {feeSchedule.sheriffPoundageCitation}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-control border border-line bg-paper p-4">
            <div className="text-xs font-bold text-ink mb-1 flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-ink-2" /> Statutory Citations:
            </div>
            <ul className="list-disc pl-5 space-y-1 text-xs text-ink-2">
              {feeSchedule.citations.map((cite, idx) => (
                <li key={idx}>{cite}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Title Risk Warning */}
        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" />
            <div>
              <h2 className="text-sm font-bold text-ink">
                Title risk warning for {state} auctions
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">
                Courthouse foreclosure auctions sell property subject to all senior mortgages, municipal real estate tax liens, and IRS redemption rights (26 U.S.C. § 7425). We provide discovery and fine-print triage, not title insurance or legal representation. Run a complete title search before bidding.
              </p>
            </div>
          </div>
        </div>

        {/* County Directory List */}
        <div className="mt-10">
          <h2 className="text-xl font-bold tracking-tight text-ink mb-4">
            Counties with foreclosure and auction listings in {state}
          </h2>

          {error ? (
            <p role="alert" className="mt-6 rounded-control border border-catch/30 bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>
          ) : counties.length === 0 ? (
            <p className="mt-6 text-sm text-ink-3">No listings in {state} show a county yet. Browse all {state} listings above.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-card shadow-sm">
              {counties.map((row) => (
                <li key={row.county}>
                  <Link
                    href={`/states/${state}/${countyToSlug(row.county)}`}
                    className="block px-5 py-4 text-sm hover:bg-paper transition-colors"
                  >
                    <span className="flex items-center justify-between gap-4">
                      <span className="font-semibold text-ink">{row.county}</span>
                      <span className="tabular-nums text-ink-3">{row.count} {row.count === 1 ? "listing" : "listings"}</span>
                    </span>
                    {row.sources.length > 0 ? (
                      <span className="mt-1 block text-xs text-ink-3">{row.sources.join(", ")}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
