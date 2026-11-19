import { cache } from "react";
import { loadCountyInventory } from "@/lib/county-inventory";
import { STATE_NAMES } from "@/lib/hero-market-suggestions";
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
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { sourceDisplayText } from "@/lib/source-display";
import { SOURCES } from "@/data/listings";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";
import { interpolate } from "@/lib/i18n/translator";

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

const VALID_STATE_CODES = new Set(Object.keys(STATE_NAMES));

function parseValidStateCode(raw?: string): string | null {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(code) && VALID_STATE_CODES.has(code) ? code : null;
}

const loadCountyData = cache(async function loadCountyData(stateCode: string, countyParam: string): Promise<ListingSummary[]> {
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
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state: rawState, county: rawCounty } = await params;
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const state = parseValidStateCode(rawState);
  if (!state) {
    return {
      title: locale === "en" ? "Jurisdiction Not Found | PerfectProperty" : m.meta.countyNotFoundTitle,
      description: locale === "en" ? "Recognized two-letter US state jurisdiction required." : m.meta.countyNotFoundDescription,
      robots: { index: false, follow: false },
    };
  }
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
    ...(stats.totalCount === 0 ? { robots: { index: false, follow: false } } : {}),
    alternates: meta.alternates,
    openGraph: {
      ...meta.openGraph,
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: meta.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: ["/og-image.png"],
    },
  };
}

