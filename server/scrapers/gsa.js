// server/scrapers/gsa.js
//
// REAL GSA Surplus Real Estate auction scraper.
// Source: https://realestatesales.gov/our-listing  (public, no auth)
// Strategy: list page → per-property detail pages at
//   /asset-details/?property_id=N, regex-parse the hidden tour_property_*
//   inputs (clean address) + the descriptive prose for beds/baths/sqft.
//
// Per docs/STRATEGY.md §2 Tier A and docs/sources-to-scrape.md #2: GSA's own
// JSON API is personal-property-only (vehicles), so we parse the real-estate
// site HTML instead. Low volume (~5 live at any time), 60s timeout needed.
//
// Rate limit: 1 req/sec between detail pages. Be polite — US government site.

const BaseScraper = require('./base');
const { extractDetailImages } = require('./media-policy');
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');
const { isPathExcludedForAdapter, validateAccessForAdapter } = require('../sources/catalog');

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

class GsaSurplusScraper extends BaseScraper {
  constructor(options = {}) {
    super({ ...options, name: 'GsaSurplusCollector', sourceKey: 'gsa' });
    this.baseUrl = 'https://realestatesales.gov';
    this.lastRunReport = null;
    this.useScrapling = options.useScrapling ?? isScraplingEnabled('gsa');
    this.extract = options.extractImpl || extractWithScrapling;
  }

  async scrapeFeed() {
    // Respect catalog-declared robots exclusions. GSA's /our-listing path is
    // publisher-controlled (robots.txt disallows it) and is intentionally not
    // part of the live ingestion surface; the scraper refuses to crawl it
    // unless the operator explicitly overrides with SCRAPER_RESPECT_ROBOTS=0.
    const excludedPath = '/our-listing';
    if (isPathExcludedForAdapter('gsa', excludedPath)) {
      const override = process.env.SCRAPER_RESPECT_ROBOTS === '0';
      if (!override) {
        const message = `Refusing to crawl ${this.baseUrl}${excludedPath}: catalog-declared robots exclusion. Set SCRAPER_RESPECT_ROBOTS=0 to override (operator-only).`;
        console.warn(`[${this.name}] ${message}`);
        this.lastRunReport = {
          outcome: 'skipped_robots_exclusion',
          scope: { endpoint: excludedPath, filters: { assetClass: 'real_estate' } },
          recordsDiscovered: 0, recordsEmitted: 0, recordsRejected: 0,
          failures: [], complete: false, fullSweepComplete: false,
          truncated: false, fixtureFallbackUsed: false,
          robotsExclusion: { path: excludedPath, source: 'catalog', overrideRequired: true }
        };
        return [];
      }
      console.warn(`[${this.name}] SCRAPER_RESPECT_ROBOTS=0 set; operator override active for catalog-declared robots exclusion (${excludedPath}).`);
    }
    return this.executeWithRetry(async () => {
      const listHtml = await this.fetchText(`${this.baseUrl}/our-listing`, 60000);

      // Property cards link to /asset-details/?property_id=N.
      const idRe = /\/asset-details\/\?property_id=(\d+)/g;
      const indexEvidence = this.useScrapling
        ? await this.extract('gsa-index', { html: listHtml, url: `${this.baseUrl}/our-listing` }) : null;
      const ids = indexEvidence ? indexEvidence.items.map(item => item.propertyId)
        : [...new Set([...listHtml.matchAll(idRe)].map(m => m[1]))];

      // The list page is the only place "Current Bid" appears as one clean
      // token. Capture id → bid where present; cards without a current bid
      // still get fetched (the detail page is the fallback for the price).
      const bidRe = /\/asset-details\/\?property_id=(\d+)[\s\S]*?property-price">[\s\S]*?\$([\d,]+)/g;
      const listBids = new Map();
      let m;
      if (indexEvidence) {
        for (const item of indexEvidence.items) if (item.currentBid !== null) listBids.set(item.propertyId, item.currentBid);
      } else while ((m = bidRe.exec(listHtml)) !== null) {
        if (!listBids.has(m[1])) listBids.set(m[1], this.parseMoney(m[2]));
      }
      console.log(`[${this.name}] Found ${ids.length} GSA properties on list page (${listBids.size} with a current bid)`);

      const listings = [];
      const failures = [];
      for (const id of ids) {
        try {
          const detail = await this.fetchDetail(id, listBids.get(id) || 0);
          if (detail) {
            listings.push(detail);
            await this.crawlJitter();
          }
        } catch (err) {
          console.warn(`[${this.name}] Failed property_id=${id}: ${err.message}`);
          failures.push({ propertyId: id, error: err.message });
        }
      }

      this.lastRunReport = { outcome: failures.length ? 'partial_failure' : listings.length ? 'success' : 'empty', scope: { endpoint: '/our-listing', filters: { assetClass: 'real_estate' } }, recordsDiscovered: ids.length, recordsEmitted: listings.length, recordsRejected: ids.length - listings.length - failures.length, failures, complete: failures.length === 0, fullSweepComplete: failures.length === 0, truncated: false, fixtureFallbackUsed: false };
      if (indexEvidence) this.lastRunReport.extraction = this.extractionEvidence(indexEvidence);
      console.log(`[${this.name}] Scraped ${listings.length} GSA properties`);
      return listings.map(item => this.standardizeListing(item));
    });
  }

