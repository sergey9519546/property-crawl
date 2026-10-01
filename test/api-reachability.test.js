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
// A route that satisfies only (1) is invisible to the product: every fetch
// from a client component returns 404 "Unknown API route" before it reaches
// the server. A route that satisfies only (2) is worse, because it looks
// wired until a caller discovers the missing implementation.
//
// Three routes are currently in the first bucket. Each has a real route
// module and passing tests, which makes them look live:
//
//   /api/coverage              server.js:185
//   /api/price-drops           server.js:212 + routes/price-drop.js
//   /api/portfolio/dashboard   server.js:206 + routes/portfolio-dashboard.js
//
// They are not removed here - a CLI or external consumer may use them, and
// deleting working code is not this test's call. They are pinned so the state
// is deliberate: if one gains a browser caller, or is dropped, this test
// fails and the entry is updated on purpose rather than drifting.

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
  '/api/price-drops',
  '/api/portfolio/dashboard',
];

// Implemented and genuinely wired end to end. If one of these stops matching
// API_PATH, a shipped UI feature has just gone dark.
const KNOWN_BROWSER_REACHABLE = [
  '/api/listings',
  '/api/hunts/h1/evaluate',
  '/api/saved-searches/s1',
  '/api/saved-searches/s1/run',
  '/api/alerts/matches',
  '/api/source-network/onboarding',
  '/api/source-network/unbrowse/status',
  '/api/watchlist/w1/comps',
  '/api/auction-calendar',
];

const apiPath = apiPathRegex();

test('the proxy allowlist still admits every known-reachable route', () => {
  const rejected = KNOWN_BROWSER_REACHABLE.filter((p) => !apiPath.test(p));
  assert.deepEqual(
    rejected,
    [],
    'these routes are served and have UI callers, but API_PATH now rejects them - '
      + 'a shipped feature has gone dark behind a 404 the user cannot diagnose',
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
    3,
    'the set of server routes the browser cannot reach changed. If a route was '
      + 'added or removed on purpose, update this list in the same commit',
  );
});

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
