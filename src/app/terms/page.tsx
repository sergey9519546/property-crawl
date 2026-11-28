import type { Metadata } from "next";
import Link from "next/link";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";
import { ShieldAlert, Scale, AlertTriangle, FileText, ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const title = locale === "en" ? "Terms of Service | PerfectProperty" : m.meta.termsTitle;
  const description = m.meta.termsDescription;
  return {
    title,
    description,
    alternates: {
      canonical: "/terms",
    },
    openGraph: {
      title,
      description,
      url: "/terms",
      siteName: "PerfectProperty",
      type: "website",
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}

export default async function TermsPage() {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  return (
    <div className="min-h-screen bg-paper text-ink">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl px-6 pb-16 pt-28 text-ink outline-none sm:px-8 sm:pt-32">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink-3 hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {m.common.backToHome}
        </Link>
      </div>

      <div className="border-b border-line pb-8">
        <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-3">{m.terms.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          {m.terms.title}
        </h1>
        <p className="mt-3 text-sm text-ink-3">
          Last revised: October 22, 2026 · Effective immediately for all beta participants
        </p>
      </div>

      {locale === "en" ? (
<>
<div className="mt-8 space-y-10 text-sm leading-7 text-ink-2">
        {/* Section 1 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <Scale className="h-5 w-5 text-ink-2" />
            1. Nature of the Service & Non-Brokerage Disclosure
          </h2>
          <p>
            PerfectProperty is an independent discovery, analytical aggregation, and triage intelligence layer
            for distressed, judicial foreclosure, trustee sale, and government-disposed real estate. PerfectProperty
            is <strong>not a licensed real estate broker, lender, auctioneer, escrow agent, title company, or
            foreclosure consultant</strong>.
          </p>
          <p>
            We do not represent buyers, lenders, trustees, or distressed homeowners. We do not participate in
            real estate transactions, do not draft deeds, and do not receive transaction-contingent brokerage commissions.
            All analytics, Deal Scores, cash-to-close breakdowns, and valuation ranges are provided solely for
            preliminary informational screening.
          </p>
        </section>

        {/* Section 2 */}
        <section className="rounded-card border border-line-strong bg-paper p-6 space-y-3 text-ink">
          <h2 className="text-lg font-bold flex items-center gap-2 text-ink">
            <ShieldAlert className="h-5 w-5 text-ink-3" />
            2. No outreach to owners, and the laws we follow
          </h2>
          <p className="text-ink-2 leading-relaxed">
            Users are <strong>strictly prohibited</strong> from utilizing any record, parcel identifier, defendant name,
            or case docket surfaced by PerfectProperty to engage in unsolicited telemarketing, automated robocalls,
            direct text messaging, or predatory homeowner outreach.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-xs text-ink-2">
            <li>
              <strong>Telephone Consumer Protection Act (47 U.S.C. § 227):</strong> Unsolicited automated calls and texts
              to homeowners carry statutory penalties of $500 to $1,500 per incident. PerfectProperty does not publish
              homeowner phone numbers and bans their ingestion.
            </li>
            <li>
              <strong>California Civil Code § 1695 & Statewide Foreclosure Rescue Laws:</strong> PerfectProperty strictly
              forbids utilizing platform observations to act as an unbonded foreclosure rescue consultant or solicit
              distressed equity concessions from owner-occupants. Violations may result in immediate permanent revocation
              of access and notification to civil authorities.
            </li>
          </ul>
        </section>

        {/* Section 3 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink">
            3. Zero-Fabrication Valuation & Appraisal Disclaimer
          </h2>
          <p>
            Deal Scores and valuation ranges appear only when the underlying source record publishes both an opening bid
            and an estimated market range (never imputed or fabricated when omitted by the publisher).
            <strong> Under no circumstances does a Deal Score or estimated value constitute an official appraisal,
            market study, or guarantee of profitability.</strong>
          </p>
          <p>
            Distressed real estate auctions are sold on an strictly <em>&ldquo;AS-IS, WHERE-IS, WITH ALL FAULTS&rdquo;</em> basis,
            without warranty of habitability, physical inspection access, or title guarantees. Users must conduct their
            own independent physical inspection, structural assessment, and professional title search before tendering bids.
          </p>
        </section>

        {/* Section 4 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink">
            4. Public Record Discrepancies, Postponements & Bankruptcy Stays
          </h2>
          <p>
            Auction schedules, opening bids, and judgment amounts are aggregated from public sheriff sales,
            county clerk portals, press association legal notice subscriptions, and federal agency announcements.
            Auction proceedings are subject to unexpected court continuances, trustee adjournments, bankruptcy automatic stays
            (under 11 U.S.C. § 362), and statutory redemptions at any time prior to hammer fall.
          </p>
          <p>
            PerfectProperty reports the exact observed state at the timestamp cited in each record&apos;s provenance.
            Users are solely responsible for verifying current auction standing directly with the auctioneer or county sheriff.
          </p>
        </section>

        {/* Section 5 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink">
            5. Operator Access & Beta Credentials
          </h2>
          <p>
            Access to private operator surfaces, document reviews, and bespoke hunt execution requires valid
            authorized credentials. Sharing, republishing, or scraping authenticated operator endpoints without written
            authorization is prohibited.
          </p>
        </section>

        {/* Section 6 */}
        <section className="space-y-3 border-t border-line pt-6">
          <h2 className="text-lg font-bold text-ink">
            6. Limitation of Liability
          </h2>
          <p>
            To the maximum extent permitted by applicable law, PerfectProperty and its operators shall not be liable
            for any direct, indirect, incidental, punitive, or consequential damages, including loss of profits,
            bid deposits, purchase funds, or opportunity costs arising from errors, omissions, title defects, or auction
            adjournments in aggregated public listings.
          </p>
        </section>
      </div>
</>
) : (
<>
      <div className="mt-8 space-y-10 text-sm leading-7 text-ink-2">
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2"><Scale className="h-5 w-5 text-ink-2" />{m.terms.s1Title}</h2>
          <p>{m.terms.s1P1}</p>
          <p>{m.terms.s1P2}</p>
        </section>
        <section className="rounded-card border border-line-strong bg-paper p-6 space-y-3 text-ink">
          <h2 className="text-lg font-bold flex items-center gap-2 text-ink"><ShieldAlert className="h-5 w-5 text-ink-3" />{m.terms.s2Title}</h2>
          <p className="text-ink-2 leading-relaxed">{m.terms.s2P1}</p>
          <ul className="list-disc pl-5 space-y-1 text-xs text-ink-2">
            {m.terms.s2Items.map((it) => (<li key={it.label}><strong>{it.label}</strong> {it.body}</li>))}
          </ul>
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink">{m.terms.s3Title}</h2>
          <p>{m.terms.s3P1}</p>
          <p>{m.terms.s3P2}</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink">{m.terms.s4Title}</h2>
          <p>{m.terms.s4P1}</p>
          <p>{m.terms.s4P2}</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink">{m.terms.s5Title}</h2>
          <p>{m.terms.s5P1}</p>
        </section>
        <section className="space-y-3 border-t border-line pt-6">
          <h2 className="text-lg font-bold text-ink">{m.terms.s6Title}</h2>
          <p>{m.terms.s6P1}</p>
        </section>
      </div>
      </>
)}

      <div className="mt-12 rounded-card border border-line bg-paper p-6 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-ink">{m.terms.ctaTitle}</h3>
          <p className="text-xs text-ink-3 mt-1">{m.terms.ctaSub}</p>
        </div>
        <Link
          href="/contact"
          className="rounded-control bg-ink px-4 py-2.5 text-xs font-semibold text-white hover:bg-ink-2 transition"
        >
          {m.terms.ctaBtn}
        </Link>
      </div>
    </main>
      <SiteFooter />
    </div>
  );
}
