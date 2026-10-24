import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BookOpen, History, CheckCircle2, ShieldAlert, Scale, Calculator, FileText } from "lucide-react";

export const metadata: Metadata = {
  title: "Buyer's Guide to Foreclosure and Auction Homes | PerfectProperty",
  description:
    "Plain-English guide to sheriff sales, trustee sales, tax sales and bank-owned homes: what they are, what can go wrong, and what to check before you bid.",
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
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Buyer's guide</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
          Buyer's guide to auction and foreclosure homes
        </h1>
        <p className="mt-3 text-sm text-slate-600 leading-relaxed">
          What each kind of sale means, how rules differ by state, and seven things to check before you bid. Rules change, so check your county's rules first.
        </p>
      </div>

      <div className="mt-12 space-y-16">
        {/* Knowledge Base Section */}
        <section id="knowledge-base" className="scroll-mt-12 space-y-8">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
            <BookOpen className="h-6 w-6 text-indigo-600" />
            <h2 className="text-2xl font-bold text-slate-950">The basics</h2>
          </div>

          {/* Card 1: Sale Mechanisms */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
              <Scale className="h-4 w-4 text-slate-700" />
              1. Three common ways a home is sold
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Which one applies depends on your state:
            </p>
            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="font-bold text-slate-900">Sheriff sale (court-ordered)</h4>
                <p className="mt-1 text-slate-600">The lender sues, a judge orders the sale, and the county sheriff runs it. Common in states like OH, NJ, FL, PA, IL and NY. This is a judicial foreclosure.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="font-bold text-slate-900">Trustee sale (no court)</h4>
                <p className="mt-1 text-slate-600">A trustee sells the home under a clause in the loan, without going to court. Common in states like CA, TX, GA, NV, AZ and NC. Notice periods are often shorter.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="font-bold text-slate-900">Tax sale</h4>
                <p className="mt-1 text-slate-600">The county sells a home or a claim on it because property taxes went unpaid. Some states sell the debt (a lien certificate); others sell the property itself.</p>
              </div>
            </div>
          </div>

          {/* Card 2: 10-State Statutory Foreclosure & Settlement Schedules */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
                <Calculator className="h-4 w-4 text-blue-600" />
                2. How the rules differ in ten states
              </h3>
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Summary only
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Each state sets its own deposit, waiting period after the sale, and fees. A redemption period is a window after the sale when the old owner may buy the home back. This table is a summary, not legal advice.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
                <thead className="bg-slate-50 font-bold text-slate-900">
                  <tr>
                    <th className="p-3">State</th>
                    <th className="p-3">Type of sale</th>
                    <th className="p-3">Deposit</th>
                    <th className="p-3">Court confirmation or upset-bid window</th>
                    <th className="p-3">Redemption period</th>
                    <th className="p-3">Fees and taxes</th>
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
                3. Seven things to check before you bid
              </h3>
              <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full">
                Checklist
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Missing one of these can cost you your deposit or more. Check each one for the specific property.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">1. An older mortgage can stay with the property</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Foreclosing on a second mortgage or an HOA lien does not wipe out a recorded first mortgage. You take the property owing the full unpaid balance and default interest on it.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">2. Unpaid property taxes and city charges</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  County property taxes, city water and sewer charges, and demolition liens are paid before the mortgage (super-priority). They usually stay with the property, so the buyer pays them.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">3. IRS § 7425(d): 120 days to buy it back</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  If a recorded federal tax lien is involved, the U.S. Treasury has 120 days from the sale date to take the property back at the price you paid.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">4. State redemption periods and sale reviews</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  States like Alabama (180 days), Tennessee (2 years), or North Carolina (10-day rolling upset bids) let the former owner or others buy the property back or challenge the sale after the auction. A redemption period is the time the former owner can buy it back.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">5. Bankruptcy (11 U.S.C. § 362)</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  A bankruptcy filing, even minutes before the sale, usually pauses the sale right away. A sale held anyway can be cancelled as if it never happened.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="font-bold text-slate-950">6. Deposit and payment deadlines</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Sheriffs and referees strictly enforce deadlines for certified checks or wires (for example 24 hours in FL, 30 days in NJ/PA). If you pay late, you can lose your deposit.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 sm:col-span-2">
                <h4 className="font-bold text-slate-950">7. Who lives there (Protecting Tenants at Foreclosure Act, 12 U.S.C. § 5220)</h4>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Winning the sale does not give you the keys right away. Under this federal law and state tenant laws, genuine tenants must get at least 90 days' written notice to leave before eviction can begin.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Changelog Section */}
        <section id="changelog" className="scroll-mt-12 space-y-8 border-t border-slate-200 pt-12">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
            <History className="h-6 w-6 text-indigo-600" />
            <h2 className="text-2xl font-bold text-slate-950">What's new</h2>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800">October 2026</span>
                <span className="text-xs text-slate-500">&nbsp;</span>
              </div>
              <h3 className="text-base font-bold text-slate-950">
                Clearer listings
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600 leading-relaxed">
                <li>Listings that don&apos;t publish a value no longer get a made-up one.</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-800">September 2026</span>
                <span className="text-xs text-slate-500">&nbsp;</span>
              </div>
              <h3 className="text-base font-bold text-slate-950">
                Public legal notices and risk checks
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-xs text-slate-600 leading-relaxed">
                <li>Added public legal notices from several states as a source.</li>
                <li>Added a check for senior mortgages and city liens that can stay with the property.</li>
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
          Browse listings
        </Link>
        <Link
          href="/contact"
          className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
        >
          Send us feedback
        </Link>
      </div>
    </main>
  );
}
