'use strict';

// test/api-reachability.test.js
//
// Documents which server routes the browser can actually reach, and makes the
// gap explicit instead of accidental.
//
// Two independent things must line up for a UI feature to work:
//
//   1. the Node API serves the path, and
//   2. src/lib/property-api.ts API_PATH allows it through the browser proxy.
//
// And a third, which is the one that decides whether a user can actually see
// anything:
//
//   3. something in the UI layer calls it.
//
// A route that satisfies (1) but not (2) is invisible to the product: every
// fetch from a client component returns 404 "Unknown API route" before it
// reaches the server. A route that satisfies (2) but not (3) is worse, because
// it looks wired -- there is a route module, a typed client wrapper, and a
// proxy that will happily forward to it -- while no user can reach it.
//
// So there are three states, and each has a list below, each pinned:
//
//   KNOWN_BROWSER_REACHABLE         served + proxyable + a real UI caller
//   KNOWN_PROXYABLE_NO_UI_CALLER    served + proxyable + rendered by nothing
//   KNOWN_BROWSER_UNREACHABLE       served, but the proxy will not admit it
//
// The two-unreachable routes are:
//
//   /api/coverage              server.js:185
//   /api/portfolio/dashboard   server.js:206 + routes/portfolio-dashboard.js
//
// They are not removed - a CLI or external consumer may use them, and
// deleting working code is not this test's call. Every list here is pinned so
// the state is deliberate: if a route gains a caller, or is dropped, a test
// fails and the entry is updated on purpose rather than drifting.
//
// Until this test checked (3), the "reachable" list claimed routes had UI
// callers while verifying nothing of the sort. Four did not have any, and
// /api/neighborhoods was described by neither list at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function apiPathRegex() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'property-api.ts'), 'utf8');
  const match = src.match(/const API_PATH = (\/\^.*?\/[a-z]*);/s);
  assert.ok(match, 'could not extract API_PATH from src/lib/property-api.ts');
  // eslint-disable-next-line no-eval
  return eval(match[1]);
}

// Served by the Node API but not reachable from any browser caller.
const KNOWN_BROWSER_UNREACHABLE = [
  '/api/coverage',
  '/api/portfolio/dashboard',
];

// Implemented and genuinely wired end to end: served, admitted by the proxy,
// and reached by a UI file. Each entry names the file that owns the call.
//
// The caller is declared rather than discovered because these paths are
// assembled at runtime -- saved-hunts.tsx calls `fetch(\`/api/hunts${path}\`)`
// with path built by the caller, so no literal "/api/hunts/h1/evaluate" exists
// anywhere to grep for. A name that cannot be spelled is not a name that can
// be verified by string match; declaring it is the honest option, and the
// file-existence and reachability checks below still hold it to the truth.
const KNOWN_BROWSER_REACHABLE = [
  { route: '/api/listings', callers: ['src/components/listings/discovery-map.tsx', 'src/lib/listing-inventory.ts'] },
  { route: '/api/hunts/h1/evaluate', callers: ['src/components/hunts/saved-hunts.tsx'] },
  { route: '/api/saved-searches/s1', callers: ['src/lib/saved-searches.ts'] },
  { route: '/api/saved-searches/s1/run', callers: ['src/lib/saved-searches.ts'] },
  { route: '/api/alerts/matches', callers: ['src/lib/saved-searches.ts'] },
  { route: '/api/price-drops', callers: ['src/components/site/second-look-showcase.tsx'] },
];

// Served, admitted by the proxy, and rendered by nothing.
//
// This state used to be invisible. KNOWN_BROWSER_REACHABLE claimed "have UI
// callers" while only ever testing the proxy regex, so these four sat in a
// list that read as "shipped" while no user could reach them:
//
//   /api/source-network/onboarding      no reference anywhere in src
//   /api/source-network/unbrowse/status no reference anywhere in src
//   /api/watchlist/w1/comps             only an uncalled intelligence-client wrapper
//   /api/auction-calendar               only an uncalled intelligence-client wrapper
//
// /api/neighborhoods was worse still: served, proxyable, and listed in neither
// set, so nothing at all described it.
//
// They are not removed -- a CLI or external consumer may use them, and
// deleting working code is not this test's call. They are pinned so the state
// is deliberate, and so that "analytics exist" is never mistaken for "a user
// can see analytics".
const KNOWN_PROXYABLE_NO_UI_CALLER = [
  '/api/source-network/onboarding',
  '/api/source-network/unbrowse/status',
  '/api/watchlist/w1/comps',
  '/api/auction-calendar',
  '/api/neighborhoods',
];

