// server/scrapers/fdic.js
//
// REAL FDIC closed real estate scraper.
// Source: https://sales.fdic.gov/api/closedrealestate (verified live, public
// JSON API behind the FDIC's CSCRE — Closed Sales & Closed Real Estate
// SPA at https://sales.fdic.gov/closedrealestate/).
//
// The FDIC's main asset-sales landing page
// (https://www.fdic.gov/asset-sales/real-estate-and-property-sales) points
// to the third-party Property Listing Site (https://www.fdicrealestatelistings.com)
// which currently shows "No Properties At This Time" (data update
// 2026-08-13). The closed-real-estate API still returns 2,500+ records
// spanning 2010-present — that's the authoritative source.
//
// Per-record fields:
//   id, siteName, propertyName, propertyType, saleDate, state, price,
//   userId, lastUpdateDate
//
// This endpoint is historical closed-sale data, not a live opportunity feed.
// The collector is retained for explicit archival jobs but excluded from the
// production scheduler; closed sale price is never labeled as an opening bid.
//
// Per docs/sources-to-scrape.md #6: small volume per year (~50-100 REO
// sales), but it's a NEW federal source not in v0 today.
// Email for verification: RealEstateForSale@fdic.gov / (888) 206-4662.

const BaseScraper = require('./base');

function classifyPropType(raw) {
  const t = (raw || '').toLowerCase();
  if (t.includes('residential') || t.includes('single family')) return 'Single Family';
  if (t.includes('condo')) return 'Condo';
  if (t.includes('multi') || t.includes('duplex')) return 'Multi-Family';
  if (t.includes('commercial')) return 'Commercial';
  if (t.includes('land') || t.includes('lot')) return 'Land';
  if (t.includes('bank premises') || t.includes('bank premise')) return 'Commercial';
  return null;
}

// Converts an ISO date ("2021-03-02T00:00:00.000Z") to YYYY-MM-DD.
function parseSaleDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

class FdicScraper extends BaseScraper {
  constructor() {
    super({ name: 'FdicScraper', sourceKey: 'fdic' });
    this.baseUrl = 'https://sales.fdic.gov';
    this.apiUrl = `${this.baseUrl}/api/closedrealestate`;
    this.pageUrl = 'https://www.fdic.gov/asset-sales/real-estate-and-property-sales';
    this.maxListings = 50; // cap for build-data.js timeout
    this.delayMs = 500; // JSON API, no real need for 1s
    this.historicalOnly = true;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const records = await this.fetchApi();
      console.log(
        `[${this.name}] API returned ${records.length} FDIC closed real-estate records; taking first ${this.maxListings}`
      );
      const limited = records.slice(0, this.maxListings);
      const allListings = limited.map((rec) => this.toListing(rec)).filter(Boolean);
      console.log(
        `[${this.name}] Scraped ${allListings.length} FDIC real-estate records`
      );
      return allListings
        .filter((item) => this.passesFilter(item))
        .map((item) => this.standardizeListing(item));
    });
  }

  async fetchText(url, timeoutMs = 30000) {
    return super.fetchText(url, {
      timeoutMs,
      headers: {
        'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)',
        Accept: 'application/json,text/html'
      }
    });
  }

  async fetchApi() {
    const text = await this.fetchText(this.apiUrl);
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`FDIC API returned non-JSON (${text.length} bytes): ${err.message}`);
    }
    if (!Array.isArray(data)) {
      throw new Error(`FDIC API returned non-array payload: ${typeof data}`);
    }
    return data;
  }

  toListing(rec) {
    const propertyName = (rec.propertyName || '').trim();
    const state = (rec.state || '').toUpperCase();
    const salePriceNumber = Number(rec.price);
    const salePrice = Number.isFinite(salePriceNumber) && salePriceNumber > 0 ? salePriceNumber : null;
    const id = rec.id != null ? `FDIC-${rec.id}` : null;
    const propType = classifyPropType(rec.propertyType);
    const siteName = (rec.siteName || '').trim() || null;
    const observedUrl = rec.sourceUrl || rec.propertyUrl || rec.detailUrl || rec.url || null;
    const sourceUrl = observedUrl
      ? (String(observedUrl).startsWith('http') ? String(observedUrl) : new URL(String(observedUrl), this.baseUrl).toString())
      : null;

    if (!id || !/^[A-Z]{2}$/.test(state) || propertyName.length < 8 || !sourceUrl) return null;

    return {
      id,
      source: 'fdic',
      state,
      county: null,
      city: null,
      zip: null,
      address: propertyName,
      lat: null,
      lng: null,
      beds: null,
      baths: null,
      sqft: null,
      year: null,
      propType,
      openingBid: null,
      price: salePrice,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate: parseSaleDate(rec.saleDate),
      plaintiff: null,
      defendant: null,
      judgment: null,
      attorney: null,
      occupancy: null,
      deposit: null,
      photo: rec.photoUrl ?? rec.imageUrl ?? null,
      status: 'closed',
      sourceUrl,
      raw: JSON.stringify(rec),
      provenance: {
        origin: 'live',
        observed: true,
        publisher: 'Federal Deposit Insurance Corporation',
        recordId: String(rec.id),
        dataset: 'closed-real-estate',
        sourceFacts: { siteName }
      },
    };
  }

  passesFilter(item) {
    if (!item) return false;
    if (!/^FDIC-/.test(item.id || '')) return false;
    if (!/^[A-Z]{2}$/.test(item.state || '')) return false;
    if ((item.address || '').length < 8) return false;
    if (!item.sourceUrl) return false;
    return true;
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = new FdicScraper();
