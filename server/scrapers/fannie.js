const BaseScraper = require('./base');

class FannieMaeScraper extends BaseScraper {
  constructor() {
    super({ name: 'FannieMaeCollector', sourceKey: 'fannie' });
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const mockFannieListings = [
        {
          id: 'FNMA-TX-761-44',
          state: 'TX',
          county: 'Tarrant',
          city: 'Fort Worth',
          zip: '76105',
          address: '3218 Avenue I, Fort Worth, TX 76105',
          lat: 32.721,
          lng: -97.288,
          beds: 3, baths: 2, sqft: 1450, year: 1965,
          openingBid: 125000, estLow: 185000, estHigh: 210000, assessed: 168000,
          saleDate: '2026-09-24',
          plaintiff: 'Fannie Mae REO',
          defendant: '—',
          judgment: 0,
          attorney: 'HomePath Realty Team',
          occupancy: 'Vacant',
          deposit: 'Standard HomePath contract',
          sourceUrl: 'https://www.homepath.com',
          raw: 'HOMEPATH REO PROPERTY: 3218 Avenue I. List $125,000. First Look program active.'
        }
      ];

      return mockFannieListings.map(item => this.standardizeListing(item));
    });
  }
}

module.exports = new FannieMaeScraper();
