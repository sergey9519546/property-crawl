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
  getStatutoryFeeSchedule,
  generateHighCtrCountyTitle,
  generateCountyMetadata,
  buildCountyBreadcrumbs,
  buildCountyItemList,
  buildCountyFaqSchema,
} = require('../../src/lib/county-seo.js');

const serverSeo = require('../../server/seo/index.js');

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

test('County SEO: getStatutoryRedemption resolves upset bid periods and homestead distinctions', () => {
  // North Carolina: 10-day upset bid under N.C.G.S. § 45-21.27
  const nc = getStatutoryRedemption('NC');
  assert.equal(nc.days, 10);
  assert.ok(nc.upsetBid);
  assert.equal(nc.upsetBid.hasUpsetBid, true);
  assert.equal(nc.upsetBid.windowDays, 10);
  assert.equal(nc.upsetBid.minDepositPct, 0.05);
  assert.equal(nc.upsetBid.minDepositFloor, 750);
  assert.match(nc.upsetBid.statute, /45-21\.27/);

  // South Carolina: 30-day upset bid under S.C. Code § 15-39-720
  const sc = getStatutoryRedemption('SC');
  assert.equal(sc.days, 30);
  assert.ok(sc.upsetBid);
  assert.equal(sc.upsetBid.hasUpsetBid, true);
  assert.equal(sc.upsetBid.windowDays, 30);
  assert.match(sc.upsetBid.statute, /15-39-720/);

  // Alabama: 180-day homestead vs 365-day non-homestead under Ala. Code § 6-5-248
  const al = getStatutoryRedemption('AL');
  assert.equal(al.days, 180);
  assert.ok(al.homesteadDistinction);
  assert.equal(al.homesteadDistinction.hasDistinction, true);
  assert.equal(al.homesteadDistinction.homesteadDays, 180);
  assert.equal(al.homesteadDistinction.nonHomesteadDays, 365);
  assert.equal(al.homesteadDistinction.interestRatePct, 12);
  assert.match(al.homesteadDistinction.statute, /6-5-248/);

  // Texas: 2-year (730-day) homestead/ag vs 180-day non-homestead under Tex. Tax Code § 34.21
  const tx = getStatutoryRedemption('TX');
  assert.equal(tx.days, 180);
  assert.ok(tx.homesteadDistinction);
  assert.equal(tx.homesteadDistinction.hasDistinction, true);
  assert.equal(tx.homesteadDistinction.homesteadDays, 730);
  assert.equal(tx.homesteadDistinction.nonHomesteadDays, 180);
  assert.match(tx.homesteadDistinction.statute, /34\.21/);
});

