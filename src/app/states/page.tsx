import Link from "next/link";

export const dynamic = "force-dynamic";

type CoveragePayload = {
  liveByState?: {
    byStateTotal?: Record<string, unknown>;
    readError?: string | null;
  };
};

async function loadStateCounts(): Promise<{ rows: { state: string; count: number }[]; error: string | null }> {
  const apiUrl = process.env.PROPERTY_API_URL || "http://localhost:3000";
  try {
    const response = await fetch(`${apiUrl}/api/coverage`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { rows: [], error: "We couldn't load the list of states right now. Please try again in a minute." };
    const body = (await response.json()) as CoveragePayload;
    if (body.liveByState?.readError) return { rows: [], error: "We couldn't load the list of states right now. Please try again in a minute." };
    const totals = body.liveByState?.byStateTotal || {};
    const rows = Object.entries(totals)
      .flatMap(([state, count]) => {
        if (!/^[A-Z]{2}$/.test(state) || typeof count !== "number" || !Number.isFinite(count) || count <= 0) return [];
        return [{ state, count }];
      })
      .sort((left, right) => right.count - left.count || left.state.localeCompare(right.state));
    return { rows, error: null };
  } catch {
    return { rows: [], error: "We couldn't load the list of states right now. Please try again in a minute." };
  }
}

export default async function StatesPage() {
  const { rows, error } = await loadStateCounts();
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Browse by state</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Foreclosure and government property auctions by state</h1>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        Pick a state to see its counties, upcoming sales and listings. Sheriff sales, tax sales, bank-owned and government homes are included. Only states with current listings appear here.
      </p>
      {error ? (
        <p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{error}</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">No states have listings right now. Check back soon.</p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {rows.map((row) => (
            <li key={row.state}>
              <Link href={`/states/${row.state}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-50">
                <span className="font-semibold text-slate-950">{row.state}</span>
                <span className="tabular-nums text-slate-600">{row.count} {row.count === 1 ? "listing" : "listings"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
