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
const { inspectImageUrl } = require('./media-policy');

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
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      // 1. Load the SFH search page to discover which states have inventory.
      const formHtml = await this.fetchText(`${this.baseUrl}/resales/public/searchSFH`);
      const states = this.parseStateOptions(formHtml);
      console.log(`[${this.name}] ${states.length} states with SFH inventory: ${states.map(s => s.code).join(', ')}`);

      // 2. POST a search for each state → parse the summary table.
      const listings = [];
      const completedStates = [];
      const failures = [];
      for (const { code } of states) {
        try {
          const rows = await this.searchState(code);
          for (const row of rows) {
            const listing = this.rowToListing(row);
            if (listing) listings.push(listing);
          }
          completedStates.push(code);
          await this.crawlJitter();
        } catch (err) {
          console.warn(`[${this.name}] Failed state ${code}: ${err.message}`);
          failures.push({ state: code, error: err.message });
        }
      }

      this.lastRunReport = { outcome: failures.length ? 'partial_failure' : listings.length ? 'success' : 'empty', scope: { endpoint: '/resales/public/searchSFH', inventoryStates: states.map(({ code }) => code) }, statesDiscovered: states.length, statesCompleted: completedStates, recordsEmitted: listings.length, failures, complete: failures.length === 0, fullSweepComplete: failures.length === 0, truncated: false, fixtureFallbackUsed: false };
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

    const state = STATE_NAME_TO_CODE[stateName] || null;
    if (!state || !/^\d/.test(address)) return null;

    const detailHref = detailMatch ? detailMatch[1].replace(/&amp;/g, '&') : null;
    const detailId = detailHref ? (detailHref.match(/[?&]id=(\d+)/) || [])[1] : null;
    const sourceUrl = detailHref ? new URL(detailHref, this.baseUrl).toString() : null;
    const photoCandidate = photoMatch
      ? new URL(photoMatch[1].replace(/&amp;/g, '&'), this.baseUrl).toString()
      : null;
    // USDA's summary row is bound to the exact SFH detail record. Still reject
    // its explicit No_Image/site-art placeholders before they reach media
    // provenance or a gallery UI.
    const inspectedPhoto = inspectImageUrl(photoCandidate);
    const photo = inspectedPhoto.accepted ? inspectedPhoto.url : null;
    if (!detailId || !sourceUrl) return null;

    return {
      id: `USDA-${state}-${detailId}`,
      state,
      county,
      city,
      zip,
      address: `${address}, ${city}, ${state} ${zip}`,
      lat: null,
      lng: null,
      beds: beds || null,
      baths: baths || null,
      sqft: sqft || null,
      year: null,
      propType: 'Single Family',
      openingBid,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate: null,
      plaintiff: null,
      defendant: null,
      judgment: null,
      attorney: null,
      occupancy: null,
      deposit: null,
      photo,
      sourceUrl,
      raw: cells.map((cell) => this.text(cell)).join(' | ').slice(0, 2000),
      provenance: {
        origin: 'live',
        observed: true,
        publisher: 'USDA Rural Development',
        recordId: detailId,
        sourceFacts: { listingType: listingType || null },
        media: photo ? {
          photo: {
            sourceRecordUrl: sourceUrl,
            extraction: { selector: '#propertySummariesTable td:first-child img', association: 'exact_detail_record' }
          },
          gallery: [{
            url: photo,
            sourceRecordUrl: sourceUrl,
            selector: '#propertySummariesTable td:first-child img',
            association: 'exact_detail_record'
          }]
        } : undefined
      }
    };
  }

  text(cellHtml) {
    return cellHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }

  firstInt(cellHtml) {
    const m = this.text(cellHtml).match(/(\d[\d,]*)/);
    return m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) || null : null;
  }

  parseMoney(s) {
    if (!s) return null;
    const parsed = parseFloat(s.replace(/[,$]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  }

  async fetchText(url, timeoutMs = 30000, method = 'GET', body = null) {
    return super.fetchText(url, {
      timeoutMs,
      method,
      body,
      headers: {
        'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
      }
    });
  }

}

module.exports = new UsdaResalesScraper();
module.exports.UsdaResalesScraper = UsdaResalesScraper;
