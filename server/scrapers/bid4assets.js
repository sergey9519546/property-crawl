// server/scrapers/bid4assets.js
//
// REAL Bid4Assets scraper.
// Source: https://www.bid4assets.com/sheriffsales (verified live, requires
// a browser-like User-Agent — the default Node 22 fetch User-Agent is
// blocked by Akamai/edgesuite with HTTP 403).
//
// Strategy (3-stage):
//   1. Fetch /sheriffsales for the list of US sheriff-sale county
//      storefronts (BedfordPASheriffSales, AdamsCountySheriffSales, ...).
//      Also fetches /real-estate-auctions and /county-tax-sales for the
//      additional channel pages — these share the same county-link shape.
//   2. For the first 3 reachable county storefronts (e.g. Berks County PA
//      has 80+ live auctions), fetch the storefront page. Each page embeds
//      the full auction list as JSON objects in inline <script> blocks —
//      one per auction — with structured fields: AuctionID, Asset_Title,
//      ActualCloseTime, MinimumBid, CurrentBid, SheriffNumber, Attorney,
//      DebtAmount, Defendant, StatusID, BidCount, etc.
//   3. Map each JSON record to a listing via this.standardizeListing().
//      id = "B4A-{AuctionID}", source = "bid4assets", state = "PA" (parsed
//      from the "Berks County, PA Sheriff Sale: ..." title prefix).
//
// Per docs/sources-to-scrape.md #3: ~8,300+ active real-estate auctions
// across US states. Per-state counts (Aug 2026): PA 6,711, LA 343, FL 101,
// CA 75, NV 63, AR 58, TX 51.
//
// Rate limit: 1 req/sec between storefront fetches. The Akamai CDN is
// sensitive to non-browser user agents, so we send a real Chrome UA.

const BaseScraper = require('./base');

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
  // B4A records don't always carry a property type — derive from status.
  // StatusID 2 = "Scheduled", 6 = "Postponed"/"Stayed". Both are SF by default.
  return 'Single Family';
}

