// server/scrapers/bid4assets.js
//
// REAL Bid4Assets scraper.
// Source: https://www.bid4assets.com/sheriffsales (verified live, requires
// a browser-like User-Agent — the default Node 22 fetch User-Agent is
// blocked by Akamai/edgesuite with HTTP 403).
//
// Strategy (3-stage):
//   1. Fetch /sheriffsales, /county-tax-sales, and /real-estate-auctions for
//      the list of US county storefronts (BedfordPASheriffSales, AdamsCountySheriffSales, ...).
//   2. Rotate through discovered storefronts using a cursor so all counties
//      are swept across runs. Each page embeds the full auction list as JSON objects
//      in inline <script> blocks — one per auction — with structured fields:
//      AuctionID, Asset_Title, ActualCloseTime, MinimumBid, CurrentBid, SheriffNumber,
//      Attorney, DebtAmount, Defendant, StatusID, BidCount, APN, DepositAmount, etc.
//   3. Map each JSON record to a listing via this.standardizeListing().
//      id = "B4A-{AuctionID}", source = "bid4assets", state = "PA" (parsed
//      from the "Berks County, PA Sheriff Sale: ..." title prefix).
//
// Rate limit: 1 req/sec between storefront fetches.

const BaseScraper = require('./base');
const {
  createRunReport,
  recordUnitFailure,
  recordUnitSuccess,
  finalizeRunReport,
} = require('./run-report');

// Maps Bid4Assets "PropertyType" / status keywords to the canonical
// propType strings used by base.js#standardizeListing defaults.
function classifyPropType(rawType, statusId, title) {
  const t = (rawType || '').toLowerCase();
  const h = (title || '').toLowerCase();
  if (t.includes('condo') || h.includes('condo')) return 'Condo';
  if (t.includes('multi') || t.includes('duplex') || t.includes('triplex')) return 'Multi-Family';
  if (t.includes('commercial') || h.includes('commercial')) return 'Commercial';
  if (t.includes('land') || t.includes('vacant') || h.includes('vacant land')) return 'Land';
  if (t.includes('residential') || t.includes('single')) return 'Single Family';
  return null;
}

// Parses a Bid4Assets "Asset_Title" like
//   "Berks County, PA Sheriff Sale: 906 NORTH 25TH STREET"
// or
//   "***POSTPONED***Berks County, PA Sheriff Sale: 906 NORTH 25TH STREET- Postponed to 11/06/2026, New Auction 1308882"
// into { state, street, status, postponedToDate, newAuctionId }.
function parseAssetTitle(title) {
  if (!title) return { state: null, street: '', status: null, postponedToDate: null, newAuctionId: null };
  let status = 'Scheduled';
  let cleaned = title;
  if (/^\*+\s*(POSTPONED|STAYED|CANCELLED|WITHDRAWN)/i.test(cleaned)) {
    status = RegExp.$1.toUpperCase();
    cleaned = cleaned.replace(/^\*+\s*(POSTPONED|STAYED|CANCELLED|WITHDRAWN)\**\s*/i, '');
  }

  let postponedToDate = null;
  let newAuctionId = null;
  const postponeMatch = cleaned.match(/Postponed\s+to\s+([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4})/i);
  if (postponeMatch) {
    postponedToDate = parseSaleDate(postponeMatch[1]);
  }
  const newAuctionMatch = cleaned.match(/New\s+Auction\s+([0-9]+)/i);
  if (newAuctionMatch) {
    newAuctionId = newAuctionMatch[1];
  }

  // The first colon is the field separator: prefix : street
  const colonIdx = cleaned.indexOf(':');
  const prefix = colonIdx >= 0 ? cleaned.substring(0, colonIdx) : cleaned;
  let street = colonIdx >= 0 ? cleaned.substring(colonIdx + 1).trim() : '';
  // Strip trailing " - Postponed to ..." / " New Auction N" annotations
  street = street.split(' - ')[0].trim();
  // Pull a 2-letter state code from the prefix (e.g. "Berks County, PA Sheriff Sale")
  const stateMatch = prefix.match(/\b([A-Z]{2})\b/);
  const state = stateMatch ? stateMatch[1] : null;
  return { state, street, status, postponedToDate, newAuctionId };
}

// Parses a "MM/DD/YYYY" or ISO date string to YYYY-MM-DD.
function parseSaleDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

