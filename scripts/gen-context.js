'use strict';
/*
 * gen-context.js — generate CONTEXT.md (the project domain model) from the repo
 * so the agent always has a fresh, single-source-of-truth view of:
 *   - the SOURCES taxonomy + LISTINGS (from data.js, loaded via VM like server/db)
 *   - the server API routes
 *   - the npm scripts
 *   - the invariants + run/test commands documented elsewhere
 *
 * The file embeds a CONTEXT-DIGEST. `--check` (and test/context.test.js) recompute
 * the digest and FAIL if CONTEXT.md is stale vs. its sources — so a change to
 * data.js / server routes / package.json that isn't followed by regeneration is
 * caught mechanically instead of rotting silently.
 *
 * Usage:
 *   node scripts/gen-context.js            # write CONTEXT.md
 *   node scripts/gen-context.js --check    # exit 1 if stale/missing
 *   node scripts/gen-context.js --json     # print facts as JSON (for tests)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT_ARG = process.argv.indexOf('--root');
const ROOT = ROOT_ARG !== -1 && process.argv[ROOT_ARG + 1]
  ? path.resolve(process.argv[ROOT_ARG + 1])
  : path.resolve(__dirname, '..');
const CONTEXT_PATH = path.join(ROOT, 'CONTEXT.md');

function loadData() {
  const p = path.join(ROOT, 'data.js');
  const sandbox = { window: {}, Math };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox);
  return {
    sources: sandbox.window.SOURCES || {},
    listings: sandbox.window.LISTINGS || []
  };
}

function loadScripts() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.scripts || {};
}

function loadRoutes() {
  // The old version of this returned *filenames* from server/routes plus a
  // hardcoded `inline: ['sources','health']`, and it never opened a single file
  // inside server/routes. So the digest moved when a route file was renamed or
  // added, and stayed perfectly still when a route was added to, removed from,
  // or had its path changed inside an existing handler - which is what adding
  // an endpoint actually looks like. The header claimed a change to "server
  // routes" is caught mechanically. It was not.
  //
  // Now the dispatch table and each module's served paths are both read, so
  // editing a handler moves the digest. The inline list is derived from
  // server.js instead of being asserted by hand.
  const dir = path.join(ROOT, 'server', 'routes');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort(); } catch (_) {}

  const modules = files.map((name) => {
    const src = safeRead(path.join(dir, name));
    const paths = [...new Set(
      [...src.matchAll(/['"`]((?:\/api)?\/[a-z0-9\-/]*(?:\/:[a-z]+)?)['"`]/gi)].map((m) => m[1])
    )].sort();
    return { module: name.replace(/\.js$/, ''), paths };
  });

  // server.js owns the dispatch table. Each entry records the handler it
  // delegates to, or 'inline' when the branch serves the path itself. The
  // handler call sits on the same line OR the next one depending on the branch,
  // so both are inspected.
  const serverSrc = safeRead(path.join(ROOT, 'server', 'server.js'));
  const lines = serverSrc.split(/\r?\n/);
  const routed = [];
  // `.startsWith(` puts a paren between the operator and the quote, so the
  // pattern has to allow an optional "(" - omitting it silently skipped every
  // pure-startsWith branch, which is how /api/listings, /api/scrapers and
  // /api/watchlist/ went missing from the first version of this table.
  const ROUTE_TEST = /url\.pathname\s*(?:===|\.startsWith)\s*\(?\s*'([^']+)'/g;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/url\.pathname\s*(?:===|\.startsWith)/.test(line)) continue;
    ROUTE_TEST.lastIndex = 0;
    for (const m of line.matchAll(ROUTE_TEST)) {
      const route = m[1];
      if (routed.some((r) => r.path === route)) continue;
      const window = `${line}\n${lines[i + 1] || ''}\n${lines[i + 2] || ''}`;
      const handler = window.match(/return\s+((?:handle[A-Za-z]+)|(?:\w*[Hh]andlers\.\w+))/);
      routed.push({ path: route, handler: handler ? handler[1] : 'inline' });
    }
  }
  routed.sort((a, b) => a.path.localeCompare(b.path));

  return { modules, routed };
}

function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

function loadCatalog() {
  // The authoritative source taxonomy. This used to be absent from CONTEXT.md
  // entirely, which left data.js's 16 SOURCES entries described as "the source
  // of truth" for a catalog that actually has 163.
  try {
    const { SOURCE_CATALOG } = require('../server/sources/catalog');
    return SOURCE_CATALOG;
  } catch (_) {
    return [];
  }
}

function computeFacts() {
  const { sources, listings } = loadData();
  const scripts = loadScripts();
  const routes = loadRoutes();
  const catalog = loadCatalog();

  const sourceKeys = Object.entries(sources)
    .map(([k, v]) => `${k}:${v.label || ''}:${v.tier || ''}`)
    .sort();
  const states = [...new Set(listings.map((l) => l.state).filter(Boolean))].sort();
  const propTypes = [...new Set(listings.map((l) => l.propType).filter(Boolean))].sort();
  const scriptsList = Object.entries(scripts).map(([k, v]) => `${k}=${v}`).sort();
  const catalogStatuses = catalog
    .map((e) => e.status || 'DISCOVERY_ONLY')
    .reduce((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {});

  return {
    sourceCount: sourceKeys.length,
    sources: sourceKeys,
    listingCount: listings.length,
    states,
    propTypes,
    // data.js seeds the v0 static PWA and the in-memory provider. It is a
    // seed snapshot, not the live inventory: the store on disk carries more
    // records than data.js does, and the served totals come from the DB.
    seedListingCount: listings.length,
    catalogCount: catalog.length,
    catalogStatuses,
    catalogAdapters: catalog.filter((e) => e.adapterKey).length,
    routeModules: routes.modules,
    routed: routes.routed,
    scripts: scriptsList
  };
}

function computeDigest(facts) {
  return crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

function renderContext(facts) {
  const digest = computeDigest(facts);
  const src = facts.sources.map((s) => `- \`${s}\``).join('\n');
  return `# CONTEXT — property-crawl domain model

<!-- CONTEXT-DIGEST: ${digest} -->
> AUTO-GENERATED by \`node scripts/gen-context.js\`. Do not edit by hand.
> Regenerate after changing \`data.js\`, \`server/\` routes, or \`package.json\` scripts.
> Drift-gated by \`test/context.test.js\` and \`node scripts/gen-context.js --check\`.

## What this project is
Evidence-first discovery/triage layer for distressed and government-sold property —
sheriff sales, trustee sales, HUD/REO, IRS/Treasury/GSA dispositions.
Three layers: static PWA (v0, \`index.html\`/\`app.js\`), Node \`http\` listing API (v1,
\`server/\`), Next.js 16 App Router marketing site (v2, \`src/\`).

## Data shape
Authoritative source taxonomy: \`server/sources/catalog.js\` -
**${facts.catalogCount} catalog entries**, ${facts.catalogAdapters} with a live
adapter, by status: ${Object.entries(facts.catalogStatuses).sort().map(([k, v]) => `${k}=${v}`).join(', ')}.

\`data.js\` is a **seed snapshot**, not the source of truth. It seeds the v0
static PWA and the in-memory provider, and the scraper workflow commits it back.
It holds ${facts.seedListingCount} listings; the running app serves from the
database and the live record store, which carry more. Treat the catalog for
*which sources exist* and the database for *which listings exist*.

- \`SOURCES\` in data.js: ${facts.sourceCount} entries (v0 taxonomy)
${src}
- data.js seed listings: ${facts.seedListingCount} records
- states in the seed: ${facts.states.join(', ')}
- property types in the seed: ${facts.propTypes.join(', ')}

## Server API routes
- ${facts.routed.length} path(s) dispatched from \`server/server.js\`
${facts.routed.map((r) => `  - \`${r.path}\` -> ${r.handler}`).join('\n')}
- inline (served by server.js itself, no route module):
${facts.routed.filter((r) => r.handler === 'inline').map((r) => `  - \`${r.path}\``).join('\n') || '  (none)'}
- route modules (${facts.routeModules.length}): ${facts.routeModules.map((m) => m.module).join(', ')}

## Commands
\`\`\`
${facts.scripts.map((s) => s).join('\n')}
\`\`\`

## Invariants (do not violate)
- Every dynamic/AI/user string renders through \`esc()\` / \`mdToHtml()\` (XSS invariant).
- \`SCORE_BANDS\` is the single source of truth for Deal Score color/label/alpha.
- Listing contract is camelCase (dealScore, openingBid, propType, ...); Postgres stores
  snake_case and \`server/db/client.js\` aliases back — production-only breakage risk.
`;
}

function main() {
  const args = process.argv.slice(2);
  const facts = computeFacts();
  const digest = computeDigest(facts);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ facts, digest }, null, 2));
    return;
  }

  if (args.includes('--check')) {
    if (!fs.existsSync(CONTEXT_PATH)) {
      console.error('CONTEXT.md missing — run `node scripts/gen-context.js`');
      process.exit(1);
    }
    const existing = fs.readFileSync(CONTEXT_PATH, 'utf8');
    const m = existing.match(/CONTEXT-DIGEST:\s*([0-9a-f]{64})/);
    if (!m || m[1] !== digest) {
      console.error(`CONTEXT.md is STALE (digest ${m ? m[1].slice(0, 12) : 'MISSING'} != ${digest.slice(0, 12)}). Regenerate: node scripts/gen-context.js`);
      process.exit(1);
    }
    console.log('CONTEXT.md is current.');
    return;
  }

  fs.writeFileSync(CONTEXT_PATH, renderContext(facts));
  console.log(
    `Wrote ${CONTEXT_PATH} (catalog ${facts.catalogCount} sources, `
    + `data.js seed ${facts.sourceCount} sources / ${facts.seedListingCount} listings, `
    + `${facts.states.length} states, ${facts.routed.length} dispatched paths)`
  );
}

module.exports = { computeFacts, computeDigest, renderContext, loadData, CONTEXT_PATH };

if (require.main === module) main();