const apiPath = apiPathRegex();

test('the proxy allowlist still admits every known-reachable route', () => {
  const rejected = KNOWN_BROWSER_REACHABLE.filter(({ route }) => !apiPath.test(route));
  assert.deepEqual(
    rejected.map(({ route }) => route),
    [],
    'these routes are served and have UI callers, but API_PATH now rejects them - '
      + 'a shipped feature has gone dark behind a 404 the user cannot diagnose',
  );
});

test('every known-reachable route has a caller that exists and is UI-reachable', () => {
  const { reach } = uiReachableModules(SRC_FILES);

  const missingFiles = [];
  const unreachable = [];
  for (const { route, callers } of KNOWN_BROWSER_REACHABLE) {
    for (const rel of callers) {
      const full = path.join(ROOT, rel);
      if (!fs.existsSync(full)) {
        missingFiles.push(`${route} -> ${rel} (no such file)`);
        continue;
      }
      if (!reach(full)) unreachable.push(`${route} -> ${rel} (nothing in the UI layer imports it)`);
    }
  }

  assert.deepEqual(missingFiles, [], 'a declared caller file does not exist');
  assert.deepEqual(
    unreachable,
    [],
    'these callers exist but are unreachable from components/ and app/, so the route '
      + 'is not actually rendered. A wrapper nothing imports is the worst case: the file '
      + 'exists, it is typed, it is tested, and no user can get to it',
  );
});

test('the proxyable-but-unrendered set really has no UI caller', () => {
  const { reach } = uiReachableModules(SRC_FILES);

  const actuallyCalled = KNOWN_PROXYABLE_NO_UI_CALLER
    .filter((route) => callersFor(route, SRC_FILES, reach).length > 0);

  assert.deepEqual(
    actuallyCalled,
    [],
    'a route is documented as unrendered but a UI-reachable caller was found for it. '
      + 'Move it to KNOWN_BROWSER_REACHABLE with its caller',
  );

  assert.equal(
    KNOWN_PROXYABLE_NO_UI_CALLER.length,
    5,
    'the set of served, proxyable routes that no UI renders changed. These are real '
      + 'analytics endpoints behind a working proxy that no user can reach. If one gained '
      + 'a UI, or was dropped, update this list in the same commit',
  );
});

test('each documented route is admitted by the proxy, not merely served', () => {
  // Every route named in any of the three sets must at least be a path the
  // proxy would admit. A route that is neither reachable nor proxyable should
  // not be documented here at all.
  const rejected = [
    ...KNOWN_BROWSER_REACHABLE.map(({ route }) => route),
    ...KNOWN_PROXYABLE_NO_UI_CALLER,
  ].filter((p) => !apiPath.test(p));
  assert.deepEqual(
    rejected,
    [],
    'these routes are documented as browser-reachable but API_PATH rejects them, so a '
      + 'browser caller would get a 404 "Unknown API route" it cannot diagnose',
  );
});

test('the documented browser-unreachable set is accurate', () => {
  const actuallyReachable = KNOWN_BROWSER_UNREACHABLE.filter((p) => apiPath.test(p));
  assert.deepEqual(
    actuallyReachable,
    [],
    'a route listed as browser-unreachable is now in API_PATH. If it gained a UI '
      + 'caller, move it to KNOWN_BROWSER_REACHABLE instead of leaving it listed here',
  );
});

test('the unreachable set is not silently growing', () => {
  // A guard against "just add it to the allowlist and hope": the count is
  // pinned so a new orphan route is a deliberate decision.
  assert.equal(
    KNOWN_BROWSER_UNREACHABLE.length,
    2,
    'the set of server routes the browser cannot reach changed. If a route was '
      + 'added or removed on purpose, update this list in the same commit',
  );
});

// The unreachable routes are still actually served by the server
test('the unreachable routes are still actually served by the server', () => {
  // If one of these disappears from server.js, the entry is stale rather than
  // a real finding and should be removed from the list.
  const serverSrc = [
    'server.js',
    ...fs.readdirSync(path.join(ROOT, 'server', 'routes')).map((f) => path.join('routes', f)),
  ]
    .map((rel) => path.join(ROOT, 'server', rel))
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.readFileSync(p, 'utf8'))
    .join('\n');

  const missing = KNOWN_BROWSER_UNREACHABLE.filter((p) => !serverSrc.includes(p));
  assert.deepEqual(
    missing,
    [],
    'these routes are listed as served-but-unreachable but no longer appear in the server',
  );
});

