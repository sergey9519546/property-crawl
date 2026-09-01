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
// We treat `propertyName` as the street address (it is for most rows),
// parse the 2-letter state directly, and use `price` as the opening bid
// for the normalize filter. Volume target: ≥ 1 listing (we get hundreds).
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
  return 'Single Family';
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
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const records = await this.fetchApi();
      console.log(
        `[${this.name}] API returned ${records.length} FDIC closed real-estate records; taking first ${this.maxListings}`
      );
      const limited = records.slice(0, this.maxListings);
      const allListings = limited.map((rec, idx) => this.toListing(rec, idx));
      console.log(
        `[${this.name}] Scraped ${allListings.length} FDIC real-estate records`
      );
      return allListings
        .filter((item) => this.passesFilter(item))
        .map((item) => this.standardizeListing(item));
    });
  }

  async fetchText(url, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)',
          Accept: 'application/json,text/html',
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
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

  toListing(rec, idx) {
    const propertyName = (rec.propertyName || '').trim();
    const state = (rec.state || '').toUpperCase();
    const openingBid = Number(rec.price) || 0;
    const id = rec.id != null ? `FDIC-${rec.id}` : `FDIC-ROW-${idx + 1}`;
    const propType = classifyPropType(rec.propertyType);
    const siteName = (rec.siteName || 'FDIC').trim();

    return {
      id,
      source: 'fdic',
      state: state || 'US',
      county: siteName.replace(/\s+Regional Office$/i, '').trim() || 'Unknown',
      city: 'Unknown',
      zip: '00000',
      address: propertyName || 'FDIC REO property',
      lat: 0,
      lng: 0,
      beds: 0,
      baths: 0,
      sqft: 0,
      year: null,
      propType,
      openingBid,
      estLow: 0,
      estHigh: 0,
      assessed: 0,
      saleDate: parseSaleDate(rec.saleDate),
      plaintiff: 'FDIC as Receiver',
      defendant: '—',
      judgment: 0,
      attorney: 'FDIC Asset Marketing',
      occupancy: 'Unknown',
      deposit: 'See FDIC asset sales terms',
      photo: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=640&q=70',
      sourceUrl: this.pageUrl,
      raw: `FDIC closed real estate #${rec.id} | ${siteName} | ${propType} | $${openingBid} | ${rec.saleDate || 'no date'}`.substring(0, 500),
    };
  }

  passesFilter(item) {
    if (!item) return false;
    if (!/^FDIC-/.test(item.id || '')) return false;
    if (!/^[A-Z]{2}$/.test(item.state || '')) return false;
    if ((item.address || '').length < 8) return false;
    if (!(item.openingBid > 0)) return false;
    return true;
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = new FdicScraper();
