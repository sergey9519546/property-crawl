// server/scrapers/freddie.js
//
// Freddie Mac HomeSteps REO Property Scraper.
// Source: https://www.homesteps.com
//
// Scrapes live REO properties from Freddie Mac HomeSteps.

const BaseScraper = require('./base');
const {
  createRunReport,
  recordUnitFailure,
  recordUnitSuccess,
  finalizeRunReport,
  looksLikeClientRenderedShell,
  applyEmptyInventoryHonesty,
} = require('./run-report');

class FreddieMacScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'FreddieMacScraper', sourceKey: 'freddie' });
    this.baseUrl = 'https://www.homesteps.com';
    this.timeoutMs = 4000;
    this.useScrapling = options.useScrapling ?? false;
    this.extract = options.extractImpl || null;
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const topStates = (process.env.FREDDIE_STATES || 'OH,TX,FL,PA,IL,GA,NC,MI')
        .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const report = createRunReport('freddie', { endpoint: 'homesteps-api', states: topStates });
      report.statesRequested = [...topStates];
      report.endpointsTried = topStates.length;
      this.lastRunReport = report;

      const results = await Promise.allSettled(topStates.map(state => this.fetchStateListings(state)));
      const allListings = [];
      const htmlSamples = [];
      results.forEach((res, index) => {
        const state = topStates[index];
        if (res.status === 'fulfilled' && Array.isArray(res.value?.listings)) {
          recordUnitSuccess(report, state, res.value.listings.length);
          if (res.value.html) htmlSamples.push(res.value.html);
          allListings.push(...res.value.listings);
        } else if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          recordUnitSuccess(report, state, res.value.length);
          allListings.push(...res.value);
        } else {
          recordUnitFailure(report, state, res.status === 'rejected' ? res.reason : new Error('non-array result'), 'upstream');
        }
      });

      const standardized = allListings
        .filter(l => this.passesFilter(l))
        .map(l => this.standardizeListing(l));
      finalizeRunReport(report, { emitted: standardized.length });
      if (report.outcome === 'failed') {
        throw new Error(`FREDDIE_UPSTREAM_UNAVAILABLE: all ${topStates.length} HomeSteps state endpoints failed`);
      }
      applyEmptyInventoryHonesty(report, { emitted: standardized.length, htmlSamples, sourceKey: 'freddie' });
      console.log(`[${this.name}] Standardized ${standardized.length} Freddie Mac listings (${report.outcome})`);
      return standardized;
    });
  }

  async fetchStateListings(state) {
    const url = `${this.baseUrl}/homesteps/api/propertysearch?state=${encodeURIComponent(state)}`;
    try {
      const payload = await this.requestText(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
        }
      });
      const data = JSON.parse(payload);
      const items = Array.isArray(data) ? data : (data.properties || data.listings || []);
      const listings = items.map(p => this.mapJsonItem(p, state)).filter(Boolean);
      if (!listings.length) return this.fetchStateHtml(state);
      return { listings, html: null };
    } catch (err) {
      return this.fetchStateHtml(state);
    }
  }

  async fetchStateHtml(state) {
    const searchUrl = `${this.baseUrl}/listing/search?state=${state}`;
    const html = await this.requestText(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      }
    });
    const listings = this.parseHtmlCards(html, state);
    if (!listings.length && looksLikeClientRenderedShell(html)) {
      throw new Error(`FREDDIE_SPA_SHELL ${state}: client-rendered HomeSteps page has no parseable listing cards (not empty inventory)`);
    }
    return { listings, html };
  }

  parseHtmlCards(html, state) {
    const listings = [];
    const cardRegex = /<div[^>]*class="[^"]*property-card[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];
      const addressMatch = card.match(/class="[^"]*address[^"]*"[^>]*>([^<]+)<\//i);
      const priceMatch = card.match(/\$([0-9,]+)/);
      const idMatch = card.match(/data-property-id="([^"]+)"/i) || card.match(/href="\/property\/([^"]+)"/i);

      if (addressMatch && idMatch) {
        const address = addressMatch[1].trim();
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
        const id = `FRE-${idMatch[1]}`;

        listings.push({
          id,
          state,
          county: null,
          city: address.split(',')[1]?.trim() || null,
          zip: null,
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
          sourceUrl: `${this.baseUrl}/property/${id.replace(/^FRE-/, '')}`,
          raw: card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500),
          provenance: { origin: 'live', observed: true, publisher: 'Freddie Mac HomeSteps', recordId: idMatch[1] },
        });
      }
    }

    return listings;
  }

  mapJsonItem(p, state) {
    const rawPrice = p.listPrice ?? p.price ?? p.openingBid;
    const parsedPrice = Number(rawPrice);
    const price = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null;
    const propId = p.id ?? p.propertyId ?? p.mlsNumber;
    const streetAddress = p.address || p.streetAddress;
    if (propId == null || !String(streetAddress || '').trim()) return null;
    const address = p.address || [p.streetAddress, p.city, p.state || state, p.zip || p.postalCode].filter(Boolean).join(', ');

    return {
      id: `FRE-${propId}`,
      state: p.state || state,
      county: p.county ?? null,
      city: p.city ?? null,
      zip: p.zip ?? p.postalCode ?? null,
      address,
      lat: p.lat ?? p.latitude ?? null,
      lng: p.lng ?? p.longitude ?? null,
      beds: p.bedrooms ?? p.beds ?? null,
      baths: p.bathrooms ?? p.baths ?? null,
      sqft: p.sqft ?? p.squareFeet ?? null,
      year: p.yearBuilt ?? null,
      openingBid: price,
      estLow: p.estimatedValueLow ?? null,
      estHigh: p.estimatedValueHigh ?? null,
      assessed: p.assessedValue ?? null,
      saleDate: p.auctionDate ?? p.listDate ?? null,
      plaintiff: p.plaintiff ?? null,
      defendant: p.defendant ?? null,
      judgment: p.judgment ?? null,
      attorney: p.attorney ?? null,
      occupancy: p.occupancy ?? null,
      deposit: p.deposit ?? null,
      photo: p.photo ?? p.image ?? p.imageUrl ?? null,
      sourceUrl: p.url ? (p.url.startsWith('http') ? p.url : `${this.baseUrl}${p.url}`) : `${this.baseUrl}/property/${propId}`,
      raw: JSON.stringify(p).slice(0, 2000),
      provenance: { origin: 'live', observed: true, publisher: 'Freddie Mac HomeSteps', recordId: String(propId) },
    };
  }


  // Demo/Unsplash inventory overrides removed (2026-09-14 audit).
  // Live collectors must not fabricate listings; BaseScraper may still read
  // data/listings.snapshot.json as explicitly labeled fixture evidence.

}

module.exports = new FreddieMacScraper();
module.exports.FreddieMacScraper = FreddieMacScraper;