  async fetchText(url, timeoutMs = 60000) {
    // Catalog-driven access gate. The catalog is the source of truth for
    // which publisher paths this scraper is allowed to fetch — see
    // server/sources/catalog.js validateAccessForAdapter. Defense in depth:
    // any future code path that bypasses the robots.txt check above is
    // caught here, and any path that isn't on accessPolicy.allowedPaths is
    // refused even when robotsExclusion is silent.
    const access = validateAccessForAdapter(this.sourceKey, url, {
      respectRobots: process.env.SCRAPER_RESPECT_ROBOTS !== '0'
    });
    if (!access.allowed) {
      const error = new Error(`GSA access policy refuses ${url}: ${access.reason}${access.matchedPolicy ? ` (matched: ${access.matchedPolicy})` : ''}`);
      error.accessPolicyViolation = true;
      error.accessDecision = access;
      throw error;
    }
    return super.fetchText(url, {
      timeoutMs,
      headers: { 'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)' }
    });
  }

  async fetchDetail(id, listBid) {
    const detailUrl = `${this.baseUrl}/asset-details/?property_id=${id}`;
    const html = await this.fetchText(detailUrl);

    // --- Clean address from hidden tour_property_* inputs ---
    const detailEvidence = this.useScrapling
      ? await this.extract('gsa-detail', { html, url: detailUrl }) : null;
    const street = detailEvidence ? detailEvidence.property.address : this.attrValue(html, 'tour_property_address');
    const city = detailEvidence ? detailEvidence.property.city : this.attrValue(html, 'tour_property_city');
    const stateName = detailEvidence ? detailEvidence.property.state : this.attrValue(html, 'tour_property_state');
    const zip = detailEvidence ? detailEvidence.property.zipcode : this.attrValue(html, 'tour_property_zipcode');

    if (!street || !/^\d/.test(street)) return null; // require a street number
    const state = STATE_NAME_TO_CODE[stateName] || (stateName && stateName.length === 2 ? stateName : 'US');
    if (state === 'US' || !zip) return null;

    // --- Case / Sale number ---
    const identifiers = this.publisherIdentifiers(html, id);
    const { caseNo, saleNo } = identifiers;

    // --- Current bid: prefer the clean token parsed from the list page; fall
    // back to the detail page where the amount is split across markup, so we
    // strip whitespace from a window after "Current Bid" before matching. ---
    let currentBid = listBid;
    if (!currentBid) {
      const win = html.slice(html.indexOf('Current Bid'), html.indexOf('Current Bid') + 400)
        .replace(/\s+/g, '');
      const bm = win.match(/\$(\d[\d,]*)/);
      currentBid = bm ? this.parseMoney(bm[1]) : null;
    }

    // --- Photo ---
    const gallery = extractDetailImages({ source: 'gsa', html, sourceUrl: detailUrl, address: street });

    // --- beds/baths/sqft from descriptive prose (guard against false positives) ---
    const desc = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const beds = this.clampInt(this.firstInt(desc, /(\d+)[-\s]?bed(?:room)?/i), 1, 15);
    const baths = this.clampInt(this.firstInt(desc, /(\d+)[-\s]?bath(?:room)?/i), 1, 15);
    const sqft = this.clampInt(this.firstInt(desc.replace(/,/g, ''), /([\d,]+)\s*sq(?:uare)?\s*(?:foot|feet|ft)/i), 300, 100000);

    const listingId = `GSA-${identifiers.recordId}`;
    const fullAddress = `${street}, ${city}, ${state} ${zip}`;

    return {
      id: listingId,
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
      year: null,
      propType: this.classifyPropertyType(desc),
      openingBid: null,
      price: currentBid || null,
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
      photo: gallery[0]?.url || null,
      sourceUrl: detailUrl,
      raw: desc.slice(0, 2000),
      provenance: {
        origin: 'live',
        observed: true,
        publisher: 'U.S. General Services Administration',
        recordId: identifiers.recordId,
        sourceFacts: {
          caseNumber: caseNo || null,
          saleNumber: saleNo || null,
          currentBid: currentBid || null,
          identityBasis: identifiers.identityBasis,
          rejectedIdentifierCandidates: identifiers.rejectedCandidates
        },
        ...(detailEvidence ? { extraction: this.extractionEvidence(detailEvidence) } : {}),
        media: { gallery, photo: gallery[0] ? { sourceRecordUrl: detailUrl, extraction: gallery[0] } : null }
      }
    };
  }

