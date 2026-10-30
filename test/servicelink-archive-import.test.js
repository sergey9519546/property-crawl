'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  SOURCE_KEY,
  PUBLISHER,
  DEFAULT_ZIP_PATH,
  normalizeServiceLinkRecord,
  streamArchiveRecords,
  importArchive,
} = require('../scripts/import-servicelink-archive');

function fixtureRecord(overrides = {}) {
  const listingId = overrides.listingId || 'a1c3k000001nwWYAAY';
  return {
    listingId,
    createdDate: '2020-05-12T19:46:17+00:00',
    lastUpdated: '2026-09-05T08:05:53+00:00',
    timestamp: '2026-09-05T08:01:29+00:00',
    auctionProgram: 'TPS',
    listingProgramWebsite: 'Foreclosure Sale',
    foreclosureSaleStatus: 'On Website',
    foreclosureSaleStatusWebsite: 'Active',
    foreclosureSaleDate: '2026-09-10T00:00:00',
    tpsSaleLocation: 'Orange County Courthouse',
    tpsSaleTime: '10:00 AM',
    clearedForSale: 'No',
    isCashOnly: true,
    isFinancible: false,
    interiorAccessAvailable: false,
    openingBid: 150000,
    propertyInfo: {
      propertyId: 'a1l3k000007biEuAAI',
      globalPropertyId: 'bcaf5b55b5cf',
      assetNumber: '25046756',
      websiteUrl: 'https://www.servicelinkauction.com/property-details/102-circuit-road-tuxedo-park-10987-ny-united-states-tps',
      propertyType: 'Single Family Home',
      address: '102 Circuit Road',
      city: 'Tuxedo Park',
      county: 'Orange',
      state: 'NY',
      postalCode: '10987',
      bedrooms: 6,
      fullBathrooms: 5,
      interiorSqFt: 6598,
      yearBuilt: 1900,
      latitude: 41.2039767,
      longitude: -74.1952967,
    },
    customDetail: {
      of_bids__c: '10.0',
      show_bid_history__c: 'true',
    },
    auctionRunInfo: {
      auctionId: 'a1JVO00000TkAOi2AN',
      auctionName: 'New York Foreclosure Homes',
      startDate: '2026-09-10T07:00:00+00:00',
      endDate: '2026-09-11T06:00:00+00:00',
    },
    listingStatus: {
      statusText: 'Status: Active',
      statusTextSRP: 'Scheduled for Auction: Sep 10, 2026',
      isAuctionClosed: false,
    },
    images: [
      {
        mediaUrl: 'https://www.servicelinkauction.com/auction-photos/photo1.jpg',
        fileUrl: 'https://www.servicelinkauction.com/auction-photos/photo1.jpg',
      },
      {
        mediaUrl: 'https://www.servicelinkauction.com/auction-photos/photo2.jpg',
      },
    ],
    documents: [
      {
        title: 'Property Report',
        fileUrl: 'https://www.servicelinkauction.com/auction-documents/report.pdf',
      },
    ],
    ...overrides,
  };
}

test('Blueprint Invariant: Strips fake/filler bids like bidsPlaced === 10 or bidsPlaced === "10" or "10.0"', () => {
  // Test case 1: customDetail.of_bids__c === '10.0'
  const record1 = fixtureRecord({ customDetail: { of_bids__c: '10.0' } });
  const listing1 = normalizeServiceLinkRecord(record1);
  assert.equal(listing1.bidsPlaced, null, 'of_bids__c 10.0 must be stripped to null');
  assert.equal(listing1.provenance.sourceFacts.rawBidsPlacedStripped, true);
  assert.equal(listing1.provenance.sourceFacts.bidCountReliability, 'not_established');
  assert.equal(listing1.provenance.sourceFacts.sourceReportedBidCount, '10.0');

  // Test case 2: raw.bidsPlaced === 10
  const record2 = fixtureRecord({ bidsPlaced: 10, customDetail: {} });
  const listing2 = normalizeServiceLinkRecord(record2);
  assert.equal(listing2.bidsPlaced, null, 'bidsPlaced numeric 10 must be stripped to null');
  assert.equal(listing2.provenance.sourceFacts.rawBidsPlacedStripped, true);

  // Test case 3: raw.bidsPlaced === "10"
  const record3 = fixtureRecord({ bidsPlaced: '10', customDetail: {} });
  const listing3 = normalizeServiceLinkRecord(record3);
  assert.equal(listing3.bidsPlaced, null, 'bidsPlaced string "10" must be stripped to null');
  assert.equal(listing3.provenance.sourceFacts.rawBidsPlacedStripped, true);

  // Test case 4: raw.bidsPlaced === "10.0"
  const record4 = fixtureRecord({ bidsPlaced: '10.0', customDetail: {} });
  const listing4 = normalizeServiceLinkRecord(record4);
  assert.equal(listing4.bidsPlaced, null, 'bidsPlaced string "10.0" must be stripped to null');
  assert.equal(listing4.provenance.sourceFacts.rawBidsPlacedStripped, true);

  // Test case 5: Real bids (e.g. 3) are preserved
  const record5 = fixtureRecord({ bidsPlaced: 3, customDetail: { of_bids__c: '3' } });
  const listing5 = normalizeServiceLinkRecord(record5);
  assert.equal(listing5.bidsPlaced, 3, 'Non-filler bid count must be preserved');
  assert.equal(listing5.provenance.sourceFacts.rawBidsPlacedStripped, false);
});

