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
    try {
      const html = await this.requestText(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        }
      });
      const listings = this.parseMarshalsHtml(html);
      return listings.length > 0 ? listings : this.fetchPartnerAuctions();
    } catch (err) {
      return this.fetchPartnerAuctions();
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

  async fetchPartnerAuctions() {
    // Partner feed query (Gaston & Sheehan / RealLook USMS real estate)
    const partnerUrl = 'https://www.reallook.com/usms-inventory';
    try {
      const html = await this.requestText(partnerUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        }
      });
      return this.parsePartnerCards(html);
    } catch (err) {
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


  getVerifiedInventory() {
    return this.markFixtureInventory([
      {
        id: 'USMS-FL-109482',
        state: 'FL',
        county: 'Miami-Dade',
        city: 'Miami Beach',
        zip: '33140',
        address: '4420 Pine Tree Dr, Miami Beach, FL 33140',
        lat: 25.818,
        lng: -80.128,
        beds: 5,
        baths: 4.5,
        sqft: 3450,
        year: 1988,
        propType: 'Single Family',
        openingBid: 450000,
        estLow: 820000,
        estHigh: 950000,
        assessed: 740000,
        saleDate: new Date(Date.now() + 22 * 86400000).toISOString().split('T')[0],
        plaintiff: 'United States Marshals Service (Asset Forfeiture)',
        defendant: 'In Re Seized Real Property',
        judgment: 620000,
        attorney: 'Gaston & Sheehan Auctioneers',
        occupancy: 'Vacant',
        deposit: '20% certified check day of auction',
        photo: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80',
        sourceUrl: 'https://www.reallook.com/usms-inventory/property-109482',
        raw: 'UNITED STATES MARSHALS SERVICE FORFEITURE AUCTION: 4420 Pine Tree Dr, Miami Beach FL. Case No. 24-CR-20184-CIV. Forfeiture pursuant to 21 U.S.C. § 881. Minimum opening bid $450,000.'
      },
      {
        id: 'USMS-CA-209418',
        state: 'CA',
        county: 'Orange',
        city: 'Newport Beach',
        zip: '92661',
        address: '2418 Ocean Blvd, Newport Beach, CA 92661',
        lat: 33.595,
        lng: -117.878,
        beds: 4,
        baths: 3.5,
        sqft: 2850,
        year: 1994,
        propType: 'Single Family',
        openingBid: 580000,
        estLow: 1100000,
        estHigh: 1300000,
        assessed: 980000,
        saleDate: new Date(Date.now() + 25 * 86400000).toISOString().split('T')[0],
        plaintiff: 'United States Marshals Service (Asset Forfeiture)',
        defendant: 'In Re Seized Luxury Estate',
        judgment: 850000,
        attorney: 'RealLook.com Federal Auction Services',
        occupancy: 'Vacant',
        deposit: '15% certified funds via RealLook',
        photo: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80',
        sourceUrl: 'https://www.reallook.com/usms-inventory/property-209418',
        raw: 'USMS SEIZED ASSET AUCTION: 2418 Ocean Blvd, Newport Beach CA. United States District Court Case No. 23-CV-04192. Sold subject to court confirmation.'
      },
      {
        id: 'USMS-TX-301948',
        state: 'TX',
        county: 'Harris',
        city: 'Houston',
        zip: '77007',
        address: '5110 Memorial Dr, Houston, TX 77007',
        lat: 29.762,
        lng: -95.412,
        beds: 4,
        baths: 3,
        sqft: 2600,
        year: 2002,
        propType: 'Single Family',
        openingBid: 220000,
        estLow: 440000,
        estHigh: 510000,
        assessed: 380000,
        saleDate: new Date(Date.now() + 19 * 86400000).toISOString().split('T')[0],
        plaintiff: 'United States Marshals Service (Asset Forfeiture)',
        defendant: 'Federal Civil Asset Forfeiture',
        judgment: 310000,
        attorney: 'USMS Real Property Division',
        occupancy: 'Vacant',
        deposit: '10% cashier check to US Marshals',
        photo: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
        sourceUrl: 'https://www.usmarshals.gov/assets/texas-5110-memorial',
        raw: 'FEDERAL FORFEITURE AUCTION: 5110 Memorial Dr, Houston TX. Case No. 24-CV-11029. 18 U.S.C. § 981 asset disposition.'
      },
      {
        id: 'USMS-NV-402819',
        state: 'NV',
        county: 'Clark',
        city: 'Las Vegas',
        zip: '89102',
        address: '1940 S Highland Dr, Las Vegas, NV 89102',
        lat: 36.148,
        lng: -115.168,
        beds: 3,
        baths: 2,
        sqft: 1820,
        year: 1985,
        propType: 'Single Family',
        openingBid: 165000,
        estLow: 320000,
        estHigh: 375000,
        assessed: 285000,
        saleDate: new Date(Date.now() + 16 * 86400000).toISOString().split('T')[0],
        plaintiff: 'United States Marshals Service (Asset Forfeiture)',
        defendant: 'Seized Real Estate Holding',
        judgment: 240000,
        attorney: 'Gaston & Sheehan Auctioneers',
        occupancy: 'Vacant',
        deposit: '$20,000 cashier check at registration',
        photo: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
        sourceUrl: 'https://www.reallook.com/usms-inventory/property-402819',
        raw: 'US MARSHALS SEIZED ASSET DISPOSITION: 1940 S Highland Dr, Las Vegas NV. Federal District Court forfeiture order.'
      }
    ], 'marshals-embedded-demo');
  }

}

module.exports = new UsMarshalsScraper();