test('County SEO: getStatutoryFeeSchedule resolves statutory transfer taxes, poundage, and citations', () => {
  // New Jersey: N.J.S.A. 22A:4-8 poundage & N.J.S.A. 46:15-7 Realty Transfer Fee
  const nj = getStatutoryFeeSchedule('NJ', 200000);
  assert.equal(nj.isSupported, true);
  assert.match(nj.scheduleLabel, /New Jersey/);
  assert.match(nj.transferTaxCitation, /N\.J\.S\.A\. 46:15-7/);
  assert.match(nj.sheriffPoundageCitation, /N\.J\.S\.A\. 22A:4-8/);
  assert.match(nj.depositRequirement, /20%/);
  assert.equal(nj.settlementWindowHours, 720);
  assert.ok(nj.estimatedFees.transferTax > 0);
  assert.ok(nj.estimatedFees.sheriffPoundage > 0);

  // Ohio: ORC § 319.54 conveyance fee & ORC § 311.17 poundage
  const oh = getStatutoryFeeSchedule('OH', 100000);
  assert.equal(oh.isSupported, true);
  assert.match(oh.transferTaxCitation, /ORC § 319\.54/);
  assert.match(oh.sheriffPoundageCitation, /ORC § 311\.17/);

  // Florida: Fla. Stat. § 201.02 doc stamps & Fla. Stat. § 28.24 registry fee
  const fl = getStatutoryFeeSchedule('FL', 100000);
  assert.equal(fl.isSupported, true);
  assert.match(fl.transferTaxCitation, /Fla\. Stat\. § 201\.02/);
  assert.match(fl.sheriffPoundageCitation, /Fla\. Stat\. § 28\.24/);
  assert.match(fl.depositRequirement, /5%/);
  assert.equal(fl.settlementWindowHours, 24);

  // Pennsylvania: 72 P.S. § 8102-C (2% transfer tax) & 42 Pa.C.S. § 21107 (sheriff poundage)
  const pa = getStatutoryFeeSchedule('PA', 150000);
  assert.equal(pa.isSupported, true);
  assert.match(pa.transferTaxCitation, /72 P\.S\. § 8102-C/);
  assert.match(pa.sheriffPoundageCitation, /42 Pa\.C\.S\. § 21107/);

  // North Carolina: N.C.G.S. § 105-228.30 excise tax & N.C.G.S. § 45-21.15 commission cap
  const nc = getStatutoryFeeSchedule('NC', 150000);
  assert.equal(nc.isSupported, true);
  assert.match(nc.transferTaxCitation, /N\.C\.G\.S\. § 105-228\.30/);
  assert.match(nc.sheriffPoundageCitation, /N\.C\.G\.S\. § 45-21\.15/);
  assert.match(nc.depositRequirement, /N\.C\.G\.S\. § 45-21\.27/);

  // Texas: Texas Const. art. VIII § 29 ($0 transfer tax)
  const tx = getStatutoryFeeSchedule('TX', 250000);
  assert.equal(tx.isSupported, true);
  assert.equal(tx.transferTaxRatePerThousand, 0);
  assert.match(tx.transferTaxCitation, /Texas Const\. art\. VIII § 29/);

  // California: Cal. Rev. & Tax Code § 11911 documentary transfer tax
  const ca = getStatutoryFeeSchedule('CA', 500000);
  assert.equal(ca.isSupported, true);
  assert.match(ca.transferTaxCitation, /Cal\. Rev\. & Tax Code § 11911/);
  assert.match(ca.sheriffPoundageCitation, /Cal\. Civ\. Code § 2924h/);

  // Alabama: Ala. Code § 40-22-1 deed tax & Ala. Code § 12-19-90 execution fee
  const al = getStatutoryFeeSchedule('AL', 120000);
  assert.equal(al.isSupported, true);
  assert.match(al.transferTaxCitation, /Ala\. Code § 40-22-1/);
  assert.match(al.sheriffPoundageCitation, /Ala\. Code § 12-19-90/);
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

  // High-CTR title generation
  const highCtrTitle = generateHighCtrCountyTitle('Essex', 'NJ');
  assert.equal(highCtrTitle, 'Essex County Sheriff Sales & Tax Deeds | PerfectProperty');
  assert.ok(highCtrTitle.length >= 40 && highCtrTitle.length <= 57);
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

test('County SEO: schema.org FAQPage structured data generates statutory Q&A and neutralizes XSS', () => {
  const faqSchema = buildCountyFaqSchema({
    state: 'NC',
    county: 'Wake',
    baseUrl: 'https://perfectproperty.org',
  });

  assert.equal(faqSchema['@context'], 'https://schema.org');
  assert.equal(faqSchema['@type'], 'FAQPage');
  assert.ok(Array.isArray(faqSchema.mainEntity));
  assert.equal(faqSchema.mainEntity.length, 4);

  // Q1: Statutory redemption and upset bid
  const q1 = faqSchema.mainEntity[0];
  assert.equal(q1['@type'], 'Question');
  assert.match(q1.name, /statutory redemption and upset bid rules/i);
  assert.equal(q1.acceptedAnswer['@type'], 'Answer');
  assert.match(q1.acceptedAnswer.text, /N\.C\.G\.S\. § 45-21\.27/);
  assert.match(q1.acceptedAnswer.text, /10-day upset bid period/);

  // Q2: Transfer taxes and sheriff execution poundage
  const q2 = faqSchema.mainEntity[1];
  assert.match(q2.name, /transfer taxes, sheriff execution poundage/i);
  assert.match(q2.acceptedAnswer.text, /N\.C\.G\.S\. § 105-228\.30/);

  // Q3: Senior liens and property taxes
  const q3 = faqSchema.mainEntity[2];
  assert.match(q3.name, /extinguish prior mortgages or delinquent property taxes/i);
  assert.match(q3.acceptedAnswer.text, /26 U\.S\.C\. § 7425/);
  assert.match(q3.acceptedAnswer.text, /super-priority/);

  // Q4: Funds and deposit procedures
  const q4 = faqSchema.mainEntity[3];
  assert.match(q4.name, /participate in Wake County/i);
  assert.match(q4.acceptedAnswer.text, /certified funds/i);

  // Verify serializeJsonLd on FAQPage
  const serialized = serializeJsonLd(faqSchema);
  assert.doesNotMatch(serialized, /<script>/);
  assert.doesNotMatch(serialized, /<\/script>/);
});

test('County SEO: server/seo re-exports match src/lib/county-seo', () => {
  assert.equal(typeof serverSeo.getStatutoryRedemption, 'function');
  assert.equal(typeof serverSeo.getStatutoryFeeSchedule, 'function');
  assert.equal(typeof serverSeo.buildCountyFaqSchema, 'function');
  assert.equal(typeof serverSeo.generateHighCtrCountyTitle, 'function');
  assert.equal(typeof serverSeo.generateCountyMetadata, 'function');

  // Verify function parity
  assert.deepEqual(
    serverSeo.getStatutoryRedemption('NC'),
    getStatutoryRedemption('NC')
  );
  assert.deepEqual(
    serverSeo.getStatutoryFeeSchedule('NJ', 180000),
    getStatutoryFeeSchedule('NJ', 180000)
  );
});

test('County SEO: county page component wires Cadastral GIS Radar and Notice Alerts Subscription', () => {
  const pagePath = path.resolve(__dirname, '../../src/app/states/[state]/[county]/page.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /getCountyCadastralGisLink/, 'Page must call getCountyCadastralGisLink');
  assert.match(source, /CountyAlertSubscribe/, 'Page must render CountyAlertSubscribe component');
  assert.match(source, /Open GIS Parcel Viewer/, 'Page must render GIS Parcel link');
  assert.match(source, /subscribe_county_digest|CountyAlertSubscribe/, 'Page must integrate subscription workflow');
});
