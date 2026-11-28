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
  return {
    title: m.pricing.metaTitle,
    description: m.pricing.metaDescription,
    alternates: { canonical: "/pricing" },
  };
}

export default async function PricingPage() {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const p = m.pricing;

  const tiers = [
    {
      id: "public",
      name: p.publicName,
      price: p.publicPrice,
      cadence: p.publicCadence,
      ctaLabel: p.publicCta,
      ctaHref: "/listings",
      highlight: false,
      features: p.publicFeatures,
    },
    {
      id: "pro",
      name: p.proName,
      price: p.proPrice,
      cadence: p.proCadence,
      ctaLabel: p.proCta,
      ctaHref: "/account?tier=pro",
      highlight: true,
      features: p.proFeatures,
    },
    {
      id: "desk",
      name: p.deskName,
      price: p.deskPrice,
      cadence: p.deskCadence,
      ctaLabel: p.deskCta,
      ctaHref: "/account?tier=desk",
      highlight: false,
      features: p.deskFeatures,
    },
  ] as const;

  return (
    <WorkspaceSessionProvider>
      <div className="min-h-screen bg-paper text-ink">
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-5 pb-16 pt-28 outline-none sm:px-8 sm:pt-32 lg:px-12">
          <div className="max-w-2xl">
            <p className="text-label font-bold uppercase tracking-widest text-ink-3">{p.eyebrow}</p>
            <h1 className="mt-2 text-display font-semibold tracking-tight text-ink">{p.heading}</h1>
            <p className="mt-4 text-lead text-ink-2">{p.lead}</p>
          </div>

          <section aria-label={p.tiersAria} className="mt-12 grid gap-6 md:grid-cols-3">
            {tiers.map((tier) => (
              <article
                key={tier.id}
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
            <h2 className="text-title font-semibold text-ink">{p.policyHeading}</h2>
            <p className="mt-2 text-body text-ink-2">
              {p.policyBodyBefore}{" "}
              <Link href="/account" className="font-semibold text-ink underline underline-offset-4">
                {p.policyLinkLabel}
              </Link>
              {p.policyBodyAfter}
            </p>
          </section>
        </main>
        <SiteFooter />
      </div>
    </WorkspaceSessionProvider>
  );
}
