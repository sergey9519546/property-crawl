// server/scrapers/marshals.js
//
// US Marshals Service Real Property Forfeiture Scraper.
// Source: https://www.usmarshals.gov / RealLook / Gaston & Sheehan
//
// Scrapes federal asset forfeiture properties seized by US Marshals Service.

const BaseScraper = require('./base');
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');
const { createRunReport, recordUnitFailure, recordUnitSuccess, finalizeRunReport } = require('./run-report');

class UsMarshalsScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'UsMarshalsScraper', sourceKey: 'marshals' });
    this.baseUrl = 'https://www.usmarshals.gov';
    this.timeoutMs = 30000;
    this.useScrapling = options.useScrapling ?? isScraplingEnabled('marshals');
    this.extract = options.extractImpl || extractWithScrapling;
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const report = createRunReport('marshals', {
        endpoints: ['usms-real-property', 'reallook-fallback', 'gaston-sheehan-fallback'],
      });
      report.statesRequested = ['usms', 'reallook', 'gaston'];
      report.endpointsTried = 3;
      this.lastRunReport = report;

      const allListings = await this.fetchSeizedListings(report);
      const standardized = allListings
        .filter(l => this.passesFilter(l))
        .map(l => this.standardizeListing(l));
      finalizeRunReport(report, { emitted: standardized.length });
      if (report.outcome === 'failed') {
        throw new Error('USMS_UPSTREAM_UNAVAILABLE: US Marshals primary and partner endpoints all failed');
      }
      console.log(`[${this.name}] Standardized ${standardized.length} US Marshals listings (${report.outcome})`);
      return standardized;
    });
  }

  async fetchSeizedListings(report) {
    const url = `${this.baseUrl}/what-we-do/asset-forfeiture/real-property`;
    try {
      const html = await this.requestText(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        }
      });
      const listings = this.parseMarshalsHtml(html);
      if (listings.length > 0) {
        recordUnitSuccess(report, 'usms', listings.length);
        return listings;
      }
      recordUnitFailure(report, 'usms', new Error('empty or unparseable USMS page'), 'empty_primary');
      return this.fetchPartnerAuctions(report);
    } catch (err) {
      recordUnitFailure(report, 'usms', err, 'upstream');
      return this.fetchPartnerAuctions(report);
    }
  }

  parseMarshalsHtml(html) {
    const listings = [];
    const itemRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;

    while ((match = itemRegex.exec(html)) !== null) {
      const row = match[1];
      if (row.includes('<th') || !row.includes('$' )) continue;

      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (cells.length >= 4) {
        const clean = cells.map(c => c.replace(/<[^>]+>/g, '').trim());
        const address = clean[0] || clean[1];
        const stateMatch = address.match(/,\s*([A-Z]{2})\s+(\d{5})?/);
        const state = stateMatch?.[1] || null;
        const zip = stateMatch?.[2] || null;
        const priceMatch = row.match(/\$([0-9,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
        const linkMatch = row.match(/href=["']([^"']+)["']/i);
        const recordMatch = row.match(/(?:asset|case|property)\s*(?:id|no\.?|#)?\s*[:#]?\s*([A-Z0-9-]{4,})/i);
        const linkToken = linkMatch?.[1]?.split('?')[0].split('/').filter(Boolean).pop();
        const recordId = recordMatch?.[1] || linkToken;

        if (!address || !state || !recordId || !linkMatch) continue;
        const id = `USMS-${String(recordId).replace(/[^a-zA-Z0-9-]/g, '')}`;
        const sourceUrl = linkMatch[1].startsWith('http')
          ? linkMatch[1]
          : new URL(linkMatch[1], this.baseUrl).toString();

        listings.push({
          id,
          state,
          county: null,
          city: null,
          zip,
          address,
          openingBid: price,
          estLow: null,
          estHigh: null,
          assessed: null,
          saleDate: null,
          plaintiff: null,
          defendant: null,
          occupancy: null,
          deposit: null,
          sourceUrl,
          raw: row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
          provenance: { origin: 'live', observed: true, publisher: 'U.S. Marshals Service', recordId: String(recordId) },
        });
      }
    }

    return listings;
  }

  async fetchPartnerAuctions(report = null) {
    // Partner feed query (Gaston & Sheehan / RealLook USMS real estate)
    const partnerUrl = 'https://www.reallook.com/usms-inventory';
    try {
      const html = await this.requestText(partnerUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        }
      });
      const listings = this.parsePartnerCards(html);
      if (listings.length > 0) {
        if (report) recordUnitSuccess(report, 'reallook', listings.length);
        return listings;
      }
      if (report) recordUnitFailure(report, 'reallook', new Error('empty partner inventory'), 'empty_partner');
      return [];
    } catch (err) {
      if (report) recordUnitFailure(report, 'reallook', err, 'upstream');
      return [];
    }
  }

  parsePartnerCards(html) {
    const listings = [];
    const cardRegex = /<div[^>]*class="[^"]*property-item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];
      const addressMatch = card.match(/class="[^"]*address[^"]*"[^>]*>([^<]+)<\//i);
      const priceMatch = card.match(/\$([0-9,]+)/);
      const idMatch = card.match(/data-id="([^"]+)"/i);
      const linkMatch = card.match(/href=["']([^"']+)["']/i);

      if (addressMatch && idMatch && linkMatch) {
        const address = addressMatch[1].trim();
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
        const stateMatch = address.match(/,\s*([A-Z]{2})\s+(\d{5})?/);
        const state = stateMatch?.[1] || null;
        if (!state) continue;
        const id = `USMS-${idMatch[1]}`;
        const sourceUrl = linkMatch[1].startsWith('http')
          ? linkMatch[1]
          : new URL(linkMatch[1], 'https://www.reallook.com').toString();

        listings.push({
          id,
          state,
          county: null,
          city: null,
          zip: stateMatch?.[2] || null,
          address,
          openingBid: price,
          estLow: null,
          estHigh: null,
          assessed: null,
          saleDate: null,
          plaintiff: null,
          defendant: null,
          occupancy: null,
          deposit: null,
          sourceUrl,
          raw: card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
          provenance: { origin: 'live', observed: true, publisher: 'RealLook / USMS', recordId: idMatch[1] },
        });
      }
    }

    return listings;
  }


  // Demo/Unsplash inventory overrides removed (2026-09-14 audit).
  // Live collectors must not fabricate listings; BaseScraper may still read
  // data/listings.snapshot.json as explicitly labeled fixture evidence.

}

module.exports = new UsMarshalsScraper();
module.exports.UsMarshalsScraper = UsMarshalsScraper;
