'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const defaultScraper = require('../server/scrapers/servicelink');
const {
  ServiceLinkScraper,
  sourceUrlFromRecord,
  validContinuationToken,
} = require('../server/scrapers/servicelink');
const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
const { validateListingForIngestion } = require('../server/scrapers/validation');

function response(body, status = 200) {
  return { status, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(body) };
}

function sourceRecord(overrides = {}) {
  const listingId = overrides.listingId || 'a1c3k000004TZagAAG';
  return {
    listingId,
    auctionProgram: 'TPS',
    listingProgramWebsite: 'Foreclosure Sale',
    createdDate: '2026-09-01T12:00:00+00:00',
    lastUpdated: '2026-09-05T10:15:00+00:00',
    timestamp: '2026-09-05T10:14:00+00:00',
    foreclosureSaleDate: '2026-09-25T00:00:00',
    foreclosureSaleStatus: 'Postponed To',
    foreclosureSaleStatusWebsite: 'Active - Postponed',
    tpsSaleLocation: 'County Courthouse',
    tpsSaleTime: '11:00 AM',
    clearedForSale: 'No',
    isCashOnly: true,
    isFinancible: false,
    currentBid: 90000,
    estValue: 350000,
    propertyInfo: {
      propertyId: 'a1l3k00000A4GTuAAN',
      globalPropertyId: 'f242356c2ad9',
      websiteUrl: 'https://www.servicelinkauction.com/property-details/1345-e-tradewind-dr-gilbert-85234-az-united-states-tps',
      propertyType: 'Single Family Home',
      address: '1345 E Tradewind Dr',
      city: 'Gilbert',
      county: 'Maricopa',
      state: 'AZ',
      postalCode: '85234',
      bedrooms: 3,
      fullBathrooms: 2,
      interiorSqFt: 1800,
      yearBuilt: 1999,
      latitude: 33.35,
      longitude: -111.75,
    },
    auctionRunInfo: { auctionId: 'a1JVO00000HqeHJ2AZ', auctionNumber: 'AuctionTPS_AZ', auctionMethod: 'On-Site', startDate: '2026-09-25T07:00:00+00:00', endDate: '2026-09-26T07:00:00+00:00' },
    listingStatus: { statusText: 'Status: Active - Postponed', statusTextSRP: 'Postponed To: Sep 25, 2026', isAuctionClosed: false, isInAuction: false },
    images: [{ mediaUrl: 'https://www.servicelinkauction.com/auction-photos/photo.jpg' }],
    documents: [{ fileUrl: 'https://www.servicelinkauction.com/auction-documents/report.pdf' }],
    ...overrides,
  };
}

function scraper(options = {}) {
  return new ServiceLinkScraper({ maxRetries: 1, random: () => 0, sleep: async () => {}, now: () => new Date('2026-09-05T12:00:00.000Z'), ...options });
}

test('scheduler default is a ServiceLink-compatible scraper object', () => {
  assert.equal(defaultScraper.name, 'ServiceLinkScraper');
  assert.equal(defaultScraper.sourceKey, 'servicelink');
  assert.equal(typeof defaultScraper.scrapeFeed, 'function');
});

test('ServiceLink follows only a bounded opaque continuation token on its fixed public listings route', async () => {
  const requested = [];
  const first = sourceRecord();
  const second = sourceRecord({
    listingId: 'a1cVO000004XjDoYAK',
    openingBid: 123456,
    propertyInfo: { ...first.propertyInfo, websiteUrl: 'https://www.servicelinkauction.com/property-details/946-western-ave-pittsburgh-15233-pa-united-states-tps', address: '946 Western Ave', city: 'Pittsburgh', county: 'Allegheny', state: 'PA', postalCode: '15233' },
    listingStatus: { statusText: 'Status: Auctioned - Reverted to Beneficiary', isAuctionClosed: true },
  });
  const subject = scraper({ maxPages: 2, limit: 25, fetchImpl: async (url, options) => {
    requested.push({ url: new URL(url), options });
    if (requested.length === 1) return response({ searchResultCount: 2, model: 'list', continuationToken: 'opaque+/cursor=', data: [first] });
    return response({ searchResultCount: 2, model: 'list', data: [second] });
  } });

  const listings = await subject.scrapeFeed();
  assert.equal(requested.length, 2);
  assert.equal(requested[0].url.origin, 'https://www.servicelinkauction.com');
  assert.equal(requested[0].url.pathname, '/api/listingsvc/v1/Listings');
  assert.equal(requested[0].url.searchParams.get('limit'), '25');
  assert.equal(requested[0].url.searchParams.has('stateCode'), false);
  assert.equal(requested[1].url.searchParams.get('continuationToken'), 'opaque+/cursor=');
  assert.deepEqual(requested[0].options.headers, { Accept: 'application/json' });
  assert.equal(listings.length, 2);
  assert.equal(listings[0].id, 'servicelink:a1c3k000004TZagAAG');
  assert.equal(listings[0].source, 'servicelink');
  assert.equal(listings[0].sourceUrl, first.propertyInfo.websiteUrl);
  assert.equal(listings[0].openingBid, null, 'current bid and estimate are not opening bids');
  assert.equal(listings[1].openingBid, 123456, 'an explicit per-listing opening bid is retained');
  assert.equal(listings[0].status, 'Status: Active - Postponed');
  assert.equal(listings[1].status, 'Status: Auctioned - Reverted to Beneficiary');
  assert.equal(listings[0].provenance.recordKind, 'source_record');
  assert.equal(listings[0].provenance.recordId, first.listingId);
  assert.equal(listings[0].provenance.publisher, 'ServiceLink Auction');
  assert.equal(listings[0].photo, null);
  assert.doesNotMatch(listings[0].raw, /auction-photos|auction-documents/);
  assert.deepEqual(validateListingForIngestion(listings[0], { expectedSource: 'servicelink' }).errors, []);
  assert.equal(subject.lastRunReport.outcome, 'success');
  assert.equal(subject.lastRunReport.pagesFetched, 2);
});

