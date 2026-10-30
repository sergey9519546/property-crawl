import Link from "next/link";
import { Plus } from "lucide-react";
import { SectionHeading } from "./section-heading";

const QUESTIONS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Is it free?",
    a: <>Yes. Search, the map, the sale calendar, listing pages and the catch are free, with no account. Members pay for hunts, email alerts and an account watchlist. <Link href="/#pricing" className="font-semibold text-ink underline underline-offset-4">Compare plans</Link>.</>,
  },
  {
    q: "Where do the listings come from?",
    a: "Public sale notices and government listings: HUD homes, foreclosure auctions, sheriff sales, USDA homes, GSA sales, and IRS and Treasury seizures. More sources are on our list but don't supply listings yet. Each listing links to its source when one is published.",
  },
  {
    q: "Do you cover every county?",
    a: <>No. Coverage depends on what each county publishes. <Link href="/states" className="font-semibold text-ink underline underline-offset-4">See which states and counties have listings now</Link>.</>,
  },
  {
    q: "What is “the catch”?",
    a: "A plain-English list of what could cost you on a listing: whether someone lives there, how long the former owner can buy it back, liens that may survive the sale, and the deposit. If the listing leaves one of these out, that goes on the list too.",
  },
  {
    q: "What is a redemption period?",
    a: "Some states let the former owner buy the property back for a set time after the sale. You can win the auction and still lose the property, so check the period before you bid.",
  },
  {
    q: "What is the Deal Score?",
    a: "A quick way to sort listings. It compares the opening bid to the published value range. It is not an appraisal, and when a listing has no value range we leave it blank instead of guessing.",
  },
  {
    q: "Does this replace a title search or inspection?",
    a: "No. We don't sell title reports or sold-price comparables. Before you bid, order a title search and look at the property yourself.",
  },
  {
    q: "Do I need cash on sale day?",
    a: "Often, yes. Many sales want a deposit in certified funds on the day, and the rest soon after. Terms vary by sale, and the listing shows them when they are published.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 px-5 pt-24 pb-28 lg:px-8">
      <div className="mx-auto max-w-[820px]">
        <SectionHeading eyebrow="Questions" title="What first-time bidders ask us.">
          Short answers. The <Link href="/resources" className="font-semibold text-ink underline underline-offset-4">buyer&apos;s guide</Link> has the long ones.
        </SectionHeading>
        <div className="mt-12 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-card">
          {QUESTIONS.map(({ q, a }) => (
            <details key={q} className="faq-item group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 px-6 py-5 text-[16px] font-semibold text-ink transition-colors hover:bg-paper sm:px-7">
                {q}
                <Plus aria-hidden className="faq-icon h-5 w-5 shrink-0 text-ink-3 transition-transform duration-200" />
              </summary>
              <p className="px-6 pb-6 text-[15px] leading-7 text-ink-2 sm:px-7">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
