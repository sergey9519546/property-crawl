'use strict';

// ServiceLink Auction public listing collector.
//
// This collector deliberately uses the single anonymous listing endpoint that
// was observed live in the reference audit. It does not reuse client headers,
// credentials, bid endpoints, account endpoints, or media/document URLs.

const BaseScraper = require('./base');
const { ScraperResponseError } = require('./circuit-breaker');
const { inspectSourceRecordUrl } = require('./source-policy');

const SOURCE_KEY = 'servicelink';
const PUBLISHER = 'ServiceLink Auction';
const API_ORIGIN = 'https://www.servicelinkauction.com';
const LISTINGS_PATH = '/api/listingsvc/v1/Listings';
const DEFAULT_MAX_PAGES = 1;
const MAX_PAGES = 5;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const rawPublisherRecords = new WeakMap();

function boundedPositiveInt(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function cleanText(value, maximum = 1_000) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : null;
}

function dateOnly(value) {
  const text = cleanText(value, 80);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(text).toISOString().slice(0, 10);
}

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function observedBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function observedOpeningBid(record) {
  // These names are publisher fields for an opening bid. Do not substitute a
  // current bid, an estimate, or an auction-run-level starting bid.
  for (const field of ['openingBid', 'tpsOpenBid']) {
    const amount = finiteNumber(record?.[field]);
    if (amount !== null && amount > 0) return { amount, field };
  }
  return { amount: null, field: null };
}

function validListingId(value) {
  const id = cleanText(value, 160);
  return id && /^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(id) ? id : null;
}

function validContinuationToken(value) {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return token && token.length <= 2_048 && !/[\u0000-\u001F\u007F]/.test(token) ? token : null;
}

function sourceUrlFromRecord(record) {
  const candidates = [record?.propertyInfo?.websiteUrl, record?.canonicalUrl];
  for (const candidate of candidates) {
    const inspection = inspectSourceRecordUrl(SOURCE_KEY, candidate);
    if (inspection.isValid) return inspection.url;
  }
  return null;
}

