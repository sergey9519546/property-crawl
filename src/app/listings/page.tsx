import React from "react";
import { Suspense } from "react";
import { Metadata } from "next";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { DiscoveryWorkbench, type DiscoveryPayload } from "@/components/listings/discovery-workbench";
import { DataModeBanner } from "@/components/site/data-mode-banner";
import { discoverySearchParams, readDiscoveryFilters } from "@/lib/discovery-query";

export const metadata: Metadata = {
  title: "Distressed Property Evidence Feed | PerfectProperty",
  description: "Research source-observed and clearly labeled demonstration foreclosure, sheriff-sale, and government-property records. Unknown auction and title facts remain explicit.",
  openGraph: {
    title: "Distressed Property Evidence Feed | PerfectProperty",
    description: "A source-aware property research feed with exact-record links, evidence gaps, and explicit model provenance.",
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
    <main className="relative min-h-screen max-w-full overflow-x-hidden bg-[#F5F6F7] text-[#111827]">
      <DataModeBanner />
      <Suspense fallback={<div className="grid min-h-[60vh] place-items-center text-sm text-slate-500">Loading discovery…</div>}>
        <DiscoveryWorkbench initialPayload={initialPayload} />
      </Suspense>
    </main>
    </WorkspaceShell>
  );
}
