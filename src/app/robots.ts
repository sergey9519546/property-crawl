import type { MetadataRoute } from 'next';
import { getCanonicalOrigin } from '@/lib/app-origin';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getCanonicalOrigin();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/alerts', '/api/account', '/account', '/workspace/', '/portfolio', '/hunts', '/research'],
      },
      {
        userAgent: ['GPTBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Google-Extended', 'cohere-ai'],
        allow: [
          '/',
          '/states',
          '/states/*',
          '/listings',
          '/listings/*',
          '/foreclosure',
          '/foreclosure/*',
          '/sheriff-sales',
          '/sheriff-sales/*',
          '/resources',
          '/about',
          '/sources',
          '/contact',
          '/enterprise',
          '/case-studies',
          '/security',
        ],
        disallow: ['/api/*', '/account', '/workspace/', '/portfolio', '/hunts', '/research'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
