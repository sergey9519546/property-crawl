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

          {/* Card 2: 10-State Statutory Foreclosure & Settlement Schedules */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
                <Calculator className="h-4 w-4 text-blue-600" />
                2. Top-10 State Foreclosure Statutory Comparison Matrix
              </h3>
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Audited Legal Presets
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Every jurisdiction enforces strict statutory rules governing certified knockdown deposits, confirmation stays, post-sale upset periods, and transfer taxes. Underwriting bids without verifying these parameters leads to forfeited deposits or unexpected statutory carrying costs:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
                <thead className="bg-slate-50 font-bold text-slate-900">
                  <tr>
                    <th className="p-3">State</th>
                    <th className="p-3">Primary Mechanism</th>
                    <th className="p-3">Knockdown Deposit</th>
                    <th className="p-3">Confirmation / Upset</th>
                    <th className="p-3">Statutory Redemption</th>
                    <th className="p-3">Statutory Fees / Taxes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                  <tr>
                    <td className="p-3 font-semibold text-slate-950">California (CA)</td>
                    <td className="p-3">Non-Judicial Trustee</td>
                    <td className="p-3">100% Cashier's Check</td>
                    <td className="p-3">45-Day SB 1079 Window</td>
                    <td className="p-3">0 Days (Cal. Civ. Code § 2924m)</td>
                    <td className="p-3">$1.10 per $1,000 transfer tax</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-950">Florida (FL)</td>
                    <td className="p-3">Judicial Foreclosure</td>
                    <td className="p-3">5% Electronic Tender</td>
                    <td className="p-3">10-Day Certificate of Title</td>
                    <td className="p-3">0 Days (Cert. of Sale cut-off)</td>
                    <td className="p-3">Fla. Stat. § 201.02 ($0.70 / $100 doc stamps) + 1.5% registry</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-950">Georgia (GA)</td>
                    <td className="p-3">Non-Judicial Deed of Trust</td>
                    <td className="p-3">10% Certified Deposit</td>
                    <td className="p-3">Immediate (First Tuesday)</td>
                    <td className="p-3">0 Days mortgage; 1 yr tax deed</td>
                    <td className="p-3">$1.00 per $1,000 transfer tax</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-950">Illinois (IL)</td>
                    <td className="p-3">Judicial Foreclosure</td>
                    <td className="p-3">10% Certified Funds</td>
                    <td className="p-3">30-Day Confirmation Motion</td>
                    <td className="p-3">30–90 Days residential (735 ILCS 5/15)</td>
                    <td className="p-3">$1.50 per $1,000 combined stamps</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-950">New Jersey (NJ)</td>
                    <td className="p-3">Judicial Sheriff Sale</td>
                    <td className="p-3">20% Certified Knockdown</td>
                    <td className="p-3">10-Day Objection / Redemption</td>
                    <td className="p-3">10 Days (R. 4:65-5)</td>
                    <td className="p-3">Tiered commission (2-6%) + ~1% transfer fee</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-950">New York (NY)</td>
                    <td className="p-3">Judicial Referee Sale</td>
                    <td className="p-3">10% Certified Check</td>
                    <td className="p-3">30-Day Referee Report</td>
                    <td className="p-3">0 Days (Gavel fall cut-off)</td>
                    <td className="p-3">$4.00 per $1,000 state transfer tax</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-950">North Carolina (NC)</td>
                    <td className="p-3">Non-Judicial Trustee</td>
                    <td className="p-3">5% Minimum ($750 floor)</td>
                    <td className="p-3">10-Day Rolling Upset Bid</td>
                    <td className="p-3">10-Day Upset Period (N.C.G.S. § 45-21)</td>
                    <td className="p-3">$2.00 per $1,000 excise tax</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-950">Ohio (OH)</td>
                    <td className="p-3">Judicial Sheriff Sale</td>
                    <td className="p-3">10% Certified Deposit</td>
                    <td className="p-3">30-Day Confirmation Entry</td>
                    <td className="p-3">Expires at confirmation (R.C. 2329.33)</td>
                    <td className="p-3">1.5% sheriff poundage + $4/k conveyance</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-950">Pennsylvania (PA)</td>
                    <td className="p-3">Judicial Sheriff Sale</td>
                    <td className="p-3">10% Day-of Certified</td>
                    <td className="p-3">30-Day Schedule of Distribution</td>
                    <td className="p-3">0 Days mortgage; 9 mo tax claims</td>
                    <td className="p-3">2% realty transfer tax + 2% poundage</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-950">Texas (TX)</td>
                    <td className="p-3">Non-Judicial Trustee / Tax</td>
                    <td className="p-3">100% Cash / Cashier's Check</td>
                    <td className="p-3">Immediate (First Tuesday)</td>
                    <td className="p-3">0 Days mortgage; 180 d / 2 yr tax</td>
                    <td className="p-3">$0 state real estate transfer tax</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Card 3: 7 Deal-Killer Due Diligence Checklist */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                3. The 7 Deal-Killer Due Diligence Checklist
              </h3>
              <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full">
                Forensic Protocol
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Every auction bidder must audit seven statutory failure modes before tendering funds. Missing even one can result in complete capital loss:
            </p>
            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">1. Senior Lien Priority &amp; 1st Mortgage Survival</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  A junior mortgage or HOA lien foreclosure never wipes out a recorded senior 1st mortgage. The purchaser takes title subject to the full unpaid principal and default interest of the senior lien.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">2. Municipal Super-Priority Ad Valorem Taxes</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  County real property taxes, municipal water/sewer assessments, and demolition liens carry absolute statutory super-priority over all private mortgages and must be paid in full by the auction buyer.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">3. IRS § 7425(d) 120-Day Federal Redemption</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Recorded federal tax liens give the United States Department of the Treasury a 120-day right of redemption from the sale date to take the property back at the auction purchase price.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">4. State Statutory Redemption &amp; Confirmation Stays</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  States like Alabama (180 days), Tennessee (2 years), or North Carolina (10-day rolling upset bids) permit prior owners or third parties to redeem or overturn auction sales post-gavel fall.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">5. Bankruptcy Automatic Stay (11 U.S.C. § 362)</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  A bankruptcy petition filed minutes before the sale triggers an immediate statutory stay. Any auction conducted in violation of the stay is void ab initio under federal bankruptcy law.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">6. Certified Funds Deposit &amp; Tender Deadlines</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Sheriff departments and referees strictly enforce certified check or wire deadlines (e.g. 24 hours in FL, 30 days in NJ/PA). Failure to tender timely results in default forfeiture of the deposit.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 sm:col-span-2">
                <h4 className="font-bold text-slate-950">7. Occupancy &amp; Protecting Tenants at Foreclosure Act (12 U.S.C. § 5220)</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Foreclosure deeds do not grant immediate physical possession. Under federal PTFA and state tenant protection laws, bona fide residential tenants must be provided with a mandatory 90-day written notice to vacate before eviction proceedings may begin.
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
