import { loadCountyInventory } from "@/lib/county-inventory";
import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bandForScore } from "@/lib/score-bands";
import { ArrowLeft, ExternalLink, Gavel, Scale, Calculator, CheckSquare, HelpCircle, AlertTriangle, MapPin } from "lucide-react";
import { computeStatutoryFeePreset, computeStatutoryDeadlinesAndCarry } from "@/lib/underwriting";
import { serializeJsonLd } from "@/lib/json-ld";
import {
  normalizeCountySlug,
  formatCountyDisplayName,
  computeCountyStats,
  getStatutoryRedemption,
  getStatutoryFeeSchedule,
  generateCountyMetadata,
  buildCountyBreadcrumbs,
  buildCountyItemList,
  buildCountyFaqSchema,
  getCountyCadastralGisLink,
} from "@/lib/county-seo";
import { CountyAlertSubscribe } from "@/components/alerts/county-alert-subscribe";

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
  return loadCountyInventory<ListingSummary>({
    stateCode,
    county: normalizeCountySlug(countyParam).toLowerCase(),
    apiUrl: process.env.PROPERTY_API_URL || "http://localhost:3000",
    searchLocal: async (query) => {
      try {
        const db = require("@server/db/client");
        const discovery = require("@server/discovery/query");
        return discovery.search(db, discovery.queryFromUrl(new URL(`http://localhost/api/listings?${query}`)));
      } catch {
        throw new Error("Local inventory search unavailable");
      }
    },
  });
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
        <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-3">Browse by state</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">We don&apos;t recognize that state</h1>
        <p className="mt-4 text-sm leading-6 text-ink-3">
          Use a two-letter state code, like OH or FL.
        </p>
        <Link href="/states" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-ink underline">
          <ArrowLeft className="h-4 w-4" /> All states
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
  const nextSale = upcomingCount > 0 ? saleOf(listings[0]) : null;
  const stats = computeCountyStats(listings);
  const redemption = getStatutoryRedemption(state);
  const gisLink = getCountyCadastralGisLink(state, countyName);
  const feeSchedule = getStatutoryFeeSchedule(state, stats.medianOpeningBid || 150000);

  // Fee math only runs on a published median bid; no stand-in price.
  const baselinePrice = stats.medianOpeningBid || 0;
  const feePreset = baselinePrice > 0 ? computeStatutoryFeePreset({ purchasePrice: baselinePrice, state }) : null;
  const carrySchedule = computeStatutoryDeadlinesAndCarry({ state, purchasePrice: baselinePrice, redemptionDays: redemption.days });

  const breadcrumbsSchema = buildCountyBreadcrumbs({ state, county: countyName });
  const itemListSchema = buildCountyItemList({ state, county: countyName, listings });
  const faqSchema = buildCountyFaqSchema({ state, county: countyName });

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqSchema) }}
      />

      <main className="mx-auto max-w-5xl px-6 py-12">
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-xs font-medium text-ink-3">
          <Link href="/" className="hover:text-ink transition-colors">Home</Link>
          <span>/</span>
          <Link href="/states" className="hover:text-ink transition-colors">States</Link>
          <span>/</span>
          <Link href={`/states/${state}`} className="hover:text-ink transition-colors">{state}</Link>
          <span>/</span>
          <span className="text-ink font-semibold">{formalCounty}</span>
        </nav>

        {/* Page Header */}
        <div className="border-b border-line pb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold uppercase tracking-wider text-ink-2">
            <Gavel className="h-3.5 w-3.5" /> Foreclosure and auction listings
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Foreclosure and government property auctions in {formalCounty}, {state}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-3 sm:text-base">
            {upcomingCount > 0
              ? `${stats.totalCount} listing${stats.totalCount === 1 ? "" : "s"} in ${formalCounty}. ${upcomingCount} ${upcomingCount === 1 ? "sale is" : "sales are"} coming up, ${thisWeekCount} in the next 7 days. Next sale: ${nextSale}.`
              : `No upcoming sales listed here right now. ${stats.totalCount} past or undated listing${stats.totalCount === 1 ? "" : "s"} below.`}
            {" "}Always confirm the date and terms with the county before you bid.
          </p>
          <div className="mt-5 flex flex-wrap gap-3 text-sm font-semibold">
            <Link href={`/listings?state=${encodeURIComponent(state)}&county=${encodeURIComponent(countyName)}`} className="rounded-control bg-ink px-5 py-3 text-white transition hover:bg-ink-2">Browse these listings</Link>
            <Link href="/hunts" className="self-center text-ink underline hover:text-ink-2">Get email alerts for this county (members)</Link>
          </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-card border border-line bg-card p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Sales in the next 7 days</div>
            <div className="mt-2 text-2xl font-bold text-ink tabular-nums">
              {thisWeekCount}
            </div>
            <div className="mt-1 text-xs text-ink-3">{upcomingCount} upcoming of {stats.totalCount} listings</div>
          </div>

          <div className="rounded-card border border-line bg-card p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Typical opening bid</div>
            <div className="mt-2 text-2xl font-bold text-ink tabular-nums">
              {stats.medianOpeningBid ? `$${Math.round(stats.medianOpeningBid).toLocaleString("en-US")}` : "Not published"}
            </div>
            <div className="mt-1 text-xs text-ink-3">Middle of the published opening bids</div>
          </div>

          <div className="rounded-card border border-line bg-card p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Typical Deal Score</div>
            <div className="mt-2 text-2xl font-bold text-ink tabular-nums" style={{ color: bandForScore(stats.medianDealScore)?.color }}>
              {stats.medianDealScore ? `${Math.round(stats.medianDealScore)}/99` : "Not scored yet"}
            </div>
            <div className="mt-1 text-xs text-ink-3">A quick read on each deal, not an appraisal</div>
          </div>

          <div className="rounded-card border border-line bg-card p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Time to redeem after the sale</div>
            <div className="mt-2 text-2xl font-bold text-catch-ink tabular-nums">
              {redemption.days !== null ? `${redemption.days} Days` : "Set by the court"}
            </div>
            <div className="mt-1 text-xs text-ink-3">How long the previous owner can buy it back</div>
          </div>
        </div>

        {/* Statutory Redemption Overview Banner */}
        <div className="mt-6 rounded-card border border-catch/30 bg-catch-wash p-5 text-catch-ink shadow-sm">
          <div className="flex items-start gap-3">
            <Scale className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" />
            <div>
              <div className="text-sm font-semibold text-catch-ink">
                The catch in {state}: redemption rule, {redemption.days !== null ? `${redemption.days} days` : "set by the court"}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-catch-ink">
                {redemption.label}. Where a redemption period applies, the previous owner can reclaim the property after the sale,
                so ownership may not be final right away. Check the exact rules with the county before you bid.
              </p>

              {/* Statutory Upset Bid Callout (e.g. NC, SC) */}
              {redemption.upsetBid && redemption.upsetBid.hasUpsetBid && (
                <div className="mt-3 rounded-control border border-catch/40 bg-card p-3 text-xs text-ink">
                  <span className="font-bold text-catch-ink">Statutory Upset Bid Rule ({redemption.upsetBid.statute}):</span>{" "}
                  {redemption.upsetBid.description}
                </div>
              )}

              {/* Homestead vs Non-Homestead Distinction Callout (e.g. AL, TX, MI, IA) */}
              {redemption.homesteadDistinction && redemption.homesteadDistinction.hasDistinction && (
                <div className="mt-3 rounded-control border border-catch/40 bg-card p-3 text-xs text-ink">
                  <span className="font-bold text-catch-ink">Homestead vs. Non-Homestead Schedule ({redemption.homesteadDistinction.statute}):</span>{" "}
                  {redemption.homesteadDistinction.description}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Statutory Bidding & Closing Playbook for State */}
        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-ink-2" />
              <h2 className="text-base font-bold text-ink">
                What to expect at a {state} auction
              </h2>
            </div>
            <span className="text-xs font-semibold text-ink-3">
              {feeSchedule.scheduleLabel}
            </span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Estimated deposit when you win</div>
              <div className="mt-1 text-lg font-bold text-ink">
                {feePreset ? `$${Math.round(feePreset.creditedDeposit).toLocaleString("en-US")}` : `$${Math.round(feeSchedule.estimatedFees.estimatedDeposit).toLocaleString("en-US")}`}
              </div>
              <div className="mt-1 text-label text-ink-3">
                {feeSchedule.depositRequirement}
              </div>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Transfer tax and sale fees</div>
              <div className="mt-1 text-lg font-bold text-ink">
                {feePreset
                  ? `$${Math.round(feePreset.transferTax + feePreset.sheriffPoundage).toLocaleString("en-US")}`
                  : `$${Math.round(feeSchedule.estimatedFees.transferTax + feeSchedule.estimatedFees.sheriffPoundage).toLocaleString("en-US")}`}
              </div>
              <div className="mt-1 text-label text-ink-3">
                {feeSchedule.transferTaxCitation}
              </div>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">Court approval or upset window</div>
              <div className="mt-1 text-lg font-bold text-catch-ink">
                {carrySchedule.objectionOrConfirmationDays > 0 ? `${carrySchedule.objectionOrConfirmationDays} Days` : (redemption.upsetBid?.hasUpsetBid ? `${redemption.upsetBid.windowDays} Days` : "None")}
              </div>
              <div className="mt-1 text-label text-ink-3">
                {carrySchedule.objectionLabel || (redemption.upsetBid?.hasUpsetBid ? redemption.upsetBid.statute : feeSchedule.settlementDeadlineDescription)}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-control border border-line bg-paper p-4">
            <div className="text-xs font-bold text-ink mb-1 flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-ink-2" /> Laws behind these numbers:
            </div>
            <ul className="list-disc pl-5 space-y-1 text-xs text-ink-2">
              {feeSchedule.citations.map((cite, idx) => (
                <li key={idx}>{cite}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* 7 Deal-Killer Due Diligence Checklist for County */}
        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-4">
            <CheckSquare className="h-5 w-5 text-catch-ink" />
            <div>
              <h2 className="text-base font-bold text-ink">
                7 things to check before you bid in {formalCounty}
              </h2>
              <p className="text-xs text-ink-3 mt-0.5">
                Ask the county clerk and the sheriff&apos;s office about each one. We do not provide title reports, so this list does not replace a title search.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-control border border-line bg-paper p-3.5">
              <span className="font-bold text-ink">1. Is the foreclosing loan first in line?</span> If it is a second mortgage, you take the property and the first mortgage balance too.
            </div>
            <div className="rounded-control border border-line bg-paper p-3.5">
              <span className="font-bold text-ink">2. Unpaid property taxes and water bills:</span> In {state}, these are paid ahead of other debts and usually stay with the property after the sale.
            </div>
            <div className="rounded-control border border-line bg-paper p-3.5">
              <span className="font-bold text-ink">3. IRS liens (§ 7425):</span> If a federal tax lien is involved, 26 U.S.C. § 7425 gives the IRS a 120-day right of redemption.
            </div>
            <div className="rounded-control border border-line bg-paper p-3.5">
              <span className="font-bold text-ink">4. Court approval and objections:</span> {redemption.label}
            </div>
            <div className="rounded-control border border-line bg-paper p-3.5">
              <span className="font-bold text-ink">5. Bankruptcy (11 U.S.C. § 362):</span> A bankruptcy filing usually pauses the sale. Check PACER or CourtListener just before the sale.
            </div>
            <div className="rounded-control border border-line bg-paper p-3.5">
              <span className="font-bold text-ink">6. Deposit rules:</span> Bring certified cashier&apos;s checks meeting county rules ({feeSchedule.depositRequirement}).
            </div>
            <div className="rounded-control border border-line bg-paper p-3.5 sm:col-span-2">
              <span className="font-bold text-ink">7. Who lives there (12 U.S.C. § 5220):</span> Find out if the home is occupied. Tenants with a bona fide lease must receive statutory 90-day notice under the Protecting Tenants at Foreclosure Act.
            </div>
          </div>
        </div>

        {/* Visible FAQ & Statutory Guide for GEO / Search Answer Engines */}
        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-4">
            <HelpCircle className="h-5 w-5 text-ink-2" />
            <div>
              <h2 className="text-base font-bold text-ink">
                Frequently asked questions: {formalCounty} foreclosure &amp; sheriff sales
              </h2>
              <p className="text-xs text-ink-3 mt-0.5">
                Statutory guidance and court auction procedures for {state} buyers.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div className="rounded-control border border-line bg-paper p-4">
              <h3 className="text-sm font-bold text-ink">
                What are the post-sale redemption and upset bid deadlines in {formalCounty}, {state}?
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                In {state}, {redemption.label}.
                {redemption.upsetBid && redemption.upsetBid.hasUpsetBid
                  ? ` North Carolina law (${redemption.upsetBid.statute}) provides a ${redemption.upsetBid.windowDays}-day upset bid period. Each qualifying upset bid (minimum 5% increase or $750 floor deposited with Clerk of Superior Court) reopens a new 10-day window.`
                  : ""}
                {redemption.homesteadDistinction && redemption.homesteadDistinction.hasDistinction
                  ? ` ${redemption.homesteadDistinction.description}`
                  : ""}
                {redemption.days === 0
                  ? " Bidding concludes upon the gavel drop or judicial confirmation of sale, extinguishing the mortgagor's equitable right of redemption."
                  : ""}
              </p>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <h3 className="text-sm font-bold text-ink">
                What transfer taxes, sheriff execution poundage, and court fees apply in {state}?
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                {feeSchedule.scheduleLabel}: {feeSchedule.transferTaxCitation} {feeSchedule.sheriffPoundageCitation} Settlement rules: {feeSchedule.settlementDeadlineDescription}
              </p>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <h3 className="text-sm font-bold text-ink">
                Does a foreclosure auction wipe out senior mortgages or property taxes in {formalCounty}?
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                No. Foreclosing a junior mortgage or judgment does not extinguish a recorded senior first mortgage. County property taxes, municipal utility liens, and special assessments maintain statutory super-priority and survive the auction. If federal tax liens are recorded, 26 U.S.C. § 7425 gives the IRS a 120-day redemption right. Always order a title search from a licensed title abstractor before bidding.
              </p>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <h3 className="text-sm font-bold text-ink">
                What funds and deposits are accepted at {formalCounty} auctions?
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                Bidders must tender certified cashier&apos;s checks payable per county sheriff or clerk rules ({feeSchedule.depositRequirement}). Personal checks, credit cards, and delayed financing are strictly prohibited. The remaining purchase balance must be settled within statutory deadlines ({feeSchedule.settlementDeadlineDescription}).
              </p>
            </div>
          </div>
        </div>

        {/* Title Risk & Forensic Disclaimer */}
        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" />
            <div>
              <h2 className="text-sm font-bold text-ink">
                Legal disclaimer &amp; title risk warning for {formalCounty}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">
                PerfectProperty is an independent discovery and analytical triage tool indexing public court dockets, sheriff notices, and government asset dispositions. PerfectProperty is not a title insurance company, law firm, or financial advisor. Foreclosure auctions convey property &ldquo;as-is, where-is&rdquo; and winning bids are subject to all prior recorded mortgages, municipal tax liens, code enforcement assessments, and statutory redemption stays not extinguished by the judicial decree. Always retain a licensed title abstractor or real estate attorney to run a certified title examination before tendering funds at auction.
              </p>
            </div>
          </div>
        </div>

        {/* Source Breakdown */}
        {Object.keys(stats.sourceBreakdown).length > 0 && (
          <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wider text-ink-2">
              Where {formalCounty} listings come from
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(stats.sourceBreakdown).map(([srcKey, count]) => (
                <span
                  key={srcKey}
                  className="inline-flex items-center gap-1.5 rounded-control border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-2"
                >
                  <span className="font-semibold uppercase tracking-wider">{srcKey}</span>
                  <span className="rounded-full bg-line px-1.5 py-0.2 text-label font-bold tabular-nums text-ink-2">
                    {count}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Official County Cadastral & GIS Parcel Radar */}
        {gisLink && (
          <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-0.5 text-label font-bold uppercase tracking-wider text-ink-2">
                  <MapPin className="h-3 w-3 text-go" />
                  {gisLink.authorityType === "county_assessor_gis" ? "Official County Assessor GIS" : "Statewide Cadastral GIS"}
                </div>
                <h2 className="text-base font-bold text-ink">
                  {gisLink.portalName}
                </h2>
                <p className="text-xs text-ink-3 max-w-2xl leading-relaxed">
                  {gisLink.instructions}
                </p>
              </div>
              <a
                href={gisLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 shrink-0 rounded-control border border-line-strong bg-paper px-4 py-2.5 text-xs font-semibold text-ink-2 hover:bg-line transition"
              >
                Open GIS Parcel Viewer <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        )}

        {/* Automated Sheriff Sale Notice Alerts */}
        <div className="mt-8">
          <CountyAlertSubscribe state={state} county={countyName} formalCounty={formalCounty} />
        </div>

        {/* Listings Section */}
        <div className="mt-10">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div>
              <h2 className="text-xl font-bold text-ink">Listings by sale date</h2>
              <p className="text-xs text-ink-3 mt-0.5">Upcoming sales first, soonest at the top. Past and undated sales follow.</p>
            </div>
            <Link
              href={`/listings?state=${encodeURIComponent(state)}&county=${encodeURIComponent(countyName)}`}
              className="text-xs font-semibold text-ink hover:text-ink-2 underline flex items-center gap-1"
            >
              Search and filter these listings &rarr;
            </Link>
          </div>

          <div className="mt-6 grid gap-4">
            {listings.map((item) => {
              const address = item.address || "Address not published";
              const city = item.city || "";
              const propType = item.propType || "Property";
              const openingBid = item.openingBid != null ? `$${Math.round(Number(item.openingBid)).toLocaleString("en-US")}` : "Not published";
              const score = item.dealScore != null ? Number(item.dealScore) : null;
              const saleDate = saleOf(item) || null;
              const band = bandForScore(score);
              const source = item.source || "Notice";

              return (
                <div
                  key={item.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between rounded-card border border-line bg-card p-5 shadow-sm transition hover:border-line-strong hover:shadow"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-line px-2 py-0.5 text-label font-bold uppercase tracking-wider text-ink-2">
                        {source}
                      </span>
                      <span className="text-xs text-ink-3">{propType}</span>
                    </div>
                    <h3 className="text-base font-semibold text-ink">
                      <Link href={`/listings/${encodeURIComponent(item.id)}`} className="hover:underline">
                        {address}
                      </Link>
                    </h3>
                    <div className="text-xs text-ink-3">
                      {[city, formalCounty, state, item.zip].filter(Boolean).join(", ")}
                    </div>
                    <div className={`text-xs font-semibold ${saleDate && saleDate >= today ? "text-ink" : "text-ink-3"}`}>
                      {saleDate ? `${saleDate >= today ? "Sale" : "Sale date passed"}: ${saleDate}` : "Sale date not published"}
                    </div>
                  </div>

                  <div className="mt-4 sm:mt-0 sm:text-right flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-3 sm:gap-1">
                    <div>
                      <div className="text-xs text-ink-3">Opening bid</div>
                      <div className="text-base font-bold text-ink tabular-nums">{openingBid}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {band && score !== null && (
                        <span className="inline-block rounded px-2 py-0.5 text-xs font-bold" style={{ background: `${band.color}${band.alpha}`, color: band.color }}>
                          Score: {Math.round(score)}/99 · {band.label}
                        </span>
                      )}
                      <Link
                        href={`/listings/${encodeURIComponent(item.id)}`}
                        className="inline-flex items-center gap-1 rounded-control border border-line-strong bg-paper px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-line"
                      >
                        View details <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Back Link Footer */}
        <div className="mt-12 border-t border-line pt-6">
          <Link
            href={`/states/${state}`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-ink hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to all {state} counties
          </Link>
        </div>
      </main>
    </>
  );
}
