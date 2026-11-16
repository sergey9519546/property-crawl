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
const SITEMAP_CACHE_TTL_MS = 5 * 60 * 1000;
const SITEMAP_BATCH_CONCURRENCY = 4;

export const revalidate = 300;

type ListingRecord = { id: string; saleDate?: string | null };
type CoveragePayload = {
  liveByState?: {
    readError?: unknown;
    byStateTotal?: Record<string, unknown>;
    byCounty?: Record<string, Array<{ county?: unknown; count?: unknown }>>;
  };
};

let cachedSitemap: { expiresAt: number; entries: MetadataRoute.Sitemap } | null = null;
let inflightSitemap: Promise<MetadataRoute.Sitemap> | null = null;

async function fetchListingsPage(page: number): Promise<{ records: ListingRecord[]; total: number | null }> {
  const offset = page * LISTINGS_PAGE_SIZE;
  const response = await fetch(`${API_BASE}/api/listings?limit=${LISTINGS_PAGE_SIZE}&offset=${offset}&summary=1`, {
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return { records: [], total: null };
  const payload = await response.json();
  const rawRecords: unknown[] = Array.isArray(payload?.listings) ? payload.listings : [];
  const records = rawRecords.filter(
    (record): record is ListingRecord => Boolean(record && typeof (record as { id?: unknown }).id === 'string' && (record as { id: string }).id),
  );
  const total = typeof payload?.total === 'number' && Number.isFinite(payload.total) ? payload.total : null;
  return { records, total };
}

async function fetchCoveragePayload(): Promise<CoveragePayload | null> {
  try {
    const response = await fetch(`${API_BASE}/api/coverage`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? ((await response.json()) as CoveragePayload) : null;
  } catch {
    return null;
  }
}

function buildGeographyPages(
  baseUrl: string,
  now: Date,
  totals: unknown,
  byCounty: unknown,
): { statePages: MetadataRoute.Sitemap; countyPages: MetadataRoute.Sitemap } {
  const statePages: MetadataRoute.Sitemap = totals && typeof totals === 'object'
    ? Object.entries(totals as Record<string, unknown>).flatMap(([state, count]) => {
        if (!/^[A-Z]{2}$/.test(state) || typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return [];
        return [{
          url: `${baseUrl}/states/${state}`,
          lastModified: now,
          changeFrequency: 'daily' as const,
          priority: 0.5,
        }];
      })
    : [];
  const countyPages: MetadataRoute.Sitemap = byCounty && typeof byCounty === 'object'
    ? Object.entries(byCounty as Record<string, unknown>).flatMap(([state, rows]) =>
        /^[A-Z]{2}$/.test(state) && Array.isArray(rows)
          ? rows.flatMap((row: { county?: unknown; count?: unknown }) => {
              const slug = typeof row?.county === 'string' ? countyToSlug(row.county) : '';
              return slug && typeof row.count === 'number' && row.count > 0
                ? [{ url: `${baseUrl}/states/${state}/${slug}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.7 }]
                : [];
            })
          : [],
      )
    : [];
  return { statePages, countyPages };
}

async function buildSitemapEntries(): Promise<MetadataRoute.Sitemap> {
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
  const appendRecords = (records: ListingRecord[]) => {
    for (const typed of records) {
      if (seenListingIds.has(typed.id)) continue;
      seenListingIds.add(typed.id);
      listingPages.push({
        url: `${baseUrl}/listings/${encodeURIComponent(typed.id)}`,
        lastModified: typed.saleDate && Number.isFinite(Date.parse(typed.saleDate)) ? new Date(typed.saleDate) : now,
        changeFrequency: 'daily',
        priority: 0.8,
      });
      if (listingPages.length >= MAX_LISTING_URLS) break;
    }
  };

  const [firstPageResult, coveragePayload] = await Promise.allSettled([
    fetchListingsPage(0),
    fetchCoveragePayload(),
  ]);

  try {
    if (firstPageResult.status === 'fulfilled') {
      const firstPage = firstPageResult.value;
      appendRecords(firstPage.records);
      if (firstPage.records.length === LISTINGS_PAGE_SIZE && listingPages.length < MAX_LISTING_URLS) {
        const expectedTotal = firstPage.total != null ? Math.min(firstPage.total, MAX_LISTING_URLS) : MAX_LISTING_URLS;
        const maxPage = Math.min(MAX_LISTING_PAGES, Math.ceil(expectedTotal / LISTINGS_PAGE_SIZE));
        for (let start = 1; start < maxPage && listingPages.length < MAX_LISTING_URLS; start += SITEMAP_BATCH_CONCURRENCY) {
          const batchPages = Array.from(
            { length: Math.min(SITEMAP_BATCH_CONCURRENCY, maxPage - start) },
            (_, idx) => start + idx,
          );
          const batchResults = await Promise.allSettled(batchPages.map((page) => fetchListingsPage(page)));
          let stopPaging = false;
          for (const settled of batchResults) {
            if (settled.status !== 'fulfilled' || settled.value.records.length === 0) {
              stopPaging = true;
              break;
            }
            const before = listingPages.length;
            appendRecords(settled.value.records);
            if (settled.value.records.length < LISTINGS_PAGE_SIZE || listingPages.length === before || listingPages.length >= MAX_LISTING_URLS) {
              stopPaging = true;
              break;
            }
          }
          if (stopPaging) break;
        }
      }
    }
  } catch {
    // Inventory unreachable at build time; static pages still describe the site.
  }

  const payload = coveragePayload.status === 'fulfilled' ? coveragePayload.value : null;
  let { statePages, countyPages } =
    payload?.liveByState && !payload.liveByState.readError
      ? buildGeographyPages(baseUrl, now, payload.liveByState.byStateTotal, payload.liveByState.byCounty)
      : { statePages: [] as MetadataRoute.Sitemap, countyPages: [] as MetadataRoute.Sitemap };

  if (statePages.length === 0) {
    try {
      const req = createRequire(process.cwd() + "/package.json");
      const matrix = req("./server/discovery/coverage-matrix").summarize();
      ({ statePages, countyPages } = buildGeographyPages(
        baseUrl,
        now,
        matrix.liveByState?.byStateTotal,
        matrix.liveByState?.byCounty,
      ));
    } catch {
      // Local matrix unavailable
    }
  }

  return [...staticPages, ...statePages, ...countyPages, ...listingPages];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.NODE_ENV === 'test') {
    return buildSitemapEntries();
  }
  if (cachedSitemap && cachedSitemap.expiresAt > Date.now()) {
    return cachedSitemap.entries;
  }
  if (!inflightSitemap) {
    inflightSitemap = buildSitemapEntries()
      .then((entries) => {
        cachedSitemap = {
          entries,
          expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS,
        };
        return entries;
      })
      .finally(() => {
        inflightSitemap = null;
      });
  }
  return inflightSitemap;
}
