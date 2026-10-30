import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SectionHeading } from "@/components/site/section-heading";

export const metadata: Metadata = {
  title: "Buyer's Guide to Foreclosure and Auction Homes | PerfectProperty",
  description:
    "Plain-English guide to sheriff sales, trustee sales, tax sales and bank-owned homes: what they are, what can go wrong, and what to check before you bid.",
};

const card = "rounded-3xl border border-line bg-card p-6 shadow-sm sm:p-8";
const catchCard = "rounded-2xl border border-[var(--catch-border)] bg-[var(--catch-bg)] p-5";

const steps = [
  { n: "1", title: "Notice", body: "The sale is announced in a public notice. It gives the date, place and often the deposit." },
  { n: "2", title: "Sale day", body: "Bidding happens at the courthouse, online, or through a trustee. The highest bidder wins." },
  { n: "3", title: "Deposit and payment", body: "You pay a deposit on the day, then the rest by a deadline. Miss it and you can lose the deposit." },
  { n: "4", title: "Review window", body: "Some states need a judge to confirm the sale, or let others top your bid for a few days." },
  { n: "5", title: "Buy-back window", body: "In some states the old owner can buy the home back for a set time after the sale." },
  { n: "6", title: "Deed and possession", body: "You get the deed. If someone still lives there, you may have to go through eviction." },
];

const catches = [
  { title: "An older mortgage can stay with the property", body: "Foreclosing on a second mortgage or an HOA lien does not wipe out a recorded first mortgage. You take the property owing the full unpaid balance and default interest on it." },
  { title: "Unpaid property taxes and city charges", body: "County property taxes, city water and sewer charges, and demolition liens are paid before the mortgage (super-priority). They usually stay with the property, so the buyer pays them." },
  { title: "IRS § 7425(d): 120 days to buy it back", body: "If a recorded federal tax lien is involved, the U.S. Treasury has 120 days from the sale date to take the property back at the price you paid." },
  { title: "State redemption periods and sale reviews", body: "States like Alabama (180 days), Tennessee (2 years), or North Carolina (10-day rolling upset bids) let the former owner or others buy the property back or challenge the sale after the auction. A redemption period is the time the former owner can buy it back." },
  { title: "Bankruptcy (11 U.S.C. § 362)", body: "A bankruptcy filing, even minutes before the sale, usually pauses the sale right away. A sale held anyway can be cancelled as if it never happened." },
  { title: "Deposit and payment deadlines", body: "Sheriffs and referees strictly enforce deadlines for certified checks or wires (for example 24 hours in FL, 30 days in NJ/PA). If you pay late, you can lose your deposit." },
];

const checklist = [
  "Read the sale notice twice: date, place, deposit, and how to pay.",
  "Open the listing and read \"the catch\" first.",
  "Find out whether the home is occupied.",
  "Look up liens and unpaid taxes on the property. We do not provide title reports.",
  "Check your state's redemption and confirmation rules (table above).",
  "Check for a bankruptcy filing just before the sale.",
  "Have your deposit ready in the form the notice asks for.",
  "Call the county to confirm the sale is still on.",
];

const th = "p-3 align-bottom";

