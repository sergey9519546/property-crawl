import Link from "next/link";
import { countyToSlug, getStatutoryRedemption } from "@/lib/county-seo";
import { CountyRow, loadStateCounties as loadStateCountiesImpl } from "@/lib/state-coverage";

export const dynamic = "force-dynamic";

export async function loadStateCounties(state: string): Promise<{ total: number; counties: CountyRow[]; error: string | null }> {
  return loadStateCountiesImpl(state);
}

export default async function StateCountiesPage({ params }: { params: Promise<{ state: string }> }) {
  const { state: raw } = await params;
  const state = /^[A-Za-z]{2}$/.test(raw || "") ? raw.toUpperCase() : null;
  if (!state) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-3">Browse by state</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">We don't recognize that state</h1>
        <p className="mt-4 text-sm leading-6 text-ink-3">Use a two-letter state code, like OH or FL.</p>
        <Link href="/states" className="mt-6 inline-block text-sm font-semibold text-ink underline">All states</Link>
      </main>
    );
  }

  const { total, counties, error } = await loadStateCounties(state);
  const redemption = getStatutoryRedemption(state);
  const hasRule = !redemption.label.startsWith("Statutory redemption details require");
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-ink">
      <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-2">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signature ring-1 ring-ink/20" />
        Browse by state
      </p>
      <h1 className="mt-5 text-balance text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[42px]">Foreclosure and government property auctions in {state}</h1>
      <p className="mt-4 max-w-[620px] text-[16px] leading-[1.65] text-ink-2">
        Pick a county to see its upcoming sales and listings. Under each county name you can see where the sale notices come from.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
        {total > 0 ? (
          <Link href={`/listings?state=${state}`} className="rounded-xl bg-ink px-5 py-3 font-semibold text-white transition hover:bg-ink-2">Browse all {total} {state} listings</Link>
        ) : null}
        <Link href="/states" className="font-semibold text-ink underline">All states</Link>
      </div>
      {hasRule ? (
        <div className="mt-6 rounded-2xl border border-[var(--catch-border)] bg-[var(--catch-bg)] p-5 text-[var(--catch-ink)]">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em]">The catch to check in {state}</p>
          <p className="mt-2 text-sm leading-relaxed">{redemption.label}</p>
          <p className="mt-2 text-xs"><Link href="/resources" className="font-semibold underline">More catches in the buyer&apos;s guide</Link></p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-6 rounded-xl border border-catch/30 bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>
      ) : counties.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No listings in {state} show a county yet. Browse all {state} listings above.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-card">
          {counties.map((row) => (
            <li key={row.county}>
              <Link
                href={`/states/${state}/${countyToSlug(row.county)}`}
                className="block px-4 py-3 text-sm hover:bg-paper"
              >
                <span className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-ink">{row.county}</span>
                  <span className="tabular-nums text-ink-3">{row.count} {row.count === 1 ? "listing" : "listings"}</span>
                </span>
                {row.sources.length > 0 ? (
                  <span className="mt-1 block text-xs text-ink-3">{row.sources.join(", ")}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