function formatAddress(property) {
  const street = cleanText(property?.address, 300);
  const city = cleanText(property?.city, 150);
  const state = cleanText(property?.state, 2)?.toUpperCase() || null;
  const zip = cleanText(property?.postalCode, 20);
  if (!street || !state || !/^[A-Z]{2}$/.test(state)) return null;
  return [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function compactRawRecord(record, sourceUrl) {
  const property = record?.propertyInfo || {};
  const run = record?.auctionRunInfo || {};
  const status = record?.listingStatus || {};
  return JSON.stringify({
    listingId: cleanText(record?.listingId, 160),
    sourceUrl,
    auctionProgram: cleanText(record?.auctionProgram, 120),
    listingProgramWebsite: cleanText(record?.listingProgramWebsite, 240),
    createdDate: cleanText(record?.createdDate, 80),
    lastUpdated: cleanText(record?.lastUpdated, 80),
    timestamp: cleanText(record?.timestamp, 80),
    foreclosureSaleStatus: cleanText(record?.foreclosureSaleStatus, 240),
    foreclosureSaleStatusWebsite: cleanText(record?.foreclosureSaleStatusWebsite, 240),
    foreclosureSaleDate: cleanText(record?.foreclosureSaleDate, 80),
    tpsSaleLocation: cleanText(record?.tpsSaleLocation, 500),
    tpsSaleTime: cleanText(record?.tpsSaleTime, 80),
    clearedForSale: cleanText(record?.clearedForSale, 80),
    isCashOnly: observedBoolean(record?.isCashOnly),
    isFinancible: observedBoolean(record?.isFinancible),
    interiorAccessAvailable: observedBoolean(record?.interiorAccessAvailable),
    property: {
      propertyId: cleanText(property.propertyId, 160),
      globalPropertyId: cleanText(property.globalPropertyId, 160),
      assetNumber: cleanText(property.assetNumber, 160),
      type: cleanText(property.propertyType, 160),
      address: cleanText(property.address, 300),
      city: cleanText(property.city, 150),
      county: cleanText(property.county, 150),
      state: cleanText(property.state, 2),
      postalCode: cleanText(property.postalCode, 20),
      bedrooms: finiteNumber(property.bedrooms),
      bathrooms: finiteNumber(property.fullBathrooms),
      interiorSqFt: finiteNumber(property.interiorSqFt),
      lotSize: finiteNumber(property.lotSize),
      yearBuilt: finiteNumber(property.yearBuilt),
      latitude: finiteNumber(property.latitude),
      longitude: finiteNumber(property.longitude),
    },
    auctionRun: {
      auctionId: cleanText(run.auctionId, 160),
      awxId: cleanText(run.awxId, 160),
      auctionName: cleanText(run.auctionName, 240),
      auctionNumber: cleanText(run.auctionNumber, 160),
      auctionMethod: cleanText(run.auctionMethod, 120),
      startDate: cleanText(run.startDate, 80),
      endDate: cleanText(run.endDate, 80),
    },
    listingStatus: {
      statusText: cleanText(status.statusText, 240),
      statusTextSRP: cleanText(status.statusTextSRP, 240),
      isAuctionClosed: observedBoolean(status.isAuctionClosed),
      isInAuction: observedBoolean(status.isInAuction),
      isInPreAuction: observedBoolean(status.isInPreAuction),
      isInPostAuction: observedBoolean(status.isInPostAuction),
      isComingSoon: observedBoolean(status.isComingSoon),
    },
  });
}

class ServiceLinkScraper extends BaseScraper {
  constructor(options = {}) {
    super({
      name: 'ServiceLinkScraper',
      sourceKey: SOURCE_KEY,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries ?? 2,
      fetchImpl: options.fetchImpl,
      random: options.random,
      sleep: options.sleep,
    });
    this.circuitBreaker = options.circuitBreaker || this.circuitBreaker;
    this.maxPages = boundedPositiveInt(options.maxPages ?? process.env.SERVICELINK_MAX_PAGES, DEFAULT_MAX_PAGES, MAX_PAGES);
    this.limit = boundedPositiveInt(options.limit ?? process.env.SERVICELINK_PAGE_SIZE, DEFAULT_LIMIT, MAX_LIMIT);
    this.now = options.now || (() => new Date());
    this.lastRunReport = null;
  }

  buildListingsUrl(continuationToken = null) {
    const url = new URL(LISTINGS_PATH, API_ORIGIN);
    url.searchParams.set('limit', String(this.limit));
    if (continuationToken) url.searchParams.set('continuationToken', continuationToken);
    return url.toString();
  }

  async fetchPage(continuationToken = null) {
    const payload = await this.requestJson(this.buildListingsUrl(continuationToken), {
      headers: { Accept: 'application/json' },
    });
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
      const error = new ScraperResponseError('ServiceLink listing response did not contain a data array', {
        code: 'SERVICELINK_INVALID_SCHEMA',
        circuitRecorded: true,
      });
      this.circuitBreaker.trip(error.message);
      throw error;
    }
    return payload;
  }

  toListing(record, observedAt) {
    const listingId = validListingId(record?.listingId);
    const property = record?.propertyInfo;
    const sourceUrl = sourceUrlFromRecord(record);
    const state = cleanText(property?.state, 2)?.toUpperCase() || null;
    const address = formatAddress(property);
    if (!listingId || !sourceUrl || !state || !/^[A-Z]{2}$/.test(state) || !address) return null;

    const opening = observedOpeningBid(record);
    const status = record?.listingStatus || {};
    const sourceStatus = cleanText(status.statusText, 240)
      || cleanText(record?.foreclosureSaleStatusWebsite, 240)
      || cleanText(record?.foreclosureSaleStatus, 240);
    const raw = compactRawRecord(record, sourceUrl);
    const provenance = {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      recordId: listingId,
      publisher: PUBLISHER,
      exactSourceUrl: sourceUrl,
      observedAt,
      sourceFacts: {
        listingId,
        propertyId: cleanText(property.propertyId, 160),
        globalPropertyId: cleanText(property.globalPropertyId, 160),
        auctionProgram: cleanText(record?.auctionProgram, 120),
        listingProgramWebsite: cleanText(record?.listingProgramWebsite, 240),
        sourceStatus,
        foreclosureSaleStatus: cleanText(record?.foreclosureSaleStatus, 240),
        foreclosureSaleStatusWebsite: cleanText(record?.foreclosureSaleStatusWebsite, 240),
        createdDate: cleanText(record?.createdDate, 80),
        lastUpdated: cleanText(record?.lastUpdated, 80),
        timestamp: cleanText(record?.timestamp, 80),
        auctionRunStartDate: cleanText(record?.auctionRunInfo?.startDate, 80),
        auctionRunEndDate: cleanText(record?.auctionRunInfo?.endDate, 80),
        auctionMethod: cleanText(record?.auctionRunInfo?.auctionMethod, 120),
        openingBidField: opening.field,
        tpsSaleLocation: cleanText(record?.tpsSaleLocation, 500),
        tpsSaleTime: cleanText(record?.tpsSaleTime, 80),
        clearedForSale: cleanText(record?.clearedForSale, 80),
        listingStatus: {
          statusText: cleanText(status.statusText, 240),
          statusTextSRP: cleanText(status.statusTextSRP, 240),
          isAuctionClosed: observedBoolean(status.isAuctionClosed),
          isInAuction: observedBoolean(status.isInAuction),
          isInPreAuction: observedBoolean(status.isInPreAuction),
          isInPostAuction: observedBoolean(status.isInPostAuction),
          isComingSoon: observedBoolean(status.isComingSoon),
        },
      },
      media: { photo: null, photoStatus: { state: 'not_collected', reason: 'public_listing_media_not_collected_by_this_adapter', observedAt } },
    };

    const listing = this.standardizeListing({
      id: `servicelink:${listingId}`,
      source: SOURCE_KEY,
      state,
      county: cleanText(property.county, 150),
      city: cleanText(property.city, 150),
      zip: cleanText(property.postalCode, 20),
      address,
      lat: finiteNumber(property.latitude),
      lng: finiteNumber(property.longitude),
      beds: finiteNumber(property.bedrooms),
      baths: finiteNumber(property.fullBathrooms),
      sqft: finiteNumber(property.interiorSqFt),
      year: finiteNumber(property.yearBuilt),
      propType: cleanText(property.propertyType, 160),
      openingBid: opening.amount,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate: dateOnly(record?.foreclosureSaleDate),
      plaintiff: null,
      defendant: null,
      judgment: null,
      attorney: null,
      occupancy: cleanText(property.occupancyStatus, 120),
      deposit: null,
      photo: null,
      sourceUrl,
      raw,
      price: null,
      listingDate: cleanText(record?.createdDate, 80),
      status: sourceStatus,
      sourceObservedAt: observedAt,
      provenance,
    });
    if (listing) rawPublisherRecords.set(listing, record);
    return listing;
  }

  async scrapeFeed() {
    const report = {
      outcome: 'failed',
      pagesRequested: 0,
      pagesFetched: 0,
      recordsDiscovered: 0,
      recordsEmitted: 0,
      recordsSkipped: 0,
      bounded: true,
      maxPages: this.maxPages,
      limit: this.limit,
      continuationStopped: false,
      failures: [],
    };
    this.lastRunReport = report;

    try {
      const listings = await this.executeWithRetry(async () => {
        const emitted = [];
        const seenListingIds = new Set();
        let continuationToken = validContinuationToken(this.resumeToken);

        for (let pageNumber = 1; pageNumber <= this.maxPages; pageNumber += 1) {
          report.pagesRequested += 1;
          const payload = await this.fetchPage(continuationToken);
          report.pagesFetched += 1;
          report.recordsDiscovered += payload.data.length;
          const observedAt = new Date(this.now()).toISOString();

          for (const record of payload.data) {
            const listing = this.toListing(record, observedAt);
            if (!listing || seenListingIds.has(listing.id)) {
              report.recordsSkipped += 1;
              continue;
            }
            seenListingIds.add(listing.id);
            emitted.push(listing);
          }

          const next = validContinuationToken(payload.continuationToken);
          report.nextContinuationToken = next;
          if (!next) {
            if (payload.continuationToken != null && payload.continuationToken !== '') {
              report.continuationStopped = true;
              report.failures.push({ scope: 'continuation', error: 'Unsafe continuation token was not followed' });
            }
            break;
          }
          if (pageNumber === this.maxPages) {
            report.continuationStopped = true;
            break;
          }
          continuationToken = next;
          await this.crawlJitter();
        }
        return emitted;
      });
      report.recordsEmitted = listings.length;
      report.outcome = listings.length ? 'success' : 'empty';
      report.truncated = report.continuationStopped;
      report.complete = !report.continuationStopped;
      return listings;
    } catch (error) {
      report.outcome = 'failed';
      report.failures.push({ scope: 'upstream', error: error.message, code: error.code || null });
      throw error;
    }
  }

  setCheckpoint(checkpoint) {
    this.resumeToken = validContinuationToken(checkpoint?.continuationToken);
    return this;
  }
}

async function collectServiceLink(options = {}) {
  const scraper = new ServiceLinkScraper(options);
  return scraper.scrapeFeed();
}

const defaultScraper = new ServiceLinkScraper();

module.exports = defaultScraper;
module.exports.API_ORIGIN = API_ORIGIN;
module.exports.DEFAULT_LIMIT = DEFAULT_LIMIT;
module.exports.DEFAULT_MAX_PAGES = DEFAULT_MAX_PAGES;
module.exports.LISTINGS_PATH = LISTINGS_PATH;
module.exports.MAX_LIMIT = MAX_LIMIT;
module.exports.MAX_PAGES = MAX_PAGES;
module.exports.PUBLISHER = PUBLISHER;
module.exports.SOURCE_KEY = SOURCE_KEY;
module.exports.ServiceLinkScraper = ServiceLinkScraper;
module.exports.collectServiceLink = collectServiceLink;
module.exports.compactRawRecord = compactRawRecord;
module.exports.observedOpeningBid = observedOpeningBid;
module.exports.observedBoolean = observedBoolean;
module.exports.sourceUrlFromRecord = sourceUrlFromRecord;
module.exports.validContinuationToken = validContinuationToken;
module.exports.getRawPublisherRecord = (listing) => rawPublisherRecords.get(listing) || null;
