const BaseScraper = require('./base');

class IrsSeizedScraper extends BaseScraper {
  constructor() {
    super({ name: 'IrsAuctionCollector', sourceKey: 'irs' });
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
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
          sourceUrl: 'https://www.irsauctions.gov',
          raw: 'IRS SEIZED PROPERTY AUCTION: 915 E Stewart Ave. Minimum bid $110,000. 180-day redemption rule applies.'
        }
      ];

      return mockIrsListings.map(item => this.standardizeListing(item));
    });
  }
}

module.exports = new IrsSeizedScraper();
