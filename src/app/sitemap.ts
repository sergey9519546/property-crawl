import { countyToSlug } from "@/lib/county-seo";
import type { MetadataRoute } from 'next';

/**
 * The sitemap must never be built from the fixture listings in
 * `components/terminal/property-data.ts`. Those are demo records with invented
 * addresses and valuation bands, and their ids are not database records: this
 * file used to emit `/listings/GA-FULT-60281` and every other fixture id, so
 * the sitemap advertised pages that answer 404. Listing pages come from the live
 * inventory, or from nothing at all.
 */
const API_BASE = process.env.PROPERTY_API_URL || 'http://localhost:3000';
const MAX_LISTING_URLS = 5_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_ORIGIN || 'https://property-crawl.onrender.com';
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: `${baseUrl}/listings`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${baseUrl}/states`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
    { url: `${baseUrl}/sources`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/hunts`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${baseUrl}/research`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${baseUrl}/activity`, lastModified: now, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${baseUrl}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/resources`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/sign-in`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/checkout`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${baseUrl}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  // A live inventory is a bonus, not a requirement. If it cannot be read, the
  // honest sitemap is the static pages alone - never a stand-in list of records
  // that do not exist.
  let listingPages: MetadataRoute.Sitemap = [];
  let countyPages: MetadataRoute.Sitemap = [];
  try {
    const response = await fetch(`${API_BASE}/api/listings?limit=${MAX_LISTING_URLS}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const payload = await response.json();
      const records: unknown[] = Array.isArray(payload?.listings) ? payload.listings : [];
      listingPages = records
        .filter((record): record is { id: string; saleDate?: string | null } =>
          Boolean(record && typeof (record as { id?: unknown }).id === 'string'
            && (record as { id: string }).id))
        .map((record) => ({
          url: `${baseUrl}/listings/${encodeURIComponent(record.id)}`,
          lastModified: record.saleDate ? new Date(record.saleDate) : now,
          changeFrequency: 'daily',
          priority: 0.8,
        }));

    }
  } catch {
    // Inventory unreachable at build time; static pages still describe the site.
  }

  let statePages: MetadataRoute.Sitemap = [];
  try {
    const response = await fetch(`${API_BASE}/api/coverage`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      const payload = await response.json();
      const totals = payload?.liveByState?.byStateTotal;
      if (!payload?.liveByState?.readError && totals && typeof totals === 'object') {
        statePages = Object.entries(totals as Record<string, unknown>).flatMap(([state, count]) => {
          if (!/^[A-Z]{2}$/.test(state) || typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return [];
          return [{
            url: `${baseUrl}/states/${state}`,
            lastModified: now,
            changeFrequency: 'daily' as const,
            priority: 0.5,
          }];
        });
        // Every county with a live record, from the same coverage rollup the
        // state pages render, so no county is dropped past a listing cap.
        const byCounty = payload?.liveByState?.byCounty;
        if (byCounty && typeof byCounty === 'object') {
          countyPages = Object.entries(byCounty as Record<string, unknown>).flatMap(([state, rows]) =>
            /^[A-Z]{2}$/.test(state) && Array.isArray(rows)
              ? rows.flatMap((row: { county?: unknown; count?: unknown }) => {
                  const slug = typeof row?.county === 'string' ? countyToSlug(row.county) : '';
                  return slug && typeof row.count === 'number' && row.count > 0
                    ? [{ url: `${baseUrl}/states/${state}/${slug}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.7 }]
                    : [];
                })
              : []);
        }
      }
    }
  } catch {
    // Coverage unreachable: omit state URLs. Do not invent them.
  }

  return [...staticPages, ...statePages, ...countyPages, ...listingPages];
}