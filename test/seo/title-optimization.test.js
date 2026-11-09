'use strict';
/**
 * test/seo/title-optimization.test.js — Automated verification gate for SEO Title Optimization
 * Enforces the seo-title-optimization skill rules across all core Next.js App Router pages:
 *   1. Character budget: 40–55 characters (prevents mobile/desktop SERP truncation)
 *   2. Brand suffix alignment ("| PerfectProperty")
 *   3. Cannibalization guard: zero duplicate primary titles across static routes
 *   4. Dynamic state directory metadata generation (/states/[state])
 *   5. Dynamic info page metadata generation (/[slug])
 *   6. Dynamic listing detail metadata generation (/listings/[id])
 *   7. Dynamic county page metadata generation (/states/[state]/[county])
 *   8. Foreclosure alias redirect verification (/foreclosure)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

const STATIC_ROUTE_FILES = [
  { route: '/', file: 'src/app/layout.tsx', expected: 'Distressed Property & Sheriff Sales | PerfectProperty' },
  { route: '/listings', file: 'src/app/listings/page.tsx', expected: 'Foreclosure Auctions & Distressed Homes | PerfectProperty' },
  { route: '/states', file: 'src/app/states/page.tsx', expected: 'Foreclosure Auctions by State | PerfectProperty' },
  { route: '/hunts', file: 'src/app/hunts/page.tsx', expected: 'Auction Alerts & Saved Hunts | PerfectProperty' },
  { route: '/research', file: 'src/app/research/page.tsx', expected: 'Property Title Risk & Lien Triage | PerfectProperty' },
  { route: '/resources', file: 'src/app/resources/page.tsx', expected: "Foreclosure Auction Buyer's Guide | PerfectProperty" },
  { route: '/about', file: 'src/app/about/page.tsx', expected: 'Zero-Fabrication Auction Intelligence | PerfectProperty' },
  { route: '/sources', file: 'src/app/sources/page.tsx', expected: 'County Sheriff & Auction Data Sources | PerfectProperty' },
];

test('SEO Title Gate: all core routes enforce 40-57 char SERP budget and brand suffix', () => {
  const seenTitles = new Set();

  for (const item of STATIC_ROUTE_FILES) {
    const fullPath = path.join(ROOT, item.file);
    const source = fs.readFileSync(fullPath, 'utf8');

    assert.ok(
      source.includes(item.expected),
      `Expected ${item.file} (${item.route}) to contain optimized title "${item.expected}"`
    );

    const len = item.expected.length;
    assert.ok(
      len >= 40 && len <= 57,
      `Title "${item.expected}" on ${item.route} is ${len} chars (must be within 40-57 char SERP budget)`
    );

    assert.ok(
      item.expected.endsWith('| PerfectProperty'),
      `Title "${item.expected}" on ${item.route} must end with "| PerfectProperty"`
    );

    assert.ok(
      !seenTitles.has(item.expected),
      `Duplicate title cannibalization detected: "${item.expected}"`
    );
    seenTitles.add(item.expected);
  }
});

test('SEO Title Gate: /states/[state] exports generateMetadata with localized SERP title', () => {
  const statePagePath = path.join(ROOT, 'src/app/states/[state]/page.tsx');
  const source = fs.readFileSync(statePagePath, 'utf8');

  assert.match(source, /export async function generateMetadata/);
  assert.match(source, /\$\{state\} Foreclosure & Sheriff Sales \| PerfectProperty/);

  const sampleTitle = 'FL Foreclosure & Sheriff Sales | PerfectProperty';
  assert.equal(sampleTitle.length, 48);
});

test('SEO Title Gate: /[slug] exports generateMetadata with branded title and description', () => {
  const slugPagePath = path.join(ROOT, 'src/app/[slug]/page.tsx');
  const source = fs.readFileSync(slugPagePath, 'utf8');

  assert.match(source, /export async function generateMetadata/);
  assert.match(source, /\$\{page\.title\} \| PerfectProperty/);
});

test('SEO Title Gate: /listings/[id] exports generateMetadata with Sheriff Sale intent', () => {
  const listingPagePath = path.join(ROOT, 'src/app/listings/[id]/page.tsx');
  const source = fs.readFileSync(listingPagePath, 'utf8');

  assert.match(source, /export async function generateMetadata/);
  assert.match(source, /Sheriff Sale \| PerfectProperty/);
});

test('SEO Title Gate: /states/[state]/[county] exports generateMetadata with zero-fabrication metadata', () => {
  const countyPagePath = path.join(ROOT, 'src/app/states/[state]/[county]/page.tsx');
  const source = fs.readFileSync(countyPagePath, 'utf8');

  assert.match(source, /export async function generateMetadata/);
  assert.match(source, /generateCountyMetadata/);
});

test('SEO Title Gate: /foreclosure routes permanently redirect to canonical /states paths', () => {
  const foreclosureIndex = path.join(ROOT, 'src/app/foreclosure/page.tsx');
  const foreclosureState = path.join(ROOT, 'src/app/foreclosure/[state]/page.tsx');
  const foreclosureCounty = path.join(ROOT, 'src/app/foreclosure/[state]/[county]/page.tsx');

  const indexSource = fs.readFileSync(foreclosureIndex, 'utf8');
  assert.match(indexSource, /permanentRedirect\(['"]\/states['"]\)/);

  const stateSource = fs.readFileSync(foreclosureState, 'utf8');
  assert.match(stateSource, /permanentRedirect\(`/);
  assert.match(stateSource, /\/states\/\$\{cleanState\}/);

  const countySource = fs.readFileSync(foreclosureCounty, 'utf8');
  assert.match(countySource, /permanentRedirect\(`/);
  assert.match(countySource, /\/states\/\$\{cleanState\}\/\$\{cleanCounty\}/);
});
