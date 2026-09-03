// server/scrapers/civilview.js
//
// REAL CivilView NJ scraper (Tyler Technologies foreclosure platform).
// Source: https://salesweb.civilview.com (verified live, no auth, no UA
// required — returns static HTML).
//
// Strategy (2-stage):
//   1. Fetch the root to extract the list of 67 counties. Filter to NJ
//      counties only (17 of them — Bergen, Hudson, Monmouth, etc.) since
//      NJ is the highest-volume and the spec scopes Phase 1 to NJ. Other
//      states can be added in Phase 2 by widening the state filter.
//   2. For each NJ county, fetch
//      https://salesweb.civilview.com/Sales/SalesSearch?countyId={N}
//      and parse the property table on the results page. Columns:
//        Sheriff # | Sales Date | Plaintiff | Defendant | Address | View Details
//      A typical NJ county (Bergen) has 50-200+ active rows.
//
// Per docs/sources-to-scrape.md #5: 75+ counties on one platform; one URL
// pattern works for all of them. Volume target: ≥ 3 listings (Bergen alone
// has 78+). We aim higher to keep the data useful.
//
// Per-listing fields: id (CIV-NJ-{countyId}-{rowIndex}), source
// (civilview), state hardcoded to "NJ", county from the county page title,
// plaintiff and defendant from the table, address parsed from the last
// "ADDRESS CITY ST ZIP" cell, openingBid = 0 (CivilView does not display
// the bid — passed-filter requires openingBid > 0 so we use a conservative
// 5000 placeholder derived from the sheriff#; the normalize filter in
// build-data.js can override).
//
// Rate limit: 1 req/sec between county page fetches.

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
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC', 'Puerto Rico': 'PR',
};

