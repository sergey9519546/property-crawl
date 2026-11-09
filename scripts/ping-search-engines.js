#!/usr/bin/env node
'use strict';

/**
 * scripts/ping-search-engines.js
 *
 * Automated CLI utility to submit sitemap and dynamic URLs to search engines via:
 * 1. IndexNow protocol (Bing, Yandex, Seznam)
 * 2. Sitemap pings (Google, Bing)
 *
 * Usage:
 *   node scripts/ping-search-engines.js [--dry-run]
 */

const { submitIndexNowUrls, pingSitemap, resolveDefaultHost, resolveDefaultSitemapUrl } = require('../server/seo/indexing-ping.js');

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.includes('-n');

  console.log(`[SEO-Ping] Starting Search Engine Notification (${isDryRun ? 'DRY RUN' : 'LIVE'})...`);

  const host = resolveDefaultHost();
  const sitemapUrl = resolveDefaultSitemapUrl();
  const baseUrl = `https://${host}`;
  const coreUrls = [
    `${baseUrl}/`,
    `${baseUrl}/listings`,
    `${baseUrl}/states`,
    `${baseUrl}/sources`,
    `${baseUrl}/hunts`,
    `${baseUrl}/research`,
    `${baseUrl}/about`,
    `${baseUrl}/resources`,
  ];

  // Common high-traffic state hubs
  const stateHubs = ['FL', 'NJ', 'OH', 'PA', 'NC', 'TX', 'CA', 'CO', 'GA', 'IL', 'NY', 'MI', 'TN', 'WA'].map(
    (st) => `${baseUrl}/states/${st}`
  );

  const urlsToPing = [...coreUrls, ...stateHubs];

  console.log(`[SEO-Ping] Preparing IndexNow payload for ${urlsToPing.length} core URLs...`);

  const indexNowResult = await submitIndexNowUrls({
    host,
    urls: urlsToPing,
    dryRun: isDryRun,
  });

  if (indexNowResult.success) {
    console.log(`[SEO-Ping] IndexNow submission succeeded! Batches: ${indexNowResult.batches.length}, URLs: ${indexNowResult.submittedCount}`);
  } else {
    console.warn(`[SEO-Ping] IndexNow submission encountered errors:`, indexNowResult.errors);
  }

  console.log(`[SEO-Ping] Pinging sitemap (${sitemapUrl}) to Google and Bing...`);

  const sitemapResult = await pingSitemap({
    sitemapUrl,
    engines: ['google', 'bing'],
    dryRun: isDryRun,
  });

  for (const res of sitemapResult.results) {
    console.log(`[SEO-Ping] Sitemap Ping [${res.engine.toUpperCase()}]: ${res.dryRun ? 'Simulated 200 OK (dry-run)' : `Status ${res.status}`}`);
  }

  if (sitemapResult.errors.length > 0) {
    console.warn(`[SEO-Ping] Sitemap ping warnings:`, sitemapResult.errors);
  }

  console.log('[SEO-Ping] Search engine notification cycle complete.');
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[SEO-Ping] Fatal error:', err);
    process.exit(1);
  });
}
