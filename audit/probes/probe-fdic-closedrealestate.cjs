// Find FDIC closed sales app endpoints by looking at JS
const fs = require('fs');
const path = require('path');
(async () => {
  // Get the main JS bundle to look for API endpoints
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 30000);
  const r = await fetch('https://sales.fdic.gov/closedrealestate/', {
    headers: { 'User-Agent': 'property-crawl-bot/1.0' },
    signal: c.signal
  });
  const html = await r.text();
  clearTimeout(t);
  // Extract the main JS src
  const m = html.match(/src="(\/static\/js\/main\.[^"]+)"/);
  if (!m) { console.log('no main js found'); return; }
  console.log('main js:', m[1]);
  const c2 = new AbortController();
  const t2 = setTimeout(() => c2.abort(), 30000);
  const r2 = await fetch('https://sales.fdic.gov' + m[1], {
    headers: { 'User-Agent': 'property-crawl-bot/1.0' },
    signal: c2.signal
  });
  const js = await r2.text();
  clearTimeout(t2);
  // Find API endpoints
  const apiMatches = [...js.matchAll(/(?:"|\/)((?:api|listings|sales|properties|search|cscre|assets|realestate|closed)[a-zA-Z\-_/]*)"/g)].map(m => m[1]);
  console.log('Possible endpoints:');
  [...new Set(apiMatches)].forEach(e => console.log(' ', e));
  // Also look for fetch/axios calls
  const fetchMatches = [...js.matchAll(/(?:get|post|fetch|axios)\s*\(\s*["'`][^"'`]+["'`]/gi)].map(m => m[0]);
  console.log('Fetch calls:');
  [...new Set(fetchMatches)].slice(0, 20).forEach(e => console.log(' ', e));
})();
