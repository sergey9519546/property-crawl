'use strict';

// test/responsive-acceptance-contract.test.js
//
// Static, browser-free contract for the project's responsive acceptance
// surface. The Playwright suite (test/next_ui_e2e_test.py) covers viewport
// rendering at specific widths; this contract asserts the structural
// foundations the e2e tests rely on:
//
//   1. The project's documented breakpoints (mobile <640, tablet 640-1279,
//      desktop 1280+) are declared in globals.css.
//   2. globals.css honors max-width:100vw on top-level wrappers so a
//      runaway child can't blow out the mobile viewport.
//   3. Layout-bearing components (those that actually render visible
//      page sections) reference at least one of the project's documented
//      breakpoints via Tailwind responsive prefixes (`md:`, `lg:`, `xl:`).
//      A component that never declares a responsive prefix cannot
//      reflow between breakpoints — flagging it here surfaces the bug
//      before a real user hits it on a phone.
//   4. globals.css does not introduce a root-level horizontal scroll,
//      which would defeat the entire mobile layout.
//
// The contract is a regression gate: a commit that drops one of these
// declarations will trip these tests without needing a browser run.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const globalsCss = fs.readFileSync(path.join(repoRoot, 'src/app/globals.css'), 'utf8');

// --- 1. Breakpoint declaration contract ------------------------------

test('globals.css declares a mobile breakpoint (max-width: 640px)', () => {
  // The small-mobile breakpoint uses max-width, the others use min-width.
  assert.match(globalsCss, /@media\s*\([^)]*max-width:\s*640px[^)]*\)/, 'expected @media (max-width: 640px) block');
});

test('globals.css declares a tablet breakpoint (min-width: 768px)', () => {
  assert.match(globalsCss, /@media\s*\([^)]*min-width:\s*768px[^)]*\)/, 'expected @media (min-width: 768px) block');
});

test('globals.css declares a desktop breakpoint (min-width: 1280px)', () => {
  assert.match(globalsCss, /@media\s*\([^)]*min-width:\s*1280px[^)]*\)/, 'expected @media (min-width: 1280px) block');
});

test('globals.css declares a hover-capable desktop refinement', () => {
  // CSS supports `(hover: hover) and (pointer: fine)` as a chained
  // media-query — both conditions live inside their own parentheses.
  assert.match(globalsCss, /@media\s*\(\s*hover:\s*hover\s*\)\s*and\s*\(\s*pointer:\s*fine\s*\)/, 'expected @media (hover: hover) and (pointer: fine) block');
});

test('globals.css declares a reduced-motion accommodation', () => {
  assert.match(globalsCss, /@media\s*\([^)]*prefers-reduced-motion:\s*reduce[^)]*\)/, 'expected prefers-reduced-motion block');
});

// --- 2. Layout-container integrity contract --------------------------

test('globals.css does not introduce horizontal scroll at the page root', () => {
  // Top-level containers must use overflow-x:hidden (or omit overflow
  // entirely) — overflow-x:scroll on the root would defeat the entire
  // mobile layout. Look for the dangerous pattern explicitly.
  const dangerous = globalsCss.match(/(?:^|\n)\s*(?:html|body|#__next|:root)\s*\{[^}]*overflow-x:\s*scroll/g);
  assert.equal(dangerous, null, 'no root-level overflow-x:scroll is allowed');
});

test('globals.css honors max-width:100vw on top-level wrappers', () => {
  // At least one top-level wrapper must be clamped so a runaway child
  // can't blow out the viewport on mobile.
  assert.match(globalsCss, /max-width:\s*100vw/, 'expected at least one max-width:100vw guard on a top-level wrapper');
});

// --- 3. Layout-bearing component coverage ---------------------------

// A component is "layout-bearing" when it renders top-level structural
// markup that fills a meaningful portion of the page. We don't try to be
// precise about layout — instead we flag the components a release engineer
// would expect to drive the mobile reflow (header, hero, footer, workbench,
// property drawer, etc.) and assert each one carries at least one
// responsive prefix.
const LAYOUT_COMPONENTS = Object.freeze([
  'src/components/site/site-header.tsx',
  'src/components/site/site-footer.tsx',
  'src/components/site/hero.tsx',
  'src/components/listings/discovery-workbench.tsx',
  'src/components/listings/discovery-card.tsx',
  'src/components/listings/listing-media.tsx',
  'src/components/listings/property-intelligence.tsx',
]);

const RESPONSIVE_PREFIXES = Object.freeze(['sm:', 'md:', 'lg:', 'xl:', '2xl:']);

function findResponsivePrefixes(src) {
  return RESPONSIVE_PREFIXES.filter((p) => src.includes(p));
}

test('every layout-bearing component declares at least one responsive prefix', () => {
  const offenders = [];
  for (const rel of LAYOUT_COMPONENTS) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue; // optional: skip components not present in this build
    const src = fs.readFileSync(abs, 'utf8');
    const found = findResponsivePrefixes(src);
    if (found.length === 0) {
      offenders.push(rel);
    }
  }
  assert.equal(offenders.length, 0, `Layout-bearing components without any responsive prefix: ${offenders.join(', ')}`);
});

// --- 4. Touch-target contract ---------------------------------------

test('globals.css mobile breakpoint does not regress touch-target size below 44px', () => {
  // Apple HIG and WCAG 2.5.5 both recommend a 44px minimum touch target.
  // If globals.css declares min-height under the mobile breakpoint,
  // it must be at least 44px. CSS without a min-height declaration
  // under mobile is fine (Tailwind handles most interactive surfaces
  // elsewhere) — we only flag a regression, never require new rules.
  const mobileBlock = globalsCss.match(/@media\s*\([^)]*max-width:\s*640px[^)]*\)\s*\{([\s\S]*?)\n\}/);
  if (!mobileBlock) return;
  const inner = mobileBlock[1];
  const minHeights = [...inner.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]));
  for (const h of minHeights) {
    assert.ok(h >= 44, `mobile min-height of ${h}px is below the 44px touch-target floor`);
  }
});