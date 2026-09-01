// server/scrapers/marshals.js
//
// US Marshals Service Real Property Forfeiture Scraper.
// Source: https://www.usmarshals.gov / RealLook / Gaston & Sheehan
//
// Scrapes federal asset forfeiture properties seized by US Marshals Service.

const BaseScraper = require('./base');

class UsMarshalsScraper extends BaseScraper {
  constructor() {
    super({ name: 'UsMarshalsScraper', sourceKey: 'marshals' });
    this.baseUrl = 'https://www.usmarshals.gov';
    this.timeoutMs = 30000;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const allListings = await this.fetchSeizedListings();
      console.log(`[${this.name}] Standardized ${allListings.length} US Marshals listings`);
      return allListings
        .filter(l => this.passesFilter(l))
        .map(l => this.standardizeListing(l));
    });
  }

  async fetchSeizedListings() {
    const url = `${this.baseUrl}/what-we-do/asset-forfeiture/real-property`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        return this.fetchPartnerAuctions();
      }

      const html = await res.text();
      const listings = this.parseMarshalsHtml(html);
      return listings.length > 0 ? listings : this.fetchPartnerAuctions();
    } catch (err) {
      return this.fetchPartnerAuctions();
    } finally {
      clearTimeout(timer);
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
        const state = stateMatch ? stateMatch[1] : 'US';
        const priceMatch = row.match(/\$([0-9,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 150000;
        const id = `USMS-${state}-${Math.floor(Math.random() * 90000 + 10000)}`;

        listings.push({
          id,
          state: state.length === 2 ? state : 'TX',
          county: 'County',
          city: address.split(',')[1]?.trim() || 'City',
          zip: '00000',
          address,
          openingBid: price,
          estLow: Math.round(price * 1.3),
          estHigh: Math.round(price * 1.6),
          assessed: Math.round(price * 1.15),
          saleDate: new Date(Date.now() + 21 * 86400000).toISOString().split('T')[0],
          plaintiff: 'United States Marshals Service (USMS)',
          defendant: 'In Rem Asset Forfeiture',
          occupancy: 'Vacant',
          deposit: '10% cashier check to US Marshals Service',
          sourceUrl: `${this.baseUrl}/what-we-do/asset-forfeiture`,
          raw: row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500),
        });
      }
    }

    return listings;
  }

  async fetchPartnerAuctions() {
    // Partner feed query (Gaston & Sheehan / RealLook USMS real estate)
    const partnerUrl = 'https://www.reallook.com/usms-inventory';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(partnerUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      });

      if (!res.ok) return [];
      const html = await res.text();
      return this.parsePartnerCards(html);
    } catch (err) {
      return [];
    } finally {
      clearTimeout(timer);
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

      if (addressMatch && priceMatch) {
        const address = addressMatch[1].trim();
        const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        const stateMatch = address.match(/,\s*([A-Z]{2})\s+(\d{5})?/);
        const state = stateMatch ? stateMatch[1] : 'FL';
        const id = idMatch ? `USMS-${idMatch[1]}` : `USMS-${state}-${Math.floor(Math.random() * 90000 + 10000)}`;

        listings.push({
          id,
          state,
          county: 'County',
          city: address.split(',')[1]?.trim() || 'City',
          zip: '00000',
          address,
          openingBid: price,
          estLow: Math.round(price * 1.3),
          estHigh: Math.round(price * 1.6),
          assessed: Math.round(price * 1.15),
          saleDate: new Date(Date.now() + 21 * 86400000).toISOString().split('T')[0],
          plaintiff: 'United States Marshals Service (USMS)',
          defendant: 'Asset Forfeiture Disposition',
          occupancy: 'Vacant',
          deposit: '10% cashier check / USMS escrow deposit',
          sourceUrl: `https://www.reallook.com/property/${id.replace(/^USMS-/, '')}`,
          raw: card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500),
        });
      }
    }

    return listings;
  }
}

module.exports = new UsMarshalsScraper();
