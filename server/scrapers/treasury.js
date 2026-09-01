// server/scrapers/treasury.js
//
// REAL Treasury Forfeiture scraper.
// Source: https://www.treasury.gov/auctions/treasury/rp/realprop.shtml
// Strategy: fetch the listing page, extract property slugs, then fetch each
// detail page and regex-parse the structured "Starting Bid: $X" / "Living
// Area: Y sqft" / etc. fields embedded in the body text.
//
// Per docs/STRATEGY.md (ex-blueprint) §2 Tier A: "legacy static HTML —
// trivially parseable; contractor CWS Marketing, ~13 auctions".
//
// Rate limit: 1 req/sec. Be polite — this is a US government site.

const BaseScraper = require('./base');

// Full US state / territory name → 2-letter code map.
// Used by parseAddress to handle Treasury's "City, StateName 12345" format.
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
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
  'Puerto Rico': 'PR'
};

class TreasuryForfeitureScraper extends BaseScraper {
  constructor() {
    super({ name: 'TreasuryForfeitureCollector', sourceKey: 'treasury' });
    this.baseUrl = 'https://www.treasury.gov/auctions/treasury/rp';
    this.delayMs = 1000; // 1 req/sec
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const listHtml = await this.fetchText(`${this.baseUrl}/realprop.shtml`);

      // Extract property slugs from .shtml links, excluding chrome/nav.
      const slugRegex = /href="([^"]+\.shtml)"/g;
      const excludeRegex = /include|top-nav|footer|howto|contact|press|broker|carolina/i;
      const slugs = [...new Set([...listHtml.matchAll(slugRegex)].map(m => m[1]))]
        .filter(s => !excludeRegex.test(s));

      console.log(`[${this.name}] Found ${slugs.length} property links on listing page`);

      const listings = [];
      const targetSlugs = slugs.slice(0, 8);
      const detailResults = await Promise.allSettled(targetSlugs.map(async (slug) => {
        try {
          const detail = await this.fetchDetail(slug);
          if (detail) listings.push(detail);
        } catch (err) {
          console.warn(`[${this.name}] Failed ${slug}: ${err.message}`);
        }
      }));

      console.log(`[${this.name}] Scraped ${listings.length} Treasury properties`);
      return listings.map(item => this.standardizeListing(item));
    });
  }

  async fetchText(url, timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)'
        },
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchDetail(slug) {
    const detailUrl = `${this.baseUrl}/${slug}`;
    const detailHtml = await this.fetchText(detailUrl);

    // Title is the full address: "4705 Battle Creek Road SE, Salem, Oregon 97302"
    const titleMatch = detailHtml.match(/<title>([^<]+)<\/title>/);
    if (!titleMatch) return null;
    const fullAddress = titleMatch[1].trim();
    if (!/^\d/.test(fullAddress)) return null; // skip non-property titles

    // Body text — strip HTML and collapse whitespace
    const body = detailHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&plusmn;/g, '±')
      .replace(/&rsquo;/g, "'")
      .replace(/&ldquo;/g, '"')
      .replace(/&rdquo;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();

    const get = (pattern) => {
      const m = body.match(pattern);
      return m ? m[1].trim() : null;
    };

    const openingBid = this.parseMoney(get(/Starting Bid:\s*\$([\d,]+)/));
    const sqft = this.parseInt0(get(/Living Area:\s*([\d,]+)/));
    const year = this.parseInt0(get(/Year Built:\s*(\d{4})/));
    const acres = parseFloat(get(/Site Area:\s*([\d.]+)/) || '0') || 0;
    const landSqft = acres > 0 ? Math.round(acres * 43560) : 0;
    const deposit = get(/Deposit:\s*([^.]+?)(?:\.|Inspection|$)/);
    const saleDateRaw = get(/Auction Date and Time:\s*([^I]+?)(?=Inspection|$)/);
    const parcelNo = get(/Parcel No:\s*(\S+)/);
    const saleNumber = get(/Sale Number:\s*([\w-]+)/);

    const beds = this.parseInt0(get(/(\d+)\s*bedrooms?/i));
    const baths = this.parseInt0(get(/(\d+)\s*baths?/i));

    const addrParts = this.parseAddress(fullAddress);
    const baseName = slug.replace('.shtml', '');
    const saleDate = this.parseSaleDate(saleDateRaw);

    return {
      id: saleNumber ? `TRSY-${saleNumber}` : `TRSY-${baseName.toUpperCase()}`,
      state: addrParts.state,
      county: addrParts.county || 'Unknown',
      city: addrParts.city,
      zip: addrParts.zip,
      address: fullAddress,
      lat: 0, // populated by geocoder (Phase 3)
      lng: 0,
      beds,
      baths,
      sqft: sqft || landSqft || 0,
      year: year || null,
      propType: this.classifyPropertyType(body),
      openingBid: openingBid || 0,
      estLow: 0, // populated by enrichment (Phase 3)
      estHigh: 0,
      assessed: 0,
      saleDate,
      plaintiff: 'U.S. Department of the Treasury',
      defendant: '—',
      judgment: 0,
      attorney: 'CWS Marketing Group, Inc',
      occupancy: 'Unknown',
      deposit: deposit || 'See listing',
      photo: `${this.baseUrl}/images/${baseName}01.gif`,
      sourceUrl: detailUrl,
      raw: body.substring(0, 800)
    };
  }

  parseAddress(address) {
    // "4705 Battle Creek Road SE, Salem, Oregon 97302"
    // or  "112 North Avenue E, Bruni, Texas 78344"
    // or  "915 E Stewart Ave, Las Vegas, NV 89101"
    const parts = address.split(',').map(s => s.trim());
    if (parts.length < 3) return { state: 'US', zip: '00000', city: '', county: '' };
    const last = parts[parts.length - 1];

    // Try state code (e.g. "NV 89101")
    let m = last.match(/^([A-Z]{2})\s+(\d{5})$/);
    if (m) {
      return { state: m[1], zip: m[2], city: parts[parts.length - 2], county: '' };
    }
    // Try full state name (e.g. "Oregon 97302")
    m = last.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(\d{5})$/);
    if (m) {
      const code = STATE_NAME_TO_CODE[m[1]];
      if (code) {
        return { state: code, zip: m[2], city: parts[parts.length - 2], county: '' };
      }
    }
    return { state: 'US', zip: '00000', city: parts[parts.length - 2] || '', county: '' };
  }

  parseSaleDate(raw) {
    if (!raw) return null;
    const months = {
      January: '01', February: '02', March: '03', April: '04',
      May: '05', June: '06', July: '07', August: '08',
      September: '09', October: '10', November: '11', December: '12'
    };
    const m = raw.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/);
    if (!m || !months[m[1]]) return null;
    return `${m[3]}-${months[m[1]]}-${m[2].padStart(2, '0')}`;
  }

  classifyPropertyType(body) {
    if (/SINGLE FAMILY HOME/i.test(body)) return 'Single Family';
    if (/CONDO/i.test(body)) return 'Condo';
    if (/MULTI.?FAMILY|MULTIPLEX/i.test(body)) return 'Multi-Family';
    if (/COMMERCIAL/i.test(body)) return 'Commercial';
    if (/LAND|VACANT/i.test(body)) return 'Land';
    return 'Single Family';
  }

  parseMoney(s) {
    if (!s) return 0;
    return parseInt(s.replace(/[^\d]/g, ''), 10) || 0;
  }

  parseInt0(s) {
    if (!s) return 0;
    return parseInt(s.replace(/[^\d]/g, ''), 10) || 0;
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = new TreasuryForfeitureScraper();