function rotateStorefronts(slugs, startIndex, limit) {
  if (!Array.isArray(slugs) || slugs.length === 0) return [];
  const size = Math.max(0, Math.floor(Number(limit) || 0));
  if (size === 0) return [];
  if (size >= slugs.length) return [...slugs];
  const length = slugs.length;
  const start = ((Math.floor(Number(startIndex) || 0) % length) + length) % length;
  const window = [];
  for (let index = 0; index < size; index += 1) {
    window.push(slugs[(start + index) % length]);
  }
  return window;
}

class Bid4AssetsScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'Bid4AssetsScraper', sourceKey: 'bid4assets', ...options });
    this.baseUrl = 'https://www.bid4assets.com';
    this.maxStorefronts = Number(options.maxStorefronts ?? process.env.BID4ASSETS_MAX_STOREFRONTS) || 3;
    this.rotationOffset = Number(options.rotationOffset ?? process.env.BID4ASSETS_ROTATION_OFFSET) || 0;
    this.userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const report = createRunReport('bid4assets', {
        endpoint: '/sheriffsales',
        maxStorefronts: this.maxStorefronts,
        rotationOffset: this.rotationOffset,
      });
      this.lastRunReport = report;

      const countySlugs = await this.discoverStorefronts();
      report.endpointsTried = 1;
      const targetSlugs = rotateStorefronts(countySlugs, this.rotationOffset, this.maxStorefronts);

      console.log(
        `[${this.name}] Discovered ${countySlugs.length} storefronts; sweeping ${targetSlugs.length} at offset ${this.rotationOffset}`
      );

      const allListings = [];
      const seenIds = new Set();

      for (let i = 0; i < targetSlugs.length; i++) {
        const slug = targetSlugs[i];
        try {
          const listings = await this.fetchStorefront(slug);
          let added = 0;
          for (const item of listings) {
            const id = item.id;
            if (seenIds.has(id)) continue;
            seenIds.add(id);
            allListings.push(item);
            added++;
          }
          recordUnitSuccess(report, slug.replace(/^\//, ''), added);
          console.log(`[${this.name}]   ${slug}: ${listings.length} raw / ${added} new`);
        } catch (err) {
          recordUnitFailure(report, slug.replace(/^\//, ''), err);
          console.warn(`[${this.name}] Failed ${slug}: ${err.message}`);
        }
        if (i < targetSlugs.length - 1) await this.crawlJitter();
      }

      console.log(
        `[${this.name}] Scraped ${allListings.length} Bid4Assets auctions from ${targetSlugs.length} storefronts`
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
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });
  }

  async discoverStorefronts() {
    // Multi-channel discovery: /sheriffsales, /county-tax-sales, /real-estate-auctions
    const channels = ['/sheriffsales', '/county-tax-sales', '/real-estate-auctions'];
    const slugs = new Set();

    for (const channel of channels) {
      try {
        const html = await this.fetchText(`${this.baseUrl}${channel}`);
        const linkRe = /href="(\/[A-Za-z][A-Za-z0-9_-]*(?:[Ss]heriff|[Tt]ax[Ss]ale|[Aa]uction)[A-Za-z0-9_-]*)"/g;
        let m;
        while ((m = linkRe.exec(html)) !== null) {
          slugs.add(m[1]);
        }
      } catch (err) {
        console.warn(`[${this.name}] Channel discovery warning on ${channel}: ${err.message}`);
      }
    }

    if (slugs.size === 0) {
      // Fallback known storefronts if HTML discovery returns empty
      slugs.add('/berkscountysheriffsales');
      slugs.add('/adamscountysheriffsales');
      slugs.add('/bedfordpasheriffsales');
    }

    const slugArr = [...slugs];
    const lower = slugArr.map((s) => s.toLowerCase());
    const preferred = [
      '/berkscountysheriffsales',
      '/adamscountysheriffsales',
      '/bedfordpasheriffsales',
    ];
    const ordered = [
      ...preferred.filter((p) => lower.includes(p)).map((p) => slugArr[lower.indexOf(p)]),
      ...slugArr.filter((s) => !preferred.includes(s.toLowerCase())),
    ];
    return ordered;
  }

  async fetchStorefront(slug) {
    const url = `${this.baseUrl}${slug}`;
    const html = await this.fetchText(url);

    // Each auction is embedded in the page as a JSON object literal.
    // The object always starts with {"AuctionID":<number>,"Asset_Title":...
    // Capture greedily up to the matching closing brace.
    const objectRe = /\{\s*"AuctionID"\s*:\s*(\d+)\s*,[\s\S]*?\}/g;
    const records = [];
    let m;
    while ((m = objectRe.exec(html)) !== null) {
      try {
        const obj = JSON.parse(m[0]);
        if (obj && obj.AuctionID && obj.Asset_Title) {
          records.push(obj);
        }
      } catch (err) {
        // Skip malformed JSON
      }
    }

    return records
      .map((rec) => this.toListing(rec, slug, url))
      .filter(Boolean);
  }

  toListing(rec, slug, storefrontUrl) {
    const { state, street, status, postponedToDate, newAuctionId } = parseAssetTitle(rec.Asset_Title);
    const saleDate = parseSaleDate(rec.ActualCloseTime);
    const auctionId = rec.AuctionID;
    const id = `B4A-${auctionId}`;
    const minimumBid = Number(rec.MinimumBid);
    const currentBid = Number(rec.CurrentBid);
    const debtAmount = Number(rec.DebtAmount);
    const depositAmount = Number(rec.DepositAmount ?? rec.RequiredDeposit ?? rec.Deposit);
    const openingBid = Number.isFinite(minimumBid) && minimumBid > 0 ? minimumBid : null;
    const price = Number.isFinite(currentBid) && currentBid > 0 ? currentBid : null;
    const deposit = Number.isFinite(depositAmount) && depositAmount > 0 ? depositAmount : null;
    const rawApn = rec.ParcelID || rec.APN || rec.ParcelNumber || rec.TaxParcelID || null;
    const apn = rawApn ? String(rawApn).trim() : null;

    // Derive a friendly county name from the storefront slug.
    const raw = (slug || '').replace(/^\//, '');
    const countyMatch = raw.match(/^([A-Za-z]+?)(?:County|PA)?(?:Sheriff|SheriffSales|Sales|TaxSale)?$/i);
    const county = (countyMatch ? countyMatch[1] : raw)
      .replace(/sheriff|sheriffsales|countysheriff|sales|taxsale/i, '')
      .replace(/pa$/i, '')
      .trim() || null;

    if (!auctionId || !state || !street) return null;

    const sourceFacts = {
      sheriffNumber: rec.SheriffNumber ?? null,
      bidCount: rec.BidCount ?? null,
      debtAmount: Number.isFinite(debtAmount) && debtAmount > 0 ? debtAmount : null,
      apn,
      deposit,
      postponedToDate,
      newAuctionId,
    };

    return {
      id,
      source: 'bid4assets',
      state,
      county,
      city: null,
      zip: null,
      address: street,
      lat: null,
      lng: null,
      beds: null,
      baths: null,
      sqft: null,
      year: null,
      propType: classifyPropType(rec.PropertyType, rec.StatusID, rec.Asset_Title),
      openingBid,
      price,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate,
      plaintiff: null,
      defendant: rec.Defendant?.trim() || null,
      judgment: null,
      attorney: rec.Attorney?.trim() || null,
      occupancy: null,
      deposit,
      apn,
      photo: rec.PhotoUrl ?? rec.ImageUrl ?? null,
      status,
      sourceUrl: `${this.baseUrl}/auction/${auctionId}`,
      raw: JSON.stringify(rec),
      sourceFacts,
      provenance: {
        origin: 'live',
        observed: true,
        publisher: 'Bid4Assets',
        recordId: String(auctionId),
        sourceFacts,
      },
    };
  }

  passesFilter(item) {
    if (!item) return false;
    if (!/^B4A-\d+$/.test(item.id || '')) return false;
    if (!/^[A-Z]{2}$/.test(item.state || '')) return false;
    if ((item.address || '').length < 8) return false;
    if (item.openingBid != null && !(Number(item.openingBid) > 0)) return false;
    return true;
  }
}

module.exports = new Bid4AssetsScraper();
module.exports.Bid4AssetsScraper = Bid4AssetsScraper;
module.exports.parseAssetTitle = parseAssetTitle;
module.exports.parseSaleDate = parseSaleDate;
module.exports.rotateStorefronts = rotateStorefronts;
