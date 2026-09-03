// Try FDIC Property Listing Site
const fs = require('fs');
const path = require('path');
const targets = [
  ['fdic-pls', 'https://www.fdic.gov/asset-sales/real-estate-and-property-sales'],
  ['fdic-bargain-pg', 'https://www.fdic.gov/asset-sales/bargain-properties'],
];
(async () => {
  // Look for actual links in main
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 30000);
  const r = await fetch('https://www.fdic.gov/asset-sales/real-estate-and-property-sales', {
    headers: { 'User-Agent': 'property-crawl-bot/1.0 (research)' },
    signal: c.signal
  });
  const text = await r.text();
  clearTimeout(t);
  // Find all external links mentioned in body
  const hrefs = [...text.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  // Filter to relevant
  const interesting = hrefs.filter(h => !h.startsWith('/modules') && !h.startsWith('/sites') && !h.startsWith('#'));
  console.log('Unique hrefs:');
  [...new Set(interesting)].forEach(h => console.log(' ', h));
})();
