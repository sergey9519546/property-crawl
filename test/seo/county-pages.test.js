'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

const {
  normalizeCountySlug,
  countyToSlug,
  formatCountyDisplayName,
  computeCountyStats,
  getStatutoryRedemption,
  generateCountyMetadata,
  buildCountyBreadcrumbs,
  buildCountyItemList,
} = require('../../src/lib/county-seo.js');

function loadTs(relative) {
  const filename = path.resolve(__dirname, '../..', relative);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = instance.require.bind(instance);
  instance.require = function (name) {
    if (name === 'server-only') return {};
    return originalRequire(name);
  };
  instance._compile(
    transformSync(fs.readFileSync(filename, 'utf8'), {
      filename,
      module: { type: 'commonjs' },
      jsc: {
        parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') },
        target: 'es2022',
        transform: { react: { runtime: 'automatic' } },
      },
    }).code,
    filename
  );
  return instance.exports;
}

const { serializeJsonLd } = loadTs('src/lib/json-ld.ts');

test('County SEO: county slug normalization handles variations, hyphens, and casing', () => {
  // Lowercase single words
  assert.equal(normalizeCountySlug('essex'), 'Essex');
  assert.equal(normalizeCountySlug('cuyahoga'), 'Cuyahoga');

  // Hyphenated slugs
  assert.equal(normalizeCountySlug('orange-county'), 'Orange County');
  assert.equal(normalizeCountySlug('san-diego'), 'San Diego');
  assert.equal(normalizeCountySlug('miami-dade'), 'Miami-Dade');

  // Encoded URL slugs
  assert.equal(normalizeCountySlug('Palm%20Beach'), 'Palm Beach');
  assert.equal(normalizeCountySlug('prince-george-s'), "Prince George's");

  // Slug conversion
  assert.equal(countyToSlug('Essex'), 'essex');
  assert.equal(countyToSlug('Orange County'), 'orange-county');
  assert.equal(countyToSlug('Miami-Dade'), 'miami-dade');
  assert.equal(countyToSlug("Prince George's"), 'prince-georges');

  // Display name formatting
  assert.equal(formatCountyDisplayName('Essex'), 'Essex County');
  assert.equal(formatCountyDisplayName('orange county'), 'Orange County');
  assert.equal(formatCountyDisplayName('Miami-Dade'), 'Miami-Dade County');
});

test('County SEO: computeCountyStats calculates count, median opening bid, median deal score, and breakdown', () => {
  const sampleListings = [
    { id: '1', openingBid: 100000, dealScore: 70, source: 'sheriff', propType: 'Single Family' },
    { id: '2', openingBid: 200000, dealScore: 80, source: 'sheriff', propType: 'Condo' },
    { id: '3', openingBid: 300000, dealScore: 90, source: 'civilview', propType: 'Single Family' },
  ];

  const stats = computeCountyStats(sampleListings);
  assert.equal(stats.totalCount, 3);
  assert.equal(stats.medianOpeningBid, 200000);
  assert.equal(stats.medianDealScore, 80);
  assert.deepEqual(stats.sourceBreakdown, { sheriff: 2, civilview: 1 });
  assert.deepEqual(stats.propertyTypes, { 'Single Family': 2, Condo: 1 });

  // Empty listings edge case
  const emptyStats = computeCountyStats([]);
  assert.equal(emptyStats.totalCount, 0);
  assert.equal(emptyStats.medianOpeningBid, null);
  assert.equal(emptyStats.medianDealScore, null);
});

test('County SEO: getStatutoryRedemption resolves accurate state statutory redemption rules', () => {
  // New Jersey: 10 days
  const nj = getStatutoryRedemption('NJ');
  assert.equal(nj.days, 10);
  assert.match(nj.label, /N\.J\. Ct\. R\. 4:65-5/);

  // Ohio: 0 days
  const oh = getStatutoryRedemption('OH');
  assert.equal(oh.days, 0);
  assert.match(oh.label, /R\.C\. 2329\.33/);

  // Florida: 0 days
  const fl = getStatutoryRedemption('FL');
  assert.equal(fl.days, 0);

  // Unknown state fallback
  const xx = getStatutoryRedemption('XX');
  assert.equal(xx.days, null);
  assert.match(xx.label, /Statutory redemption details require review/);
});

