#!/usr/bin/env node
// scripts/build-data.js
//
// Regenerates data.js (the v0 PWA's listing registry) from the scraper
// pipeline. This is the integration glue between server/scrapers/ and the
// static frontend. Without this file, scraper output never reaches the
// product.
//
// Usage:
//   node scripts/build-data.js                 # dev: skip real scrapers (fast)
//   RUN_REAL_SCRAPERS=1 node scripts/build-data.js   # prod-like: hit real sources
//   npm run refresh-data                       # via package.json script
//
// Output: writes data.js at the project root. The file is a valid JS module
// that sets window.SOURCES and window.LISTINGS for v0's app.js to consume.
// The production server (server/server.js) loads it via VM sandbox to seed
// its in-memory DB when DATABASE_URL is unset.
//
// SOURCES taxonomy is the single source of truth, kept in sync with:
//   - src/components/terminal/property-data.ts  (v2 marketing, via test/sync.test.js)
//   - server/db/schema.sql sources table        (v1 backend, post-launch)
//
// LISTINGS come from running every scraper in server/scrapers/. Each scraper
// returns an array conforming to the v0 schema (see
// server/scrapers/base.js#standardizeListing). Results are:
//   1. Deduplicated by `id` (Treasury + a hypothetical GSE won't collide)
//   2. Filtered for required fields (state, address, openingBid > 0)
//   3. Sorted by dealScore descending (best deals first)
//   4. Emitted as window.LISTINGS

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_JS_PATH = path.join(PROJECT_ROOT, 'data.js');

// SOURCES — the 11-source registry. Single source of truth here.
// Mirrors src/components/terminal/property-data.ts (test/sync.test.js enforces).
const SOURCES = {
  sheriff:   { key: "sheriff",   label: "Sheriff Sale",         tier: "B", color: "#0f766e", note: "Foreclosure sale notice published under state law",        websiteUrl: "https://www.cuyahogasheriff.org" },
  trustee:   { key: "trustee",   label: "Trustee's Sale",       tier: "B", color: "#0ea5e9", note: "Non-judicial foreclosure auction",                          websiteUrl: "https://www.clarkcountynv.gov" },
  hud:       { key: "hud",       label: "HUD Home",             tier: "A", color: "#1d4ed8", note: "hudhomestore.gov — owner-occupant window applies",         websiteUrl: "https://www.hudhomestore.gov" },
  fannie:    { key: "fannie",    label: "Fannie Mae REO",       tier: "A", color: "#2563eb", note: "homepath.com — First Look window",                         websiteUrl: "https://www.homepath.com" },
  freddie:   { key: "freddie",   label: "Freddie Mac REO",      tier: "A", color: "#1e40af", note: "homesteps.com",                                            websiteUrl: "https://www.homesteps.com" },
  usda:      { key: "usda",      label: "USDA RD/FSA REO",      tier: "A", color: "#3b82f6", note: "resales.usda.gov",                                        websiteUrl: "https://www.resales.usda.gov" },
  va:        { key: "va",        label: "VA REO",               tier: "A", color: "#0e7490", note: "vrmproperties.com",                                       websiteUrl: "https://vrmproperties.com" },
  irs:       { key: "irs",       label: "IRS Seized",           tier: "A", color: "#b45309", note: "irsauctions.gov — email subscribe",                       websiteUrl: "https://www.irsauctions.gov" },
  treasury:  { key: "treasury",  label: "Treasury Forfeiture",  tier: "A", color: "#c2410c", note: "CWS Marketing contractor",                                websiteUrl: "https://www.treasury.gov/auctions/treasury/rp/realprop.shtml" },
  marshals:  { key: "marshals",  label: "US Marshals",          tier: "A", color: "#a16207", note: "RealLook.com / Gaston & Sheehan",                          websiteUrl: "https://www.usmarshals.gov" },
  gsa:       { key: "gsa",       label: "GSA Surplus",          tier: "A", color: "#92400e", note: "realestatesales.gov",                                     websiteUrl: "https://realestatesales.gov" },
};

// Scraper registry. To add a new source: write a real scraper in
// server/scrapers/<key>.js that exports a singleton with .scrapeFeed(),
// then add it here.
const SCRAPER_REGISTRY = [
  { key: 'sheriff',    mod: '../server/scrapers/sheriff',         real: true },
  { key: 'hud',        mod: '../server/scrapers/hud',             real: true },
  { key: 'fannie',     mod: '../server/scrapers/fannie',          real: true },
  { key: 'freddie',    mod: '../server/scrapers/freddie',         real: true },
  { key: 'va',         mod: '../server/scrapers/va',              real: true },
  { key: 'marshals',   mod: '../server/scrapers/marshals',        real: true },
  { key: 'irs',        mod: '../server/scrapers/irs',             real: true },
  { key: 'treasury',   mod: '../server/scrapers/treasury',        real: true },
  { key: 'gsa',        mod: '../server/scrapers/gsa',             real: true },
  { key: 'usda',       mod: '../server/scrapers/usda',            real: true },
  { key: 'landbank',   mod: '../server/scrapers/landbanksearch',  real: true },
  { key: 'fdic',       mod: '../server/scrapers/fdic',            real: true },
  { key: 'civilview',  mod: '../server/scrapers/civilview',       real: true },
  { key: 'bid4assets', mod: '../server/scrapers/bid4assets',      real: true },
];

