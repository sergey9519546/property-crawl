import type { MetadataRoute } from 'next';
import { LISTINGS } from '@/data/listings';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://property-crawl.com';
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/listings`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 0.9,
    },
  ];

  const listingPages: MetadataRoute.Sitemap = LISTINGS.map((l) => ({
    url: `${baseUrl}/listings/${l.id}`,
    lastModified: l.saleDate ? new Date(l.saleDate) : now,
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  return [...staticPages, ...listingPages];
}
