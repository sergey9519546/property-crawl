// server/scrapers/landbanksearch.js
//
// REAL LandBankSearch meta-aggregator scraper.
// Source: https://www.landbanksearch.com/data
//
// LandBankSearch is a meta-aggregator that re-ingests 70+ US land bank
// feeds nightly. It is the single largest source of distressed/government-sold
// property in the US (80,184+ active listings as of Aug 2026).
//
// Strategy (2-stage):
//   1. Fetch /data and parse the table of 70+ land banks + per-feed counts.
//      Sort by count desc, rotate through the list using a cursor so all
//      municipal feeds are swept across scheduled runs.
//   2. For each selected land bank, fetch /land-banks/{slug} and extract the
//      current listings grid (~12 cards per page). Each card has address,
//      city/state, price, photo, propType, APN, and lot size when published.

const BaseScraper = require('./base');
const {
  createRunReport,
  recordUnitFailure,
  recordUnitSuccess,
  finalizeRunReport,
} = require('./run-report');

function rotateLandBanks(banks, startIndex, limit) {
  if (!Array.isArray(banks) || banks.length === 0) return [];
  const size = Math.max(0, Math.floor(Number(limit) || 0));
  if (size === 0) return [];
  if (size >= banks.length) return [...banks];
  const length = banks.length;
  const start = ((Math.floor(Number(startIndex) || 0) % length) + length) % length;
  const window = [];
  for (let index = 0; index < size; index += 1) {
    window.push(banks[(start + index) % length]);
  }
  return window;
}

class LandBankSearchScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'LandBankSearchScraper', sourceKey: 'landbank', ...options });
    this.baseUrl = 'https://www.landbanksearch.com';
    this.maxLandBanks = Number(options.maxLandBanks ?? process.env.LANDBANK_MAX_BANKS) || 5;
    this.rotationOffset = Number(options.rotationOffset ?? process.env.LANDBANK_ROTATION_OFFSET) || 0;
    this.maxListingsPerBank = Number(options.maxListingsPerBank) || 100;
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const report = createRunReport('landbank', {
        endpoint: '/data',
        maxLandBanks: this.maxLandBanks,
        rotationOffset: this.rotationOffset,
      });
      this.lastRunReport = report;

      const banks = await this.fetchLandBanks();
      console.log(`[${this.name}] Discovered ${banks.length} land banks on /data`);
      report.endpointsTried = 1;

      const activeBanks = banks.filter((b) => b.count > 0);
      const selected = rotateLandBanks(activeBanks, this.rotationOffset, this.maxLandBanks);

      console.log(
        `[${this.name}] Sweeping ${selected.length} of ${activeBanks.length} active land banks (offset ${this.rotationOffset}): ${selected
          .map((b) => `${b.name}(${b.state},${b.count})`)
          .join(', ')}`
      );

      const allListings = [];
      for (const bank of selected) {
        try {
          const listings = await this.fetchBankListings(bank);
          console.log(
            `[${this.name}]   ${bank.name}(${bank.state}): ${listings.length} cards`
          );
          allListings.push(...listings);
          recordUnitSuccess(report, bank.slug, listings.length);
        } catch (err) {
          recordUnitFailure(report, bank.slug, err);
          console.warn(
            `[${this.name}] Failed ${bank.slug} (${bank.state}): ${err.message}`
          );
        }
        await this.crawlJitter();
      }

      console.log(
        `[${this.name}] Scraped ${allListings.length} LandBankSearch listings across ${selected.length} land banks`
      );

      const standardized = allListings
        .filter((item) => this.passesFilter(item))
        .map((item) => this.standardizeListing(item));

      finalizeRunReport(report, { emitted: standardized.length });
      report.outcome = standardized.length ? 'success' : 'empty';
      report.complete = report.failures.length === 0;

      return standardized;
    });
  }

  async fetchText(url, timeoutMs = 30000) {
    return super.fetchText(url, {
      timeoutMs,
      headers: {
        'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
  }

  async fetchLandBanks() {
    const html = await this.fetchText(`${this.baseUrl}/data`);

    const rowRegex =
      /href="\/land-banks\/([a-z0-9-]+)"[^>]*>([^<]+)<\/a>\s*<span[^>]*>([A-Z]{2})<\/span>[\s\S]*?<td[^>]*>(\d[\d,]*)<\/td>/g;

    const banks = [];
    let m;
    const seen = new Set();
    while ((m = rowRegex.exec(html)) !== null) {
      const slug = m[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      banks.push({
        slug,
        name: m[2].trim(),
        state: m[3],
        count: parseInt(m[4].replace(/,/g, ''), 10) || 0,
      });
    }
    return banks;
  }

  async fetchBankListings(bank) {
    const html = await this.fetchText(`${this.baseUrl}/land-banks/${bank.slug}`);

    const uuidRegex = /href="\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/g;
    const seen = new Set();
    const uuids = [];
    let m;
    while ((m = uuidRegex.exec(html)) !== null) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      uuids.push(m[1]);
      if (uuids.length >= this.maxListingsPerBank) break;
    }

    const listings = [];
    for (const uuid of uuids) {
      const startIdx = html.indexOf(`/p/${uuid}`);
      const nextIdx = html.indexOf('/p/', startIdx + 1);
      const endIdx = nextIdx === -1 ? html.length : nextIdx;
      const cardHtml = html.substring(startIdx, endIdx);

      const listing = this.parseCardHtml(uuid, cardHtml, bank);
      if (listing) listings.push(listing);
    }
    return listings;
  }

  parseCardHtml(uuid, cardHtml, bank) {
    const altMatch = cardHtml.match(/alt="([^"]+)"/);
    if (!altMatch) return null;
    const street = altMatch[1].trim();
    if (!street) return null;

    const csMatch = cardHtml.match(
      /class="truncate text-xs[^"]*"[^>]*>\s*([^<]+?)\s*<\/div>/
    );
    if (!csMatch) return null;
    const csText = csMatch[1].trim();
    const cs = csText.match(/^([^,]+),\s*([A-Z]{2})$/);
    if (!cs) return null;
    const city = cs[1].trim();
    const state = cs[2];

    const priceMatch = cardHtml.match(
      /class="[^"]*font-display[^"]*"[^>]*>\s*([^<]*?)\s*<\/div>/
    );
    let openingBid = null;
    if (priceMatch) {
      const pt = priceMatch[1].trim();
      if (pt.startsWith('$')) {
        openingBid = parseInt(pt.replace(/[^\d]/g, ''), 10) || null;
      }
    }

    let propType = null;
    if (/>Structure<\/span>/.test(cardHtml)) {
      propType = 'Single Family';
    } else if (/>Vacant lot<\/span>/.test(cardHtml)) {
      propType = 'Vacant Lot';
    }

    const photoMatch = cardHtml.match(/<img\s+src="([^"]+)"/);
    let photo = photoMatch ? photoMatch[1] : '';
    photo = photo
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'");

    const address = `${street}, ${city}, ${state}`;

    // Extract APN / Parcel ID if published
    const parcelMatch = cardHtml.match(/(?:parcel|apn|pin|tax\s*id)\s*[:#]?\s*([A-Za-z0-9._-]+)/i);
    const apn = parcelMatch ? parcelMatch[1].trim() : null;

    // Extract Lot Size if published
    const lotMatch = cardHtml.match(/([0-9,.]+)\s*(acres?|sq\s*ft)/i);
    let lotSize = null;
    if (lotMatch) {
      const num = parseFloat(lotMatch[1].replace(/,/g, ''));
      if (Number.isFinite(num) && num > 0) {
        lotSize = lotMatch[2].toLowerCase().startsWith('acre') ? num : Math.round(num);
      }
    }

    const sourceFacts = {
      bankName: bank?.name || null,
      bankState: bank?.state || null,
      apn,
      lotSize,
    };

    return {
      id: `LB-${uuid}`,
      source: 'landbank',
      state,
      county: null,
      city,
      zip: null,
      address,
      lat: null,
      lng: null,
      propType,
      openingBid,
      occupancy: null,
      sourceUrl: `${this.baseUrl}/p/${uuid}`,
      photo,
      apn,
      raw: cardHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
      sourceFacts,
      provenance: {
        origin: 'live',
        observed: true,
        publisher: bank?.name || 'LandBankSearch',
        recordId: uuid,
        sourceFacts,
      },
    };
  }

  passesFilter(item) {
    if (!item) return false;
    if (!/^LB-/.test(item.id || '')) return false;
    if (!/^[A-Z]{2}$/.test(item.state || '')) return false;
    if ((item.address || '').length < 8) return false;
    if (item.openingBid != null && !(Number(item.openingBid) > 0)) return false;
    return true;
  }
}

module.exports = new LandBankSearchScraper();
module.exports.LandBankSearchScraper = LandBankSearchScraper;
module.exports.rotateLandBanks = rotateLandBanks;