export default function ResourcesPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16 text-ink sm:px-8">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm font-semibold text-ink-2 transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back to home
      </Link>

      <header className="mt-8 border-b border-line pb-10">
        <p className="inline-flex items-center gap-2 rounded-full border border-[var(--catch-border)] bg-[var(--catch-bg)] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--catch-ink)]">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-catch" />
          Buyer&apos;s guide
        </p>
        <h1 className="mt-5 text-balance text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[46px]">
          Every deal has a catch. Learn where to look.
        </h1>
        <p className="mt-4 max-w-[620px] text-pretty text-[17px] leading-[1.65] text-ink-2">
          A short path for first-time auction buyers: the kinds of sales, how a sale works, the catches to check, and what to do before you bid. Rules change, so check your county&apos;s rules first.
        </p>
      </header>

      <div className="mt-14 space-y-20">
        <section id="knowledge-base" className="scroll-mt-12 space-y-16">
          {/* 1. Kinds of sales */}
          <div className="space-y-8">
            <SectionHeading eyebrow="Step 1" title="The kinds of sales" align="left">
              Which one applies depends on your state.
            </SectionHeading>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className={card}>
                <h3 className="text-base font-semibold text-ink">Sheriff sale (court-ordered)</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">The lender sues, a judge orders the sale, and the county sheriff runs it. Common in states like OH, NJ, FL, PA, IL and NY. This is a judicial foreclosure.</p>
              </div>
              <div className={card}>
                <h3 className="text-base font-semibold text-ink">Trustee sale (no court)</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">A trustee sells the home under a clause in the loan, without going to court. Common in states like CA, TX, GA, NV, AZ and NC. Notice periods are often shorter.</p>
              </div>
              <div className={card}>
                <h3 className="text-base font-semibold text-ink">Tax sale</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">The county sells a home or a claim on it because property taxes went unpaid. Some states sell the debt (a lien certificate); others sell the property itself.</p>
              </div>
            </div>
          </div>

          {/* 2. How a sale works */}
          <div className="space-y-8">
            <SectionHeading eyebrow="Step 2" title="How a sale works, from notice to deed" align="left">
              Six stages. The exact rules and timing depend on your state.
            </SectionHeading>
            <ol className="grid gap-4 sm:grid-cols-2">
              {steps.map((s) => (
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
              <h3 className="text-lg font-semibold text-ink">How the rules differ in ten states</h3>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Summary only</span>
            </div>
            <p className="text-sm leading-relaxed text-ink-2">
              Each state sets its own deposit, waiting period after the sale, and fees. This table is a summary, not legal advice.
            </p>
            <ul className="grid gap-x-6 gap-y-1 text-xs leading-relaxed text-ink-2 sm:grid-cols-2">
              <li><strong className="text-ink">Type of sale:</strong> who runs the sale, a court or a trustee.</li>
              <li><strong className="text-ink">Deposit:</strong> what you pay on the day.</li>
              <li><strong className="text-ink">Court confirmation or upset-bid window:</strong> time after the sale when a judge reviews it or others can top your bid.</li>
              <li><strong className="text-ink">Redemption period:</strong> a window after the sale when the old owner may buy the home back.</li>
              <li><strong className="text-ink">Fees and taxes:</strong> transfer taxes and sale fees you pay on top.</li>
            </ul>
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-line overflow-hidden rounded-xl border border-line text-left text-xs">
                <thead className="bg-paper font-semibold text-ink">
                  <tr>
                    <th className={th}>State</th>
                    <th className={th}>Type of sale</th>
                    <th className={th}>Deposit</th>
                    <th className={th}>Court confirmation or upset-bid window</th>
                    <th className={th}>Redemption period</th>
                    <th className={th}>Fees and taxes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-card text-ink-2">
                  <tr>
                    <td className="p-3 font-semibold text-ink">California (CA)</td>
                    <td className="p-3">Non-Judicial Trustee</td>
                    <td className="p-3">100% Cashier's Check</td>
                    <td className="p-3">45-Day SB 1079 Window</td>
                    <td className="p-3">0 Days (Cal. Civ. Code § 2924m)</td>
                    <td className="p-3">$1.10 per $1,000 transfer tax</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-ink">Florida (FL)</td>
                    <td className="p-3">Judicial Foreclosure</td>
                    <td className="p-3">5% Electronic Tender</td>
                    <td className="p-3">10-Day Certificate of Title</td>
                    <td className="p-3">0 Days (Cert. of Sale cut-off)</td>
                    <td className="p-3">Fla. Stat. § 201.02 ($0.70 / $100 doc stamps) + 1.5% registry</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-ink">Georgia (GA)</td>
                    <td className="p-3">Non-Judicial Deed of Trust</td>
                    <td className="p-3">10% Certified Deposit</td>
                    <td className="p-3">Immediate (First Tuesday)</td>
                    <td className="p-3">0 Days mortgage; 1 yr tax deed</td>
                    <td className="p-3">$1.00 per $1,000 transfer tax</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-ink">Illinois (IL)</td>
                    <td className="p-3">Judicial Foreclosure</td>
                    <td className="p-3">10% Certified Funds</td>
                    <td className="p-3">30-Day Confirmation Motion</td>
                    <td className="p-3">30–90 Days residential (735 ILCS 5/15)</td>
                    <td className="p-3">$1.50 per $1,000 combined stamps</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-ink">New Jersey (NJ)</td>
                    <td className="p-3">Judicial Sheriff Sale</td>
                    <td className="p-3">20% Certified Knockdown</td>
                    <td className="p-3">10-Day Objection / Redemption</td>
                    <td className="p-3">10 Days (R. 4:65-5)</td>
                    <td className="p-3">Tiered commission (2-6%) + ~1% transfer fee</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-ink">New York (NY)</td>
                    <td className="p-3">Judicial Referee Sale</td>
                    <td className="p-3">10% Certified Check</td>
                    <td className="p-3">30-Day Referee Report</td>
                    <td className="p-3">0 Days (Gavel fall cut-off)</td>
                    <td className="p-3">$4.00 per $1,000 state transfer tax</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-ink">North Carolina (NC)</td>
                    <td className="p-3">Non-Judicial Trustee</td>
                    <td className="p-3">5% Minimum ($750 floor)</td>
                    <td className="p-3">10-Day Rolling Upset Bid</td>
                    <td className="p-3">10-Day Upset Period (N.C.G.S. § 45-21)</td>
                    <td className="p-3">$2.00 per $1,000 excise tax</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-ink">Ohio (OH)</td>
                    <td className="p-3">Judicial Sheriff Sale</td>
                    <td className="p-3">10% Certified Deposit</td>
                    <td className="p-3">30-Day Confirmation Entry</td>
                    <td className="p-3">Expires at confirmation (R.C. 2329.33)</td>
                    <td className="p-3">1.5% sheriff poundage + $4/k conveyance</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-ink">Pennsylvania (PA)</td>
                    <td className="p-3">Judicial Sheriff Sale</td>
                    <td className="p-3">10% Day-of Certified</td>
                    <td className="p-3">30-Day Schedule of Distribution</td>
                    <td className="p-3">0 Days mortgage; 9 mo tax claims</td>
                    <td className="p-3">2% realty transfer tax + 2% poundage</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-ink">Texas (TX)</td>
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

          {/* 3. The catches */}
          <div className="space-y-8">
            <SectionHeading eyebrow="Step 3" tone="catch" title="The catches to check" align="left">
              Missing one of these can cost you your deposit or more. Check each one for the specific property.
            </SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2">
              {catches.map((c, i) => (
                <div key={c.title} className={catchCard}>
                  <h3 className="text-base font-semibold text-[var(--catch-ink)]">{i + 1}. {c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--catch-ink)]/85">{c.body}</p>
                </div>
              ))}
              <div className={`${catchCard} sm:col-span-2`}>
                <h3 className="text-base font-semibold text-[var(--catch-ink)]">7. Who lives there (Protecting Tenants at Foreclosure Act, 12 U.S.C. § 5220)</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--catch-ink)]/85">
                  Winning the sale does not give you the keys right away. Under this federal law and state tenant laws, genuine tenants must get at least 90 days&apos; written notice to leave before eviction can begin.
                </p>
              </div>
            </div>
          </div>

          {/* 4. Checklist */}
          <div className="space-y-8">
            <SectionHeading eyebrow="Step 4" title="Before you bid: your checklist" align="left">
              Work down the list for every property.
            </SectionHeading>
            <ul className={`${card} space-y-3`}>
              {checklist.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                  <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line-strong bg-card" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* 5. Next step */}
          <div className="rounded-3xl bg-ink p-8 text-white sm:p-10">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white/60">Step 5</p>
            <h2 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-[34px]">Find a sale and read its catch</h2>
            <p className="mt-3 max-w-[560px] text-[16px] leading-relaxed text-white/75">
              Search is free. Every listing shows the catch first. Members can add hunts with email alerts.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/listings" className="rounded-xl bg-card px-5 py-3 text-sm font-semibold text-ink transition hover:bg-paper">
                Search listings
              </Link>
              <Link href="/states" className="rounded-xl border border-white/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Browse by state
              </Link>
            </div>
          </div>
        </section>

        {/* Changelog */}
        <section id="changelog" className="scroll-mt-12 space-y-8 border-t border-line pt-14">
          <SectionHeading eyebrow="Changelog" title="What's new" align="left" />
          <div className="space-y-4">
            <div className={`${card} space-y-3`}>
              <span className="inline-block rounded-full bg-line px-3 py-1 text-xs font-bold text-ink-2">October 2026</span>
              <h3 className="text-base font-semibold text-ink">Clearer listings</h3>
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2">
                <li>Listings that don&apos;t publish a value no longer get a made-up one.</li>
              </ul>
            </div>
            <div className={`${card} space-y-3`}>
              <span className="inline-block rounded-full bg-line px-3 py-1 text-xs font-bold text-ink-2">September 2026</span>
              <h3 className="text-base font-semibold text-ink">Risk checks</h3>
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2">
                <li>Added a check for senior mortgages and city liens that can stay with the property.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-14 flex flex-wrap gap-4 border-t border-line pt-8">
        <Link href="/listings" className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-2">
          Browse listings
        </Link>
        <Link href="/contact" className="rounded-xl border border-line-strong bg-card px-5 py-3 text-sm font-semibold text-ink-2 transition hover:bg-paper">
          Send us feedback
        </Link>
      </div>
    </main>
  );
}
