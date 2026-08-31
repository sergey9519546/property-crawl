const BaseScraper = require('./base');

class IrsSeizedScraper extends BaseScraper {
  constructor() {
    super({ name: 'IrsAuctionCollector', sourceKey: 'irs' });
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      // Dev-mode fixture set: part of the canonical 20-listing corpus consumed
      // via scripts/build-data.js (see README "How the data flows").
      const mockIrsListings = [
        {
          id: 'IRS-NV-891-88',
          state: 'NV',
          county: 'Clark',
          city: 'Las Vegas',
          zip: '89101',
          address: '915 E Stewart Ave, Las Vegas, NV 89101',
          lat: 36.172,
          lng: -115.132,
          beds: 2, baths: 1, sqft: 980, year: 1958,
          openingBid: 110000, estLow: 215000, estHigh: 245000, assessed: 190000,
          saleDate: '2026-09-29',
          plaintiff: 'Internal Revenue Service (PALS)',
          defendant: '—',
          judgment: 0,
          attorney: 'IRS Property Appraisal & Liquidation Specialist',
          occupancy: 'Unknown',
          deposit: '20% certified check day of auction',
          sourceUrl: null,
          raw: 'IRS SEIZED PROPERTY AUCTION: 915 E Stewart Ave. Minimum bid $110,000. 180-day redemption rule applies.'
        },
        {
          id: 'IRS-CA-900-45',
          state: 'CA',
          county: 'Los Angeles',
          city: 'Los Angeles',
          zip: '90011',
          address: '5418 Hooper Ave, Los Angeles, CA 90011',
          lat: 34.002,
          lng: -118.252,
          beds: 2, baths: 1, sqft: 1040, year: 1948,
          openingBid: 176000, estLow: 319000, estHigh: 362000, assessed: 284000,
          saleDate: '2026-10-14',
          plaintiff: 'Internal Revenue Service (PALS)',
          defendant: '—',
          judgment: 0,
          attorney: 'IRS Property Appraisal & Liquidation Specialist',
          occupancy: 'Vacant',
          deposit: '20% certified check day of auction',
          sourceUrl: null,
          raw: 'IRS SEIZED PROPERTY AUCTION: 5418 Hooper Ave. Minimum bid $176,000. Offered as-is, where-is.'
        },
        {
          id: 'IRS-FL-331-29',
          state: 'FL',
          county: 'Miami-Dade',
          city: 'Miami',
          zip: '33147',
          address: '1821 NW 62nd St, Miami, FL 33147',
          lat: 25.831,
          lng: -80.229,
          beds: 3, baths: 1, sqft: 1190, year: 1951,
          openingBid: 142000, estLow: 262000, estHigh: 298000, assessed: 231000,
          saleDate: '2026-10-27',
          plaintiff: 'Internal Revenue Service (PALS)',
          defendant: '—',
          judgment: 0,
          attorney: 'IRS Property Appraisal & Liquidation Specialist',
          occupancy: 'Unknown',
          deposit: '20% certified check day of auction',
          sourceUrl: null,
          raw: 'IRS SEIZED PROPERTY AUCTION: 1821 NW 62nd St. Minimum bid $142,000. 180-day redemption rule applies.'
        },
        {
          id: 'IRS-TX-752-66',
          state: 'TX',
          county: 'Dallas',
          city: 'Dallas',
          zip: '75241',
          address: '7207 Navajo Ln, Dallas, TX 75241',
          lat: 32.696,
          lng: -96.733,
          beds: 4, baths: 2, sqft: 1680, year: 1974,
          openingBid: 99000, estLow: 194000, estHigh: 226000, assessed: 165000,
          saleDate: '2026-11-12',
          plaintiff: 'Internal Revenue Service (PALS)',
          defendant: '—',
          judgment: 0,
          attorney: 'IRS Property Appraisal & Liquidation Specialist',
          occupancy: 'Vacant',
          deposit: '20% certified check day of auction',
          sourceUrl: null,
          raw: 'IRS SEIZED PROPERTY AUCTION: 7207 Navajo Ln. Minimum bid $99,000. Open house TBD.'
        }
      ];

      return mockIrsListings.map(item => this.standardizeListing(item));
    });
  }
}

module.exports = new IrsSeizedScraper();