test('ServiceLink preserves unpublished numeric and boolean facts as null rather than zero or false', async () => {
  const missing = sourceRecord({
    isCashOnly: undefined,
    isFinancible: undefined,
    interiorAccessAvailable: undefined,
    propertyInfo: {
      ...sourceRecord().propertyInfo,
      bedrooms: null,
      fullBathrooms: '',
      interiorSqFt: undefined,
      yearBuilt: ' ',
      latitude: null,
      longitude: '',
    },
    listingStatus: { statusText: 'Status: Active' },
  });
  const subject = scraper({ fetchImpl: async () => response({ data: [missing] }) });
  const [listing] = await subject.scrapeFeed();
  assert.equal(listing.beds, null);
  assert.equal(listing.baths, null);
  assert.equal(listing.sqft, null);
  assert.equal(listing.year, null);
  assert.equal(listing.lat, null);
  assert.equal(listing.lng, null);
  assert.equal(listing.provenance.sourceFacts.listingStatus.isAuctionClosed, null);
  const compact = JSON.parse(listing.raw);
  assert.equal(compact.isCashOnly, null);
  assert.equal(compact.isFinancible, null);
  assert.equal(compact.interiorAccessAvailable, null);
});

test('ServiceLink rejects cross-origin, API, and query URLs instead of fabricating property links', () => {
  const valid = 'https://www.servicelinkauction.com/property-details/1345-e-tradewind-dr-gilbert-85234-az-united-states-tps';
  assert.equal(inspectSourceRecordUrl('servicelink', valid).isValid, true);
  assert.equal(inspectSourceRecordUrl('servicelink', 'https://servicelinkauction.com/property-details/1345-e-tradewind-dr-gilbert-85234-az-united-states-tps').isValid, false);
  assert.equal(inspectSourceRecordUrl('servicelink', 'https://tenant.servicelinkauction.com/property-details/1345-e-tradewind-dr-gilbert-85234-az-united-states-tps').isValid, false);
  assert.equal(inspectSourceRecordUrl('servicelink', 'https://www.servicelinkauction.com/api/listingsvc/v1/Listings').isValid, false);
  assert.equal(inspectSourceRecordUrl('servicelink', `${valid}?listingId=a1c`).isValid, false);
  assert.equal(sourceUrlFromRecord(sourceRecord({ propertyInfo: { websiteUrl: 'https://attacker.example/property-details/record' }, canonicalUrl: null })), null);
});

test('ServiceLink skips malformed records but reports a valid empty page truthfully', async () => {
  const bad = sourceRecord({ propertyInfo: { websiteUrl: 'https://example.test/property-details/unsafe' } });
  const subject = scraper({ fetchImpl: async () => response({ searchResultCount: 1, model: 'list', data: [bad] }) });
  assert.deepEqual(await subject.scrapeFeed(), []);
  assert.equal(subject.lastRunReport.outcome, 'empty');
  assert.equal(subject.lastRunReport.recordsDiscovered, 1);
  assert.equal(subject.lastRunReport.recordsSkipped, 1);
});

test('ServiceLink trips on a challenge page and never treats it as an empty inventory', async () => {
  const subject = scraper({ fetchImpl: async () => ({ status: 200, headers: new Headers(), text: async () => 'Attention Required! | Cloudflare' }) });
  await assert.rejects(subject.scrapeFeed(), (error) => error.code === 'UPSTREAM_BOT_CHALLENGE');
  assert.equal(subject.circuitBreaker.isOpen(), true);
  assert.equal(subject.lastRunReport.outcome, 'failed');
});

test('ServiceLink only accepts bounded opaque continuation tokens', () => {
  assert.equal(validContinuationToken('abc+/=123'), 'abc+/=123');
  assert.equal(validContinuationToken(''), null);
  assert.equal(validContinuationToken(`x${'x'.repeat(2048)}`), null);
  assert.equal(validContinuationToken('abc\nnext'), null);
});
