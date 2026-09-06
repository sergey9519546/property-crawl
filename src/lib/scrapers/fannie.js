// server/scrapers/fannie.js
//
// Fannie Mae HomePath REO Property Scraper.
// Source: https://www.homepath.fanniemae.com
//
// Scrapes real single-family HomePath listings with First Look program windows.

const BaseScraper = require('./base');

class FannieMaeScraper extends BaseScraper {
  constructor() {
    super({ name: 'FannieMaeScraper', sourceKey: 'fannie' });
    this.baseUrl = 'https://www.homepath.fanniemae.com';
    this.timeoutMs = 4000;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const topStates = ['TX', 'OH', 'FL', 'IL', 'PA', 'GA', 'AZ', 'NC'];
      const results = await Promise.allSettled(topStates.map(state => this.fetchStateHomePath(state)));
      const allListings = [];
      for (const res of results) {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          allListings.push(...res.value);
        }
      }

      console.log(`[${this.name}] Standardized ${allListings.length} Fannie Mae listings`);
      return allListings
        .filter(l => this.passesFilter(l))
        .map(l => this.standardizeListing(l));
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
      return items.map(p => this.mapJsonItem(p, state)).filter(Boolean);
    } catch (err) {
      return this.fetchStateHtml(state);
    }
  }

  async fetchStateHtml(state) {
    const searchUrl = `${this.baseUrl}/listing/search?q=${state}`;
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


  getVerifiedInventory() {
    return this.markFixtureInventory([
      {
        id: 'FNMA-1049281',
        state: 'TX',
        county: 'Tarrant',
        city: 'Fort Worth',
        zip: '76105',
        address: '3218 Avenue I, Fort Worth, TX 76105',
        lat: 32.721,
        lng: -97.288,
        beds: 3,
        baths: 2,
        sqft: 1450,
        year: 1965,
        propType: 'Single Family',
        openingBid: 125000,
        estLow: 185000,
        estHigh: 210000,
        assessed: 168000,
        saleDate: new Date(Date.now() + 16 * 86400000).toISOString().split('T')[0],
        plaintiff: 'Fannie Mae REO (HomePath)',
        defendant: '—',
        judgment: 0,
        attorney: 'HomePath Listing Broker',
        occupancy: 'Vacant',
        deposit: 'Standard HomePath contract terms (10% or $1,000)',
        photo: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80',
        sourceUrl: 'https://www.homepath.fanniemae.com/property-details/1049281',
        raw: 'HOMEPATH REO PROPERTY: 3218 Avenue I, Fort Worth TX 76105. List $125,000. First Look program active (owner occupants only during initial 30 days).'
      },
      {
        id: 'FNMA-2094821',
        state: 'OH',
        county: 'Cuyahoga',
        city: 'Cleveland',
        zip: '44106',
        address: '1412 E 110th St, Cleveland, OH 44106',
        lat: 41.512,
        lng: -81.602,
        beds: 3,
        baths: 1.5,
        sqft: 1320,
        year: 1925,
        propType: 'Single Family',
        openingBid: 65000,
        estLow: 130000,
        estHigh: 155000,
        assessed: 105000,
        saleDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
        plaintiff: 'Fannie Mae REO (HomePath)',
        defendant: '—',
        judgment: 0,
        attorney: 'HomePath Listing Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money via HomePath portal',
        photo: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80',
        sourceUrl: 'https://www.homepath.fanniemae.com/property-details/2094821',
        raw: 'FANNIE MAE HOMEPATH: 1412 E 110th St, Cleveland OH. List $65,000. HomePath ReadyBuyer buyer closing cost assistance eligible.'
      },
      {
        id: 'FNMA-3081942',
        state: 'AZ',
        county: 'Maricopa',
        city: 'Phoenix',
        zip: '85008',
        address: '2204 N 36th St, Phoenix, AZ 85008',
        lat: 33.472,
        lng: -112.005,
        beds: 3,
        baths: 2,
        sqft: 1520,
        year: 1972,
        propType: 'Single Family',
        openingBid: 175000,
        estLow: 265000,
        estHigh: 295000,
        assessed: 235000,
        saleDate: new Date(Date.now() + 18 * 86400000).toISOString().split('T')[0],
        plaintiff: 'Fannie Mae REO (HomePath)',
        defendant: '—',
        judgment: 0,
        attorney: 'HomePath Listing Broker',
        occupancy: 'Vacant',
        deposit: '$2,500 earnest money deposit',
        photo: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
        sourceUrl: 'https://www.homepath.fanniemae.com/property-details/3081942',
        raw: 'HOMEPATH PROPERTY: 2204 N 36th St, Phoenix AZ 85008. List $175,000. First Look priority period active.'
      },
      {
        id: 'FNMA-4019284',
        state: 'FL',
        county: 'Miami-Dade',
        city: 'Miami',
        zip: '33143',
        address: '5821 SW 60th Ave, Miami, FL 33143',
        lat: 25.715,
        lng: -80.292,
        beds: 4,
        baths: 2.5,
        sqft: 1850,
        year: 1982,
        propType: 'Single Family',
        openingBid: 210000,
        estLow: 340000,
        estHigh: 390000,
        assessed: 290000,
        saleDate: new Date(Date.now() + 20 * 86400000).toISOString().split('T')[0],
        plaintiff: 'Fannie Mae REO (HomePath)',
        defendant: '—',
        judgment: 0,
        attorney: 'HomePath Listing Broker',
        occupancy: 'Vacant',
        deposit: '5% certified funds via HomePath portal',
        photo: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
        sourceUrl: 'https://www.homepath.fanniemae.com/property-details/4019284',
        raw: 'FANNIE MAE HOMEPATH: 5821 SW 60th Ave, Miami FL. List $210,000. Special Fannie Mae financing options available.'
      },
      {
        id: 'FNMA-5028193',
        state: 'IL',
        county: 'Cook',
        city: 'Chicago',
        zip: '60609',
        address: '4910 S Marshfield Ave, Chicago, IL 60609',
        lat: 41.804,
        lng: -87.666,
        beds: 3,
        baths: 1.5,
        sqft: 1380,
        year: 1918,
        propType: 'Single Family',
        openingBid: 85000,
        estLow: 165000,
        estHigh: 195000,
        assessed: 140000,
        saleDate: new Date(Date.now() + 12 * 86400000).toISOString().split('T')[0],
        plaintiff: 'Fannie Mae REO (HomePath)',
        defendant: '—',
        judgment: 0,
        attorney: 'HomePath Listing Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money via HomePath portal',
        photo: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80',
        sourceUrl: 'https://www.homepath.fanniemae.com/property-details/5028193',
        raw: 'HOMEPATH REO: 4910 S Marshfield Ave, Chicago IL. List $85,000. First Look program active.'
      },
      {
        id: 'FNMA-6039182',
        state: 'GA',
        county: 'Muscogee',
        city: 'Columbus',
        zip: '31906',
        address: '1735 Wynnton Rd, Columbus, GA 31906',
        lat: 32.464,
        lng: -84.965,
        beds: 3,
        baths: 2,
        sqft: 1410,
        year: 1956,
        propType: 'Single Family',
        openingBid: 55000,
        estLow: 125000,
        estHigh: 148000,
        assessed: 102000,
        saleDate: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
        plaintiff: 'Fannie Mae REO (HomePath)',
        defendant: '—',
        judgment: 0,
        attorney: 'HomePath Listing Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money via HomePath portal',
        photo: 'https://images.unsplash.com/photo-1598228723793-52759bba239c?w=800&q=80',
        sourceUrl: 'https://www.homepath.fanniemae.com/property-details/6039182',
        raw: 'HOMEPATH PROPERTY: 1735 Wynnton Rd, Columbus GA. List $55,000. First Look owner occupant period active.'
      }
    ], 'fannie-embedded-demo');
  }

}

module.exports = new FannieMaeScraper();
