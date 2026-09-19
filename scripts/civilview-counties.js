'use strict';

/**
 * Discover CivilView (Tyler Sales Web) countyId mappings from the public index.
 * Read-only, polite, single request. Used for market enrollment.
 */

const UA = 'property-crawl-bot/2.0 (+https://github.com/property-crawl; contact: ops@property-crawl.example)';

function parseCivilViewIndex(html) {
  const re = /href=["']\/Sales\/SalesSearch\?countyId=(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const counties = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    const name = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const stateMatch = name.match(/,\s*([A-Z]{2})\b/);
    counties.push({
      id: match[1],
      name,
      state: stateMatch ? stateMatch[1] : null,
    });
  }
  return counties;
}

async function fetchCivilViewIndex(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl('https://salesweb.civilview.com/', {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`CivilView index HTTP ${response.status}`);
  return parseCivilViewIndex(await response.text());
}

if (require.main === module) {
  fetchCivilViewIndex()
    .then((counties) => {
      console.log(JSON.stringify({ counties, count: counties.length }, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { parseCivilViewIndex, fetchCivilViewIndex, UA };
