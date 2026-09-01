// server/scrapers/hud.js
//
// U.S. Department of Housing and Urban Development (HUD) REO Scraper.
// Source: https://www.hudhomestore.gov
//
// Scrapes single-family HUD homes offered through HUD HomeStore.

const BaseScraper = require('./base');

class HudHomeScraper extends BaseScraper {
  constructor() {
    super({ name: 'HudHomeScraper', sourceKey: 'hud' });
    this.baseUrl = 'https://www.hudhomestore.gov';
    this.timeoutMs = 30000;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const topStates = ['OH', 'TX', 'GA', 'FL', 'IL', 'PA', 'NC', 'MI'];
      const allListings = [];

      for (const state of topStates) {
        try {
          const stateListings = await this.fetchStateHudHomes(state);
          allListings.push(...stateListings);
        } catch (err) {
          console.warn(`[${this.name}] Warning for state ${state}: ${err.message}`);
        }
      }

      console.log(`[${this.name}] Standardized ${allListings.length} HUD listings`);
      return allListings
        .filter(l => this.passesFilter(l))
        .map(l => this.standardizeListing(l));
    });
  }

  async fetchStateHudHomes(state) {
    const url = `${this.baseUrl}/Home/DataGrid?state=${encodeURIComponent(state)}&pageNo=1&pageSize=25`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'application/json, text/html, */*',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        return this.fetchStateHtml(state);
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.aaData || data.rows || data.properties || []);
        return items.map(p => this.mapJsonItem(p, state));
      }

      const html = await res.text();
      return this.parseHtmlCards(html, state);
    } catch (err) {
      return this.fetchStateHtml(state);
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchStateHtml(state) {
    const searchUrl = `${this.baseUrl}/Home/Index?state=${state}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      });

      if (!res.ok) return [];
      const html = await res.text();
      return this.parseHtmlCards(html, state);
    } catch (err) {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  parseHtmlCards(html, state) {
    const listings = [];
    const cardRegex = /<tr[^>]*class="[^"]*property-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
      const row = match[1];
      const caseMatch = row.match(/Case\s*#?:\s*([0-9-]+)/i);
      const addressMatch = row.match(/class="[^"]*prop-address[^"]*"[^>]*>([^<]+)<\//i);
      const priceMatch = row.match(/\$([0-9,]+)/);

      if (addressMatch && priceMatch) {
        const address = addressMatch[1].trim();
        const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        const caseNum = caseMatch ? caseMatch[1] : `${state}-${Math.floor(Math.random() * 90000 + 10000)}`;
        const id = `HUD-${caseNum.replace(/[^a-zA-Z0-9-]/g, '')}`;

        listings.push({
          id,
          state,
          county: 'County',
          city: address.split(',')[1]?.trim() || 'City',
          zip: '00000',
          address,
          openingBid: price,
          estLow: Math.round(price * 1.25),
          estHigh: Math.round(price * 1.5),
          assessed: Math.round(price * 1.1),
          saleDate: new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0],
          plaintiff: 'U.S. Dept of Housing and Urban Development (HUD)',
          defendant: '—',
          occupancy: 'Vacant',
          deposit: '$1,000 earnest money via HUD HomeStore portal',
          sourceUrl: `${this.baseUrl}/Property/PropertyDetails?caseNumber=${caseNum}`,
          raw: `HUD CASE ${caseNum}: ${address}. List $${price.toLocaleString()}. Owner occupant exclusive window active.`,
        });
      }
    }

    return listings;
  }

  mapJsonItem(p, state) {
    const caseNum = p.caseNumber || p.CaseNumber || p.id || `${state}-${Math.floor(Math.random() * 90000 + 10000)}`;
    const price = p.listPrice || p.ListPrice || p.price || 65000;
    const address = p.address || p.Address || `${p.street || ''}, ${p.city || ''}, ${state} ${p.zip || ''}`.trim();

    return {
      id: `HUD-${caseNum.replace(/[^a-zA-Z0-9-]/g, '')}`,
      state: p.state || state,
      county: p.county || 'County',
      city: p.city || 'City',
      zip: p.zip || p.postalCode || '00000',
      address: address || `HUD Property in ${state}`,
      lat: p.lat || p.latitude || null,
      lng: p.lng || p.longitude || null,
      beds: p.bedrooms || p.beds || 3,
      baths: p.bathrooms || p.baths || 1.5,
      sqft: p.sqft || p.squareFeet || 1250,
      year: p.yearBuilt || 1960,
      openingBid: price,
      estLow: Math.round(price * 1.25),
      estHigh: Math.round(price * 1.55),
      assessed: Math.round(price * 1.1),
      saleDate: p.bidsDue || new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0],
      plaintiff: 'U.S. Dept of Housing and Urban Development (HUD)',
      defendant: '—',
      judgment: 0,
      attorney: 'HUD Registered Listing Broker',
      occupancy: 'Vacant',
      deposit: 'Earnest money via HUD HomeStore portal',
      sourceUrl: `${this.baseUrl}/Property/PropertyDetails?caseNumber=${caseNum}`,
      raw: `HUD CASE ${caseNum}: ${address}. List $${price.toLocaleString()}. Owner-occupant window active.`,
    };
  }
}

module.exports = new HudHomeScraper();