export default async function CountyDocketPage({ params }: PageProps) {
  const { state: rawState, county: rawCounty } = await params;
  const state = parseValidStateCode(rawState);

  if (!state) {
    notFound();
  }

  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const countyName = normalizeCountySlug(rawCounty);
  const formalCounty = formatCountyDisplayName(countyName);
  const loaded = await loadCountyData(state, rawCounty);
  if (loaded.length === 0) notFound();

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
  const feeSchedule = getStatutoryFeeSchedule(state, stats.medianOpeningBid ?? undefined);

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

      <div className="min-h-screen bg-paper text-ink">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-6 pb-20 pt-28 outline-none sm:pt-32">
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-xs font-medium text-ink-3">
          <Link href="/" className="hover:text-ink transition-colors">{m.states.homeCrumb}</Link>
          <span>/</span>
          <Link href="/states" className="hover:text-ink transition-colors">{m.states.statesCrumb}</Link>
          <span>/</span>
          <Link href={`/states/${state}`} className="hover:text-ink transition-colors">{state}</Link>
          <span>/</span>
          <span className="text-ink font-semibold">{formalCounty}</span>
        </nav>

        <div className="border-b border-line pb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold uppercase tracking-wider text-ink-2">
            <Gavel className="h-3.5 w-3.5" /> {m.states.countyBadge}
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {interpolate(m.states.countyHeading, { county: formalCounty, state })}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-3 sm:text-base">
            {locale === "en" ? (
              upcomingCount > 0
                ? `${stats.totalCount} listing${stats.totalCount === 1 ? "" : "s"} in ${formalCounty}. ${upcomingCount} ${upcomingCount === 1 ? "sale is" : "sales are"} coming up, ${thisWeekCount} in the next 7 days. Next sale: ${nextSale}.`
                : `No upcoming sales listed here right now. ${stats.totalCount} past or undated listing${stats.totalCount === 1 ? "" : "s"} below.`
            ) : (
              upcomingCount > 0
                ? interpolate(m.states.countyUpcomingSummary, { totalCount: stats.totalCount, upcomingCount, thisWeekCount, nextSale: nextSale || "—", county: formalCounty })
                : interpolate(m.states.countyPastSummary, { totalCount: stats.totalCount, county: formalCounty })
            )}
            {" "}{m.states.countyConfirmNotice}
          </p>
          <div className="mt-5 flex flex-wrap gap-3 text-sm font-semibold">
            <Link href={`/listings?state=${encodeURIComponent(state)}&county=${encodeURIComponent(countyName)}`} className="rounded-control bg-ink px-5 py-3 text-white transition hover:bg-ink-2">{m.states.browseTheseListings}</Link>
            <Link href="/hunts" className="self-center text-ink underline hover:text-ink-2">{m.states.getEmailAlertsCounty}</Link>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-card border border-line bg-card p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{m.states.metricNext7Days}</div>
            <div className="mt-2 text-2xl font-bold text-ink tabular-nums">
              {thisWeekCount}
            </div>
            <div className="mt-1 text-xs text-ink-3">{interpolate(m.states.metricUpcomingOf, { upcomingCount, totalCount: stats.totalCount })}</div>
          </div>

          <div className="rounded-card border border-line bg-card p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{m.states.metricTypicalBid}</div>
            <div className="mt-2 text-2xl font-bold text-ink tabular-nums">
              {stats.medianOpeningBid ? `$${Math.round(stats.medianOpeningBid).toLocaleString("en-US")}` : m.states.metricNotPublished}
            </div>
            <div className="mt-1 text-xs text-ink-3">{m.states.metricMedianNote}</div>
          </div>

          <div className="rounded-card border border-line bg-card p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{m.states.metricTypicalScore}</div>
            <div className="mt-2 text-2xl font-bold text-ink tabular-nums" style={{ color: bandForScore(stats.medianDealScore)?.color }}>
              {stats.medianDealScore ? `${Math.round(stats.medianDealScore)}/99` : m.states.metricNotScored}
            </div>
            <div className="mt-1 text-xs text-ink-3">{m.states.metricScoreNote}</div>
          </div>

          <div className="rounded-card border border-line bg-card p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{m.states.metricRedemptionTime}</div>
            <div className="mt-2 text-2xl font-bold text-catch-ink tabular-nums">
              {redemption.days !== null ? interpolate(m.states.metricDaysCount, { days: redemption.days }) : m.states.metricCourtSet}
            </div>
            <div className="mt-1 text-xs text-ink-3">{m.states.metricBuybackNote}</div>
          </div>
        </div>

        <div className="mt-6 rounded-card border border-catch/30 bg-catch-wash p-5 text-catch-ink shadow-sm">
          <div className="flex items-start gap-3">
            <Scale className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" />
            <div>
              <div className="text-sm font-semibold text-catch-ink">
                {interpolate(m.states.countyCatchBanner, {
                  state,
                  daysText: redemption.days !== null ? interpolate(m.states.metricDaysCount, { days: redemption.days }) : m.states.metricCourtSet,
                })}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-catch-ink">
                {redemption.label}. {m.states.countyCatchSuffix}
              </p>

              {redemption.upsetBid && redemption.upsetBid.hasUpsetBid && (
                <div className="mt-3 rounded-control border border-catch/40 bg-card p-3 text-xs text-ink">
                  <span className="font-bold text-catch-ink">{locale === "en" ? `${STATE_NAMES[state] || state} law (${redemption.upsetBid.statute}):` : interpolate(m.states.upsetRulePrefix, { statute: redemption.upsetBid.statute })}</span>{" "}
                  {redemption.upsetBid.description}
                </div>
              )}

              {redemption.homesteadDistinction && redemption.homesteadDistinction.hasDistinction && (
                <div className="mt-3 rounded-control border border-catch/40 bg-card p-3 text-xs text-ink">
                  <span className="font-bold text-catch-ink">{interpolate(m.states.homesteadRulePrefix, { statute: redemption.homesteadDistinction.statute })}</span>{" "}
                  {redemption.homesteadDistinction.description}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-ink-2" />
              <h2 className="text-base font-bold text-ink">
                {interpolate(m.states.playbookTitle, { state })}
              </h2>
            </div>
            <span className="text-xs font-semibold text-ink-3">
              {feeSchedule.scheduleLabel}
            </span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{m.states.estDepositWin}</div>
              <div className="mt-1 text-lg font-bold text-ink">
                {feePreset ? `$${Math.round(feePreset.creditedDeposit).toLocaleString("en-US")}` : m.states.perWinningBid}
              </div>
              <div className="mt-1 text-label text-ink-3">
                {feePreset ? feeSchedule.depositRequirement : `${feeSchedule.depositRequirement} (${m.states.depositWithheldNote})`}
              </div>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{m.states.transferAndFees}</div>
              <div className="mt-1 text-lg font-bold text-ink">
                {feePreset
                  ? `$${Math.round(feePreset.transferTax + feePreset.sheriffPoundage).toLocaleString("en-US")}`
                  : feeSchedule.transferTaxRatePerThousand === 0 && feeSchedule.sheriffPoundageRatePercent === 0
                    ? m.states.zeroTaxPoundage
                    : `$${Number(feeSchedule.transferTaxRatePerThousand || 0).toFixed(2)}/$1k + ${(Number(feeSchedule.sheriffPoundageRatePercent || 0) * 100).toFixed(1)}%`}
              </div>
              <div className="mt-1 text-label text-ink-3">
                {feePreset ? feeSchedule.transferTaxCitation : `${feeSchedule.transferTaxCitation} ${feeSchedule.sheriffPoundageCitation}`}
              </div>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{m.states.courtApprovalWindow}</div>
              <div className="mt-1 text-lg font-bold text-catch-ink">
                {carrySchedule.objectionOrConfirmationDays > 0
                  ? interpolate(m.states.metricDaysCount, { days: carrySchedule.objectionOrConfirmationDays })
                  : (redemption.upsetBid?.hasUpsetBid ? interpolate(m.states.metricDaysCount, { days: redemption.upsetBid.windowDays }) : m.states.noneLabel)}
              </div>
              <div className="mt-1 text-label text-ink-3">
                {carrySchedule.objectionLabel || (redemption.upsetBid?.hasUpsetBid ? redemption.upsetBid.statute : feeSchedule.settlementDeadlineDescription)}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-control border border-line bg-paper p-4">
            <div className="text-xs font-bold text-ink mb-1 flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-ink-2" /> {m.states.lawsBehindNumbers}
            </div>
            <ul className="list-disc pl-5 space-y-1 text-xs text-ink-2">
              {feeSchedule.citations.map((cite, idx) => (
                <li key={idx}>{cite}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-4">
            <CheckSquare className="h-5 w-5 text-catch-ink" />
            <div>
              <h2 className="text-base font-bold text-ink">
                {interpolate(m.states.checklistTitle, { county: formalCounty })}
              </h2>
              <p className="text-xs text-ink-3 mt-0.5">
                {m.states.checklistSub}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
            {m.states.checklistItems.map((item, idx) => (
              <div key={item.lead} className={`rounded-control border border-line bg-paper p-3.5 ${idx === m.states.checklistItems.length - 1 ? "sm:col-span-2" : ""}`}>
                <span className="font-bold text-ink">{item.lead}</span>{" "}
                {idx === 3 && locale === "en" ? redemption.label : item.body}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-4">
            <HelpCircle className="h-5 w-5 text-ink-2" />
            <div>
              <h2 className="text-base font-bold text-ink">
                {interpolate(m.states.faqTitle, { county: formalCounty })}
              </h2>
              <p className="text-xs text-ink-3 mt-0.5">
                {interpolate(m.states.faqSub, { state })}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div className="rounded-control border border-line bg-paper p-4">
              <h3 className="text-sm font-bold text-ink">
                {interpolate(m.states.faqQ1, { county: formalCounty, state })}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                {state}: {redemption.label}.
                {redemption.upsetBid && redemption.upsetBid.hasUpsetBid
                  ? ` ${STATE_NAMES[state] || state} (${redemption.upsetBid.statute}): ${redemption.upsetBid.windowDays}d.`
                  : ""}
                {redemption.homesteadDistinction && redemption.homesteadDistinction.hasDistinction
                  ? ` ${redemption.homesteadDistinction.description}`
                  : ""}
              </p>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <h3 className="text-sm font-bold text-ink">
                {interpolate(m.states.faqQ2, { state })}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                {feeSchedule.scheduleLabel}: {feeSchedule.transferTaxCitation} {feeSchedule.sheriffPoundageCitation} {feeSchedule.settlementDeadlineDescription}
              </p>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <h3 className="text-sm font-bold text-ink">
                {interpolate(m.states.faqQ3, { county: formalCounty })}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                {m.states.faqA3}
              </p>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <h3 className="text-sm font-bold text-ink">
                {interpolate(m.states.faqQ4, { county: formalCounty })}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                {feeSchedule.depositRequirement}. {feeSchedule.settlementDeadlineDescription}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" />
            <div>
              <h2 className="text-sm font-bold text-ink">
                {interpolate(m.states.disclaimerTitle, { county: formalCounty })}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">
                {m.states.disclaimerBody}
              </p>
            </div>
          </div>
        </div>

        {Object.keys(stats.sourceBreakdown).length > 0 && (
          <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wider text-ink-2">
              {interpolate(m.states.whereFromTitle, { county: formalCounty })}
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(stats.sourceBreakdown).map(([srcKey, count]) => (
                <span
                  key={srcKey}
                  className="inline-flex items-center gap-1.5 rounded-control border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-2"
                >
                  <span className="font-semibold tracking-wider">{sourceDisplayText(SOURCES[srcKey]?.label ?? srcKey)}</span>
                  <span className="rounded-full bg-line px-1.5 py-0.2 text-label font-bold tabular-nums text-ink-2">
                    {count}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {gisLink && (
          <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-0.5 text-label font-bold uppercase tracking-wider text-ink-2">
                  <MapPin className="h-3 w-3 text-go" />
                  {gisLink.authorityType === "county_assessor_gis" ? m.states.officialCountyGis : m.states.statewideCadastralGis}
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
                {locale === "en" ? "Open GIS Parcel Viewer" : m.states.openGisViewer} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        )}

        <div className="mt-8">
          <CountyAlertSubscribe state={state} county={countyName} formalCounty={formalCounty} />
        </div>

        <div className="mt-10">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div>
              <h2 className="text-xl font-bold text-ink">{m.states.listingsByDateTitle}</h2>
              <p className="text-xs text-ink-3 mt-0.5">{m.states.listingsByDateSub}</p>
            </div>
            <Link
              href={`/listings?state=${encodeURIComponent(state)}&county=${encodeURIComponent(countyName)}`}
              className="text-xs font-semibold text-ink hover:text-ink-2 underline flex items-center gap-1"
            >
              {m.states.searchFilterThese}
            </Link>
          </div>

          <div className="mt-6 grid gap-4">
            {listings.map((item) => {
              const address = item.address || m.states.addressNotPublished;
              const city = item.city || "";
              const propType = item.propType || m.states.propertyFallback;
              const openingBid = item.openingBid != null ? `$${Math.round(Number(item.openingBid)).toLocaleString("en-US")}` : m.states.metricNotPublished;
              const score = item.dealScore != null ? Number(item.dealScore) : null;
              const saleDate = saleOf(item) || null;
              const band = bandForScore(score);
              const source = item.source || m.states.noticeFallback;

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
                      {saleDate ? `${saleDate >= today ? m.states.saleLabel : m.states.salePassedLabel}: ${saleDate}` : m.states.saleDateNotPublished}
                    </div>
                  </div>

                  <div className="mt-4 sm:mt-0 sm:text-right flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-3 sm:gap-1">
                    <div>
                      <div className="text-xs text-ink-3">{m.states.openingBidLabel}</div>
                      <div className="text-base font-bold text-ink tabular-nums">{openingBid}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {band && score !== null && (
                        <span className="inline-block rounded px-2 py-0.5 text-xs font-bold" style={{ background: `${band.color}${band.alpha}`, color: band.color }}>
                          {m.states.scorePrefix}: {Math.round(score)}/99 · {band.label}
                        </span>
                      )}
                      <Link
                        href={`/listings/${encodeURIComponent(item.id)}`}
                        className="inline-flex items-center gap-1 rounded-control border border-line-strong bg-paper px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-line"
                      >
                        {m.states.viewDetails} <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-12 border-t border-line pt-6">
          <Link
            href={`/states/${state}`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-ink hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> {interpolate(m.states.backToStateCounties, { state })}
          </Link>
        </div>
      </main>
      <SiteFooter />
      </div>
    </>
  );
}