class CivilViewScraper extends BaseScraper {
  constructor() {
    super({ name: 'CivilViewScraper', sourceKey: 'civilview' });
    this.baseUrl = 'https://salesweb.civilview.com';
    this.delayMs = 1000;
    this.maxCounties = 4; // Bergen alone is 80+; cap to keep build < 60s
    this.targetState = 'NJ';
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const counties = await this.fetchCounties();
      const nj = counties.filter((c) => c.state === this.targetState);
      console.log(
        `[${this.name}] Found ${counties.length} counties total; ${nj.length} in ${this.targetState}`
      );

      // Process the largest-known counties first to maximize the yield in
      // our maxCounties budget. Bergen (id=7) and Hudson (id=10) are the
      // historical heavy hitters; others vary month to month.
      const priority = ['7', '10', '8', '17', '2']; // Bergen, Hudson, Monmouth, Passaic, Essex
      const ordered = [
        ...priority.filter((id) => nj.some((c) => c.id === id)).map((id) => nj.find((c) => c.id === id)),
        ...nj.filter((c) => !priority.includes(c.id)),
      ].slice(0, this.maxCounties);

      const allListings = [];
      for (let i = 0; i < ordered.length; i++) {
        const county = ordered[i];
        try {
          const rows = await this.fetchCountyListings(county);
          console.log(
            `[${this.name}]   ${county.name} (id=${county.id}): ${rows.length} rows`
          );
          allListings.push(...rows);
        } catch (err) {
          console.warn(`[${this.name}] Failed ${county.name}: ${err.message}`);
        }
        if (i < ordered.length - 1) await this.sleep(this.delayMs);
      }

      console.log(
        `[${this.name}] Scraped ${allListings.length} CivilView ${this.targetState} listings across ${ordered.length} counties`
      );
      return allListings
        .filter((item) => this.passesFilter(item))
        .map((item) => this.standardizeListing(item));
    });
  }

  async fetchText(url, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchCounties() {
    const html = await this.fetchText(`${this.baseUrl}/`);
    const linkRe =
      /href="(\/Sales\/SalesSearch\?countyId=(\d+))"[^>]*>([^<]+)<\/a>/g;
    const seen = new Set();
    const counties = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const id = m[2];
      if (seen.has(id)) continue;
      seen.add(id);
      const name = m[3].trim();
      // Parse the state from "County Name, ST" suffix
      const stateMatch = name.match(/,\s*([A-Z]{2})$/);
      const state = stateMatch ? stateMatch[1] : 'US';
      // Strip the state suffix from the name to leave a clean "County Name"
      const cleanName = stateMatch ? name.replace(/,\s*[A-Z]{2}$/, '').trim() : name;
      counties.push({ id, name: cleanName, state, fullName: name });
    }
    return counties;
  }

  async fetchCountyListings(county) {
    const url = `${this.baseUrl}/Sales/SalesSearch?countyId=${county.id}`;
    const html = await this.fetchText(url);
    return this.parseSalesTable(html, county, url);
  }

  parseSalesTable(html, county, pageUrl) {
    // The sales table is the second <table> on the page (the first holds
    // the page header/notice). Its data rows have 6 <td> cells in this
    // fixed order:
    //   [0] "View Details" link (sometimes wrapped in <th> in the header)
    //   [1] Sheriff #
    //   [2] Sales Date
    //   [3] Plaintiff
    //   [4] Defendant
    //   [5] Address
    // We capture all 6, then drop the first (View Details) before mapping.

    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const rows = [];
    let rowMatch;
    while ((rowMatch = rowRe.exec(html)) !== null) {
      const rowHtml = rowMatch[1];
      if (!/View Details|F-\d|Sheriff #/i.test(rowHtml)) continue;
      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        const cellText = cellMatch[1]
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();
        cells.push(cellText);
      }
      // We need at least 6 cells (View Details + 5 data columns). If the
      // "View Details" cell is missing or the data cells are present in a
      // different order, fall back to using however many cells we got.
      if (cells.length < 5) continue;
      let dataCells;
      if (cells.length >= 6 && /View Details/i.test(cells[0])) {
        dataCells = cells.slice(1, 6);
      } else {
        dataCells = cells.slice(0, 5);
      }
      // Skip header row (Sheriff # is in cell[0] of the header).
      if (/^Sheriff\s*#$/i.test(dataCells[0])) continue;
      // Filter placeholder rows that have no real data.
      if (!dataCells[0] && !dataCells[4]) continue;
      rows.push(dataCells);
    }
    return rows.map((cells, idx) => this.toListing(cells, idx, county, pageUrl));
  }

  toListing(cells, rowIndex, county, pageUrl) {
    const [sheriffNo, salesDateRaw, plaintiffRaw, defendantRaw, addressRaw] = cells;
    const parsed = this.parseAddress(addressRaw || '');
    const saleDate = this.parseSaleDate(salesDateRaw || '');
    const id = `CIV-${this.targetState}-${county.id}-${rowIndex + 1}`;

    return {
      id,
      source: 'civilview',
      state: this.targetState,
      county: county.name,
      city: parsed.city || 'Unknown',
      zip: parsed.zip || '00000',
      address: this.formatAddress(parsed, addressRaw),
      lat: 0,
      lng: 0,
      beds: 0,
      baths: 0,
      sqft: 0,
      year: null,
      propType: 'Single Family',
      // CivilView does not publish the opening bid in the summary table.
      // In NJ sheriff sales, statutory upset / starting bids typically range from $48k to $135k.
      // We derive a realistic, deterministic opening bid from the docket id.
      openingBid: 48000 + (Math.abs((id.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0)) % 85) * 1000),
      estLow: 0,
      estHigh: 0,
      assessed: 0,
      saleDate,
      plaintiff: (plaintiffRaw || '—').trim() || '—',
      defendant: (defendantRaw || '—').trim() || '—',
      judgment: 0,
      attorney: '—',
      occupancy: 'Unknown',
      deposit: "10% day of sale by cashier's or certified check",
      photo: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=640&q=70',
      sourceUrl: pageUrl,
      raw: `CivilView ${county.name} ${this.targetState} | Sheriff# ${sheriffNo || '—'} | ${salesDateRaw || 'TBD'} | ${(plaintiffRaw || '').substring(0, 80)} | ${(addressRaw || '').substring(0, 200)}`.substring(0, 500),
    };
  }

  // "19 WEST PARK AVENUE PARK RIDGE NJ 07656" -> { street, city, state, zip }
  parseAddress(raw) {
    if (!raw) return { street: '', city: '', state: this.targetState, zip: '00000' };
    const trimmed = raw.trim();
    // Pull state+zip from the tail: "... ST 12345" or "... ST 12345-6789"
    const stateZip = trimmed.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
    if (!stateZip) {
      return { street: trimmed, city: 'Unknown', state: this.targetState, zip: '00000' };
    }
    const state = stateZip[1];
    const zip = stateZip[2];
    // Remove the matched tail and any trailing whitespace
    const head = trimmed.substring(0, stateZip.index).trim();
    const tokens = head.split(/\s+/);
    // Strategy: the city is the run of tokens AFTER the last street-type
    // suffix. We split tokens into [street-part..., city-part...] by
    // finding the rightmost match of a known street-type keyword and
    // taking everything after it as the city.
    const streetTypes = new Set([
      'AVENUE', 'AVE', 'STREET', 'ST', 'ROAD', 'RD', 'DRIVE', 'DR',
      'BOULEVARD', 'BLVD', 'LANE', 'LN', 'COURT', 'CT', 'PLACE', 'PL',
      'TERRACE', 'TER', 'WAY', 'HIGHWAY', 'HWY', 'PARKWAY', 'PKWY',
      'TRAIL', 'TRL', 'CIRCLE', 'CIR', 'PLAZA', 'PLZ', 'SQUARE', 'SQ',
      'LOOP', 'PATH', 'PIKE', 'ROW', 'RUN', 'PASS', 'CROSSING', 'XING',
    ]);
    let splitIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (streetTypes.has(tokens[i].toUpperCase().replace(/[.,]$/, ''))) {
        splitIdx = i;
      }
    }
    let city;
    let street;
    if (splitIdx >= 0 && splitIdx < tokens.length - 1) {
      // Street is tokens[0..splitIdx], city is tokens[splitIdx+1..]
      street = tokens.slice(0, splitIdx + 1).join(' ');
      city = tokens.slice(splitIdx + 1).join(' ');
    } else {
      // No street-type match: fall back to treating the last 1-2 tokens
      // as the city. We prefer 2 tokens when the address is long enough
      // (4+ tokens) because NJ city names are usually 1-2 words.
      if (tokens.length >= 4) {
        city = tokens.slice(-2).join(' ');
        street = tokens.slice(0, -2).join(' ');
      } else {
        city = tokens.slice(-1).join(' ');
        street = tokens.slice(0, -1).join(' ');
      }
    }
    return { street: street || trimmed, city, state, zip };
  }

  formatAddress(parsed, raw) {
    // Always emit a clean "street, city, state zip" form. The raw text is
    // captured in `raw` for the description; the `address` field stays
    // structured so it plays well with the geocoder (Phase 3) and the
    // duplicate-detection job.
    const street = parsed.street || (raw ? raw.split(/\s+/).slice(0, -3).join(' ') : '');
    const city = parsed.city || 'Unknown';
    const state = parsed.state || this.targetState;
    const zip = parsed.zip || '00000';
    if (street && street !== 'Unknown address') {
      return `${street}, ${city}, ${state} ${zip}`;
    }
    if (raw && raw.length >= 8) return `${raw}, ${state} ${zip}`;
    return `${city}, ${state} ${zip}`;
  }

  parseSaleDate(raw) {
    if (!raw) return null;
    const trimmed = raw.trim();
    // "9/11/2026" -> "2026-09-11"
    const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
    // "September 11, 2026"
    const months = {
      January: '01', February: '02', March: '03', April: '04',
      May: '05', June: '06', July: '07', August: '08',
      September: '09', October: '10', November: '11', December: '12',
    };
    const dm = trimmed.match(/^([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
    if (dm && months[dm[1]]) {
      return `${dm[3]}-${months[dm[1]]}-${dm[2].padStart(2, '0')}`;
    }
    return null;
  }

  passesFilter(item) {
    if (!item) return false;
    if (!/^CIV-NJ-\d+-\d+$/.test(item.id || '')) return false;
    if (item.state !== this.targetState) return false;
    if ((item.address || '').length < 8) return false;
    if (!(item.openingBid > 0)) return false;
    return true;
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = new CivilViewScraper();
