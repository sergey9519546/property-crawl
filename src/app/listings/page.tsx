import React from "react";
import { Suspense } from "react";
import { Metadata } from "next";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { DiscoveryWorkbench, type DiscoveryPayload } from "@/components/listings/discovery-workbench";
import { DataModeBanner } from "@/components/site/data-mode-banner";
import { discoverySearchParams, readDiscoveryFilters } from "@/lib/discovery-query";

export const metadata: Metadata = {
  title: "Search Foreclosure and Auction Properties | PerfectProperty",
  description: "Search foreclosure, sheriff-sale, tax-sale and government-sold properties by state, county or ZIP. See the sale date, opening bid and what to check before you bid.",
  openGraph: {
    title: "Search Foreclosure and Auction Properties | PerfectProperty",
    description: "Search foreclosure and government-sold properties in one list, map and calendar. Each listing links to the original sale notice.",
  }
};

export const dynamic = "force-dynamic";

async function loadInitialListings(raw: Record<string, string | string[] | undefined>): Promise<DiscoveryPayload | null> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw || {})) {
    const text = Array.isArray(value) ? value[0] : value;
    if (text) params.set(key, text);
  }
  const filters = readDiscoveryFilters(params);
  const query = discoverySearchParams(filters, {
    limit: filters.view === "calendar" ? 1000 : 48,
    facets: "state,county,source,type,program,lifecycle,occupancy,freshness",
  });
  const apiUrl = process.env.PROPERTY_API_URL || "http://localhost:3000";
  try {
    const response = await fetch(`${apiUrl}/api/listings?${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as DiscoveryPayload;
    return Array.isArray(payload?.listings) ? payload : null;
  } catch {
    return null;
  }
}

export default async function ListingsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initialPayload = await loadInitialListings(await searchParams);
  return (
    <WorkspaceShell>
    <main className="relative min-h-screen max-w-full overflow-x-hidden bg-paper text-ink">
      <DataModeBanner />
      <Suspense fallback={<div className="grid min-h-[60vh] place-items-center text-sm text-ink-3">Loading listings…</div>}>
        <DiscoveryWorkbench initialPayload={initialPayload} />
      </Suspense>
    </main>
    </WorkspaceShell>
  );
}
