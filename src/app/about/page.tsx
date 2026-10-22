import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Target, Cpu, ShieldCheck, Database, Award, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "About PerfectProperty — Evidence-First Distressed Real Estate Discovery",
  description:
    "The mission, architecture, and $0-liability engineering principles behind PerfectProperty: Zillow for distressed real estate with an AI that reads the fine print.",
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
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Our Mission & Principles</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
          About PerfectProperty
        </h1>
        <p className="mt-3 text-base text-slate-600 leading-relaxed">
          &ldquo;Zillow for distressed and government-sold property, with an AI that reads the fine print and tells you if each one is actually a deal — and what the catch is.&rdquo;
        </p>
      </div>

      <div className="mt-10 space-y-12 text-sm leading-7 text-slate-700">
        {/* The Problem */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-950 flex items-center gap-2">
            <Target className="h-5 w-5 text-indigo-600" />
            The Broken Legacy of Distressed Property
          </h2>
          <p>
            For decades, investors seeking distressed real estate—sheriff sales, tax deed sales, HUD/REO homes,
            and federal seized assets—have been forced to rely on expensive legacy aggregators charging $40–$50/month.
            These platforms suffer from fatal shortcomings: manual data entry backlogs, hallucinated bid activity
            (like the infamous &ldquo;10 bids placed&rdquo; artifact appearing across 99% of entries), and zero explanation
            of statutory risks.
          </p>
          <p>
            Buyers routinely win an auction only to discover an uncancelled second mortgage, an unexpired IRS 120-day
            right of redemption, or an automatic bankruptcy stay that renders the certificate of sale void.
            PerfectProperty was engineered from the ground up to solve this information asymmetry through
            <strong> evidence-first discovery and forensic document analysis</strong>.
          </p>
        </section>

        {/* The 5 Architectural Pillars */}
        <section className="space-y-6">
          <h2 className="text-xl font-bold text-slate-950 flex items-center gap-2">
            <Cpu className="h-5 w-5 text-indigo-600" />
            The Five Verified AI & Data Innovations
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
              <h3 className="font-bold text-slate-950 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-extrabold text-indigo-800">1</span>
                Email-as-API Ingestion
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                State press association smart search subscriptions ingest statutory publication notices directly via IMAP,
                allowing zero-cost, legal-safe ingestion within hours of publication without bot-scraping risks.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
              <h3 className="font-bold text-slate-950 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-extrabold text-indigo-800">2</span>
                Platform-Level County Parsers
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Rather than writing hundreds of brittle county scrapers, we build unified parsers for the municipal platforms
                that counties buy (CivilView for NJ, Realauction for OH, AcclaimWeb for NV).
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
              <h3 className="font-bold text-slate-950 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-extrabold text-indigo-800">3</span>
                Stateless Scrapling Anti-Detect
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Stateless streaming Scrapling spider workers run underneath our Node.js coordinator, isolating TLS sessions
                and cookie jars while fail-closing immediately on robots exclusions.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
              <h3 className="font-bold text-slate-950 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-extrabold text-indigo-800">4</span>
                Free Government Enrichment Stack
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                US Census Geocoder, County ArcGIS parcel endpoints, and FHFA House Price Index data replace thousands in monthly API fees
                with authoritative public ground-truth.
              </p>
            </div>
          </div>
        </section>

        {/* The $0 Liability Moat */}
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6 space-y-4">
          <h2 className="text-lg font-bold text-emerald-950 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-700" />
            The $0 Liability Moat: Non-Brokerage & Non-Interference
          </h2>
          <p className="text-xs leading-relaxed text-emerald-900">
            We are strictly a discovery and research tool. We never touch transactions, never hold earnest deposits,
            never sell phone numbers, and never contact homeowners. This single design decision completely avoids the
            Telephone Consumer Protection Act (TCPA), California Civil Code § 1695 mortgage rescue regulations,
            and state real estate licensing requirements.
          </p>
          <div className="grid gap-2 sm:grid-cols-3 text-xs font-semibold text-emerald-950">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-100/70 p-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" /> Zero Cold Calls or Robocalls
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-emerald-100/70 p-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" /> Zero Homeowner Solicitation
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-emerald-100/70 p-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" /> 100% Public Source Provenance
            </div>
          </div>
        </section>
      </div>

      <div className="mt-12 flex flex-wrap gap-4 border-t border-slate-200 pt-8">
        <Link
          href="/listings"
          className="rounded-xl bg-[#0F172A] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1E293B] transition"
        >
          Explore Listing Workspace
        </Link>
        <Link
          href="/sources"
          className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
        >
          View Source Radar
        </Link>
      </div>
    </main>
  );
}