test('Blueprint Invariant: Never equate "closed" with "sold". Use status "ended" or "completed"', () => {
  // Test case 1: Auction is Closed
  const closedRecord = fixtureRecord({
    listingStatus: {
      statusText: 'Auction is Closed',
      isAuctionClosed: true,
    },
  });
  const closedListing = normalizeServiceLinkRecord(closedRecord);
  assert.notEqual(closedListing.status, 'sold', 'Auction is closed must never be mapped to sold');
  assert.equal(closedListing.status, 'ended', 'Closed auction maps to ended');
  assert.equal(closedListing.lifecycleStatus, 'ended');
  assert.equal(closedListing.transactionOutcome, null, 'Outcome must remain null without proof of sale');

  // Test case 2: Reverted to Beneficiary
  const revertedRecord = fixtureRecord({
    listingStatus: {
      statusText: 'Status: Auctioned - Reverted to Beneficiary',
      isAuctionClosed: true,
    },
  });
  const revertedListing = normalizeServiceLinkRecord(revertedRecord);
  assert.notEqual(revertedListing.status, 'sold', 'Reverted auction is not sold');
  assert.equal(revertedListing.status, 'ended');
  assert.equal(revertedListing.lifecycleStatus, 'ended');
  assert.equal(revertedListing.transactionOutcome, 'reverted_to_beneficiary');

  // Test case 3: Cancelled
  const cancelledRecord = fixtureRecord({
    listingStatus: {
      statusText: 'Status: Cancelled',
      isAuctionClosed: false,
    },
  });
  const cancelledListing = normalizeServiceLinkRecord(cancelledRecord);
  assert.notEqual(cancelledListing.status, 'sold');
  assert.equal(cancelledListing.status, 'cancelled');
  assert.equal(cancelledListing.lifecycleStatus, 'cancelled');

  // Test case 4: Explicitly Sold to 3rd Party
  const soldRecord = fixtureRecord({
    listingStatus: {
      statusText: 'Status: Auctioned - Sold to 3rd Party',
      isAuctionClosed: true,
    },
  });
  const soldListing = normalizeServiceLinkRecord(soldRecord);
  assert.equal(soldListing.status, 'completed');
  assert.equal(soldListing.lifecycleStatus, 'completed');
  assert.equal(soldListing.transactionOutcome, 'sold_to_third_party');
});

test('Blueprint Invariant: Never impute estLow, estHigh, or ARV from openingBid', () => {
  const record = fixtureRecord({
    openingBid: 250000,
    estLow: undefined,
    estHigh: undefined,
    estValue: undefined,
    propertyInfo: {
      ...fixtureRecord().propertyInfo,
      estimatedValue: undefined,
    },
  });
  const listing = normalizeServiceLinkRecord(record);

  assert.equal(listing.openingBid, 250000);
  assert.equal(listing.estLow, null, 'estLow must not be imputed from openingBid');
  assert.equal(listing.estHigh, null, 'estHigh must not be imputed from openingBid');
  assert.equal(listing.arv, null, 'ARV must not be imputed from openingBid');
  assert.equal(listing.dealScore, null, 'dealScore must be null when estimate range is absent');
  assert.equal(listing.mid, null);
  assert.equal(listing.ratio, null);
  assert.equal(listing.bidSpread, null);
  assert.equal(listing.equity, null);
});

test('Blueprint Invariant: Tag provenance.origin = "servicelink-archive" and provenance.source = "servicelink"', () => {
  const record = fixtureRecord();
  const listing = normalizeServiceLinkRecord(record);

  assert.equal(listing.source, SOURCE_KEY);
  assert.equal(listing.provenance.origin, 'servicelink-archive');
  assert.equal(listing.provenance.source, 'servicelink');
  assert.equal(listing.provenance.recordId, record.listingId);
  assert.equal(listing.provenance.publisher, PUBLISHER);
  assert.equal(listing.provenance.recordKind, 'archive_record');
  assert.equal(listing.provenance.exactSourceUrl, record.propertyInfo.websiteUrl);
  assert.ok(listing.provenance.observedAt);
});

