// server/scrapers/fannie.js
//
// Fannie Mae HomePath REO Property Scraper.
// Source: https://www.homepath.fanniemae.com
//
// Scrapes real single-family HomePath listings with First Look program windows.

const BaseScraper = require('./base');
const {
  createRunReport,
  recordUnitFailure,
  recordUnitSuccess,
  finalizeRunReport,
  looksLikeClientRenderedShell,
  applyEmptyInventoryHonesty,
} = require('./run-report');

class FannieMaeScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'FannieMaeScraper', sourceKey: 'fannie' });
    this.baseUrl = 'https://www.homepath.fanniemae.com';
    this.timeoutMs = 4000;
    // Structural parser not wired for HomePath SPA HTML; flag reserved.
    this.useScrapling = options.useScrapling ?? false;
    this.extract = options.extractImpl || null;
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const topStates = (process.env.FANNIE_STATES || 'TX,OH,FL,IL,PA,GA,AZ,NC')
        .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const report = createRunReport('fannie', { endpoint: 'homepath-search-service', states: topStates });
      report.statesRequested = [...topStates];
      report.endpointsTried = topStates.length;
      this.lastRunReport = report;

      const results = await Promise.allSettled(topStates.map(state => this.fetchStateHomePath(state)));
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
        throw new Error(`FANNIE_UPSTREAM_UNAVAILABLE: all ${topStates.length} HomePath state endpoints failed`);
      }
      applyEmptyInventoryHonesty(report, { emitted: standardized.length, htmlSamples, sourceKey: 'fannie' });
      console.log(`[${this.name}] Standardized ${standardized.length} Fannie Mae listings (${report.outcome})`);
      return standardized;
    });
  }

  async fetchStateHomePath(state) {
    const url = `${this.baseUrl}/search-service/v1/properties?state=${encodeURIComponent(state)}&pageSize=25`;
    try {
      const payload = await this.requestText(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
        }
      });
      const data = JSON.parse(payload);
      const items = Array.isArray(data) ? data : (data.properties || data.listings || data.content || []);
      const listings = items.map(p => this.mapJsonItem(p, state)).filter(Boolean);
      if (!listings.length) return this.fetchStateHtml(state);
      return { listings, html: null };
    } catch (err) {
      return this.fetchStateHtml(state);
    }
  }

  async fetchStateHtml(state) {
    const searchUrl = `${this.baseUrl}/listing/search?q=${state}`;
    const html = await this.requestText(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      }
    });
    const listings = this.parseHtmlCards(html, state);
    if (!listings.length && looksLikeClientRenderedShell(html)) {
      throw new Error(`FANNIE_SPA_SHELL ${state}: client-rendered HomePath page has no parseable listing cards (not empty inventory)`);
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
        const id = `FNMA-${idMatch[1]}`;

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
          sourceUrl: `${this.baseUrl}/property/${id.replace(/^FNMA-/, '')}`,
          raw: card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500),
          provenance: { origin: 'live', observed: true, publisher: 'Fannie Mae HomePath', recordId: idMatch[1] },
        });
      }
    }

    return listings;
  }

  mapJsonItem(p, state) {
    const rawPrice = p.listPrice ?? p.price ?? p.openingBid;
    const parsedPrice = Number(rawPrice);
    const price = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null;
    const propId = p.id ?? p.propertyId ?? p.listingId;
    const streetAddress = p.address || p.streetAddress;
    if (propId == null || !String(streetAddress || '').trim()) return null;
    const address = p.address || [p.streetAddress, p.city, p.state || state, p.zip || p.postalCode].filter(Boolean).join(', ');

    return {
      id: `FNMA-${propId}`,
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
      provenance: { origin: 'live', observed: true, publisher: 'Fannie Mae HomePath', recordId: String(propId) },
    };
  }


  // Demo/Unsplash inventory overrides removed (2026-09-14 audit).
  // Live collectors must not fabricate listings; BaseScraper may still read
  // data/listings.snapshot.json as explicitly labeled fixture evidence.

}

module.exports = new FannieMaeScraper();
module.exports.FannieMaeScraper = FannieMaeScraper;