// --- does a route actually have a UI caller? -----------------------------
//
// The header above says two independent things must line up: the API serves
// the path, and API_PATH admits it. Every test above only ever checked the
// second. So KNOWN_BROWSER_REACHABLE asserted "served and have UI callers"
// while testing nothing about callers at all -- and four of its nine entries
// had none:
//
//   /api/source-network/onboarding     no reference anywhere in src
//   /api/source-network/unbrowse/status  no reference anywhere in src
//   /api/watchlist/w1/comps            only an uncalled wrapper in intelligence-client
//   /api/auction-calendar              only an uncalled wrapper in intelligence-client
//
// A wrapper that nothing imports is the most misleading case: the file exists,
// it is typed, it is tested, and no user can reach it.
//
// So a route counts as caller-backed only if some file outside the proxy
// itself names its path AND that file is reachable from the UI layer -- either
// it is a component/page, or a src/lib module that something in the UI layer
// imports, transitively.

function collectSrcFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collectSrcFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// The proxy defines the allowlist; it must not count as a caller of itself.
const PROXY_FILE = path.join(ROOT, 'src', 'lib', 'property-api.ts');

function isUiLayer(file) {
  const rel = path.relative(path.join(ROOT, 'src'), file).split(path.sep).join('/');
  return rel.startsWith('components/') || rel.startsWith('app/');
}

// Resolves "some UI file imports this module, transitively" over relative
// specifiers only. Bare package imports are third-party and irrelevant here.
// Resolves "some UI file imports this module, transitively".
//
// Two specifier forms appear here: relative ("../lib/x") and the "@/" alias
// tsconfig maps to src/. Bare package specifiers are third-party and
// irrelevant to whether a UI file reaches a route.
function uiReachableModules(files) {
  const byPath = new Map(files.map((f) => [path.resolve(f), f]));
  const memo = new Map();
  const SRC_DIR = path.join(ROOT, 'src');

  const resolveSpec = (fromFile, spec) => {
    let base;
    if (spec.startsWith('@/')) base = path.join(SRC_DIR, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
    else return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (byPath.has(path.resolve(candidate))) return path.resolve(candidate);
    }
    return null;
  };

  const importedBy = new Map();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const match of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const target = resolveSpec(file, match[1]);
      if (!target) continue;
      if (!importedBy.has(target)) importedBy.set(target, new Set());
      importedBy.get(target).add(path.resolve(file));
    }
  }

  const reach = (file, seen = new Set()) => {
    const key = path.resolve(file);
    if (memo.has(key)) return memo.get(key);
    if (seen.has(key)) return false;
    seen.add(key);
    let result = isUiLayer(file);
    if (!result) {
      for (const importer of importedBy.get(key) || []) {
        if (reach(importer, seen)) { result = true; break; }
      }
    }
    memo.set(key, result);
    return result;
  };

  return { reach, byPath };
}

// These lists name concrete examples of parameterized routes
// ("/api/hunts/h1/evaluate" stands for /api/hunts/${id}/evaluate), so a plain
// string match would report every real caller as missing. Segments that look
// like an identifier become a wildcard that still cannot cross a quote, a
// slash or whitespace -- which is exactly what a template literal cannot do
// either, so `${id}` inside `/api/hunts/${id}/evaluate` still matches.
function callerRegex(route) {
  const IDENT_SEGMENT = /^(?:job_[a-z0-9]+|[a-z]{1,3}\d+|\d+|[0-9a-f]{16,})$/i;
  const pattern = route
    .split('/')
    .map((seg) => {
      if (!seg) return '';
      if (IDENT_SEGMENT.test(seg)) return "[^/'\"`\\s]+";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/')
    .replace(/\/\//g, '/');
  return new RegExp(pattern);
}

function callersFor(route, files, reach) {
  const re = callerRegex(route);
  return files.filter((file) => {
    if (path.resolve(file) === path.resolve(PROXY_FILE)) return false;
    return re.test(fs.readFileSync(file, 'utf8')) && reach(file);
  });
}

const SRC_FILES = collectSrcFiles(path.join(ROOT, 'src'));