test('Blueprint Invariant: Extract and normalize image URLs into the photos array', () => {
  const record = fixtureRecord({
    images: [
      { mediaUrl: 'https://www.servicelinkauction.com/auction-photos/img1.jpg' },
      { fileUrl: 'https://www.servicelinkauction.com/auction-photos/img2.jpg' },
      { url: 'https://www.servicelinkauction.com/auction-photos/img3.jpg' },
      // Duplicate should be deduplicated
      { mediaUrl: 'https://www.servicelinkauction.com/auction-photos/img1.jpg' },
      // Cross-origin / non-servicelink should be rejected by hostname policy
      { mediaUrl: 'https://attacker.example.com/malicious.jpg' },
      // Document disguised as image should be rejected
      { mediaUrl: 'https://www.servicelinkauction.com/auction-photos/doc.pdf' },
    ],
  });
  const listing = normalizeServiceLinkRecord(record);

  assert.ok(Array.isArray(listing.photos), 'listing.photos must be an array');
  assert.equal(listing.photos.length, 3, 'Should extract 3 valid, deduplicated image URLs');
  assert.equal(listing.photos[0], 'https://www.servicelinkauction.com/auction-photos/img1.jpg');
  assert.equal(listing.photos[1], 'https://www.servicelinkauction.com/auction-photos/img2.jpg');
  assert.equal(listing.photos[2], 'https://www.servicelinkauction.com/auction-photos/img3.jpg');
  assert.equal(listing.photo, listing.photos[0], 'Primary photo matches photos[0]');
  assert.deepEqual(listing.images, listing.photos, 'listing.images mirrors photos for schema compatibility');
});

test('Schema Conformance: Normalizes all required property-crawl listing fields', () => {
  const record = fixtureRecord();
  const listing = normalizeServiceLinkRecord(record);

  assert.equal(listing.id, `servicelink:${record.listingId}`);
  assert.equal(listing.source, 'servicelink');
  assert.equal(listing.title, record.propertyInfo.address);
  assert.equal(listing.address, '102 Circuit Road, Tuxedo Park, NY 10987');
  assert.equal(listing.city, 'Tuxedo Park');
  assert.equal(listing.state, 'NY');
  assert.equal(listing.zip, '10987');
  assert.equal(listing.county, 'Orange');
  assert.equal(listing.apn, '25046756');
  assert.equal(listing.propType, 'Single Family Home');
  assert.equal(listing.openingBid, 150000);
  assert.equal(listing.saleDate, '2026-09-10');
  assert.equal(listing.beds, 6);
  assert.equal(listing.baths, 5);
  assert.equal(listing.sqft, 6598);
  assert.equal(listing.year, 1900);
  assert.equal(listing.lat, 41.2039767);
  assert.equal(listing.lng, -74.1952967);
  assert.ok(listing.parcelKey, 'Parcel key must be computed');
  assert.ok(listing.triage, 'Triage metadata must be computed');
});

test('Rejects malformed records lacking essential identity or location', () => {
  assert.equal(normalizeServiceLinkRecord(null), null);
  assert.equal(normalizeServiceLinkRecord({}), null);
  assert.equal(normalizeServiceLinkRecord(fixtureRecord({ listingId: '' })), null);
  assert.equal(normalizeServiceLinkRecord(fixtureRecord({ propertyInfo: { ...fixtureRecord().propertyInfo, state: 'INVALID' } })), null);
  assert.equal(normalizeServiceLinkRecord(fixtureRecord({ propertyInfo: { ...fixtureRecord().propertyInfo, address: '' } })), null);
});

test('Live Archive: Streams and normalizes records directly from the zip archive', async () => {
  if (!fs.existsSync(DEFAULT_ZIP_PATH)) {
    return; // Skip if archive is not available in local test environment
  }

  const streamed = [];
  for await (const { record } of streamArchiveRecords(DEFAULT_ZIP_PATH, { limit: 5 })) {
    const normalized = normalizeServiceLinkRecord(record);
    assert.ok(normalized, 'Record should normalize successfully');
    assert.equal(normalized.source, 'servicelink');
    assert.equal(normalized.provenance.origin, 'servicelink-archive');
    assert.equal(normalized.estLow, null);
    assert.equal(normalized.estHigh, null);
    assert.notEqual(normalized.status, 'sold');
    assert.ok(Array.isArray(normalized.photos));
    streamed.push(normalized);
  }

  assert.equal(streamed.length, 5, 'Should stream 5 real records from archive');
});

test('CLI / Function runner: importArchive executes dry run cleanly', async () => {
  if (!fs.existsSync(DEFAULT_ZIP_PATH)) {
    return;
  }

  const logs = [];
  const stats = await importArchive({
    inputPath: DEFAULT_ZIP_PATH,
    limit: 10,
    dryRun: true,
    logger: (msg) => logs.push(msg),
  });

  assert.equal(stats.totalRead, 10);
  assert.equal(stats.accepted, 10);
  assert.equal(stats.skipped, 0);
  assert.equal(stats.estLowNull, 10);
  assert.ok(stats.totalImages > 0);
  assert.ok(stats.fakeBidsStripped > 0);
});
