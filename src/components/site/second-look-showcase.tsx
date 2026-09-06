"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Clock3, FileCheck2, GitCompareArrows, RotateCcw, SearchCheck } from "lucide-react";

const changes = [
  { id: "bid", label: "Opening amount changed", before: "$186,000", after: "$142,000", reason: "Now below your saved $150,000 threshold" },
  { id: "date", label: "Sale rescheduled", before: "Postponed", after: "Oct 14", reason: "A new published deadline now exists" },
  { id: "document", label: "Missing terms arrived", before: "Unknown", after: "Reviewed", reason: "The sale-terms evidence condition is satisfied" },
] as const;

export function SecondLookShowcase() {
  const [active, setActive] = React.useState<(typeof changes)[number]["id"]>("bid");
  const selected = changes.find((item) => item.id === active) || changes[0];
  return <section id="second-look" className="border-y border-slate-200 bg-[#F5F6F7] px-5 py-20 sm:px-8 sm:py-28">
    <div className="mx-auto max-w-7xl">
      <div className="grid items-end gap-8 lg:grid-cols-[1fr_0.8fr]"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">The find after the first no</p><h2 className="mt-4 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight text-slate-950 sm:text-6xl">PerfectProperty remembers why you passed.</h2></div><div><p className="text-base leading-7 text-slate-600">Second Look watches the evidence behind your decision. When the published fact you cared about changes, the case comes back with the trigger attached. Your decision stays intact until you review it.</p><Link href="/research" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-slate-900 underline hover:text-slate-700">Open the research inbox <ArrowRight size={15} /></Link></div></div>
      <div className="mt-12 overflow-hidden rounded-3xl border border-slate-300 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.10)]">
        <div className="grid lg:grid-cols-[340px_1fr]">
          <div className="border-b border-slate-200 bg-slate-950 p-6 text-white lg:border-b-0 lg:border-r"><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-emerald-400">Illustrative workflow</p><h3 className="mt-3 text-2xl font-semibold">What changed?</h3><p className="mt-2 text-sm leading-6 text-slate-300">Choose the evidence that arrived after a pass decision.</p><div className="mt-6 space-y-2">{changes.map((item) => <button key={item.id} type="button" aria-pressed={active === item.id} onClick={() => setActive(item.id)} className={`w-full rounded-xl border p-4 text-left transition ${active === item.id ? "border-emerald-500 bg-[#0F172A] text-white" : "border-white/15 bg-white/5 hover:bg-white/10"}`}><span className="block text-xs font-bold">{item.label}</span><span className={`mt-1 block text-[11px] ${active === item.id ? "text-emerald-300" : "text-slate-400"}`}>{item.before} → {item.after}</span></button>)}</div></div>
          <div className="p-6 sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-900"><RotateCcw size={12} />Second Look</div><h3 className="mt-4 text-2xl font-semibold text-slate-950">County tax-deed opportunity</h3><p className="mt-1 text-xs text-slate-500">Passed · price above target · decision preserved</p></div><span className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Case revision 8</span></div>
            <div className="mt-7 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><GitCompareArrows size={17} className="text-slate-900" /><p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Previous evidence</p><p className="mt-1 text-lg font-semibold text-slate-950">{selected.before}</p></div><div className="rounded-xl bg-slate-50 p-4"><SearchCheck size={17} className="text-slate-900" /><p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Current evidence</p><p className="mt-1 text-lg font-semibold text-slate-950">{selected.after}</p></div><div className="rounded-xl bg-amber-50 p-4"><Clock3 size={17} className="text-amber-700" /><p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-amber-800">Observed</p><p className="mt-1 text-lg font-semibold text-amber-950">Today, 9:42 AM</p></div></div>
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-5"><p className="flex items-center gap-2 text-sm font-bold text-slate-950"><Check size={16} />Why it returned</p><p className="mt-2 text-sm leading-6 text-slate-700">{selected.reason}. The system cites the new evidence and leaves the earlier pass untouched until the operator decides again.</p></div>
            <div className="mt-5 flex flex-wrap gap-3 text-xs"><span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 font-semibold"><FileCheck2 size={14} />Evidence comparison</span><span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 font-semibold"><Clock3 size={14} />Observation history</span><span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 font-semibold"><GitCompareArrows size={14} />Reproducible packet</span></div>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
