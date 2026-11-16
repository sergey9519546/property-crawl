import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_ORIGIN || 'https://property-crawl.onrender.com').replace(/\/+$/, '');
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