  extractionEvidence(result) {
    return { engine: result.engine, engineVersion: result.engineVersion, profile: result.profile,
      sourceUrl: result.sourceUrl, contentSha256: result.contentSha256,
      method: 'deterministic-selectors', adaptiveIdentityMatching: false };
  }

  classifyPropertyType(desc) {
    if (/commercial/i.test(desc)) return 'Commercial';
    if (/condo/i.test(desc)) return 'Condo';
    if (/multi.?family|duplex/i.test(desc)) return 'Multi-Family';
    if (/vacant land|land only|raw land|acreage/i.test(desc)) return 'Land';
    return null;
  }

  publisherIdentifiers(html, propertyId) {
    const candidate = (label) => this.firstText(html, new RegExp(`${label}\\s*:\\s*([A-Za-z0-9-]+)`, 'i'));
    const saleCandidate = candidate('Sale Number');
    const caseCandidate = candidate('Case Number');
    // Publisher identifiers observed on GSA pages are stable alphanumeric
    // tokens. Requiring at least one digit prevents adjacent prose such as
    // "Sale Number: Block ..." from becoming a durable property identity.
    const valid = value => Boolean(value && value.length <= 64 && /\d/.test(value) && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value));
    const saleNo = valid(saleCandidate) ? saleCandidate : '';
    const caseNo = valid(caseCandidate) ? caseCandidate : '';
    const recordId = String(saleNo || caseNo || propertyId);
    return {
      saleNo,
      caseNo,
      recordId,
      identityBasis: saleNo ? 'sale_number' : caseNo ? 'case_number' : 'property_id',
      rejectedCandidates: [
        ...(!saleNo && saleCandidate ? [{ field: 'saleNumber', value: saleCandidate }] : []),
        ...(!caseNo && caseCandidate ? [{ field: 'caseNumber', value: caseCandidate }] : [])
      ]
    };
  }

  // Extract the value="..." from a hidden input named `name`.
  attrValue(html, name) {
    const m = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i'));
    return m ? m[1].trim() : '';
  }

  firstText(str, re) {
    if (!str) return '';
    const m = str.match(re);
    return m ? m[1].trim() : '';
  }

  firstInt(str, re) {
    if (!str) return 0;
    const m = str.match(re);
    return m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) || 0 : 0;
  }

  clampInt(n, min, max) {
    return n >= min && n <= max ? n : 0;
  }

  parseMoney(s) {
    if (!s) return 0;
    return parseInt(s.replace(/[^\d]/g, ''), 10) || 0;
  }

}

module.exports = new GsaSurplusScraper();
module.exports.GsaSurplusScraper = GsaSurplusScraper;
