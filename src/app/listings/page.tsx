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

const CARD_SSR_IMAGES_CAP = 2;

function compactListingForSsr(item: Record<string, unknown>) {
  const {
    hudSafmr: _hudSafmr,
    assessorParcel: _assessorParcel,
    raw: _raw,
    cashToCloseDetails: _cashToCloseDetails,
    identityFallback: _identityFallback,
    seniorLienWarning: _seniorLienWarning,
    provenance,
    researchQuality,
    opportunity,
    images,
    ...rest
  } = item;

  let compactProvenance: Record<string, unknown> | undefined;
  if (provenance && typeof provenance === "object") {
    const p = provenance as Record<string, unknown>;
    const media = p.media && typeof p.media === "object" ? (p.media as Record<string, unknown>) : null;
    const derived = p.derivedFields && typeof p.derivedFields === "object"
      ? (p.derivedFields as Record<string, unknown>)
      : null;
    compactProvenance = {
      ...(p.origin !== undefined ? { origin: p.origin } : {}),
      ...(p.observed !== undefined ? { observed: p.observed } : {}),
      ...(p.publisher !== undefined ? { publisher: p.publisher } : {}),
      ...(p.recordId !== undefined ? { recordId: p.recordId } : {}),
      ...(p.observedAt !== undefined ? { observedAt: p.observedAt } : {}),
      ...(media && (media.photo !== undefined || media.secondary !== undefined)
        ? {
            media: {
              ...(media.photo !== undefined ? { photo: media.photo } : {}),
              ...(media.secondary !== undefined ? { secondary: media.secondary } : {}),
            },
          }
        : {}),
      ...(derived && (derived.openingBid !== undefined || derived.saleDate !== undefined)
        ? {
            derivedFields: {
              ...(derived.openingBid ? { openingBid: true } : {}),
              ...(derived.saleDate ? { saleDate: true } : {}),
            },
          }
        : {}),
    };
  }

  let compactRq: Record<string, unknown> | undefined;
  if (researchQuality && typeof researchQuality === "object") {
    const rq = researchQuality as Record<string, unknown>;
    compactRq = {
      ...(rq.score !== undefined ? { score: rq.score } : {}),
      ...(rq.band !== undefined ? { band: rq.band } : {}),
      ...(rq.note !== undefined ? { note: rq.note } : {}),
    };
  }

  let compactOpp: Record<string, unknown> | undefined;
  if (opportunity && typeof opportunity === "object") {
    const opp = opportunity as Record<string, unknown>;
    compactOpp = {
      ...(opp.dealScore !== undefined ? { dealScore: opp.dealScore } : {}),
      ...(opp.urgency !== undefined ? { urgency: opp.urgency } : {}),
      ...(opp.daysToSale !== undefined ? { daysToSale: opp.daysToSale } : {}),
      ...(opp.rank !== undefined ? { rank: opp.rank } : {}),
      ...(opp.note !== undefined ? { note: opp.note } : {}),
      ...(opp.valuationBasis !== undefined ? { valuationBasis: opp.valuationBasis } : {}),
    };
  }

  return {
    ...rest,
    ...(Array.isArray(images) && images.length > 0
      ? { images: images.slice(0, CARD_SSR_IMAGES_CAP) }
      : {}),
    ...(compactProvenance ? { provenance: compactProvenance } : {}),
    ...(compactRq ? { researchQuality: compactRq } : {}),
    ...(compactOpp ? { opportunity: compactOpp } : {}),
  };
}

function compactInitialPayloadForSsr(payload: DiscoveryPayload): DiscoveryPayload {
  return {
    ...payload,
    listings: Array.isArray(payload.listings)
      ? (payload.listings.map((item) =>
          compactListingForSsr(item as unknown as Record<string, unknown>),
        ) as unknown as DiscoveryPayload["listings"])
      : [],
  };
}

async function loadInitialListings(raw: Record<string, string | string[] | undefined>): Promise<DiscoveryPayload | null> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw || {})) {
    const text = Array.isArray(value) ? value[0] : value;
    if (text) params.set(key, text);
  }
  const filters = readDiscoveryFilters(params);
  const ssrFacets = filters.state
    ? "state,county,source,type,program,lifecycle,occupancy,freshness"
    : "state,source,type,program,lifecycle,occupancy,freshness";
  const query = discoverySearchParams(filters, {
    limit: filters.view === "calendar" ? 1000 : 24,
    facets: ssrFacets,
  });
  const apiUrl = process.env.PROPERTY_API_URL || "http://localhost:3000";
  try {
    const response = await fetch(`${apiUrl}/api/listings?${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as DiscoveryPayload;
    return Array.isArray(payload?.listings) ? compactInitialPayloadForSsr(payload) : null;
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
