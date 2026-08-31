const BaseScraper = require('./base');

class HudHomeScraper extends BaseScraper {
  constructor() {
    super({ name: 'HudHomeCollector', sourceKey: 'hud' });
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      // Dev-mode fixture set: part of the canonical 20-listing corpus consumed
      // via scripts/build-data.js (see README "How the data flows").
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
          sourceUrl: null,
          raw: 'HUD CASE 411-998214: 892 S Champion Ave. List $58,000. Owner occupant period active.'
        },
        {
          id: 'OH-FRA-33120',
          state: 'OH',
          county: 'Franklin',
          city: 'Columbus',
          zip: '43231',
          address: '4470 Cleveland Ave, Columbus, OH 43231',
          lat: 40.054,
          lng: -82.912,
          beds: 3, baths: 1, sqft: 1260, year: 1956,
          openingBid: 52000, estLow: 118000, estHigh: 139000, assessed: 94000,
          saleDate: '2026-09-24',
          plaintiff: 'U.S. Dept of Housing and Urban Development',
          defendant: '—',
          judgment: 0,
          attorney: 'HUD Registered Listing Broker',
          occupancy: 'Vacant',
          deposit: '$1,000 earnest money via HUD HomeStore portal',
          sourceUrl: null,
          raw: 'HUD CASE 441-778820: 4470 Cleveland Ave, Columbus. List $52,000. Owner occupant period active through Sept 20.'
        },
        {
          id: 'HUD-GA-303-56',
          state: 'GA',
          county: 'DeKalb',
          city: 'Atlanta',
          zip: '30316',
          address: '2195 Flat Shoals Rd SE, Atlanta, GA 30316',
          lat: 33.702,
          lng: -84.331,
          beds: 3, baths: 2, sqft: 1440, year: 1962,
          openingBid: 71000, estLow: 156000, estHigh: 184000, assessed: 128000,
          saleDate: '2026-10-08',
          plaintiff: 'U.S. Dept of Housing and Urban Development',
          defendant: '—',
          judgment: 0,
          attorney: 'HUD Registered Listing Broker',
          occupancy: 'Vacant',
          deposit: '$1,000 earnest money via HUD HomeStore portal',
          sourceUrl: null,
          raw: 'HUD CASE 105-447192: 2195 Flat Shoals Rd SE, Atlanta. List $71,000. Insurable with escrow.'
        },
        {
          id: 'HUD-TX-735-12',
          state: 'TX',
          county: 'Dallas',
          city: 'Dallas',
          zip: '75217',
          address: '8610 Old Seagoville Rd, Dallas, TX 75217',
          lat: 32.692,
          lng: -96.648,
          beds: 3, baths: 2, sqft: 1520, year: 1978,
          openingBid: 88000, estLow: 171000, estHigh: 199000, assessed: 149000,
          saleDate: '2026-10-15',
          plaintiff: 'U.S. Dept of Housing and Urban Development',
          defendant: '—',
          judgment: 0,
          attorney: 'HUD Registered Listing Broker',
          occupancy: 'Vacant',
          deposit: '$1,000 earnest money via HUD HomeStore portal',
          sourceUrl: null,
          raw: 'HUD CASE 511-309218: 8610 Old Seagoville Rd, Dallas. List $88,000. UI - uninsurable.'
        },
        {
          id: 'HUD-FL-338-44',
          state: 'FL',
          county: 'Duval',
          city: 'Jacksonville',
          zip: '32210',
          address: '6633 Wilson Blvd, Jacksonville, FL 32210',
          lat: 30.279,
          lng: -81.748,
          beds: 3, baths: 2, sqft: 1380, year: 1971,
          openingBid: 46000, estLow: 121000, estHigh: 139000, assessed: 103000,
          saleDate: '2026-11-05',
          plaintiff: 'U.S. Dept of Housing and Urban Development',
          defendant: '—',
          judgment: 0,
          attorney: 'HUD Registered Listing Broker',
          occupancy: 'Vacant',
          deposit: '$1,000 earnest money via HUD HomeStore portal',
          sourceUrl: null,
          raw: 'HUD CASE 091-552810: 6633 Wilson Blvd, Jacksonville. List $46,000. Owner occupant period active.'
        }
      ];

      return mockHudListings.map(item => this.standardizeListing(item));
    });
  }
}

module.exports = new HudHomeScraper();
