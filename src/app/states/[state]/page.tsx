import Link from "next/link";
import { countyToSlug } from "@/lib/county-seo";

export const dynamic = "force-dynamic";

type CountyRow = { county: string; count: number; sources: string[] };

type CoveragePayload = {
  liveByState?: {
    byStateTotal?: Record<string, unknown>;
    byCounty?: Record<string, unknown>;
    readError?: string | null;
  };
};

async function loadStateCounties(state: string): Promise<{ total: number; counties: CountyRow[]; error: string | null }> {
  const apiUrl = process.env.PROPERTY_API_URL || "http://localhost:3000";
  try {
    const response = await fetch(`${apiUrl}/api/coverage`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { total: 0, counties: [], error: "We couldn't load this state's counties right now. Please try again in a minute." };
    const body = (await response.json()) as CoveragePayload;
    if (body.liveByState?.readError) return { total: 0, counties: [], error: "We couldn't load this state's counties right now. Please try again in a minute." };
    const totalRaw = body.liveByState?.byStateTotal?.[state];
    const total = typeof totalRaw === "number" && Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0;
    const raw = body.liveByState?.byCounty?.[state];
    const counties = Array.isArray(raw)
      ? raw.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const county = (row as { county?: unknown }).county;
          const count = (row as { count?: unknown }).count;
          const sources = (row as { sources?: unknown }).sources;
          if (typeof county !== "string" || county.trim().length < 2) return [];
          if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return [];
          const names = Array.isArray(sources)
            ? sources.filter((item): item is string => typeof item === "string" && item.length > 0)
            : [];
          return [{ county, count, sources: names }];
        })
      : [];
    return { total, counties, error: null };
  } catch {
    return { total: 0, counties: [], error: "We couldn't load this state's counties right now. Please try again in a minute." };
  }
}

export default async function StateCountiesPage({ params }: { params: Promise<{ state: string }> }) {
  const { state: raw } = await params;
  const state = /^[A-Za-z]{2}$/.test(raw || "") ? raw.toUpperCase() : null;
  if (!state) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Browse by state</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">We don't recognize that state</h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">Use a two-letter state code, like OH or FL.</p>
        <Link href="/states" className="mt-6 inline-block text-sm font-semibold text-slate-950 underline">All states</Link>
      </main>
    );
  }

  const { total, counties, error } = await loadStateCounties(state);
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Browse by state</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Foreclosure and government property auctions in {state}</h1>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        Pick a county to see its upcoming sales and listings. Under each county name you can see where the sale notices come from.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/states" className="font-semibold text-slate-950 underline">All states</Link>
        {total > 0 ? (
          <>
            <span className="text-slate-400"> · </span>
            <Link href={`/listings?state=${state}`} className="font-semibold text-slate-950 underline">Browse all {total} {state} listings</Link>
          </>
        ) : null}
      </p>
      {error ? (
        <p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{error}</p>
      ) : counties.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">No listings in {state} show a county yet. Browse all {state} listings above.</p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {counties.map((row) => (
            <li key={row.county}>
              <Link
                href={`/states/${state}/${countyToSlug(row.county)}`}
                className="block px-4 py-3 text-sm hover:bg-slate-50"
              >
                <span className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-slate-950">{row.county}</span>
                  <span className="tabular-nums text-slate-600">{row.count} {row.count === 1 ? "listing" : "listings"}</span>
                </span>
                {row.sources.length > 0 ? (
                  <span className="mt-1 block text-xs text-slate-500">{row.sources.join(", ")}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
