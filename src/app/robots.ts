import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_ORIGIN || 'https://property-crawl.onrender.com';
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/alerts', '/api/user'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
