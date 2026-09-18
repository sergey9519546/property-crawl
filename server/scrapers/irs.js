// server/scrapers/irs.js
//
// REAL IRS Seized Property auction scraper.
// Source: https://www.irsauctions.gov/auction/items  (public, no auth)
// Strategy: list page → per-auction detail pages at /ad/<slug>, regex-parse the
//   structured "Asset Address" <address> block + "Asset Description" prose.
//
// Per docs/STRATEGY.md §2 Tier A and docs/sources-to-scrape.md #1: public
// government site, low volume (~5-10 active listings), front page live.
// Personal-property auctions (boats, watches, safes) are filtered out by
// requiring a street-number Asset Address.
//
// Detail fetches are capped at two in flight and receive 250–750ms jitter.

const BaseScraper = require('./base');
const { mapWithConcurrency } = require('./http');
const { extractDetailImages } = require('./media-policy');
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');

// Title substrings that mark an IRS auction as personal property, not real
// estate (these auctions are hosted at a venue address, so a street-number
// check can't exclude them). Matched case-insensitively against the title.
const PERSONAL_PROPERTY_KEYWORDS = [
  'personal property', 'watch', 'purse', 'jewelry', 'jewellery', 'jet ski',
  'kawasaki', 'boat', 'safe', 'vehicle', 'motorcycle', 'trailer', 'equipment',
  'firearm', 'coin', 'instrument', 'furniture', 'artwork', 'painting'
];

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

