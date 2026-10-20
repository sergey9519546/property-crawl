import { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Gavel, Scale, ShieldAlert, TrendingUp } from "lucide-react";
import { serializeJsonLd } from "@/lib/json-ld";
import {
  normalizeCountySlug,
  formatCountyDisplayName,
  computeCountyStats,
  getStatutoryRedemption,
  generateCountyMetadata,
  buildCountyBreadcrumbs,
  buildCountyItemList,
} from "@/lib/county-seo";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ state: string; county: string }>;
};

type ListingSummary = {
  id: string;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  zip?: string | null;
  source?: string | null;
  propType?: string | null;
  openingBid?: number | null;
  dealScore?: number | null;
  saleDate?: string | null;
  auctionDate?: string | null;
  status?: string | null;
};

async function loadCountyData(stateCode: string, countyParam: string): Promise<ListingSummary[]> {
  const normCounty = normalizeCountySlug(countyParam);
  const countyQuery = normCounty.toLowerCase();
  const apiUrl = process.env.PROPERTY_API_URL || "http://localhost:3000";

  // First attempt: fetch via running API server
  try {
    const res = await fetch(
      `${apiUrl}/api/listings?state=${encodeURIComponent(stateCode)}&county=${encodeURIComponent(countyQuery)}&limit=250`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      const items = Array.isArray(data) ? data : Array.isArray(data?.listings) ? data.listings : [];
      if (items.length > 0) return items;
    }
  } catch {
    // API not reachable or timed out; fall through to server discovery engine
  }

  // Second attempt: local database & discovery engine (zero mock, production in-memory or PG)
  try {
    const db = require("@server/db/client");
    const discovery = require("@server/discovery/query");
    const searchUrl = new URL(
      `http://localhost/api/listings?state=${encodeURIComponent(stateCode)}&county=${encodeURIComponent(countyQuery)}&limit=250`
    );
    const query = discovery.queryFromUrl(searchUrl);
    const result = await discovery.search(db, query);
    return Array.isArray(result?.listings) ? result.listings : [];
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state: rawState, county: rawCounty } = await params;
  const state = /^[A-Za-z]{2}$/.test(rawState || "") ? rawState.toUpperCase() : "US";
  const countyName = normalizeCountySlug(rawCounty);
  const listings = await loadCountyData(state, rawCounty);
  const stats = computeCountyStats(listings);

  const meta = generateCountyMetadata({
    state,
    county: countyName,
    count: stats.totalCount,
    medianBid: stats.medianOpeningBid,
  });

  return {
    title: meta.title,
    description: meta.description,
    alternates: meta.alternates,
    openGraph: meta.openGraph,
  };
}

