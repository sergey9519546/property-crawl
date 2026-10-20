'use strict';

/**
 * scripts/civilview-counties.js — CLI and registry for CivilView (Tyler Sales Web) counties.
 *
 * Usage:
 *   node scripts/civilview-counties.js         # list all verified NJ and PA counties
 *   node scripts/civilview-counties.js --nj    # list all 21 NJ counties
 *   node scripts/civilview-counties.js --pa    # list Pennsylvania counties
 *   node scripts/civilview-counties.js --live  # fetch live index from salesweb.civilview.com
 */

const {
  NJ_COUNTIES,
  PA_COUNTIES,
  ALL_COUNTIES,
  getCivilViewSearchUrl,
  getCivilViewDetailUrl,
  getCounty,
  getNJCounties,
  getPACounties,
} = require('../server/sources/civilview');

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

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--nj')) {
    const list = NJ_COUNTIES.map((c) => ({
      ...c,
      searchUrl: getCivilViewSearchUrl(c.id),
    }));
    console.log(JSON.stringify({ counties: list, count: list.length }, null, 2));
    return;
  }

  if (argv.includes('--pa')) {
    const list = PA_COUNTIES.map((c) => ({
      ...c,
      searchUrl: getCivilViewSearchUrl(c.id),
    }));
    console.log(JSON.stringify({ counties: list, count: list.length }, null, 2));
    return;
  }

  if (argv.includes('--live')) {
    const counties = await fetchCivilViewIndex();
    console.log(JSON.stringify({ counties, count: counties.length }, null, 2));
    return;
  }

  const list = ALL_COUNTIES.map((c) => ({
    ...c,
    searchUrl: getCivilViewSearchUrl(c.id),
  }));
  console.log(JSON.stringify({
    counties: list,
    njCount: NJ_COUNTIES.length,
    paCount: PA_COUNTIES.length,
    totalCount: list.length,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCivilViewIndex,
  fetchCivilViewIndex,
  UA,
  NJ_COUNTIES,
  PA_COUNTIES,
  ALL_COUNTIES,
  getCivilViewSearchUrl,
  getCivilViewDetailUrl,
  getCounty,
  getNJCounties,
  getPACounties,
  main,
};
