const BaseScraper = require('./base');

class FannieMaeScraper extends BaseScraper {
  constructor() {
    super({ name: 'FannieMaeCollector', sourceKey: 'fannie' });
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      // Dev-mode fixture set: part of the canonical 20-listing corpus consumed
      // via scripts/build-data.js (see README "How the data flows").
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
          sourceUrl: null,
          raw: 'HOMEPATH REO PROPERTY: 3218 Avenue I. List $125,000. First Look program active.'
        },
        {
          id: 'FNMA-OH-452-63',
          state: 'OH',
          county: 'Hamilton',
          city: 'Cincinnati',
          zip: '45205',
          address: '2087 Harrison Ave, Cincinnati, OH 45205',
          lat: 39.122,
          lng: -84.606,
          beds: 3, baths: 2, sqft: 1620, year: 1955,
          openingBid: 79000, estLow: 152000, estHigh: 178000, assessed: 131000,
          saleDate: '2026-10-01',
          plaintiff: 'Fannie Mae REO',
          defendant: '—',
          judgment: 0,
          attorney: 'HomePath Realty Team',
          occupancy: 'Vacant',
          deposit: 'Standard HomePath contract',
          sourceUrl: null,
          raw: 'HOMEPATH REO PROPERTY: 2087 Harrison Ave. List $79,000. First Look window open.'
        },
        {
          id: 'FNMA-AZ-850-21',
          state: 'AZ',
          county: 'Maricopa',
          city: 'Phoenix',
          zip: '85033',
          address: '7402 W Elm St, Phoenix, AZ 85033',
          lat: 33.493,
          lng: -112.218,
          beds: 4, baths: 2, sqft: 1780, year: 1983,
          openingBid: 132000, estLow: 229000, estHigh: 267000, assessed: 205000,
          saleDate: '2026-10-09',
          plaintiff: 'Fannie Mae REO',
          defendant: '—',
          judgment: 0,
          attorney: 'HomePath Realty Team',
          occupancy: 'Vacant',
          deposit: 'Standard HomePath contract',
          sourceUrl: null,
          raw: 'HOMEPATH REO PROPERTY: 7402 W Elm St. List $132,000. Renovation financing eligible.'
        },
        {
          id: 'FNMA-MI-482-09',
          state: 'MI',
          county: 'Wayne',
          city: 'Detroit',
          zip: '48210',
          address: '4112 Central St, Detroit, MI 48210',
          lat: 42.322,
          lng: -83.132,
          beds: 3, baths: 1, sqft: 1240, year: 1938,
          openingBid: 39000, estLow: 96000, estHigh: 118000, assessed: 72000,
          saleDate: '2026-10-22',
          plaintiff: 'Fannie Mae REO',
          defendant: '—',
          judgment: 0,
          attorney: 'HomePath Realty Team',
          occupancy: 'Unknown',
          deposit: 'Standard HomePath contract',
          sourceUrl: null,
          raw: 'HOMEPATH REO PROPERTY: 4112 Central St. List $39,000. Sold as-is.'
        },
        {
          id: 'FNMA-NC-282-17',
          state: 'NC',
          county: 'Mecklenburg',
          city: 'Charlotte',
          zip: '28208',
          address: '1925 Wilkinson Blvd, Charlotte, NC 28208',
          lat: 35.244,
          lng: -80.888,
          beds: 3, baths: 2, sqft: 1410, year: 1970,
          openingBid: 102000, estLow: 189000, estHigh: 221000, assessed: 158000,
          saleDate: '2026-11-10',
          plaintiff: 'Fannie Mae REO',
          defendant: '—',
          judgment: 0,
          attorney: 'HomePath Realty Team',
          occupancy: 'Vacant',
          deposit: 'Standard HomePath contract',
          sourceUrl: null,
          raw: 'HOMEPATH REO PROPERTY: 1925 Wilkinson Blvd. List $102,000. First Look program active.'
        }
      ];

      return mockFannieListings.map(item => this.standardizeListing(item));
    });
  }
}

module.exports = new FannieMaeScraper();