export default async function CountyDocketPage({ params }: PageProps) {
  const { state: rawState, county: rawCounty } = await params;
  const state = /^[A-Za-z]{2}$/.test(rawState || "") ? rawState.toUpperCase() : null;

  if (!state) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Coverage</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Invalid State Code</h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          County docket intelligence requires a valid two-letter US state postal code.
        </p>
        <Link href="/states" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-950 underline">
          <ArrowLeft className="h-4 w-4" /> All States Directory
        </Link>
      </main>
    );
  }

  const countyName = normalizeCountySlug(rawCounty);
  const formalCounty = formatCountyDisplayName(countyName);
  const listings = await loadCountyData(state, rawCounty);
  const stats = computeCountyStats(listings);
  const redemption = getStatutoryRedemption(state);

  const breadcrumbsSchema = buildCountyBreadcrumbs({ state, county: countyName });
  const itemListSchema = buildCountyItemList({ state, county: countyName, listings });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbsSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemListSchema) }}
      />

      <main className="mx-auto max-w-5xl px-6 py-12">
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
          <Link href="/" className="hover:text-slate-900 transition-colors">Home</Link>
          <span>/</span>
          <Link href="/states" className="hover:text-slate-900 transition-colors">States</Link>
          <span>/</span>
          <Link href={`/states/${state}`} className="hover:text-slate-900 transition-colors">{state}</Link>
          <span>/</span>
          <span className="text-slate-900 font-semibold">{formalCounty}</span>
        </nav>

        {/* Page Header */}
        <div className="border-b border-slate-200 pb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50/70 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-700">
            <Gavel className="h-3.5 w-3.5" /> County Docket &amp; Foreclosure Directory
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Distressed &amp; Foreclosure Property in {formalCounty}, {state}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Verified foreclosure auctions, tax deeds, and trustee dispositions published for {formalCounty}.
            Track opening bids, triage deal scores, and observe statutory redemption boundaries before bidding.
          </p>
        </div>

        {/* Key Metrics Grid */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Dockets</div>
            <div className="mt-2 text-2xl font-bold text-slate-950 tabular-nums">
              {stats.totalCount}
            </div>
            <div className="mt-1 text-xs text-slate-500">Recorded cases</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Median Opening Bid</div>
            <div className="mt-2 text-2xl font-bold text-blue-600 tabular-nums">
              {stats.medianOpeningBid ? `$${Math.round(stats.medianOpeningBid).toLocaleString("en-US")}` : "Unpublished"}
            </div>
            <div className="mt-1 text-xs text-slate-500">Live auction baseline</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Median Deal Score</div>
            <div className="mt-2 text-2xl font-bold text-emerald-600 tabular-nums">
              {stats.medianDealScore ? `${Math.round(stats.medianDealScore)}/99` : "Evaluating"}
            </div>
            <div className="mt-1 text-xs text-slate-500">Triage indicator</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Statutory Redemption</div>
            <div className="mt-2 text-2xl font-bold text-amber-600 tabular-nums">
              {redemption.days !== null ? `${redemption.days} Days` : "Judicial"}
            </div>
            <div className="mt-1 text-xs text-slate-500">{state} post-sale window</div>
          </div>
        </div>

        {/* Statutory Redemption Overview Banner */}
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/70 p-5 text-amber-950 shadow-sm">
          <div className="flex items-start gap-3">
            <Scale className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <div className="text-sm font-semibold text-amber-900">
                {state} Statutory Redemption Rule: {redemption.days !== null ? `${redemption.days} Days` : "Judicial Law Day"}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                {redemption.label}. Pre-sale or post-sale statutory redemption periods determine whether a prior owner
                can reclaim the property after gavel fall. Ensure official docket confirmation and statutory deadlines are verified.
              </p>
            </div>
          </div>
        </div>

        {/* Source Breakdown */}
        {Object.keys(stats.sourceBreakdown).length > 0 && (
          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
              Source &amp; Publisher Breakdown in {formalCounty}
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(stats.sourceBreakdown).map(([srcKey, count]) => (
                <span
                  key={srcKey}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800"
                >
                  <span className="font-semibold uppercase tracking-wider">{srcKey}</span>
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.2 text-[10px] font-bold tabular-nums text-slate-700">
                    {count}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Listings Section */}
        <div className="mt-10">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-950">Active Case Dockets</h2>
              <p className="text-xs text-slate-500 mt-0.5">Showing verified foreclosure and distressed records</p>
            </div>
            <Link
              href={`/listings?state=${encodeURIComponent(state)}&county=${encodeURIComponent(countyName)}`}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline flex items-center gap-1"
            >
              Open in Terminal Workbench &rarr;
            </Link>
          </div>

          {listings.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-12 text-center">
              <ShieldAlert className="mx-auto h-8 w-8 text-slate-400" />
              <h3 className="mt-3 text-base font-semibold text-slate-950">No Live Dockets Currently Captured</h3>
              <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">
                No active records are currently indexed for {formalCounty}, {state}. Check neighboring county dockets or
                subscribe to email alert notices.
              </p>
              <div className="mt-6 flex justify-center gap-4">
                <Link
                  href={`/states/${state}`}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  View All {state} Counties
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-4">
              {listings.map((item) => {
                const address = item.address || "Address upon official request";
                const city = item.city || "";
                const propType = item.propType || "Distressed Property";
                const openingBid = item.openingBid != null ? `$${Math.round(Number(item.openingBid)).toLocaleString("en-US")}` : "Unpublished";
                const score = item.dealScore != null ? Number(item.dealScore) : null;
                const saleDate = item.saleDate || item.auctionDate || "Date Pending";
                const source = item.source || "Notice";

                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-700">
                          {source}
                        </span>
                        <span className="text-xs text-slate-500">{propType}</span>
                      </div>
                      <h3 className="text-base font-semibold text-slate-950">
                        <Link href={`/listings/${encodeURIComponent(item.id)}`} className="hover:underline">
                          {address}
                        </Link>
                      </h3>
                      <div className="text-xs text-slate-500">
                        {[city, formalCounty, state, item.zip].filter(Boolean).join(", ")}
                      </div>
                    </div>

                    <div className="mt-4 sm:mt-0 sm:text-right flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-3 sm:gap-1">
                      <div>
                        <div className="text-xs text-slate-500">Opening Bid</div>
                        <div className="text-base font-bold text-blue-600 tabular-nums">{openingBid}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {score !== null && (
                          <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold text-white ${
                            score >= 80 ? 'bg-emerald-600' : score >= 60 ? 'bg-blue-600' : 'bg-amber-600'
                          }`}>
                            Score: {score}/99
                          </span>
                        )}
                        <Link
                          href={`/listings/${encodeURIComponent(item.id)}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Dossier <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Back Link Footer */}
        <div className="mt-12 border-t border-slate-200 pt-6">
          <Link
            href={`/states/${state}`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Return to all {state} Counties
          </Link>
        </div>
      </main>
    </>
  );
}
