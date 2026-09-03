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
//      Sort by count desc, take top N (default 5).
//   2. For each top land bank, fetch /land-banks/{slug} and extract the
//      "Cheapest current listings" grid (~12 cards per page). Each card
//      already has address, city/state, price, photo, and propType badge.
//
// Per-listing fields:
//   - id        = "LB-{uuid}" (uuid from /p/{uuid} href)
//   - source    = "landbank"
//   - address   = "0 Ruby Ave, Cleveland, OH" (from card alt + city/state)
//   - state     = 2-letter (from /data row, also confirmed in card)
//   - openingBid= parsed "$X" price (0 if "Make offer" -> filtered out)
//   - photo     = card <img src> (satellite or real photo from source bank)
//   - sourceUrl = https://www.landbanksearch.com/p/{uuid}
//   - propType  = "Single Family" if Structure badge, else "Vacant Lot"
//   - occupancy = "Vacant" (land bank default)
//
// Safety:
//   - AbortController timeout = 30s per fetch (modeled on treasury.js)
//   - 1s polite delay between land-bank page fetches
//   - 5 land banks x ~12 cards = ~60 listings per run (well under
//     the 180s build-data.js timeout)
//   - maxListingsPerBank cap = 100 (defensive)
//
// Coordinates:
//   LandBankSearch listing cards do not contain per-property lat/lng. We use
//   the land bank's city centroid (from /explore?lng=&lat= URL) for every
//   listing from that bank, then apply a small pseudorandom offset (±0.05°,
//   ~5.5 km) per listing so map markers don't all stack on the same point.
//   Geocoding individual cards would require the Google Maps API or similar;
//   this jitter is the best approximation without that dependency.

const BaseScraper = require('./base');

class LandBankSearchScraper extends BaseScraper {
  constructor() {
    super({ name: 'LandBankSearchScraper', sourceKey: 'landbank' });
    this.baseUrl = 'https://www.landbanksearch.com';
    this.delayMs = 1000;
    this.maxLandBanks = 5;
    this.maxListingsPerBank = 100;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const banks = await this.fetchLandBanks();
      console.log(`[${this.name}] Discovered ${banks.length} land banks on /data`);

      const top = banks
        .filter((b) => b.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, this.maxLandBanks);

      console.log(
        `[${this.name}] Top ${top.length} by volume: ${top
          .map((b) => `${b.name}(${b.state},${b.count})`)
          .join(', ')}`
      );

      const allListings = [];
      for (const bank of top) {
        try {
          const listings = await this.fetchBankListings(bank);
          console.log(
            `[${this.name}]   ${bank.name}(${bank.state}): ${listings.length} cards`
          );
          allListings.push(...listings);
        } catch (err) {
          console.warn(
            `[${this.name}] Failed ${bank.slug} (${bank.state}): ${err.message}`
          );
        }
        await this.sleep(this.delayMs);
      }

      console.log(
        `[${this.name}] Scraped ${allListings.length} LandBankSearch listings across ${top.length} land banks`
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

    let defaultLat = 39.5;
    let defaultLng = -83.0;
    const mapMatch = html.match(
      /href="\/explore\?lng=([-\d.]+)&amp;lat=([-\d.]+)/
    );
    if (mapMatch) {
      defaultLng = parseFloat(mapMatch[1]);
      defaultLat = parseFloat(mapMatch[2]);
    }

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

      const listing = this.parseCardHtml(uuid, cardHtml, bank, defaultLat, defaultLng);
      if (listing) listings.push(listing);
    }
    return listings;
  }

  parseCardHtml(uuid, cardHtml, bank, defaultLat, defaultLng) {
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
    let openingBid = 0;
    if (priceMatch) {
      const pt = priceMatch[1].trim();
      if (pt.startsWith('$')) {
        openingBid = parseInt(pt.replace(/[^\d]/g, ''), 10) || 0;
      }
    }

    let propType = 'Vacant Lot';
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
    const county = bank.name.replace(/ Land Bank.*$/i, '').trim() || city;

    // Apply a small pseudorandom jitter (±0.05°, ~5.5 km) so map markers
    // from the same land bank don't all overlap on the city centroid.
    // Seed derived from the UUID for reproducibility across runs.
    const hash = uuid.replace(/-/g, '');
    const seed1 = parseInt(hash.slice(0, 4), 16) || 0;
    const seed2 = parseInt(hash.slice(4, 8), 16) || 0;
    const jitterLat = ((seed1 % 1000) / 10000) - 0.05;   // -0.05 to +0.049
    const jitterLng = ((seed2 % 1000) / 10000) - 0.05;

    return {
      id: `LB-${uuid}`,
      state,
      county,
      city,
      zip: '00000',
      address,
      lat: +(defaultLat + jitterLat).toFixed(6),
      lng: +(defaultLng + jitterLng).toFixed(6),
      propType,
      openingBid,
      occupancy: 'Vacant',
      sourceUrl: `${this.baseUrl}/p/${uuid}`,
      photo,
      raw: `${address} | ${bank.name} | ${propType} | ${openingBid ? '$' + openingBid : 'Make offer'}`,
    };
  }

  passesFilter(item) {
    if (!item) return false;
    if (!/^LB-/.test(item.id || '')) return false;
    if (!/^[A-Z]{2}$/.test(item.state || '')) return false;
    if ((item.address || '').length < 8) return false;
    if (!(item.openingBid > 0)) return false;
    return true;
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = new LandBankSearchScraper();
