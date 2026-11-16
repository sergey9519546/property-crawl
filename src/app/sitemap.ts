import { createRequire } from "node:module";
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
const LISTINGS_PAGE_SIZE = 1_000;
const MAX_LISTING_PAGES = 25;
const MAX_LISTING_URLS = LISTINGS_PAGE_SIZE * MAX_LISTING_PAGES;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_ORIGIN || 'https://property-crawl.onrender.com';
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: `${baseUrl}/listings`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${baseUrl}/states`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
    { url: `${baseUrl}/sources`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/activity`, lastModified: now, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${baseUrl}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/resources`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/case-studies`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/enterprise`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/security`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${baseUrl}/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${baseUrl}/register`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${baseUrl}/sign-in`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  // A live inventory is a bonus, not a requirement. If it cannot be read, the
  // honest sitemap is the static pages alone - never a stand-in list of records
  // that do not exist.
  const listingPages: MetadataRoute.Sitemap = [];
  const seenListingIds = new Set<string>();
  let countyPages: MetadataRoute.Sitemap = [];
  try {
    for (let page = 0; page < MAX_LISTING_PAGES && listingPages.length < MAX_LISTING_URLS; page++) {
      const offset = page * LISTINGS_PAGE_SIZE;
      const response = await fetch(`${API_BASE}/api/listings?limit=${LISTINGS_PAGE_SIZE}&offset=${offset}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) break;
      const payload = await response.json();
      const records: unknown[] = Array.isArray(payload?.listings) ? payload.listings : [];
      if (records.length === 0) break;

      let addedOnPage = 0;
      for (const record of records) {
        if (
          record &&
          typeof (record as { id?: unknown }).id === 'string' &&
          (record as { id: string }).id
        ) {
          const typed = record as { id: string; saleDate?: string | null };
          if (seenListingIds.has(typed.id)) continue;
          seenListingIds.add(typed.id);
          addedOnPage++;
          listingPages.push({
            url: `${baseUrl}/listings/${encodeURIComponent(typed.id)}`,
            lastModified: typed.saleDate && Number.isFinite(Date.parse(typed.saleDate)) ? new Date(typed.saleDate) : now,
            changeFrequency: 'daily',
            priority: 0.8,
          });
          if (listingPages.length >= MAX_LISTING_URLS) break;
        }
      }

      const total = typeof payload?.total === 'number' && Number.isFinite(payload.total) ? payload.total : null;
      if (records.length < LISTINGS_PAGE_SIZE || addedOnPage === 0) break;
      if (total !== null && offset + records.length >= total) break;
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
    // Remote coverage unreachable; fall back to local matrix
  }

  if (statePages.length === 0) {
    try {
      const req = createRequire(process.cwd() + "/package.json");
      const matrix = req("./server/discovery/coverage-matrix").summarize();
      const totals = matrix.liveByState?.byStateTotal || {};
      statePages = Object.entries(totals as Record<string, unknown>).flatMap(([state, count]) => {
        if (!/^[A-Z]{2}$/.test(state) || typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return [];
        return [{
          url: `${baseUrl}/states/${state}`,
          lastModified: now,
          changeFrequency: 'daily' as const,
          priority: 0.5,
        }];
      });
      const byCounty = matrix.liveByState?.byCounty || {};
      countyPages = Object.entries(byCounty as Record<string, unknown>).flatMap(([state, rows]) =>
        /^[A-Z]{2}$/.test(state) && Array.isArray(rows)
          ? rows.flatMap((row: { county?: unknown; count?: unknown }) => {
              const slug = typeof row?.county === 'string' ? countyToSlug(row.county) : '';
              return slug && typeof row.count === 'number' && row.count > 0
                ? [{ url: `${baseUrl}/states/${state}/${slug}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.7 }]
                : [];
            })
          : []);
    } catch {
      // Local matrix unavailable
    }
  }

  return [...staticPages, ...statePages, ...countyPages, ...listingPages];
}
