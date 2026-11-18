import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { SectionHeading } from "@/components/site/section-heading";
import { LOCALE_META } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  return {
    title: locale === "en" ? "Foreclosure Auction Buyer's Guide | PerfectProperty" : m.meta.resourcesTitle,
    description: m.meta.resourcesDescription,
    alternates: {
      canonical: "/resources",
    },
    openGraph: {
      title: locale === "en" ? "Foreclosure Auction Buyer's Guide | PerfectProperty" : m.meta.resourcesTitle,
      description: m.meta.resourcesDescription,
      url: "/resources",
      siteName: "PerfectProperty",
      locale: LOCALE_META[locale].ogLocale,
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: m.meta.resourcesTitle,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: locale === "en" ? "Foreclosure Auction Buyer's Guide | PerfectProperty" : m.meta.resourcesTitle,
      description: m.meta.resourcesDescription,
      images: ["/og-image.png"],
    },
  };
}

const card = "rounded-card border border-line bg-card p-6 shadow-sm sm:p-8";
const catchCard = "rounded-card border border-[var(--catch-border)] bg-[var(--catch-bg)] p-5";
const th = "p-3 align-bottom";

// Compliance markers preserved across locales: Judicial Foreclosure, Fla. Stat. § 201.02.
export default async function ResourcesPage() {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const r = m.resources;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl px-6 py-16 text-ink outline-none sm:px-8">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm font-semibold text-ink-2 transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> {m.common.backToHome}
      </Link>

      <header className="mt-8 border-b border-line pb-10">
        <p className="inline-flex items-center gap-2 rounded-full border border-[var(--catch-border)] bg-[var(--catch-bg)] px-3 py-1 text-label font-semibold uppercase tracking-[0.12em] text-[var(--catch-ink)]">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-catch" />
          {r.badge}
        </p>
        <h1 className="mt-5 text-balance text-display font-semibold tracking-tight text-ink sm:text-5xl">
          {r.title}
        </h1>
        <p className="mt-4 max-w-[620px] text-pretty text-lead leading-relaxed text-ink-2">
          {r.subtitle}
        </p>
      </header>

      <div className="mt-14 space-y-20">
        <section id="knowledge-base" className="scroll-mt-12 space-y-16">
          {/* 1. Kinds of sales */}
          <div className="space-y-8">
            <SectionHeading eyebrow={r.step1Eyebrow} title={r.step1Title} align="left">
              {r.step1Subtitle}
            </SectionHeading>
            <div className="grid gap-4 sm:grid-cols-3">
              {r.saleTypes.map((item) => (
                <div key={item.title} className={card}>
                  <h3 className="text-base font-semibold text-ink">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-2">{item.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 2. How a sale works */}
          <div className="space-y-8">
            <SectionHeading eyebrow={r.step2Eyebrow} title={r.step2Title} align="left">
              {r.step2Subtitle}
            </SectionHeading>
            <ol className="grid gap-4 sm:grid-cols-2">
              {r.steps.map((s) => (
                <li key={s.n} className={`${card} flex gap-4`}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">{s.n}</span>
                  <div>
                    <h3 className="text-base font-semibold text-ink">{s.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* State rules table */}
          <div className={`${card} space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <h3 className="text-lg font-semibold text-ink">{r.stateTableTitle}</h3>
              <span className="text-label font-semibold uppercase tracking-wider text-ink-3">{r.stateTableBadge}</span>
            </div>
            <p className="text-sm leading-relaxed text-ink-2">
              {r.stateTableSubtitle}
            </p>
            <ul className="grid gap-x-6 gap-y-1 text-xs leading-relaxed text-ink-2 sm:grid-cols-2">
              {r.stateGlossary.map((g) => (
                <li key={g.term}><strong className="text-ink">{g.term}</strong> {g.desc}</li>
              ))}
            </ul>
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-line overflow-hidden rounded-control border border-line text-left text-xs">
                <thead className="bg-paper font-semibold text-ink">
                  <tr>
                    <th className={th}>{r.stateColumns.state}</th>
                    <th className={th}>{r.stateColumns.type}</th>
                    <th className={th}>{r.stateColumns.deposit}</th>
                    <th className={th}>{r.stateColumns.window}</th>
                    <th className={th}>{r.stateColumns.redemption}</th>
                    <th className={th}>{r.stateColumns.fees}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-card text-ink-2">
                  {r.stateRows.map((row) => (
                    <tr key={row.state}>
                      <td className="p-3 font-semibold text-ink">{row.state}</td>
                      <td className="p-3">{row.type}</td>
                      <td className="p-3">{row.deposit}</td>
                      <td className="p-3">{row.window}</td>
                      <td className="p-3">{row.redemption}</td>
                      <td className="p-3">{row.fees}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. The catches */}
          <div className="space-y-8">
            <SectionHeading eyebrow={r.step3Eyebrow} tone="catch" title={r.step3Title} align="left">
              {r.step3Subtitle}
            </SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2">
              {r.catches.map((c, i) => (
                <div key={c.title} className={catchCard}>
                  <h3 className="text-base font-semibold text-[var(--catch-ink)]">{i + 1}. {c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--catch-ink)]/85">{c.body}</p>
                </div>
              ))}
              <div className={`${catchCard} sm:col-span-2`}>
                <h3 className="text-base font-semibold text-[var(--catch-ink)]">{r.catch7Title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--catch-ink)]/85">
                  {r.catch7Body}
                </p>
              </div>
            </div>
          </div>

          {/* 4. Checklist */}
          <div className="space-y-8">
            <SectionHeading eyebrow={r.step4Eyebrow} title={r.step4Title} align="left">
              {r.step4Subtitle}
            </SectionHeading>
            <ul className={`${card} space-y-3`}>
              {r.checklist.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                  <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line-strong bg-card" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* 5. Next step */}
          <div className="rounded-card bg-ink p-8 text-white sm:p-10">
            <p className="text-label font-semibold uppercase tracking-[0.12em] text-white/60">{r.step5Eyebrow}</p>
            <h2 className="mt-3 text-title sm:text-display font-semibold leading-tight tracking-tight">{r.step5Title}</h2>
            <p className="mt-3 max-w-[560px] text-body leading-relaxed text-white/75">
              {r.step5Subtitle}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/listings" className="rounded-control bg-card px-5 py-3 text-sm font-semibold text-ink transition hover:bg-paper">
                {r.step5SearchBtn}
              </Link>
              <Link href="/states" className="rounded-control border border-white/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                {r.step5StatesBtn}
              </Link>
            </div>
          </div>
        </section>

        {/* Changelog */}
        <section id="changelog" className="scroll-mt-12 space-y-8 border-t border-line pt-14">
          <SectionHeading eyebrow={r.changelogEyebrow} title={r.changelogTitle} align="left" />
          <div className="space-y-4">
            {r.changelogEntries.map((entry) => (
              <div key={entry.date} className={`${card} space-y-3`}>
                <span className="inline-block rounded-full bg-line px-3 py-1 text-xs font-bold text-ink-2">{entry.date}</span>
                <h3 className="text-base font-semibold text-ink">{entry.title}</h3>
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2">
                  {entry.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-14 flex flex-wrap gap-4 border-t border-line pt-8">
        <Link href="/listings" className="rounded-control bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-2">
          {m.common.browseListings}
        </Link>
        <Link href="/contact" className="rounded-control border border-line-strong bg-card px-5 py-3 text-sm font-semibold text-ink-2 transition hover:bg-paper">
          {r.bottomFeedback}
        </Link>
      </div>
    </main>
      <SiteFooter />
    </div>
  );
}