class IrsSeizedScraper extends BaseScraper {
  constructor(options = {}) {
    super({ ...options, name: 'IrsAuctionCollector', sourceKey: 'irs' });
    this.baseUrl = 'https://www.irsauctions.gov';
    this.detailConcurrency = Math.min(4, Math.max(1, Math.floor(Number(options.detailConcurrency) || 2)));
    this.lastRunReport = null;
    this.useScrapling = options.useScrapling ?? isScraplingEnabled('irs');
    this.extract = options.extractImpl || extractWithScrapling;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {

      const listHtml = await this.fetchText(`${this.baseUrl}/auction/items`);

      // Each auction card links to /ad/<slug> with the auction title. IRS mixes
      // real-estate and personal-property (boats, watches, safes) auctions on
      // one page; the personal-property ones are hosted at a venue address, so
      // a street-number check alone can't tell them apart. Filter by title here
      // so we never fetch personal-property detail pages.
      const cardRe = /href="\/ad\/([a-z0-9-]+)"\s+rel="bookmark">\s*<span class="treas-page-title">([^<]+)<\/span>/g;
      const seen = new Set();
      const cards = [];
      const excluded = [];
      let cm;
      while ((cm = cardRe.exec(listHtml)) !== null) {
        if (seen.has(cm[1])) continue;
        seen.add(cm[1]);
        const title = this.decodeEntities(cm[2]).trim();
        const excludedKeyword = PERSONAL_PROPERTY_KEYWORDS.find(kw => title.toLowerCase().includes(kw));
        if (excludedKeyword) {
          excluded.push({ slug: cm[1], reason: 'explicit_personal_property_title', keyword: excludedKeyword });
          continue;
        }
        cards.push({ slug: cm[1], title });
      }
      console.log(`[${this.name}] Found ${cards.length} real-estate auction cards on list page`);

      const detailResults = await mapWithConcurrency(
        cards,
        this.detailConcurrency,
        async ({ slug, title }) => {
          await this.crawlJitter();
          return this.fetchDetail(slug, title);
        }
      );
      const listings = [];
      const failures = [];
      detailResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          if (result.value) listings.push(result.value);
        } else {
          console.warn(`[${this.name}] Failed /ad/${cards[index].slug}: ${result.reason.message}`);
          failures.push({ slug: cards[index].slug, error: result.reason.message });
        }
      });

      const recordsRejected = cards.length - listings.length - failures.length;
      const complete = failures.length === 0 && recordsRejected === 0;
      this.lastRunReport = { outcome: complete ? (listings.length ? 'success' : 'empty') : 'partial_failure', scope: { endpoint: '/auction/items', filters: { assetClass: 'real_estate' } }, recordsDiscovered: cards.length, recordsEmitted: listings.length, recordsRejected, recordsExcluded: excluded.length, exclusions: excluded, failures, complete, fullSweepComplete: complete, truncated: false, fixtureFallbackUsed: false };
      console.log(`[${this.name}] Scraped ${listings.length} IRS properties`);
      return listings.map(item => this.standardizeListing(item));
    });
  }

  async fetchText(url, timeoutMs = this.timeoutMs) {
    return super.fetchText(url, {
      timeoutMs,
      headers: { 'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)' }
    });
  }

  async fetchDetail(slug, publisherTitle = '') {
    const detailUrl = `${this.baseUrl}/ad/${slug}`;
    const html = await this.fetchText(detailUrl);

    // When Scrapling is enabled, ask the venv for the structured property
    // record before the regex scan runs. We still run the regex scan below
    // so the per-field fallback path is unchanged when Scrapling returns
    // null for a given field (a partial extract is OK).
    let scraplingRecord = null;
    if (this.useScrapling) {
      try {
        const evidence = await this.extract('irs-detail', { html, url: detailUrl });
        const p = evidence && evidence.property ? evidence.property : null;
        if (p && (p.address || p.state || p.minimumBid != null || p.saleDate || p.beds != null || p.baths != null)) {
          scraplingRecord = p;
        }
      } catch (_) {
        scraplingRecord = null;
      }
    }

    // Only the exact publisher title and property-description field may qualify
    // an unnumbered land address. Whole-page text can contain unrelated cards,
    // navigation, or footer content.
    const descMatch = html.match(/Asset Description<\/div>\s*<div class="field__item">([\s\S]*?)<\/div>/);
    const desc = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
      : '';

    // --- Asset Address block: <address ...> STREET <br> City, ZIP ST <br> Country </address> ---
    const addrBlockMatch = html.match(/<address[^>]*>([\s\S]*?)<\/address>/);
    if (!addrBlockMatch) return null; // personal-property auctions have no <address>

    const addrLines = addrBlockMatch[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    const positiveLandEvidence = /\b(?:agricultural\s+land|vacant\s+land|vacant\s+lot|land\s+(?:is\s+)?for\s+sale|\d+(?:\.\d+)?\s+acres?)\b/i.test(`${publisherTitle} ${desc}`);
    if (addrLines.length < 2) return null;
    const parcelPrefixedLand = positiveLandEvidence && /^parcel\s+id\b/i.test(addrLines[0]) && addrLines.length >= 3;
    // Prefer the Scrapling-resolved street when the venv returned one;
    // fall back to the regex split when it didn't.
    const street = (scraplingRecord && scraplingRecord.address)
      ? scraplingRecord.address
      : (parcelPrefixedLand ? addrLines[1] : addrLines[0]);
    if (!/^\d/.test(street) && !positiveLandEvidence) return null;

    // Second line: "Drexel Hill, 19026 PA"
    const cityLine = parcelPrefixedLand ? addrLines[2] : addrLines[1];
    const cityMatch = cityLine.match(/^(.+?),\s*(\d{5})\s+([A-Z]{2})$/);
    if (!cityMatch) return null;

    const city = (scraplingRecord && scraplingRecord.city) ? scraplingRecord.city : cityMatch[1].trim();
    const zip = (scraplingRecord && scraplingRecord.zip) ? scraplingRecord.zip : cityMatch[2];
    const state = (scraplingRecord && scraplingRecord.state) ? scraplingRecord.state : cityMatch[3];

    // --- Asset Description prose: "...built in 1942...3 bedrooms, 2 bathrooms, ~1,152 sq ft." ---
    const beds = (scraplingRecord && Number.isInteger(scraplingRecord.beds))
      ? scraplingRecord.beds
      : this.firstInt(desc, /(\d+)\s*bedrooms?/i);
    const baths = (scraplingRecord && Number.isInteger(scraplingRecord.baths))
      ? scraplingRecord.baths
      : this.firstInt(desc, /(\d+)\s*bathrooms?/i);
    const sqft = (scraplingRecord && Number.isInteger(scraplingRecord.sqft))
      ? scraplingRecord.sqft
      : this.firstInt(desc.replace(/,/g, ''), /([\d,]+)\s*sq\s*ft/i);
    const year = (scraplingRecord && Number.isInteger(scraplingRecord.yearBuilt))
      ? scraplingRecord.yearBuilt
      : (this.firstInt(desc, /built in (\d{4})/i) || null);

    // --- Minimum bid: <div content="110665.00" class="field__item">110,665.00</div> ---
    const bidMatch = html.match(/content="([\d,]+\.\d+)"\s+class="field__item"/);
    const openingBid = (scraplingRecord && Number.isFinite(scraplingRecord.minimumBid))
      ? scraplingRecord.minimumBid
      : (bidMatch ? this.parseMoney(bidMatch[1]) : null);

    // --- Date of Auction: first <time datetime="2026-09-08T17:30:00Z"> ---
    const timeMatch = html.match(/<time datetime="([^"]+)"/);
    const saleDate = (scraplingRecord && scraplingRecord.saleDate)
      ? scraplingRecord.saleDate.slice(0, 10)
      : (timeMatch ? timeMatch[1].slice(0, 10) : null);

    // --- Defendant / taxpayer: "...seized ... due from Albert W Sperry." ---
    const defMatch = html.match(/due from ([^.]+?)\./i);
    const defendant = defMatch ? defMatch[1].trim() : null;

    const id = `IRS-${state}-${slug.toUpperCase().slice(0, 18)}`;
    const fullAddress = `${street}, ${city}, ${state} ${zip}`;
    const gallery = extractDetailImages({ source: 'irs', html, sourceUrl: detailUrl, address: fullAddress });

    return {
      id,
      state,
      county: null,
      city,
      zip,
      address: fullAddress,
      lat: null,
      lng: null,
      beds: beds || null,
      baths: baths || null,
      sqft: sqft || null,
      year,
      propType: this.classifyPropertyType(`${publisherTitle} ${desc}`),
      openingBid,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate,
      plaintiff: null,
      defendant,
      judgment: null,
      attorney: null,
      occupancy: null,
      deposit: null,
      photo: gallery[0]?.url || null,
      sourceUrl: detailUrl,
      raw: (desc || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 2000),
      provenance: {
        origin: 'live', observed: true, publisher: 'Internal Revenue Service', recordId: slug,
        sourceFacts: { publisherTitle: publisherTitle || null, addressQualification: /^\d/.test(street) ? 'numbered_street' : 'positive_land_evidence', publisherParcelLabel: parcelPrefixedLand ? addrLines[0] : null },
        media: gallery.length ? {
          photo: { sourceRecordUrl: detailUrl, extraction: { selector: gallery[0].selector, association: 'exact_detail_page' } },
          gallery
        } : {}
      }
    };
  }

  classifyPropertyType(desc) {
    if (/commercial/i.test(desc)) return 'Commercial';
    if (/condo/i.test(desc)) return 'Condo';
    if (/multi.?family|duplex|triplex/i.test(desc)) return 'Multi-Family';
    if (/single.?family|\bhome\b|\bhouse\b|residential/i.test(desc)) return 'Single Family';
    if (/land|vacant|lot|acre/i.test(desc)) return 'Land';
    return null;
  }

  firstInt(str, re) {
    if (!str) return 0;
    const m = str.match(re);
    return m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) || 0 : 0;
  }

  parseMoney(s) {
    if (!s) return 0;
    // Values carry cents, e.g. "110665.00" — strip currency/commas but keep the
    // decimal so we don't fold ".00" into the integer (×100 bug).
    return Math.round(parseFloat(s.replace(/[,$]/g, '')) || 0);
  }

  decodeEntities(s) {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&#0?39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&ndash;/g, '-')
      .replace(/&mdash;/g, '-')
      .replace(/&hellip;/g, '\u2026')
  }

  // Demo/Unsplash inventory overrides removed (2026-09-14 audit).
  // Live collectors must not fabricate listings; BaseScraper may still read
  // data/listings.snapshot.json as explicitly labeled fixture evidence.

}

module.exports = new IrsSeizedScraper();
module.exports.IrsSeizedScraper = IrsSeizedScraper;