test('County SEO: generateCountyMetadata creates compliant title, description, and canonical tags', () => {
  const meta = generateCountyMetadata({
    state: 'NJ',
    county: 'Essex',
    count: 24,
    medianBid: 185000,
    baseUrl: 'https://perfectproperty.org',
  });

  assert.equal(meta.title, 'Distressed & Foreclosure Property in Essex County, NJ | PerfectProperty');
  assert.match(meta.description, /Explore 24 active distressed, foreclosure, and tax-deed properties in Essex County, NJ/);
  assert.match(meta.description, /\$185,000/);
  assert.equal(meta.alternates.canonical, 'https://perfectproperty.org/states/NJ/essex');

  assert.deepEqual(meta.openGraph, {
    title: 'Distressed & Foreclosure Property in Essex County, NJ | PerfectProperty',
    description: meta.description,
    url: 'https://perfectproperty.org/states/NJ/essex',
    siteName: 'PerfectProperty',
    type: 'website',
  });
});

test('County SEO: schema.org BreadcrumbList structure is valid and compliant', () => {
  const schema = buildCountyBreadcrumbs({
    state: 'OH',
    county: 'Cuyahoga',
    baseUrl: 'https://perfectproperty.org',
  });

  assert.equal(schema['@context'], 'https://schema.org');
  assert.equal(schema['@type'], 'BreadcrumbList');
  assert.equal(schema.itemListElement.length, 4);

  assert.deepEqual(schema.itemListElement[0], {
    '@type': 'ListItem',
    position: 1,
    name: 'Home',
    item: 'https://perfectproperty.org',
  });

  assert.deepEqual(schema.itemListElement[1], {
    '@type': 'ListItem',
    position: 2,
    name: 'States',
    item: 'https://perfectproperty.org/states',
  });

  assert.deepEqual(schema.itemListElement[2], {
    '@type': 'ListItem',
    position: 3,
    name: 'OH',
    item: 'https://perfectproperty.org/states/OH',
  });

  assert.deepEqual(schema.itemListElement[3], {
    '@type': 'ListItem',
    position: 4,
    name: 'Cuyahoga County',
    item: 'https://perfectproperty.org/states/OH/cuyahoga',
  });
});

test('County SEO: schema.org ItemList structure is valid and sanitizes against script injection', () => {
  const listings = [
    {
      id: 'NJ-01',
      address: '100 Main St <script>alert("xss")</script>',
      openingBid: 120000,
      dealScore: 85,
      propType: 'Single Family',
    },
    {
      id: 'NJ-02',
      address: '200 Oak Ave',
      openingBid: 95000,
      dealScore: 78,
      propType: 'Condo',
    },
  ];

  const itemList = buildCountyItemList({
    state: 'NJ',
    county: 'Essex',
    listings,
    baseUrl: 'https://perfectproperty.org',
  });

  assert.equal(itemList['@context'], 'https://schema.org');
  assert.equal(itemList['@type'], 'ItemList');
  assert.equal(itemList.numberOfItems, 2);
  assert.equal(itemList.itemListElement.length, 2);

  const firstItem = itemList.itemListElement[0];
  assert.equal(firstItem.position, 1);
  assert.equal(firstItem.url, 'https://perfectproperty.org/listings/NJ-01');
  assert.match(firstItem.name, /100 Main St/);

  // Verify serializeJsonLd neutralizes <script> injection characters
  const serialized = serializeJsonLd(itemList);
  assert.doesNotMatch(serialized, /<script>/);
  assert.doesNotMatch(serialized, /<\/script>/);
  assert.match(serialized, /\\u003cscript\\u003e/);
});