// Parses a Bid4Assets "Asset_Title" like
//   "Berks County, PA Sheriff Sale: 906 NORTH 25TH STREET"
// or
//   "***POSTPONED***Berks County, PA Sheriff Sale: 906 NORTH 25TH STREET- Postponed to 11/06/2026, New Auction 1308882"
// into { state, street, status }.
function parseAssetTitle(title) {
  if (!title) return { state: 'US', street: '', status: 'Scheduled' };
  let status = 'Scheduled';
  let cleaned = title;
  if (/^\*+\s*(POSTPONED|STAYED|CANCELLED|WITHDRAWN)/i.test(cleaned)) {
    status = RegExp.$1.toUpperCase();
    cleaned = cleaned.replace(/^\*+\s*(POSTPONED|STAYED|CANCELLED|WITHDRAWN)\**\s*/i, '');
  }
  // The first colon is the field separator: prefix : street
  const colonIdx = cleaned.indexOf(':');
  const prefix = colonIdx >= 0 ? cleaned.substring(0, colonIdx) : cleaned;
  let street = colonIdx >= 0 ? cleaned.substring(colonIdx + 1).trim() : cleaned;
  // Strip trailing " - Postponed to ..." / " New Auction N" annotations
  street = street.split(' - ')[0].trim();
  // Pull a 2-letter state code from the prefix (e.g. "Berks County, PA Sheriff Sale")
  const stateMatch = prefix.match(/\b([A-Z]{2})\b/);
  const state = stateMatch ? stateMatch[1] : 'US';
  return { state, street, status };
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
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

class Bid4AssetsScraper extends BaseScraper {
  constructor() {
    super({ name: 'Bid4AssetsScraper', sourceKey: 'bid4assets' });
    this.baseUrl = 'https://www.bid4assets.com';
    this.delayMs = 1000; // 1 req/sec
    this.maxStorefronts = 3; // Berks alone has 80+ — 3 storefronts is enough for v1
    // Browser UA — the Akamai CDN returns 403 for Node's default UA.
    this.userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const countySlugs = await this.discoverStorefronts();
      console.log(
        `[${this.name}] Discovered ${countySlugs.length} sheriff-sale county storefronts; visiting first ${this.maxStorefronts}`
      );

      const allListings = [];
      const seenIds = new Set();

      for (let i = 0; i < Math.min(this.maxStorefronts, countySlugs.length); i++) {
        const slug = countySlugs[i];
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
          console.log(`[${this.name}]   ${slug}: ${listings.length} raw / ${added} new`);
        } catch (err) {
          console.warn(`[${this.name}] Failed ${slug}: ${err.message}`);
        }
        if (i < this.maxStorefronts - 1) await this.sleep(this.delayMs);
      }

      console.log(
        `[${this.name}] Scraped ${allListings.length} Bid4Assets auctions from ${this.maxStorefronts} storefronts`
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
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async discoverStorefronts() {
    // /sheriffsales has the most counties (Bedford, Berks, Adams, ...).
    // We ignore /real-estate-auctions and /county-tax-sales for v1 because
    // they have the same per-county storefront URL pattern; doubling up
    // just wastes requests. Expand in Phase 2.
    const html = await this.fetchText(`${this.baseUrl}/sheriffsales`);
    // Case-insensitive: the page mixes /BedfordPASheriffSales (capital S)
    // with /berkscountysheriffsales (lowercase s).
    const linkRe = /href="(\/[A-Za-z][A-Za-z0-9]*[Ss]heriff[A-Za-z0-9]*)"/g;
    const slugs = new Set();
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      slugs.add(m[1]);
    }
    // Lowercase everything for ordering so we can compare case-insensitively.
    const slugArr = [...slugs];
    const lower = slugArr.map((s) => s.toLowerCase());
    // Prefer counties we know carry data (Berks alone has 80+).
    const preferred = [
      '/berkscountysheriffsales',
      '/adamscountysheriffsales',
      '/bedfordpasheriffsales',
    ];
    const ordered = [
      ...preferred.filter((p) => lower.includes(p)).map((p) => slugArr[lower.indexOf(p)]),
      ...slugArr,
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
        // Skip malformed JSON; the embedded objects sometimes have trailing
        // commas that break the parser. Not worth a hard failure.
      }
    }

    return records
      .map((rec) => this.toListing(rec, slug, url))
      .filter((item) => item.openingBid > 0);
  }

  toListing(rec, slug, storefrontUrl) {
    const { state, street, status } = parseAssetTitle(rec.Asset_Title);
    const saleDate = parseSaleDate(rec.ActualCloseTime);
    const id = `B4A-${rec.AuctionID}`;
    const openingBid = Number(rec.CurrentBid || rec.MinimumBid || 0) || 0;
    const judgment = Number(rec.DebtAmount || 0) || 0;
    // Derive a friendly county name from the storefront slug. The slug
    // shapes are: /berkscountysheriffsales -> "berks",
    //              /BedfordPASheriffSales -> "Bedford",
    //              /BossierSheriff -> "Bossier",
    //              /adamscountysheriffsales -> "adams".
    const raw = (slug || '').replace(/^\//, '');
    const countyMatch = raw.match(/^([A-Za-z]+?)(?:County|PA)?(?:Sheriff|SheriffSales|Sales)?$/i);
    const county = (countyMatch ? countyMatch[1] : raw)
      .replace(/sheriff|sheriffsales|countysheriff|sales/i, '')
      .replace(/pa$/i, '')
      .trim() || 'Unknown';

    return {
      id,
      source: 'bid4assets',
      state,
      county: county || 'Unknown',
      city: 'Unknown',
      zip: '00000',
      address: street || rec.Asset_Title,
      lat: 0,
      lng: 0,
      beds: 0,
      baths: 0,
      sqft: 0,
      year: null,
      propType: classifyPropType(rec.PropertyType, rec.StatusID, rec.Asset_Title),
      openingBid,
      estLow: 0,
      estHigh: 0,
      assessed: 0,
      saleDate,
      plaintiff: 'Plaintiff per docket',
      defendant: (rec.Defendant || '—').trim() || '—',
      judgment,
      attorney: (rec.Attorney || '—').trim() || '—',
      occupancy: 'Unknown',
      deposit: 'See Bid4Assets sale terms',
      photo: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=640&q=70',
      sourceUrl: `${this.baseUrl}/auction/${rec.AuctionID}`,
      raw: `[B4A ${status}] ${rec.Asset_Title} | Sheriff# ${rec.SheriffNumber || '—'} | Bid count: ${rec.BidCount || 0} | MinBid $${rec.MinimumBid || 0} | Debt $${rec.DebtAmount || 0}`.substring(0, 500),
    };
  }

  passesFilter(item) {
    if (!item) return false;
    if (!/^B4A-\d+$/.test(item.id || '')) return false;
    if (!/^[A-Z]{2}$/.test(item.state || '')) return false;
    if ((item.address || '').length < 8) return false;
    if (!(item.openingBid > 0)) return false;
    return true;
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = new Bid4AssetsScraper();
