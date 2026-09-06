import Link from "next/link";
import { ArrowRight, Bookmark, Search, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/site/logo";

export function LocalWorkspaceEntry({ returning = false }: { returning?: boolean }) {
  return <main className="grid min-h-screen place-items-center bg-[#F5F6F7] px-5 py-16">
    <div className="w-full max-w-lg">
      <Link href="/" aria-label="PerfectProperty home" className="mb-8 flex justify-center"><Logo className="text-lg" /></Link>
      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">Local beta workspace</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{returning ? "Welcome back" : "Start your property research"}</h1>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">You can explore listings, save properties, and reopen saved searches without an account. Your workspace stays in this browser.</p>
        <ul className="my-7 space-y-4 text-sm text-slate-700">
          <li className="flex gap-3"><Search className="h-5 w-5 shrink-0 text-emerald-700" /> Search the available inventory and inspect exact source records.</li>
          <li className="flex gap-3"><Bookmark className="h-5 w-5 shrink-0 text-emerald-700" /> Keep a local watchlist and export your research.</li>
          <li className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-emerald-700" /> No password requested. Cloud accounts and cross-device sync are not connected yet.</li>
        </ul>
        <Link href="/listings" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white hover:bg-slate-800">Open research workspace <ArrowRight className="h-4 w-4" /></Link>
        <p className="mt-4 text-xs leading-relaxed text-slate-500">Clearing browser data removes local saves. Export important research before changing devices.</p>
      </section>
    </div>
  </main>;
}
