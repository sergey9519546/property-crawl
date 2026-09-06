// server/scrapers/freddie.js
//
// Freddie Mac HomeSteps REO Property Scraper.
// Source: https://www.homesteps.com
//
// Scrapes live REO properties from Freddie Mac HomeSteps.

const BaseScraper = require('./base');

class FreddieMacScraper extends BaseScraper {
  constructor() {
    super({ name: 'FreddieMacScraper', sourceKey: 'freddie' });
    this.baseUrl = 'https://www.homesteps.com';
    this.timeoutMs = 4000;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const topStates = ['OH', 'TX', 'FL', 'PA', 'IL', 'GA', 'NC', 'MI'];
      const results = await Promise.allSettled(topStates.map(state => this.fetchStateListings(state)));
      const allListings = [];
      for (const res of results) {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          allListings.push(...res.value);
        }
      }

      console.log(`[${this.name}] Standardized ${allListings.length} Freddie Mac listings`);
      return allListings
        .filter(l => this.passesFilter(l))
        .map(l => this.standardizeListing(l));
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
      return items.map(p => this.mapJsonItem(p, state)).filter(Boolean);
    } catch (err) {
      return this.fetchStateHtml(state);
    }
  }

  async fetchStateHtml(state) {
    const searchUrl = `${this.baseUrl}/listing/search?state=${state}`;
    try {
      const html = await this.requestText(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        }
      });
      return this.parseHtmlCards(html, state);
    } catch (err) {
      return [];
    }
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


  getVerifiedInventory() {
    return this.markFixtureInventory([
      {
        id: 'FRE-882194',
        state: 'FL',
        county: 'Escambia',
        city: 'Pensacola',
        zip: '32504',
        address: '420 E Burgess Rd, Pensacola, FL 32504',
        lat: 30.485,
        lng: -87.215,
        beds: 3,
        baths: 2,
        sqft: 1480,
        year: 1978,
        propType: 'Single Family',
        openingBid: 92000,
        estLow: 165000,
        estHigh: 190000,
        assessed: 140000,
        saleDate: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
        plaintiff: 'Freddie Mac REO (HomeSteps)',
        defendant: '—',
        judgment: 0,
        attorney: 'HomeSteps Real Estate Broker',
        occupancy: 'Vacant',
        deposit: '$1,500 earnest money deposit',
        photo: 'https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=800&q=80',
        sourceUrl: 'https://www.homesteps.com/property/882194',
        raw: 'FREDDIE MAC HOMESTEPS: 420 E Burgess Rd, Pensacola FL 32504. List $92,000. SmartBuy initiative: up to 3% closing cost savings for owner-occupants.'
      },
      {
        id: 'FRE-771928',
        state: 'TX',
        county: 'Lubbock',
        city: 'Lubbock',
        zip: '79410',
        address: '3102 34th St, Lubbock, TX 79410',
        lat: 33.568,
        lng: -101.884,
        beds: 3,
        baths: 2,
        sqft: 1390,
        year: 1964,
        propType: 'Single Family',
        openingBid: 78000,
        estLow: 148000,
        estHigh: 172000,
        assessed: 125000,
        saleDate: new Date(Date.now() + 13 * 86400000).toISOString().split('T')[0],
        plaintiff: 'Freddie Mac REO (HomeSteps)',
        defendant: '—',
        judgment: 0,
        attorney: 'HomeSteps Real Estate Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 certified funds via HomeSteps portal',
        photo: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800&q=80',
        sourceUrl: 'https://www.homesteps.com/property/771928',
        raw: 'HOMESTEPS REO: 3102 34th St, Lubbock TX 79410. List $78,000. HomeSteps Good Neighbor program eligible.'
      },
      {
        id: 'FRE-664912',
        state: 'OH',
        county: 'Lucas',
        city: 'Toledo',
        zip: '43606',
        address: '1520 W Central Ave, Toledo, OH 43606',
        lat: 41.674,
        lng: -83.582,
        beds: 3,
        baths: 1.5,
        sqft: 1260,
        year: 1948,
        propType: 'Single Family',
        openingBid: 48000,
        estLow: 105000,
        estHigh: 128000,
        assessed: 88000,
        saleDate: new Date(Date.now() + 11 * 86400000).toISOString().split('T')[0],
        plaintiff: 'Freddie Mac REO (HomeSteps)',
        defendant: '—',
        judgment: 0,
        attorney: 'HomeSteps Real Estate Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money',
        photo: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80',
        sourceUrl: 'https://www.homesteps.com/property/664912',
        raw: 'HOMESTEPS PROPERTY: 1520 W Central Ave, Toledo OH 43606. List $48,000. First Look window for owner-occupants.'
      },
      {
        id: 'FRE-559103',
        state: 'IL',
        county: 'Sangamon',
        city: 'Springfield',
        zip: '62703',
        address: '1410 S 14th St, Springfield, IL 62703',
        lat: 39.789,
        lng: -89.638,
        beds: 3,
        baths: 1,
        sqft: 1210,
        year: 1950,
        propType: 'Single Family',
        openingBid: 52000,
        estLow: 112000,
        estHigh: 134000,
        assessed: 94000,
        saleDate: new Date(Date.now() + 17 * 86400000).toISOString().split('T')[0],
        plaintiff: 'Freddie Mac REO (HomeSteps)',
        defendant: '—',
        judgment: 0,
        attorney: 'HomeSteps Real Estate Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money',
        photo: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80',
        sourceUrl: 'https://www.homesteps.com/property/559103',
        raw: 'FREDDIE MAC HOMESTEPS: 1410 S 14th St, Springfield IL. List $52,000. SmartBuy program available.'
      },
      {
        id: 'FRE-448192',
        state: 'NC',
        county: 'Forsyth',
        city: 'Winston-Salem',
        zip: '27101',
        address: '1120 N Cleveland Ave, Winston-Salem, NC 27101',
        lat: 36.108,
        lng: -80.238,
        beds: 3,
        baths: 2,
        sqft: 1340,
        year: 1968,
        propType: 'Single Family',
        openingBid: 64000,
        estLow: 138000,
        estHigh: 162000,
        assessed: 115000,
        saleDate: new Date(Date.now() + 19 * 86400000).toISOString().split('T')[0],
        plaintiff: 'Freddie Mac REO (HomeSteps)',
        defendant: '—',
        judgment: 0,
        attorney: 'HomeSteps Real Estate Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money',
        photo: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
        sourceUrl: 'https://www.homesteps.com/property/448192',
        raw: 'HOMESTEPS REO: 1120 N Cleveland Ave, Winston-Salem NC 27101. List $64,000. First Look active.'
      }
    ], 'freddie-embedded-demo');
  }

}

module.exports = new FreddieMacScraper();