// `cross-env` is intentionally NOT required: pass --real on any platform.
const RUN_REAL = process.env.RUN_REAL_SCRAPERS === '1' || process.argv.includes('--real');
// Per-scraper wall-clock budget. Treasury fetches 16 detail pages at ~9s each
// (US government site, polite throttling), so it needs ~3 min end-to-end.
// Bump this if you add a slower source.
const TIMEOUT_PER_SCRAPER_MS = 180_000;

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function gather() {
  const all = [];
  const counts = {};
  for (const entry of SCRAPER_REGISTRY) {
    if (entry.real && !RUN_REAL) {
      counts[entry.key] = { skipped: 'set RUN_REAL_SCRAPERS=1 to enable' };
      continue;
    }
    let scraper;
    try {
      scraper = require(entry.mod);
    } catch (err) {
      console.warn(`[build-data] could not load ${entry.key}: ${err.message}`);
      counts[entry.key] = { error: err.message };
      continue;
    }
    if (!scraper || typeof scraper.scrapeFeed !== 'function') {
      console.warn(`[build-data] ${entry.key} has no scrapeFeed()`);
      counts[entry.key] = { error: 'no scrapeFeed()' };
      continue;
    }
    try {
      console.log(`[build-data] running ${entry.key}…`);
      const items = await withTimeout(scraper.scrapeFeed(), TIMEOUT_PER_SCRAPER_MS, entry.key);
      all.push(...items);
      counts[entry.key] = { count: items.length };
      console.log(`[build-data] ${entry.key} → ${items.length} listings`);
    } catch (err) {
      console.warn(`[build-data] ${entry.key} failed: ${err.message}`);
      counts[entry.key] = { error: err.message };
    }
  }
  return { all, counts };
}

function normalize(listings) {
  // 1. Dedupe by id (keep first)
  const seen = new Set();
  const deduped = [];
  for (const l of listings) {
    if (!l || !l.id) continue;
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    deduped.push(l);
  }
  // 2. Filter: must have a state, an address, and a positive opening bid
  const filtered = deduped.filter(l => {
    if (!l.state || l.state === 'US' || l.state.length !== 2) return false;
    if (!l.address || l.address.length < 8) return false;
    if (!l.openingBid || l.openingBid <= 0) return false;
    return true;
  }).map(l => {
    const sourceHomepage = SOURCES[l.source]?.websiteUrl;
    const candidate = typeof l.sourceUrl === 'string' ? l.sourceUrl.replace(/\/+$/, '') : '';
    const homepage = typeof sourceHomepage === 'string' ? sourceHomepage.replace(/\/+$/, '') : '';
    const isGenericHomepage = !candidate || candidate === homepage;
    return { ...l, sourceUrl: isGenericHomepage ? null : l.sourceUrl };
  });
  // 3. Sort: best deal score first; tiebreak by opening bid asc
  filtered.sort((a, b) => {
    if ((b.dealScore || 0) !== (a.dealScore || 0)) return (b.dealScore || 0) - (a.dealScore || 0);
    return (a.openingBid || 0) - (b.openingBid || 0);
  });
  return filtered;
}

function emit(sources, listings) {
  const header = `// AUTO-GENERATED by scripts/build-data.js — do not edit by hand.
// Run \`node scripts/build-data.js\` to regenerate from server/scrapers/.
// Last generated: ${new Date().toISOString()}
// SOURCES taxonomy kept in sync with src/components/terminal/property-data.ts
// via test/sync.test.js.

`;
  const sourcesJs = `window.SOURCES = ${JSON.stringify(sources, null, 2)};\n\n`;
  const listingsJs = `window.LISTINGS = ${JSON.stringify(listings, null, 2)};\n`;
  return header + sourcesJs + listingsJs;
}

async function main() {
  console.log(`[build-data] RUN_REAL_SCRAPERS=${RUN_REAL ? '1' : '0'}`);
  const { all, counts } = await gather();
  const normalized = normalize(all);
  console.log(`[build-data] ${all.length} raw → ${normalized.length} after normalize`);

  // Per-source summary
  for (const [key, info] of Object.entries(counts)) {
    if (info.skipped) console.log(`  ${key}: skipped (${info.skipped})`);
    else if (info.error) console.log(`  ${key}: ERROR (${info.error})`);
    else console.log(`  ${key}: ${info.count} listings`);
  }

  fs.writeFileSync(DATA_JS_PATH, emit(SOURCES, normalized), 'utf8');
  console.log(`[build-data] wrote ${normalized.length} listings → ${path.relative(PROJECT_ROOT, DATA_JS_PATH)}`);
}

main().catch(err => {
  console.error('[build-data] FATAL:', err);
  process.exit(1);
});
