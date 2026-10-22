import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BookOpen, History, CheckCircle2, ShieldAlert, Scale, Calculator, FileText } from "lucide-react";

export const metadata: Metadata = {
  title: "Resources, Knowledge Base & Changelog | PerfectProperty",
  description:
    "Statutory foreclosure guide, cash-to-close breakdowns, lien priority rules, and release changelog for the PerfectProperty platform.",
};

export default function ResourcesPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16 text-slate-900 sm:px-8">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>
      </div>

      <div className="border-b border-slate-200 pb-8">
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Documentation & Guides</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
          Resources & Knowledge Base
        </h1>
        <p className="mt-3 text-sm text-slate-600 leading-relaxed">
          Forensic guides to statutory auction types, lien priority hierarchy, cash-to-close rules, and our verified release history.
        </p>
      </div>

      <div className="mt-12 space-y-16">
        {/* Knowledge Base Section */}
        <section id="knowledge-base" className="scroll-mt-12 space-y-8">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
            <BookOpen className="h-6 w-6 text-indigo-600" />
            <h2 className="text-2xl font-bold text-slate-950">Underwriting Knowledge Base</h2>
          </div>

          {/* Card 1: Sale Mechanisms */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
              <Scale className="h-4 w-4 text-slate-700" />
              1. Judicial Foreclosure vs Non-Judicial Trustee Sales vs Tax Deeds
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Distressed property dispositions follow state-specific statutory pathways:
            </p>
            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="font-bold text-slate-900">Judicial Sheriff Sales</h4>
                <p className="mt-1 text-slate-600">Common in OH, NJ, FL, PA, IL, NY. Requires court final judgment of foreclosure. Supervised by the county sheriff with statutory upset pricing.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="font-bold text-slate-900">Non-Judicial Trustee Sales</h4>
                <p className="mt-1 text-slate-600">Common in CA, TX, GA, NV, AZ, NC. Handled via Deed of Trust power-of-sale clause without court filings. Shorter notice timeline (21–90 days).</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="font-bold text-slate-900">Tax Lien & Deed Sales</h4>
                <p className="mt-1 text-slate-600">Conducted by county tax collectors for delinquent real estate property taxes. Some states sell lien certificates; others sell the underlying deed directly.</p>
              </div>
            </div>
          </div>

          {/* Card 2: Cash-to-Close Calculations */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
              <Calculator className="h-4 w-4 text-slate-700" />
              2. Statutory Cash-to-Close & Settlement Requirements
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Winning bids at distressed auctions require more than the hammer price. Bidders must tender certified funds within rigid statutory settlement windows:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-xs text-slate-700">
              <li>
                <strong>Florida (Fla. Stat. § 201.02):</strong> Requires 5% deposit at hammer fall. State documentary stamp tax ($0.70 per $100 of consideration) plus electronic clerk fees due within 24 hours.
              </li>
              <li>
                <strong>Pennsylvania (Pa. R.C.P. 3129):</strong> Requires 10% day-of deposit. 2% state realty transfer tax, 2% sheriff poundage fee, and delinquent taxes due within 30 days.
              </li>
              <li>
                <strong>New Jersey:</strong> 20% certified deposit due immediately upon hammer fall. Balance due within 30 days with interest accruing at 8% from day 30.
              </li>
              <li>
                <strong>North Carolina (G.S. 45-21.27):</strong> 10-day statutory upset bid window remains open after sale; any third party may file a 5% upset bid with the clerk of superior court.
              </li>
            </ul>
          </div>

          {/* Card 3: Title Risk & Lien Priority Hierarchy */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              3. Forensic Lien Priority & Surviving Encumbrances
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Winning an auction does NOT automatically deliver clean title. Surviving lien risks depend on the foreclosing instrument&apos;s recordation date:
            </p>
            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <h4 className="font-bold text-amber-950">Junior 2nd Mortgage Foreclosure</h4>
                <p className="mt-1 text-amber-900 leading-relaxed">
                  If the plaintiff is a 2nd mortgage or HELOC, the foreclosure <strong>DOES NOT extinguish the 1st mortgage</strong>.
                  The winning bidder takes the deed strictly subject to the outstanding senior loan balance.
                </p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <h4 className="font-bold text-amber-950">IRS Federal Tax Liens (26 U.S.C. § 7425)</h4>
                <p className="mt-1 text-amber-900 leading-relaxed">
                  Federal tax liens recorded against the borrower grant the United States a statutory <strong>120-day right of redemption</strong>
                  to buy back the property from the auction purchaser at the bid price plus interest.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Changelog Section */}
        <section id="changelog" className="scroll-mt-12 space-y-8 border-t border-slate-200 pt-12">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
            <History className="h-6 w-6 text-indigo-600" />
            <h2 className="text-2xl font-bold text-slate-950">Platform Changelog</h2>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800">v2.0.0 Stable</span>
                <span className="text-xs text-slate-500">October 2026</span>
              </div>
              <h3 className="text-base font-bold text-slate-950">
                Next.js 16 App Router Migration & Scrapling Anti-Detect Spider Engine
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600 leading-relaxed">
                <li>Production migration to Next.js 16 (App Router) on port 3001 with plain Node.js HTTP API proxying on port 3000.</li>
                <li>Integrated stateless streaming Scrapling spider engine (<code>scripts/crawlers/scrapling_spider.py</code>) with publisher session boundaries (<code>pub:&#123;source&#125;:&#123;scope&#125;</code>).</li>
                <li>Fail-closed legal non-negotiables: robots.txt exclusion emits <code>ACCESS_POLICY_VIOLATION</code> rather than silent drops.</li>
                <li>Comprehensive Adversarial Security Gauntlet (M1 Challenger): route unshadowing, SQLi/XSS boundaries, and 50 parallel requests concurrency tests.</li>
                <li>PostgreSQL 16 + PostGIS 3.6 durability with 27 forward migrations and zero data-mode fabrication.</li>
                <li>Decision Packet dossiers (JSON + Markdown export) with Second Look reconsideration triggers.</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-800">v1.8.0</span>
                <span className="text-xs text-slate-500">September 2026</span>
              </div>
              <h3 className="text-base font-bold text-slate-950">
                Source Radar & IMAP Email-as-API Legal Ingestion
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-xs text-slate-600 leading-relaxed">
                <li>Automated IMAP inbox parsing for Florida, Illinois, Texas, and Ohio public legal notice publications.</li>
                <li>Source Radar dashboard tracking live scraper freshness, circuit breaker trips, and catalog admission statuses.</li>
                <li>Title Risk engine arbitrating senior mortgage survivals and municipal code enforcement liens.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-12 flex flex-wrap gap-4 border-t border-slate-200 pt-8">
        <Link
          href="/listings"
          className="rounded-xl bg-[#0F172A] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1E293B] transition"
        >
          Open Listing Workspace
        </Link>
        <Link
          href="/contact"
          className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
        >
          Submit Research Feedback
        </Link>
      </div>
    </main>
  );
}
