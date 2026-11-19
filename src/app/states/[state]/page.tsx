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
import { Scale, Calculator, AlertTriangle, ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";
import { interpolate, selectPlural } from "@/lib/i18n/translator";

const VALID_STATE_CODES = new Set(Object.keys(STATE_NAMES));

function parseValidStateCode(raw?: string): string | null {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(code) && VALID_STATE_CODES.has(code) ? code : null;
}

const getCachedStateCounties = cache(async (state: string) => loadStateCountiesImpl(state));

export async function generateMetadata({ params }: { params: Promise<{ state: string }> }): Promise<Metadata> {
  const { state: raw } = await params;
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const state = parseValidStateCode(raw);
  if (!state) {
    return {
      title: locale === "en" ? "State Not Found | PerfectProperty" : m.meta.stateNotFoundTitle,
      description: locale === "en" ? "Browse foreclosure and sheriff sale listings by recognized two-letter US state code." : m.meta.stateNotFoundDescription,
      robots: { index: false, follow: false },
    };
  }
  const { total, counties, error } = await loadStateCounties(state);
  const stateName = STATE_NAMES[state] || state;
  const isEmptyKnownState = total === 0 && counties.length === 0 && !error;
  const title = locale === "en"
    ? `${state} Foreclosure & Sheriff Sales | PerfectProperty`
    : interpolate(m.meta.stateCountiesTitle, { state });
  const description = locale === "en"
    ? `Browse ${stateName} (${state}) sheriff sales, foreclosure auctions, and tax deed listings by county. Check statutory redemption rules and opening bids before you bid.`
    : interpolate(m.meta.stateCountiesDescription, { stateName, state });
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

  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const { total, counties, error } = await loadStateCounties(state);
  if (total === 0 && counties.length === 0 && !error) {
    return (
      <div className="min-h-screen bg-paper text-ink">
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-6 pb-20 pt-28 outline-none sm:pt-32">
        <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-3">{m.states.browseByState}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">
          {interpolate(m.states.noActiveTitle, { stateName: STATE_NAMES[state] || state, state })}
        </h1>
        <p className="mt-4 text-sm leading-6 text-ink-3">
          {interpolate(m.states.noActiveBody, { stateName: STATE_NAMES[state] || state })}
        </p>
        <div className="mt-6 flex flex-wrap gap-4">
          <Link href="/states" className="inline-flex items-center gap-2 text-sm font-semibold text-ink underline">
            <ArrowLeft className="h-4 w-4" /> {m.states.allStates}
          </Link>
          <Link href="/listings" className="text-sm font-semibold text-ink underline">
            {m.states.browseAllActive}
          </Link>
        </div>
        </main>
        <SiteFooter />
      </div>
    );
  }
  const redemption = getStatutoryRedemption(state);
  const hasRule = !redemption.label.startsWith("Statutory redemption details require");
  const feeSchedule = getStatutoryFeeSchedule(state);

  const siteBaseUrl = require("@/lib/app-origin").getCanonicalOrigin();
  const breadcrumbsSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteBaseUrl },
      { "@type": "ListItem", position: 2, name: "States", item: `${siteBaseUrl}/states` },
      { "@type": "ListItem", position: 3, name: state, item: `${siteBaseUrl}/states/${state}` },
    ],
  };

  const stateName = STATE_NAMES[state] || state;
  const rawStateFaq = buildCountyFaqSchema({ state, county: stateName });
  const stateFaqSchema = {
    ...rawStateFaq,
    mainEntity: Array.isArray(rawStateFaq.mainEntity)
      ? rawStateFaq.mainEntity.map((q: { name?: string; acceptedAnswer?: { text?: string; [k: string]: unknown }; [k: string]: unknown }) => ({
          ...q,
          name: typeof q.name === "string" ? q.name.replace(new RegExp(`${stateName} County`, "gi"), `${stateName} statewide`) : q.name,
          acceptedAnswer: q.acceptedAnswer && typeof q.acceptedAnswer.text === "string"
            ? { ...q.acceptedAnswer, text: q.acceptedAnswer.text.replace(new RegExp(`${stateName} County`, "gi"), `${stateName} statewide`) }
            : q.acceptedAnswer,
        }))
      : rawStateFaq.mainEntity,
  };

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

      <div className="min-h-screen bg-paper text-ink">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl px-6 pb-20 pt-28 outline-none sm:pt-32">
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-xs font-medium text-ink-3">
          <Link href="/" className="hover:text-ink transition-colors">{m.states.homeCrumb}</Link>
          <span>/</span>
          <Link href="/states" className="hover:text-ink transition-colors">{m.states.statesCrumb}</Link>
          <span>/</span>
          <span className="text-ink font-semibold">{state}</span>
        </nav>

        <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-label font-semibold uppercase tracking-[0.12em] text-ink-2">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signature ring-1 ring-ink/20" />
          {m.states.browseByState}
        </p>
        <h1 className="mt-5 text-balance text-display font-semibold tracking-tight text-ink sm:text-5xl">
          {interpolate(m.states.stateHeading, { state })}
        </h1>
        <p className="mt-4 max-w-[680px] text-lead leading-relaxed text-ink-2">
          {m.states.stateLead}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm font-semibold">
          {total > 0 ? (
            <Link href={`/listings?state=${state}`} className="rounded-control bg-ink px-5 py-3 text-white transition hover:bg-ink-2">
              {interpolate(m.states.browseAllState, { count: total, state })}
            </Link>
          ) : null}
          <Link href="/states" className="text-ink underline hover:text-ink-2">
            {m.states.allStates}
          </Link>
        </div>

        {hasRule ? (
          <div className="mt-8 rounded-card border border-catch/30 bg-catch-wash p-5 text-catch-ink shadow-sm">
            <div className="flex items-start gap-3">
              <Scale className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" />
              <div>
                <p className="text-label font-semibold uppercase tracking-[0.12em]">
                  {interpolate(m.states.redemptionBannerEyebrow, { state })}
                </p>
                <p className="mt-1 text-sm leading-relaxed">{redemption.label}</p>

                {redemption.upsetBid && redemption.upsetBid.hasUpsetBid && (
                  <div className="mt-3 rounded-control border border-catch/40 bg-card p-3 text-xs text-ink">
                    <span className="font-bold text-catch-ink">{interpolate(m.states.upsetRulePrefix, { statute: redemption.upsetBid.statute })}</span>{" "}
                    {redemption.upsetBid.description}
                  </div>
                )}

                {redemption.homesteadDistinction && redemption.homesteadDistinction.hasDistinction && (
                  <div className="mt-3 rounded-control border border-catch/40 bg-card p-3 text-xs text-ink">
                    <span className="font-bold text-catch-ink">{interpolate(m.states.homesteadRulePrefix, { statute: redemption.homesteadDistinction.statute })}</span>{" "}
                    {redemption.homesteadDistinction.description}
                  </div>
                )}

                <p className="mt-2 text-xs">
                  <Link href="/resources" className="font-semibold underline">
                    {m.states.moreCatchesLink}
                  </Link>
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-ink-2" />
              <h2 className="text-base font-bold text-ink">
                {interpolate(m.states.feeScheduleHeading, { state })}
              </h2>
            </div>
            <span className="text-xs font-semibold text-ink-3">
              {feeSchedule.scheduleLabel}
            </span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{m.states.standardDeposit}</div>
              <div className="mt-1 text-base font-bold text-ink">
                {feeSchedule.depositRequirement}
              </div>
              <div className="mt-1 text-label text-ink-3">
                {m.states.certifiedFundsNote}
              </div>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{m.states.transferTaxLabel}</div>
              <div className="mt-1 text-sm font-semibold text-ink">
                {feeSchedule.transferTaxCitation}
              </div>
            </div>

            <div className="rounded-control border border-line bg-paper p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{m.states.sheriffPoundageLabel}</div>
              <div className="mt-1 text-sm font-semibold text-ink">
                {feeSchedule.sheriffPoundageCitation}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-control border border-line bg-paper p-4">
            <div className="text-xs font-bold text-ink mb-1 flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-ink-2" /> {m.states.statutoryCitationsLabel}
            </div>
            <ul className="list-disc pl-5 space-y-1 text-xs text-ink-2">
              {feeSchedule.citations.map((cite, idx) => (
                <li key={idx}>{cite}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" />
            <div>
              <h2 className="text-sm font-bold text-ink">
                {interpolate(m.states.titleWarningHeading, { state })}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">
                {m.states.titleWarningBody}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10">
          <h2 className="text-xl font-bold tracking-tight text-ink mb-4">
            {interpolate(m.states.countiesHeading, { state })}
          </h2>

          {error ? (
            <p role="alert" className="mt-6 rounded-control border border-catch/30 bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>
          ) : counties.length === 0 ? (
            <p className="mt-6 text-sm text-ink-3">{interpolate(m.states.noCountiesNote, { state })}</p>
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
                      <span className="tabular-nums text-ink-3">{row.count} {selectPlural(locale, row.count, m.states.listingWord)}</span>
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
      <SiteFooter />
      </div>
    </>
  );
}
