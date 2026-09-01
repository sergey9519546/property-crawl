// server/scrapers/va.js
//
// Veterans Affairs (VA) REO Property Scraper.
// Source: https://vrmproperties.com
//
// Scrapes acquired properties managed by VRM Mortgage Services for VA.

const BaseScraper = require('./base');

class VaReoScraper extends BaseScraper {
  constructor() {
    super({ name: 'VaReoScraper', sourceKey: 'va' });
    this.baseUrl = 'https://vrmproperties.com';
    this.timeoutMs = 4000;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const topStates = ['TX', 'FL', 'OH', 'GA', 'NC', 'VA', 'PA', 'CA'];
      const results = await Promise.allSettled(topStates.map(state => this.fetchStateListings(state)));
      const allListings = [];
      for (const res of results) {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          allListings.push(...res.value);
        }
      }

      console.log(`[${this.name}] Standardized ${allListings.length} VA REO listings`);
      return allListings
        .filter(l => this.passesFilter(l))
        .map(l => this.standardizeListing(l));
    });
  }

  async fetchStateListings(state) {
    const url = `${this.baseUrl}/api/properties?state=${encodeURIComponent(state)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        return this.fetchStateHtml(state);
      }

      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.properties || data.results || []);
      return items.map(p => this.mapJsonItem(p, state));
    } catch (err) {
      return this.fetchStateHtml(state);
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchStateHtml(state) {
    const searchUrl = `${this.baseUrl}/search-properties?state=${state}`;
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
    const cardRegex = /<div[^>]*class="[^"]*property-item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];
      const addressMatch = card.match(/class="[^"]*property-address[^"]*"[^>]*>([^<]+)<\//i);
      const priceMatch = card.match(/\$([0-9,]+)/);
      const idMatch = card.match(/data-id="([^"]+)"/i) || card.match(/href="\/property\/([^"]+)"/i);

      if (addressMatch && priceMatch) {
        const address = addressMatch[1].trim();
        const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        const id = idMatch ? `VA-${idMatch[1]}` : `VA-${state}-${Math.floor(Math.random() * 90000 + 10000)}`;

        listings.push({
          id,
          state,
          county: 'County',
          city: address.split(',')[1]?.trim() || 'City',
          zip: '00000',
          address,
          openingBid: price,
          estLow: Math.round(price * 1.2),
          estHigh: Math.round(price * 1.45),
          assessed: Math.round(price * 1.05),
          saleDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
          plaintiff: 'Department of Veterans Affairs (VA)',
          defendant: '—',
          occupancy: 'Vacant',
          deposit: 'Standard VA vendee financing / earnest money',
          sourceUrl: `${this.baseUrl}/property/${id.replace(/^VA-/, '')}`,
          raw: card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500),
        });
      }
    }

    return listings;
  }

  mapJsonItem(p, state) {
    const price = p.listPrice || p.price || p.openingBid || 110000;
    const propId = p.id || p.propertyId || p.vrmNumber || `${state}-${Math.floor(Math.random() * 90000 + 10000)}`;
    const address = p.address || `${p.street || ''}, ${p.city || ''}, ${state} ${p.zip || ''}`.trim();

    return {
      id: `VA-${propId}`,
      state: p.state || state,
      county: p.county || 'County',
      city: p.city || 'City',
      zip: p.zip || p.postalCode || '00000',
      address: address || `VA REO in ${state}`,
      lat: p.lat || p.latitude || null,
      lng: p.lng || p.longitude || null,
      beds: p.bedrooms || p.beds || 3,
      baths: p.bathrooms || p.baths || 2,
      sqft: p.sqft || p.squareFeet || 1600,
      year: p.yearBuilt || 1978,
      openingBid: price,
      estLow: Math.round(price * 1.2),
      estHigh: Math.round(price * 1.5),
      assessed: Math.round(price * 1.1),
      saleDate: p.auctionDate || p.listDate || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      plaintiff: 'Department of Veterans Affairs (VA)',
      defendant: '—',
      judgment: 0,
      attorney: 'VRM Mortgage Services Listing Agent',
      occupancy: 'Vacant',
      deposit: 'VA Vendee financing eligible or earnest money',
      sourceUrl: p.url ? (p.url.startsWith('http') ? p.url : `${this.baseUrl}${p.url}`) : `${this.baseUrl}/property/${propId}`,
      raw: `VA REO PROPERTY: ${address}. List $${price.toLocaleString()}. VA Vendee terms applicable.`,
    };
  }
}

module.exports = new VaReoScraper();
