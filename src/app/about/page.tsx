import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { SectionHeading } from "@/components/site/section-heading";

export const metadata: Metadata = {
  title: "About PerfectProperty — Find Foreclosure and Government-Sold Homes",
  description:
    "Sheriff sales, bank-owned homes, tax sales and government-sold property in one place, with the risks spelled out.",
};

const STEPS = [
  {
    title: "Find",
    body: "Search a city, county or ZIP and see upcoming sales from public sources. It is free and needs no account.",
  },
  {
    title: "Read the catch",
    body: "Each listing shows the catch: redemption period, liens that may survive the sale, occupancy and deposit. It also names anything the notice leaves out, and links to the original notice.",
  },
  {
    title: "Get alerts",
    body: "Members start a hunt and get an email when a new listing fits, or when a saved one changes its date or opening bid.",
  },
  {
    title: "Check before you bid",
    body: "We point you to what to verify yourself: title, condition and sale terms.",
  },
];

const PROMISES = ["Zero Cold Calls or Robocalls", "We never contact homeowners", "Public sources only"];

export default function AboutPage() {
  return (
    <main className="relative min-h-screen max-w-full overflow-x-hidden bg-paper text-ink">
      <SiteHeader />

      <section className="px-5 pt-40 pb-12 sm:pt-48 sm:pb-16">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-3 transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" /> Back to PerfectProperty
          </Link>
          <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-2">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            About us
          </p>
          <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl">
            Every deal has a catch. We show it first.
          </h1>
          <p className="mt-5 max-w-[620px] text-pretty text-lg leading-8 text-ink-2">
            PerfectProperty lists foreclosure, sheriff, tax and government-sold property for first-time auction buyers,
            small landlords and flippers. Each listing comes with its risks in plain English.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/listings"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink-2"
            >
              Browse listings <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      <section className="px-5 pb-16">
        <div className="mx-auto max-w-4xl">
          <SectionHeading eyebrow="Why we built it" tone="catch" title="The fine print is where buyers get hurt">
            Sales are spread across county sites, court notices and government pages. Some buyers win an auction, then
            find a second mortgage that stays with the property. Others learn the old owner has a window to take it
            back. We put the sales in one list, map and calendar, and show those risks next to each one.
          </SectionHeading>
        </div>
      </section>

      <section className="px-5 pb-16">
        <div className="mx-auto max-w-4xl">
          <SectionHeading eyebrow="How it works" title="Four steps from search to bid" />
          <ol className="mt-10 grid gap-4 sm:grid-cols-2">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-paper text-sm font-semibold tabular-nums text-ink-2">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-lg font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-7 text-ink-2">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-5 pb-16">
        <div className="mx-auto max-w-4xl rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-10">
          <SectionHeading eyebrow="Our limits" align="left" title="What we do and don't do">
            We help you find and size up a property. We don&apos;t replace a title search or an inspection, we don&apos;t
            bid for you, and we don&apos;t cover every county.
          </SectionHeading>
          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {PROMISES.map((p) => (
              <li
                key={p}
                className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-950"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden /> {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-5 pb-20 sm:pb-28">
        <div className="mx-auto max-w-4xl rounded-3xl bg-ink p-8 text-white sm:p-12">
          <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">See the catch on a real sale</h2>
          <p className="mt-3 max-w-[520px] text-[16px] leading-7 text-slate-300">
            Open any listing and read the catch before anything else.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/listings"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-ink transition-colors hover:bg-slate-100"
            >
              Browse listings <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/resources#knowledge-base"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              See where listings come from
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
