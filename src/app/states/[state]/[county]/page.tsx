import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bandForScore } from "@/lib/score-bands";
import { ArrowLeft, ExternalLink, Gavel, Scale, TrendingUp, Calculator, CheckSquare } from "lucide-react";
import { computeStatutoryFeePreset, computeStatutoryDeadlinesAndCarry } from "@/lib/underwriting";
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
  const loaded = await loadCountyData(state, rawCounty);
  // No records for this slug: a real 404, not an indexable empty page.
  if (loaded.length === 0) notFound();
  // Upcoming sales first (soonest at top), then undated/past records.
  const today = new Date().toISOString().slice(0, 10);
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const saleOf = (item: ListingSummary) => (item.saleDate || item.auctionDate || "").slice(0, 10);
  const listings = [...loaded].sort((a, b) => {
    const da = saleOf(a), db = saleOf(b);
    const ua = da >= today ? 0 : 1, ub = db >= today ? 0 : 1;
    return ua - ub || (ua === 0 ? da.localeCompare(db) : db.localeCompare(da));
  });
  const upcomingCount = listings.filter((item) => saleOf(item) >= today).length;
  const thisWeekCount = listings.filter((item) => saleOf(item) >= today && saleOf(item) <= weekOut).length;
  const stats = computeCountyStats(listings);
  const redemption = getStatutoryRedemption(state);
  // Fee math only runs on a published median bid; no stand-in price.
  const baselinePrice = stats.medianOpeningBid || 0;
  const feePreset = baselinePrice > 0 ? computeStatutoryFeePreset({ purchasePrice: baselinePrice, state }) : null;
  const carrySchedule = computeStatutoryDeadlinesAndCarry({ state, purchasePrice: baselinePrice, redemptionDays: redemption.days });

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
            {thisWeekCount} sale{thisWeekCount === 1 ? "" : "s"} scheduled in the next 7 days and {upcomingCount} upcoming in total, out of {stats.totalCount} foreclosure, tax-deed, and government-sale records collected for {formalCounty}. Confirm every record at its publisher before bidding.
          </p>
        </div>

        {/* Key Metrics Grid */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sales Next 7 Days</div>
            <div className="mt-2 text-2xl font-bold text-slate-950 tabular-nums">
              {thisWeekCount}
            </div>
            <div className="mt-1 text-xs text-slate-500">{upcomingCount} upcoming of {stats.totalCount} records</div>
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

        {/* Statutory Bidding & Closing Playbook for State */}
        {feePreset && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-blue-600" />
                <h2 className="text-base font-bold text-slate-950">
                  {state} Statutory Auction &amp; Settlement Framework
                </h2>
              </div>
              <span className="text-xs font-semibold text-slate-500">
                {feePreset.scheduleLabel}
              </span>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Estimated Deposit At Knockdown</div>
                <div className="mt-1 text-lg font-bold text-slate-900">
                  ${Math.round(feePreset.creditedDeposit).toLocaleString("en-US")}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Certified funds at the median published opening bid (${Math.round(baselinePrice).toLocaleString("en-US")})
                </div>
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Transfer Tax &amp; Poundage</div>
                <div className="mt-1 text-lg font-bold text-slate-900">
                  ${Math.round(feePreset.transferTax + feePreset.sheriffPoundage).toLocaleString("en-US")}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Statutory deed stamps + sheriff/referee commission
                </div>
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Confirmation / Upset Window</div>
                <div className="mt-1 text-lg font-bold text-amber-700">
                  {carrySchedule.objectionOrConfirmationDays > 0 ? `${carrySchedule.objectionOrConfirmationDays} Days` : "Immediate"}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {carrySchedule.objectionLabel || "Court confirmation or gavel drop"}
                </div>
              </div>
            </div>

            {feePreset.citations.length > 0 && (
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <div className="text-xs font-bold text-blue-950 mb-1 flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5 text-blue-700" /> Statutory Authorities &amp; Governing Codes:
                </div>
                <ul className="list-disc pl-5 space-y-1 text-xs text-blue-900/90">
                  {feePreset.citations.map((cite, idx) => (
                    <li key={idx}>{cite}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 7 Deal-Killer Due Diligence Checklist for County */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-4">
            <CheckSquare className="h-5 w-5 text-indigo-600" />
            <div>
              <h2 className="text-base font-bold text-slate-950">
                7-Point Foreclosure Due Diligence Checklist ({formalCounty}, {state})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Critical title and statutory failure modes to verify at the county clerk &amp; sheriff office before bidding
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
              <span className="font-bold text-slate-900">1. Senior Lien Priority:</span> Ensure the foreclosing mortgage is senior. Junior mortgage foreclosures take subject to the 1st mortgage balance.
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
              <span className="font-bold text-slate-900">2. Municipal Ad Valorem Taxes:</span> In {state}, delinquent property taxes and utility water/sewer liens enjoy super-priority status and survive foreclosure.
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
              <span className="font-bold text-slate-900">3. IRS § 7425 120-Day Redemption:</span> Any recorded federal tax lien gives the United States a statutory 120-day right of redemption post-sale.
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
              <span className="font-bold text-slate-900">4. State Confirmation &amp; Objection:</span> {redemption.label}
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
              <span className="font-bold text-slate-900">5. Bankruptcy Automatic Stay (11 U.S.C. § 362):</span> Verify PACER / CourtListener dockets immediately prior to gavel fall to confirm no bankruptcy petition was filed.
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
              <span className="font-bold text-slate-900">6. Certified Funds Tender Rules:</span> Have cashier&apos;s checks prepared for the exact deposit percentage required by {formalCounty} rules.
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5 sm:col-span-2">
              <span className="font-bold text-slate-900">7. Occupancy &amp; PTFA (12 U.S.C. § 5220):</span> Verify whether the property is occupied; bona fide tenants require a statutory 90-day notice to vacate under the Protecting Tenants at Foreclosure Act.
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
              <h2 className="text-xl font-bold text-slate-950">Records by sale date</h2>
              <p className="text-xs text-slate-500 mt-0.5">Upcoming sales first, soonest at the top. Undated and past records follow.</p>
            </div>
            <Link
              href={`/listings?state=${encodeURIComponent(state)}&county=${encodeURIComponent(countyName)}`}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline flex items-center gap-1"
            >
              Open in Terminal Workbench &rarr;
            </Link>
          </div>

            <div className="mt-6 grid gap-4">
              {listings.map((item) => {
                const address = item.address || "Address upon official request";
                const city = item.city || "";
                const propType = item.propType || "Distressed Property";
                const openingBid = item.openingBid != null ? `$${Math.round(Number(item.openingBid)).toLocaleString("en-US")}` : "Unpublished";
                const score = item.dealScore != null ? Number(item.dealScore) : null;
                const saleDate = saleOf(item) || null;
                const band = bandForScore(score);
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
                      <div className={`text-xs font-semibold ${saleDate && saleDate >= today ? "text-slate-900" : "text-slate-500"}`}>
                        {saleDate ? `${saleDate >= today ? "Sale" : "Sale date passed"}: ${saleDate}` : "Sale date not published"}
                      </div>
                    </div>

                    <div className="mt-4 sm:mt-0 sm:text-right flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-3 sm:gap-1">
                      <div>
                        <div className="text-xs text-slate-500">Opening Bid</div>
                        <div className="text-base font-bold text-blue-600 tabular-nums">{openingBid}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {band && score !== null && (
                          <span className="inline-block rounded px-2 py-0.5 text-xs font-bold" style={{ background: `${band.color}${band.alpha}`, color: band.color }}>
                            Score: {Math.round(score)}/99 · {band.label}
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
