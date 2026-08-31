// server/scrapers/usda.js
//
// REAL USDA RD/FSA REO & foreclosure scraper.
// Source: https://www.resales.usda.gov/resales/public/searchSFH  (public, no auth)
// Strategy: the Single-Family search form is a POST that returns a static
//   <table id="propertySummariesTable"> with every field we need (photo,
//   address, city, state, county, zip, price/bid, beds, baths, sqft) plus a
//   link to the per-property detail page. No detail fetches required.
//
// Per docs/STRATEGY.md §2 Tier A and docs/sources-to-scrape.md #3: the
// data.gov feed is dead (2018); parse the live site respectfully. Volume is
// low (~15 active nationally at a time) so we POST once per state that has
// listings (the state dropdown only lists states with inventory).
//
// NOTE: the bare host `resales.usda.gov` does not resolve — use `www.`.
// Rate limit: 1 req/sec between state POSTs. Be polite — US government site.

const BaseScraper = require('./base');

const STATE_NAME_TO_CODE = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC', 'Puerto Rico': 'PR'
};

class UsdaResalesScraper extends BaseScraper {
  constructor() {
    super({ name: 'UsdaResalesCollector', sourceKey: 'usda' });
    this.baseUrl = 'https://www.resales.usda.gov';
    this.delayMs = 1000; // 1 req/sec
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      // 1. Load the SFH search page to discover which states have inventory.
      const formHtml = await this.fetchText(`${this.baseUrl}/resales/public/searchSFH`);
      const states = this.parseStateOptions(formHtml);
      console.log(`[${this.name}] ${states.length} states with SFH inventory: ${states.map(s => s.code).join(', ')}`);

      // 2. POST a search for each state → parse the summary table.
      const listings = [];
      for (const { code } of states) {
        try {
          const rows = await this.searchState(code);
          for (const row of rows) {
            const listing = this.rowToListing(row);
            if (listing) listings.push(listing);
          }
          await this.sleep(this.delayMs);
        } catch (err) {
          console.warn(`[${this.name}] Failed state ${code}: ${err.message}`);
        }
      }

      console.log(`[${this.name}] Scraped ${listings.length} USDA properties`);
      return listings.map(item => this.standardizeListing(item));
    });
  }

  // Parse the <select id="stateCode"> options that have a non-empty value
  // (the dropdown only lists states with active properties).
  parseStateOptions(html) {
    const m = html.match(/<select[^>]*id="stateCode"[\s\S]*?<\/select>/);
    if (!m) return [];
    const opts = [...m[0].matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)];
    return opts
      .filter(o => o[1] && o[1].trim() !== '')
      .map(o => ({ code: o[1].trim(), label: o[2].trim() }));
  }

  async searchState(stateCode) {
    const body = new URLSearchParams({
      stateCode,
      countyCode: '',
      city: '',
      zipCode: '',
      propertyType: 'Single Family',
      listingType: 'All Types',
      minPrice: '',
      maxPrice: '',
      bedrooms: '',
      bathrooms: '',
      squareFootage: '',
      searchFormName: 'SFH',
      Search: 'Search'
    }).toString();

    const html = await this.fetchText(`${this.baseUrl}/resales/public/searchSFH`, 30000, 'POST', body);
    return this.parseSummaryTable(html);
  }

  parseSummaryTable(html) {
    const m = html.match(/<table[^>]*id="propertySummariesTable"[^>]*>([\s\S]*?)<\/table>/);
    if (!m) return [];
    const rows = [...m[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(r => r[1]);
    // Skip the header row (first row). Each data row has 11 cells.
    return rows.slice(1).map(rowHtml => [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]));
  }

  rowToListing(cells) {
    if (!cells || cells.length < 11) return null;

    // cell[0]: <img src="..."> + <a href="/resales/public/SFHPropertyDetail?id=N&...">
    const photoMatch = cells[0].match(/src="([^"]+)"/);
    const detailMatch = cells[0].match(/href="([^"]*SFHPropertyDetail[^"]*)"/);

    const listingType = this.text(cells[1]); // REO Property | Foreclosure
    const address = this.text(cells[2]).replace(/\s*Map\s*$/, '').trim();
    const city = this.text(cells[3]).replace(/,$/, '').trim();
    const stateName = this.text(cells[4]).trim();
    const county = this.text(cells[5]).trim();
    const zip = this.text(cells[6]).trim().slice(0, 5);
    const openingBid = this.parseMoney(this.text(cells[7]));
    const beds = this.firstInt(cells[8]);
    const baths = this.firstInt(cells[9]);
    const sqft = this.firstInt(cells[10]);

    const state = STATE_NAME_TO_CODE[stateName] || 'US';
    if (state === 'US' || !/^\d/.test(address) || !openingBid) return null;

    const detailId = detailMatch ? (detailMatch[1].match(/id=(\d+)/) || [])[1] : null;
    const sourceUrl = detailMatch ? `${this.baseUrl}${detailMatch[1]}` : null;
    const photo = photoMatch ? photoMatch[1] : 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=640&q=70';

    return {
      id: `USDA-${state}-${detailId || address.replace(/\D/g, '').slice(0, 8)}`,
      state,
      county,
      city,
      zip,
      address: `${address}, ${city}, ${state} ${zip}`,
      lat: 0,
      lng: 0,
      beds,
      baths,
      sqft,
      year: null,
      propType: 'Single Family',
      openingBid,
      estLow: 0,
      estHigh: 0,
      assessed: 0,
      saleDate: null,
      plaintiff: 'U.S. Dept of Agriculture — Rural Development',
      defendant: '—',
      judgment: 0,
      attorney: listingType === 'Foreclosure' ? 'USDA-RD servicing office' : 'USDA-RD listing agent',
      occupancy: 'Unknown',
      deposit: 'See USDA RD/FSA purchase terms',
      photo,
      sourceUrl,
      raw: `USDA ${listingType} — ${address}, ${city}, ${stateName} ${zip}`
    };
  }

  text(cellHtml) {
    return cellHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }

  firstInt(cellHtml) {
    const m = this.text(cellHtml).match(/(\d[\d,]*)/);
    return m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) || 0 : 0;
  }

  parseMoney(s) {
    if (!s) return 0;
    return Math.round(parseFloat(s.replace(/[,$]/g, '')) || 0);
  }

  async fetchText(url, timeoutMs = 30000, method = 'GET', body = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const opts = {
        method,
        headers: {
          'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)',
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
        },
        signal: controller.signal
      };
      if (body) opts.body = body;
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = new UsdaResalesScraper();
