// =============================================================
// PROPERTY_CRAWL — Source Registry Sync Drift Detector
// =============================================================
//
// The source registry exists in two places:
//   1) data.js (window.SOURCES) — production, used by the static PWA
//      and loaded by server/db/client.js into the Node server.
//   2) src/components/terminal/property-data.ts (export const SOURCES)
//      — used by the Next.js marketing site (src/app/page.tsx).
//
// If they drift, the "View on source" link, tier badge, and color
// chips look different depending on which surface the user is on.
// This test fails loudly when they disagree, so CI catches it.
//
// Add `node test/sync.test.js` to the runner in test/verify.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const dataJsPath = path.join(root, 'data.js');
const propertyDataTsPath = path.join(root, 'src', 'components', 'terminal', 'property-data.ts');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// -------------------------------------------------------------
// Load v0 SOURCES by running data.js in a VM sandbox
// -------------------------------------------------------------
function loadV0Sources() {
  const src = fs.readFileSync(dataJsPath, 'utf8');
  const sandbox = { window: {}, Math };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.SOURCES;
}

// -------------------------------------------------------------
// Load v2 SOURCES by extracting the object literal from the
// TypeScript file. The SOURCES object literal in property-data.ts
// is plain JS object syntax (no TS-specific syntax inside the braces),
// so once we extract the braces-balanced block we can eval it.
// -------------------------------------------------------------
function loadV2Sources() {
  const src = fs.readFileSync(propertyDataTsPath, 'utf8');
  const start = src.indexOf('export const SOURCES');
  if (start === -1) throw new Error('Could not find SOURCES in property-data.ts');
  const braceStart = src.indexOf('{', start);
  if (braceStart === -1) throw new Error('Could not find opening { of SOURCES block');
  // Walk forward to find the matching closing brace.
  let depth = 0;
  let i = braceStart;
  let inString = false;
  let stringChar = null;
  for (; i < src.length; i++) {
    const c = src[i];
    // Naive string tracking so braces inside strings don't fool us
    if (!inString && (c === "'" || c === '"' || c === '`')) {
      inString = true; stringChar = c;
      continue;
    }
    if (inString && c === stringChar && src[i - 1] !== '\\') {
      inString = false; stringChar = null;
      continue;
    }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  const block = src.slice(braceStart, i);
  // Block is plain JS object syntax — eval it.
  // eslint-disable-next-line no-new-func
  return (new Function('return (' + block + ')'))();
}

console.log('--- SOURCE REGISTRY SYNC DRIFT CHECK ---');

const v0 = loadV0Sources();
const v2 = loadV2Sources();

const v0Keys = Object.keys(v0).sort();
const v2Keys = Object.keys(v2).sort();

test('SOURCES block exists in both layers', () => {
  assert.ok(v0 && typeof v0 === 'object', 'v0 SOURCES is missing');
  assert.ok(v2 && typeof v2 === 'object', 'v2 SOURCES is missing');
});

test('SOURCES have the same 11 keys (no rename/add/remove drift)', () => {
  assert.deepStrictEqual(v2Keys, v0Keys, `Keys differ.\n  v0: ${v0Keys.join(', ')}\n  v2: ${v2Keys.join(', ')}`);
});

test('SOURCES have the same label / tier / color / note / websiteUrl per key', () => {
  const FIELDS = ['label', 'tier', 'color', 'note', 'websiteUrl'];
  for (const k of v0Keys) {
    for (const f of FIELDS) {
      const a = (v0[k] || {})[f];
      const b = (v2[k] || {})[f];
      assert.strictEqual(b, a, `Mismatch on SOURCES.${k}.${f}\n  v0: ${JSON.stringify(a)}\n  v2: ${JSON.stringify(b)}`);
    }
  }
});

// -------------------------------------------------------------
// Listings drift check (smoke): the v0 dashboard has 20 listings
// and the v1 server should report 20 via /api/health seed message.
// We do NOT enforce that the v2 marketing demo's 6 listings match
// v0's 20, because v2 is intentionally a curated marketing demo.
// We only flag obvious cross-checks (e.g. count > 0).
// -------------------------------------------------------------
test('v0 dashboard has a valid listings array initialized', () => {
  const dataSrc = fs.readFileSync(dataJsPath, 'utf8');
  const sandbox = { window: {}, Math };
  vm.createContext(sandbox);
  vm.runInContext(dataSrc, sandbox);
  assert.ok(Array.isArray(sandbox.window.LISTINGS), 'v0 dashboard should have an initialized LISTINGS array');
});

test('generated listings never expose a source homepage as an exact record URL', () => {
  const dataSrc = fs.readFileSync(dataJsPath, 'utf8');
  const sandbox = { window: {}, Math };
  vm.createContext(sandbox);
  vm.runInContext(dataSrc, sandbox);
  for (const listing of sandbox.window.LISTINGS) {
    if (!listing.sourceUrl) continue;
    const homepage = sandbox.window.SOURCES[listing.source]?.websiteUrl;
    assert.notStrictEqual(
      listing.sourceUrl.replace(/\/+$/, ''),
      homepage?.replace(/\/+$/, ''),
      `${listing.id} points at a generic source homepage`,
    );
  }
});

test('v2 marketing demo has at least 3 listings (curated subset)', () => {
  const dataSrc = fs.readFileSync(propertyDataTsPath, 'utf8');
  const start = dataSrc.indexOf('export const INITIAL_LISTINGS');
  if (start === -1) throw new Error('Could not find INITIAL_LISTINGS');
  const m = dataSrc.slice(start, start + 4000).match(/id:\s*'([\w-]+)'/g);
  const ids = m || [];
  assert.ok(ids.length >= 3, `v2 should demo at least 3 listings, found ${ids.length}`);
});

console.log(`--- SYNC TEST SUMMARY: ${passed} Passed, ${failed} Failed ---`);
process.exit(failed > 0 ? 1 : 0);
