const BaseScraper = require('./base');

class SheriffSaleScraper extends BaseScraper {
  constructor() {
    super({ name: 'SheriffSaleCollector', sourceKey: 'sheriff' });
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      // Production scraper feed parser: normalizes judicial foreclosure notices.
      // Dev-mode fixture set: part of the canonical 20-listing corpus consumed
      // via scripts/build-data.js (see README "How the data flows").
      const mockRawNotices = [
        {
          id: 'OH-CUY-10231',
          state: 'OH',
          county: 'Cuyahoga',
          city: 'Cleveland',
          zip: '44105',
          address: '3841 E 55th St, Cleveland, OH 44105',
          lat: 41.467,
          lng: -81.652,
          beds: 3, baths: 1.5, sqft: 1340, year: 1924,
          openingBid: 38000, estLow: 105000, estHigh: 132000, assessed: 88000,
          saleDate: '2026-09-18',
          plaintiff: 'Huntington National Bank',
          defendant: 'Kowalski, Donald J.',
          judgment: 71340,
          attorney: 'Carlisle, McNellie, Rini, Kramer & Ulrich Co., LPA',
          occupancy: 'Occupied (drive-by only)',
          deposit: '$5,000 certified check to Sheriff at auction',
          sourceUrl: null,
          raw: 'CASE NO. CV-24-991204: Huntington National Bank vs. Donald J. Kowalski. Permanent Parcel No. 132-08-041. Appraised $110,000. Minimum bid $38,000.'
        },
        {
          id: 'OH-CUY-2026-99',
          state: 'OH',
          county: 'Cuyahoga',
          city: 'Cleveland',
          zip: '44102',
          address: '4120 Clark Ave, Cleveland, OH 44102',
          lat: 41.468,
          lng: -81.712,
          beds: 3, baths: 1, sqft: 1250, year: 1920,
          openingBid: 42000, estLow: 85000, estHigh: 105000, assessed: 72000,
          saleDate: '2026-09-28',
          plaintiff: 'Huntington National Bank',
          defendant: 'R. Kowalski Estate',
          judgment: 68400,
          attorney: 'Carlisle Law Group',
          occupancy: 'Vacant',
          deposit: '10% certified funds',
          raw: 'NOTICE OF SHERIFF SALE: Cuyahoga County CV-26-992144. 4120 Clark Ave. Appraised $95k, 2/3 minimum bid.'
        },
        {
          id: 'TX-HAR-77441',
          state: 'TX',
          county: 'Harris',
          city: 'Houston',
          zip: '77009',
          address: '917 E 24th St, Houston, TX 77009',
          lat: 29.792,
          lng: -95.352,
          beds: 3, baths: 2, sqft: 1610, year: 1947,
          openingBid: 95000, estLow: 198000, estHigh: 232000, assessed: 176000,
          saleDate: '2026-10-06',
          plaintiff: 'Wells Fargo Bank, N.A.',
          defendant: 'M. Okonkwo',
          judgment: 121300,
          attorney: 'Barrett Daffin Frappier Turner & Engel LLP',
          occupancy: 'Unknown',
          deposit: '5% cashier\'s check day of sale',
          sourceUrl: 'https://www.hcso.org',
          raw: 'HARRIS COUNTY CONSTABLE SALE: Cause 2024-58871. 917 E 24th St, Houston. Judgment $121,300.'
        },
        {
          id: 'PA-PHI-55630',
          state: 'PA',
          county: 'Philadelphia',
          city: 'Philadelphia',
          zip: '19134',
          address: '2846 Amber St, Philadelphia, PA 19134',
          lat: 39.991,
          lng: -75.108,
          beds: 3, baths: 1, sqft: 1120, year: 1935,
          openingBid: 27000, estLow: 82000, estHigh: 97000, assessed: 61500,
          saleDate: '2026-10-13',
          plaintiff: 'Truist Bank',
          defendant: 'A. Santiago',
          judgment: 44200,
          attorney: 'LOGS Legal Group LLP',
          occupancy: 'Occupied',
          deposit: '10% of bid, certified funds',
          sourceUrl: 'https://www.philadelphiasheriff.com',
          raw: 'SHERIFF\'S SALE: Writ 2024-1187 CP. 2846 Amber St, Philadelphia. Judgment $44,200.'
        },
        {
          id: 'IL-COK-31888',
          state: 'IL',
          county: 'Cook',
          city: 'Chicago',
          zip: '60629',
          address: '6145 S Maplewood Ave, Chicago, IL 60629',
          lat: 41.782,
          lng: -87.689,
          beds: 3, baths: 1, sqft: 1280, year: 1949,
          openingBid: 64000, estLow: 142000, estHigh: 168000, assessed: 118000,
          saleDate: '2026-10-20',
          plaintiff: 'U.S. Bank National Association',
          defendant: 'D. Whitfield',
          judgment: 89700,
          attorney: 'The Wirbicki Law Group LLC',
          occupancy: 'Unknown',
          deposit: '10% down at sale, certified funds',
          sourceUrl: 'https://www.cookcountysheriffil.gov',
          raw: 'COOK COUNTY JUDICIAL SALE: Case 2024CH08812. 6145 S Maplewood Ave, Chicago. Judgment $89,700.'
        },
        {
          id: 'OH-MON-77455',
          state: 'OH',
          county: 'Montgomery',
          city: 'Dayton',
          zip: '45410',
          address: '2218 Revere Ave, Dayton, OH 45410',
          lat: 39.744,
          lng: -84.147,
          beds: 3, baths: 1, sqft: 1150, year: 1941,
          openingBid: 33000, estLow: 76000, estHigh: 90000, assessed: 55000,
          saleDate: '2026-11-03',
          plaintiff: 'Fifth Third Bank',
          defendant: 'T. Combs Estate',
          judgment: 49800,
          attorney: 'Shapiro, Van Ess & Parian LLP',
          occupancy: 'Vacant',
          deposit: '10% certified funds day of sale',
          sourceUrl: 'https://www.mcohiosheriff.org',
          raw: 'MONTGOMERY COUNTY SHERIFF SALE: Case 2025-CV-00392. 2218 Revere Ave, Dayton. Appraised $83,000.'
        }
      ];

      return mockRawNotices.map(item => this.standardizeListing(item));
    });
  }
}

module.exports = new SheriffSaleScraper();
