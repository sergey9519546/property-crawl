import React from "react";
import { Suspense } from "react";
import { Metadata } from "next";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { DiscoveryWorkbench, type DiscoveryPayload } from "@/components/listings/discovery-workbench";
import { DataModeBanner } from "@/components/site/data-mode-banner";
import { discoverySearchParams, readDiscoveryFilters } from "@/lib/discovery-query";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const title = locale === "en" ? "Foreclosure Auctions & Distressed Homes | PerfectProperty" : m.meta.listingsTitle;
  const description = m.meta.listingsDescription;
  return {
    title,
    description,
    alternates: {
      canonical: "/listings",
    },
    openGraph: {
      title,
      description,
      url: "/listings",
      siteName: "PerfectProperty",
      type: "website",
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}

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
      signal: AbortSignal.timeout(15_000),
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
    <main id="main-content" tabIndex={-1} className="relative min-h-screen max-w-full overflow-x-hidden bg-paper text-ink outline-none">
      <DataModeBanner />
      <Suspense fallback={<div className="grid min-h-[60vh] place-items-center text-sm text-ink-3">Loading listings…</div>}>
        <DiscoveryWorkbench initialPayload={initialPayload} />
      </Suspense>
    </main>
    </WorkspaceShell>
  );
}
