// test/heavy-map-deferred.test.js
//
// Regression guard for the landing page's critical path.
//
// The atlas in Storyteller is a MapLibre GL canvas. The engine ships as one
// ~1 MB shared chunk -- the same one the terminal's market map and the listing
// media viewer use. Three separate things have to hold for that megabyte to stay
// off the first paint, and all three were true only by accident:
//
//   1. Each map component loads the engine with `import("maplibre-gl")`, not a
//      static import. A static import would pull the chunk into the route's
//      initial <script> set, and no amount of lazy mounting downstream helps.
//   2. Storyteller's DEFAULT STAGE is "find", so the atlas mounts on first
//      paint. `next/dynamic` alone therefore changed nothing: the chunk was
//      still requested inside the critical window. It is only kept out by
//      mounting the atlas when its section nears the viewport.
//   3. The lazy placeholder must reserve the same height as the map it stands in
//      for, or deferring the map silently trades LCP for CLS. The page scores
//      CLS 0.00 and that must not become the price of a cheaper first paint.
//
// Measured when this was written: script requests on `/` fell from 22 to 18 and
// the chunk stopped being fetched at all; LCP 1590 ms -> 247 ms, CLS unchanged.
// Scrolling the atlas into view brings the chunk back, so the feature still
// works -- it is deferred, not removed.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Assert a source file matches a pattern.
 *
 * Deliberately not `assert.match(src, re)`: on failure that prints the entire
 * source file, and these are 20 KB components, so a one-line failure buries
 * itself in noise. Report the rule that broke instead.
 */
function sourceHas(rel, re, rule) {
  const src = read(rel);
  assert.ok(re.test(src), `${rel}: ${rule}`);
}

const MAP_COMPONENTS = [
  'src/components/site/deal-discovery-map.tsx',
  'src/components/terminal/market-map.tsx',
  'src/components/listings/listing-media.tsx',
];

test('no map component statically imports the engine', () => {
  // A value import (as opposed to `import type`, which is erased at compile
  // time and costs nothing) would put ~1 MB in the route's initial script set.
  for (const rel of MAP_COMPONENTS) {
    const valueImports = [...read(rel).matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']maplibre-gl["']/gm)];
    assert.equal(valueImports.length, 0,
      `${rel} statically imports maplibre-gl; use \`import("maplibre-gl")\` inside the effect instead`);
  }
});

test('every map component loads the engine dynamically', () => {
  for (const rel of MAP_COMPONENTS) {
    sourceHas(rel, /import\(\s*["']maplibre-gl["']\s*\)/,
      'must load maplibre-gl with a dynamic import so the chunk stays split');
  }
});

test('the atlas is not mounted on first paint', () => {
  const rel = 'src/components/site/storyteller.tsx';
  // The stage gate alone is not enough: the default stage IS "find", so the
  // atlas would mount immediately. It has to go through the viewport gate.
  sourceHas(rel, /stage[^=]*=\s*(?:React\.)?useState<StageKey>\(\s*["']find["']\s*\)/,
    'this guard assumes the default stage is "find"; if that changed, revisit why the atlas needs deferring');
  const src = read(rel);
  assert.ok(!/return\s+<OpportunityAtlas\s*\/>/.test(src),
    `${rel}: the atlas must not be returned directly; route it through the viewport-deferred wrapper`);
  sourceHas(rel, /<DeferredOpportunityAtlas\s*\/>/, 'the atlas must be mounted through DeferredOpportunityAtlas');
  sourceHas(rel, /IntersectionObserver/, 'the deferral must be driven by an IntersectionObserver');
  sourceHas(rel, /rootMargin/,
    'the observer should start the import slightly before the section is on screen');
});

test('lazy placeholders reserve the height of the map they replace', () => {
  // The trade this guard exists to prevent: defer the map, forget to reserve its
  // space, and CLS goes from 0.00 to whatever the insertion costs.
  const storyteller = read('src/components/site/storyteller.tsx');
  const atlasPlaceholder = storyteller.match(/function AtlasPlaceholder[\s\S]*?className="([^"]+)"/);
  assert.ok(atlasPlaceholder, 'could not find AtlasPlaceholder and its className');
  for (const h of ['h-[390px]', 'sm:h-[480px]', 'lg:h-[620px]']) {
    assert.ok(atlasPlaceholder[1].includes(h),
      `AtlasPlaceholder must reserve ${h}; it has: ${atlasPlaceholder[1]}`);
  }

  const atlas = read('src/components/site/deal-discovery-map.tsx');
  for (const h of ['h-[390px]', 'sm:h-[480px]', 'lg:h-[620px]']) {
    assert.ok(atlas.includes(h), `the atlas root must stay ${h} for the placeholder to match it`);
  }

  const terminal = read('src/components/terminal/interactive-terminal.tsx');
  const marketPlaceholder = terminal.match(/const MarketMap = dynamic[\s\S]*?className="([^"]+)"/);
  assert.ok(marketPlaceholder, 'could not find the MarketMap loading placeholder');
  for (const h of ['h-[520px]', 'sm:h-[600px]', 'lg:h-[660px]']) {
    assert.ok(marketPlaceholder[1].includes(h),
      `the MarketMap placeholder must reserve ${h}; it has: ${marketPlaceholder[1]}`);
  }

  const market = read('src/components/terminal/market-map.tsx');
  for (const h of ['h-[520px]', 'sm:h-[600px]', 'lg:h-[660px]']) {
    assert.ok(market.includes(h), `the market map must stay ${h} for the placeholder to match it`);
  }
});
