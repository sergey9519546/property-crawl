const BaseScraper = require('./base');

class HudHomeScraper extends BaseScraper {
  constructor() {
    super({ name: 'HudHomeCollector', sourceKey: 'hud' });
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const mockHudListings = [
        {
          id: 'HUD-OH-441-102',
          state: 'OH',
          county: 'Franklin',
          city: 'Columbus',
          zip: '43207',
          address: '892 S Champion Ave, Columbus, OH 43207',
          lat: 39.945,
          lng: -82.971,
          beds: 3, baths: 1, sqft: 1180, year: 1952,
          openingBid: 58000, estLow: 110000, estHigh: 128000, assessed: 94000,
          saleDate: '2026-09-30',
          plaintiff: 'U.S. Dept of Housing and Urban Development',
          defendant: '—',
          judgment: 0,
          attorney: 'HUD Registered Listing Broker',
          occupancy: 'Vacant',
          deposit: 'Earnest money via HUD portal',
          sourceUrl: 'https://www.hudhomestore.gov',
          raw: 'HUD CASE 411-998214: 892 S Champion Ave. List $58,000. Owner occupant period active.'
        }
      ];

      return mockHudListings.map(item => this.standardizeListing(item));
    });
  }
}

module.exports = new HudHomeScraper();
