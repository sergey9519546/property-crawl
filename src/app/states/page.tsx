import Link from "next/link";
import type { Metadata } from "next";
import { loadStateCounts as loadStateCountsImpl } from "@/lib/state-coverage";

export const metadata: Metadata = {
  title: "Foreclosure Auctions by State | PerfectProperty",
  description: "Browse foreclosure auctions, sheriff sales, and government property dispositions by state. View active inventory, auction dates, and county court records.",
  openGraph: {
    title: "Foreclosure Auctions by State | PerfectProperty",
    description: "Browse foreclosure auctions, sheriff sales, and government property dispositions by state.",
  },
};

export const dynamic = "force-dynamic";

export async function loadStateCounts(): Promise<{ rows: { state: string; count: number }[]; error: string | null }> {
  return loadStateCountsImpl();
}

export default async function StatesPage() {
  const { rows, error } = await loadStateCounts();
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-ink">
      <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-label font-semibold uppercase tracking-[0.12em] text-ink-2">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signature ring-1 ring-ink/20" />
        Browse by state
      </p>
      <h1 className="mt-5 text-balance text-display font-semibold tracking-tight text-ink sm:text-5xl">Foreclosure and government property auctions by state</h1>
      <p className="mt-4 max-w-[620px] text-lead leading-relaxed text-ink-2">
        Pick a state to see its counties, upcoming sales and listings. Sheriff sales, tax sales, bank-owned and government homes are included. Only states with current listings appear here.
      </p>
      <p className="mt-4 rounded-card border border-[var(--catch-border)] bg-[var(--catch-bg)] p-4 text-sm leading-relaxed text-[var(--catch-ink)]">
        Every state has its own rules for deposits, buy-back periods and court review. <Link href="/resources" className="font-semibold underline">Read the buyer&apos;s guide</Link> before you bid.
      </p>
      {error ? (
        <p role="alert" className="mt-6 rounded-control border border-catch/30 bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No states have listings right now. Check back soon.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line overflow-hidden rounded-card border border-line bg-card">
          {rows.map((row) => (
            <li key={row.state}>
              <Link href={`/states/${row.state}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-paper">
                <span className="font-semibold text-ink">{row.state}</span>
                <span className="tabular-nums text-ink-3">{row.count} {row.count === 1 ? "listing" : "listings"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
