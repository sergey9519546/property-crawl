'use strict';
/**
 * test/seo/meta-tags.test.js — Verification gate for Comprehensive Meta Tags,
 * Open Graph, Twitter Cards, Canonical URLs, and Social Sharing Discoverability.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

test('OG & Social Assets: public/og-image.png and public/og-image.svg exist and meet dimension standards', () => {
  const pngPath = path.join(ROOT, 'public/og-image.png');
  const svgPath = path.join(ROOT, 'public/og-image.svg');

  assert.ok(fs.existsSync(pngPath), 'public/og-image.png must exist');
  assert.ok(fs.existsSync(svgPath), 'public/og-image.svg must exist');

  const pngStats = fs.statSync(pngPath);
  assert.ok(pngStats.size > 1000, `public/og-image.png size (${pngStats.size} bytes) must be substantial`);

  const svgContent = fs.readFileSync(svgPath, 'utf8');
  assert.match(svgContent, /width="1200"/, 'SVG must declare 1200 width');
  assert.match(svgContent, /height="630"/, 'SVG must declare 630 height');
  assert.match(svgContent, /PerfectProperty/, 'SVG must display brand name');
});

const STATIC_METADATA_PAGES = [
  { route: '/', file: 'src/app/layout.tsx', canonical: '/' },
  { route: '/listings', file: 'src/app/listings/page.tsx', canonical: '/listings' },
  { route: '/states', file: 'src/app/states/page.tsx', canonical: '/states' },
  { route: '/about', file: 'src/app/about/page.tsx', canonical: '/about' },
  { route: '/resources', file: 'src/app/resources/page.tsx', canonical: '/resources' },
  { route: '/sources', file: 'src/app/sources/page.tsx', canonical: '/sources' },
  { route: '/research', file: 'src/app/research/page.tsx', canonical: '/research' },
  { route: '/hunts', file: 'src/app/hunts/page.tsx', canonical: '/hunts' },
  { route: '/privacy', file: 'src/app/privacy/page.tsx', canonical: '/privacy' },
  { route: '/terms', file: 'src/app/terms/page.tsx', canonical: '/terms' },
];

test('Meta Tags: all core static pages declare canonical URLs, Open Graph images, and Twitter summary_large_image', () => {
  for (const item of STATIC_METADATA_PAGES) {
    const fullPath = path.join(ROOT, item.file);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Canonical check
    assert.ok(
      content.includes(`canonical: "${item.canonical}"`) || content.includes(`canonical: '${item.canonical}'`),
      `${item.file} must declare canonical URL "${item.canonical}"`
    );

    // OpenGraph check
    assert.match(
      content,
      /openGraph:\s*\{/,
      `${item.file} must declare openGraph metadata`
    );
    assert.ok(
      content.includes('/og-image.png'),
      `${item.file} must configure og-image.png for social sharing`
    );

    // Twitter Card check
    assert.match(
      content,
      /twitter:\s*\{/,
      `${item.file} must declare twitter metadata`
    );
    assert.ok(
      content.includes('summary_large_image'),
      `${item.file} must configure summary_large_image for Twitter card`
    );
  }
});

test('Meta Tags: dynamic routes (/states/[state], /states/[state]/[county], /listings/[id], /[slug]) declare canonicals and social cards', () => {
  const dynamicFiles = [
    { file: 'src/app/states/[state]/page.tsx', canonicalPattern: /canonical:\s*canonicalUrl/ },
    { file: 'src/app/states/[state]/[county]/page.tsx', canonicalPattern: /alternates:\s*meta\.alternates/ },
    { file: 'src/app/listings/[id]/page.tsx', canonicalPattern: /canonical:\s*canonicalUrl/ },
    { file: 'src/app/[slug]/page.tsx', canonicalPattern: /canonical:\s*canonicalUrl/ },
  ];

  for (const item of dynamicFiles) {
    const fullPath = path.join(ROOT, item.file);
    const content = fs.readFileSync(fullPath, 'utf8');

    assert.match(
      content,
      item.canonicalPattern,
      `${item.file} must declare canonical alternate URL`
    );
    assert.ok(
      content.includes('summary_large_image'),
      `${item.file} must configure summary_large_image for social sharing`
    );
    assert.ok(
      content.includes('/og-image.png'),
      `${item.file} must configure /og-image.png fallback for social cards`
    );
  }
});

test('Structured Data: WebSite schema includes SearchAction for sitelinks searchbox', () => {
  const schemaPath = path.join(ROOT, 'src/components/site/seo-schema.tsx');
  const content = fs.readFileSync(schemaPath, 'utf8');

  assert.match(content, /"@type":\s*"SearchAction"/, 'WebSite schema must contain SearchAction');
  assert.match(content, /"urlTemplate":\s*`\${baseUrl}\/listings\?q=\{search_term_string\}`/, 'SearchAction must point to listings query URL');
  assert.match(content, /"query-input":\s*"required name=search_term_string"/, 'SearchAction must specify query-input name');
});
