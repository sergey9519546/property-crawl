import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Target, Cpu, ShieldCheck, Database, Award, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "About PerfectProperty — Find Foreclosure and Government-Sold Homes",
  description:
    "Sheriff sales, bank-owned homes, tax sales and government-sold property in one place, with the risks spelled out.",
};


export default function AboutPage() {
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
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Who we are</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
          Find auction and bank-owned homes, and know the catch before you bid
        </h1>
        <p className="mt-3 text-base text-slate-600 leading-relaxed">
          PerfectProperty is for flippers, small landlords and first-time auction buyers. We bring foreclosure,
          sheriff, tax and government-sold properties into one place and spell out the risks in plain English.
        </p>
      </div>

      <div className="mt-10 space-y-12 text-sm leading-7 text-slate-700">
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-950 flex items-center gap-2">
            <Target className="h-5 w-5 text-indigo-600" />
            Why we built it
          </h2>
          <p>
            Distressed property is spread across county websites, court notices and government pages. It is easy to miss
            a sale, and easy to miss the fine print. Buyers sometimes win an auction and then find a second mortgage
            that stays with the property. Others find a right of redemption (a window when the old owner can take it back).
          </p>
          <p>
            We put the sales in one list, map and calendar, and show the risks next to each one.
          </p>
        </section>

        <section className="space-y-6">
          <h2 className="text-xl font-bold text-slate-950 flex items-center gap-2">
            <Cpu className="h-5 w-5 text-indigo-600" />
            What it does
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
              <h3 className="font-bold text-slate-950 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-extrabold text-indigo-800">1</span>
                Find
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Search a city, county or ZIP and see upcoming sales from many public sources. It is free and needs no account.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
              <h3 className="font-bold text-slate-950 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-extrabold text-indigo-800">2</span>
                Judge
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Each listing can show a Deal Score and &ldquo;the catch&rdquo;: risks such as redemption periods, liens and
                occupancy. Listings link to the original notice where one is published.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
              <h3 className="font-bold text-slate-950 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-extrabold text-indigo-800">3</span>
                Get alerts
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Members start a hunt and get an email when a new listing fits, or when a saved one changes its date or opening bid.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
              <h3 className="font-bold text-slate-950 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-extrabold text-indigo-800">4</span>
                Verify
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                We point you to what to check before you bid: title, condition and sale terms.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6 space-y-4">
          <h2 className="text-lg font-bold text-emerald-950 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-700" />
            What it does not do
          </h2>
          <p className="text-xs leading-relaxed text-emerald-900">
            We help you find and size up a property. We don&apos;t replace a title search or an inspection, we don&apos;t bid for
            you, and we don&apos;t cover every county. Always check title before you bid.
          </p>
          <div className="grid gap-2 sm:grid-cols-3 text-xs font-semibold text-emerald-950">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-100/70 p-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" /> Zero Cold Calls or Robocalls
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-emerald-100/70 p-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" /> We never contact homeowners
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-emerald-100/70 p-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" /> Public sources only
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
          href="/resources#knowledge-base"
          className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
        >
          See where listings come from
        </Link>
      </div>
    </main>
  );
}
