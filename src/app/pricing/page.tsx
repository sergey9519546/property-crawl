import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { WorkspaceSessionProvider } from "@/components/workspace/workspace-shell";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const title = locale === "en" ? "Pricing & Access Tiers | PerfectProperty" : m.meta.homeTitle;
  return {
    title,
    description:
      "Evidence-first access plans for distressed real estate discovery, saved hunts, decision packet exports, and multi-market escrow allocation.",
    alternates: { canonical: "/pricing" },
  };
}

const TIERS = [
  {
    name: "Public Discovery",
    price: "$0",
    cadence: "always free",
    ctaLabel: "Browse auctions",
    ctaHref: "/listings",
    highlight: false,
    features: [
      "Search active sheriff, tax deed, trustee & federal REO feeds",
      "Inspect deterministic catch summaries & gap ledgers",
      "Explore county map, parcel polygons & auction calendar",
      "Use Bid Cost Model & statutory redemption calculators",
    ],
  },
  {
    name: "Pro Underwriting",
    price: "$39",
    cadence: "per month",
    ctaLabel: "Subscribe in account",
    ctaHref: "/account",
    highlight: true,
    features: [
      "Saved hunts & email match digests across states and counties",
      "Full JSON & Markdown Decision Packet exports with overrides",
      "Private research cases, Second Look alerts & price-drop tracking",
      "Account-scoped watchlist syncing across devices",
    ],
  },
  {
    name: "Desk & Team",
    price: "$149",
    cadence: "per month",
    ctaLabel: "Configure team access",
    ctaHref: "/account",
    highlight: false,
    features: [
      "Everything in Pro Underwriting plus team workflows",
      "Portfolio escrow capital allocator across overlapping auction dates",
      "Bulk docket comparison & multi-jurisdiction underwriting exports",
      "Priority county source onboarding & direct email-notice pipelines",
    ],
  },
] as const;

export default async function PricingPage() {
  return (
    <WorkspaceSessionProvider>
      <div className="min-h-screen bg-paper text-ink">
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-5 py-16 outline-none sm:px-8 lg:px-12">
          <div className="max-w-2xl">
            <p className="text-label font-bold uppercase tracking-widest text-ink-3">Plans &amp; Entitlements</p>
            <h1 className="mt-2 text-display font-semibold tracking-tight text-ink">
              Transparent pricing built around verified evidence.
            </h1>
            <p className="mt-4 text-lead text-ink-2">
              Every plan keeps missing data visible and refuses fabricated comps. Paid tiers unlock automated saved hunts, full decision packets, and private underwriting cases.
            </p>
          </div>

          <section aria-label="Pricing tiers" className="mt-12 grid gap-6 md:grid-cols-3">
            {TIERS.map((tier) => (
              <article
                key={tier.name}
                className={`flex flex-col justify-between rounded-card border p-6 shadow-card ${
                  tier.highlight ? "border-ink bg-card shadow-raised" : "border-line bg-card"
                }`}
              >
                <div>
                  <h2 className="text-title font-semibold text-ink">{tier.name}</h2>
                  <p className="mt-4 flex items-baseline gap-2">
                    <span className="text-display font-semibold tabular-nums text-ink">{tier.price}</span>
                    <span className="text-meta text-ink-3">{tier.cadence}</span>
                  </p>
                  <ul className="mt-6 space-y-3 border-t border-line pt-5 text-meta text-ink-2">
                    {tier.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2">
                        <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Link
                  href={tier.ctaHref}
                  className={`mt-8 inline-flex items-center justify-center rounded-control px-4 py-2.5 text-meta font-semibold transition-colors ${
                    tier.highlight
                      ? "bg-ink text-white hover:bg-ink-2"
                      : "border border-line-strong bg-paper text-ink hover:bg-line"
                  }`}
                >
                  {tier.ctaLabel}
                </Link>
              </article>
            ))}
          </section>

          <section className="mt-10 rounded-card border border-line bg-card p-6 shadow-card">
            <h2 className="text-title font-semibold text-ink">Zero-Fabrication &amp; Billing Policy</h2>
            <p className="mt-2 text-body text-ink-2">
              Paid tiers never invent automated valuations, never contact homeowners, and never unlock synthetic deal scores. Manage billing or check Stripe activation status from your{" "}
              <Link href="/account" className="font-semibold text-ink underline underline-offset-4">
                account page
              </Link>
              .
            </p>
          </section>
        </main>
        <SiteFooter />
      </div>
    </WorkspaceSessionProvider>
  );
}
