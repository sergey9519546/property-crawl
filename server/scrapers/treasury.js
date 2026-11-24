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
// Detail fetches are capped at two in flight and receive 250–750ms jitter.

const BaseScraper = require('./base');
const { mapWithConcurrency } = require('./http');
const { extractDetailImages } = require('./media-policy');
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');

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

function parseOffset(value) {
  if (value == null) return 0;
  const raw = (typeof value === 'object' && !Array.isArray(value))
    ? (value.continuationToken ?? value.cursor ?? value.nextCursor ?? value.offset ?? value.token)
    : value;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

class TreasuryForfeitureScraper extends BaseScraper {
  constructor(options = {}) {
    super({
      ...options,
      name: 'TreasuryForfeitureCollector',
      sourceKey: 'treasury',
      timeoutMs: options.timeoutMs ?? ((process.env.VERCEL === '1' || process.env.NOW_REGION) ? 8_000 : 15_000),
    });
    this.baseUrl = 'https://www.treasury.gov/auctions/treasury/rp';
    this.detailConcurrency = Math.min(4, Math.max(1, Math.floor(Number(options.detailConcurrency) || 2)));
    this.maxRetries = Math.min(3, Math.max(1, Number(options.maxRetries || ((process.env.VERCEL === '1' || process.env.NOW_REGION) ? 1 : 2))));
    this.maxItems = Math.max(1, Number(options.maxItems || process.env.TREASURY_MAX_ITEMS || ((process.env.VERCEL === '1' || process.env.NOW_REGION) ? 12 : 100)));
    this.slugOffset = parseOffset(options.slugOffset ?? options.checkpoint ?? options.cursor ?? 0);
    this.lastRunReport = null;
    this.useScrapling = options.useScrapling ?? isScraplingEnabled('treasury');
    this.extract = options.extractImpl || extractWithScrapling;
    this.useSpiderBatch = Boolean(options.useSpiderBatch || String(process.env.SCRAPLING_SPIDER_SOURCES || '').toLowerCase().split(',').map((s) => s.trim()).includes('treasury'));
    this._spiderDetailCache = new Map();
  }

  setCheckpoint(checkpoint) {
    this.slugOffset = parseOffset(checkpoint);
    return this;
  }

  async scrapeFeed(options = {}) {
    if (options && typeof options === 'object') {
      const cp = options.cursor ?? options.continuationToken ?? options.checkpoint;
      if (cp != null) this.setCheckpoint(cp);
      if (options.maxItems) this.maxItems = Math.max(1, Number(options.maxItems));
    }
    const deadlineAt = Number(options?.deadlineAt) || 0;
    return this.executeWithRetry(async () => {
      if (this._spiderDetailCache) this._spiderDetailCache.clear();

      const listHtml = await this.fetchText(`${this.baseUrl}/realprop.shtml`);

      // Extract property slugs from .shtml links, excluding chrome/nav.
      const slugRegex = /href="([^"]+\.shtml)"/g;
      const excludeRegex = /include|top-nav|footer|howto|contact|press|broker|carolina/i;
      const slugs = [...new Set([...listHtml.matchAll(slugRegex)].map(m => m[1]))]
        .filter(s => !excludeRegex.test(s));

      console.log(`[${this.name}] Found ${slugs.length} property links on listing page`);

      const totalSlugs = slugs.length;
      const startOffset = totalSlugs > 0 ? (this.slugOffset % totalSlugs) : 0;
      const targetSlugs = totalSlugs > this.maxItems ? slugs.slice(startOffset, startOffset + this.maxItems) : slugs;
      let deadlineStopped = false;
      if (this.useSpiderBatch && targetSlugs.length > 0 && typeof this.runSpiderBatch === 'function') {
        try {
          const urls = targetSlugs.map((slug) => new URL(slug, `${this.baseUrl}/`).toString());
          const batchResult = await this.runSpiderBatch({
            urls,
            profile: 'treasury-detail',
            scope: 'federal',
          });
          if (batchResult && Array.isArray(batchResult.items)) {
            for (const item of batchResult.items) {
              const itemUrl = item?.url || item?.data?.url;
              if (item && itemUrl && item.data && item.data.property) {
                this._spiderDetailCache.set(itemUrl, item.data.property);
              }
            }
          }
        } catch (err) {
          console.warn(`[${this.name}] Spider batch prefetch fallback: ${err.message}`);
        }
      }
      let attemptedCount = 0;
      const detailResults = await mapWithConcurrency(
        targetSlugs,
        this.detailConcurrency,
        async (slug) => {
          if (deadlineAt && Date.now() >= deadlineAt - 1500) { deadlineStopped = true; return null; }
          await this.crawlJitter();
          if (deadlineAt && Date.now() >= deadlineAt - 1500) { deadlineStopped = true; return null; }
          attemptedCount += 1;
          return this.fetchDetail(slug);
        }
      );
      const listings = [];
      const failures = [];
      detailResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          if (result.value) listings.push(result.value);
        } else {
          console.warn(`[${this.name}] Failed ${targetSlugs[index]}: ${result.reason.message}`);
          failures.push({ slug: targetSlugs[index], error: result.reason.message });
        }
      });

      const effectiveStartOffset = totalSlugs > this.maxItems ? startOffset : 0;
      const partialSweep = (attemptedCount < totalSlugs) || (targetSlugs.length < totalSlugs) || deadlineStopped;
      const hasMoreAhead = totalSlugs > 0 && (deadlineStopped || (effectiveStartOffset + attemptedCount) < totalSlugs);
      const nextOffset = hasMoreAhead ? (effectiveStartOffset + attemptedCount) % totalSlugs : 0;
      const nextContinuationToken = hasMoreAhead ? String(nextOffset) : null;
      this.slugOffset = nextOffset;
      this.lastRunReport = { outcome: failures.length ? 'partial_failure' : listings.length ? 'success' : 'empty', scope: { endpoint: '/auctions/treasury/rp/realprop.shtml', filters: { assetClass: 'real_property' } }, recordsDiscovered: slugs.length, recordsAttempted: attemptedCount, recordsEmitted: listings.length, recordsRejected: Math.max(0, attemptedCount - listings.length - failures.length), failures, complete: failures.length === 0 && !partialSweep, fullSweepComplete: failures.length === 0 && !partialSweep, partialSweep, truncated: partialSweep, nextContinuationToken, nextCursor: nextContinuationToken, fixtureFallbackUsed: false };
      console.log(`[${this.name}] Scraped ${listings.length} Treasury properties`);
      // Schema-invalid items must not break the entire scrapeFeed call —
      // the run report above already counts them as recordsRejected. Catch
      // each item individually so the surviving listings still flow through
      // the validator and the failure mode is observable in the report.
      const standardized = [];
      for (const item of listings) {
        try {
          standardized.push(this.standardizeListing(item));
        } catch (err) {
          if (err && err.code === 'LISTING_SCHEMA_INVALID') {
            console.warn(`[${this.name}] Dropped schema-invalid listing: ${err.message}`);
          } else {
            throw err;
          }
        }
      }
      Object.defineProperties(standardized, {
        partialSweep: { value: partialSweep, enumerable: false, writable: true, configurable: true },
        nextContinuationToken: { value: nextContinuationToken, enumerable: false, writable: true, configurable: true },
        nextCursor: { value: nextContinuationToken, enumerable: false, writable: true, configurable: true },
        report: { value: this.lastRunReport, enumerable: false, writable: true, configurable: true },
      });
      return standardized;
    });
  }

  async fetchText(url, timeoutMs = this.timeoutMs) {
    return super.fetchText(url, {
      timeoutMs,
      headers: { 'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)' }
    });
  }

  async fetchDetail(slug) {
    const detailUrl = new URL(slug, `${this.baseUrl}/`).toString();
    const detailHtml = await this.fetchText(detailUrl);

    // Title is the full address: "4705 Battle Creek Road SE, Salem, Oregon 97302"
    const titleMatch = detailHtml.match(/<title>([^<]+)<\/title>/);
    if (!titleMatch) return null;
    const fullAddress = titleMatch[1].trim();
    if (!/^\s*(?:(?:LOT|PARCEL|TRACT|UNIT)\s+[^:]+:\s*)?\d/i.test(fullAddress)) return null; // skip non-property titles

    // When Scrapling is enabled, delegate the labeled-field extraction to
    // the Python venv and use the structured record instead of the regex
    // body scan below. The Python profile returns { property: {...} }.
    let scraplingRecord = (this._spiderDetailCache && this._spiderDetailCache.get(detailUrl)) || null;
    if (!scraplingRecord && this.useScrapling) {
      try {
        const evidence = await this.extract('treasury-detail', { html: detailHtml, url: detailUrl });
        const p = evidence && evidence.property ? evidence.property : null;
        if (p && (p.startingBid != null || p.saleNumber || p.parcelNumber || p.livingArea != null || p.yearBuilt != null || p.beds != null || p.baths != null)) {
          scraplingRecord = p;
        }
      } catch (_) {
        scraplingRecord = null;
      }
    }

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

    // Prefer the Scrapling structured record (when enabled) for each labeled
    // field; fall back to the regex body scan when the venv call did not
    // return a value for that field.
    const openingBid = (scraplingRecord && Number.isFinite(scraplingRecord.startingBid))
      ? scraplingRecord.startingBid
      : this.parseMoney(get(/Starting Bid:\s*\$([\d,]+)/));
    const sqft = (scraplingRecord && Number.isFinite(scraplingRecord.livingArea))
      ? scraplingRecord.livingArea
      : this.parseInt0(get(/Living Area:\s*([\d,]+)/));
    const year = (scraplingRecord && Number.isInteger(scraplingRecord.yearBuilt))
      ? scraplingRecord.yearBuilt
      : this.parseInt0(get(/Year Built:\s*(\d{4})/));
    const acres = (scraplingRecord && Number.isFinite(scraplingRecord.siteAcres))
      ? scraplingRecord.siteAcres
      : parseFloat(get(/Site Area:\s*([\d.]+)/) || '');
    const landSqft = Number.isFinite(acres) && acres > 0 ? Math.round(acres * 43560) : null;
    const deposit = (scraplingRecord && scraplingRecord.deposit)
      ? scraplingRecord.deposit
      : get(/Deposit:\s*([^.]+?)(?:\.|Inspection|$)/);
    const saleDateRaw = (scraplingRecord && scraplingRecord.auctionDate)
      ? scraplingRecord.auctionDate
      : get(/Auction Date and Time:\s*([\s\S]+?)(?=Inspection|Deposit|Starting|Parcel|Sale\s+Number|$)/i);
    const parcelNo = (scraplingRecord && scraplingRecord.parcelNumber)
      ? scraplingRecord.parcelNumber
      : get(/Parcel No:\s*(\S+)/);
    const saleNumber = (scraplingRecord && scraplingRecord.saleNumber)
      ? scraplingRecord.saleNumber
      : get(/Sale Number:\s*([\w-]+)/);

    const beds = (scraplingRecord && Number.isInteger(scraplingRecord.beds))
      ? scraplingRecord.beds
      : this.parseInt0(get(/(\d+)\s*bedrooms?/i));
    const baths = (scraplingRecord && Number.isInteger(scraplingRecord.baths))
      ? scraplingRecord.baths
      : this.parseInt0(get(/(\d+)\s*baths?/i));

    const addrParts = this.parseAddress(fullAddress);
    const baseName = slug.replace('.shtml', '');
    let saleDate = this.parseSaleDate(saleDateRaw);
    let resolvedOpeningBid = openingBid;
    if ((resolvedOpeningBid == null || saleDate == null) && typeof this.extractWithAdaptiveFallback === 'function') {
      const adaptive = this.extractWithAdaptiveFallback(detailHtml, {
        caseNumber: { selector: 'title', extractor: (h) => (h.match(/<title>([^<]+)<\/title>/)?.[1] ? (saleNumber || baseName) : null) },
        openingBid: { selector: '.starting-bid', extractor: (h) => (h.match(/Starting\s*Bid:\s*\$([\d,]+)/i)?.[1]?.replace(/,/g, '') || null) },
        saleDateText: { selector: '.auction-date', extractor: (h) => (h.match(/Auction\s*Date\s*and\s*Time:\s*([^<]+?)(?:Inspection|$)/i)?.[1] || null) },
      }, { persistSelectors: false });
      if (adaptive && adaptive.identityPassed) {
        if (resolvedOpeningBid == null && adaptive.fields.openingBid) {
          resolvedOpeningBid = this.parseMoney(adaptive.fields.openingBid);
        }
        if (saleDate == null && adaptive.fields.saleDateText) {
          saleDate = this.parseSaleDate(adaptive.fields.saleDateText);
        }
      }
    }
    const gallery = extractDetailImages({ source: 'treasury', html: detailHtml, sourceUrl: detailUrl, address: fullAddress });
    const numericDeposit = this.parseMoney(deposit);
    const sourceFacts = {
      parcelNumber: parcelNo || null,
      siteAcres: Number.isFinite(acres) ? acres : null,
      depositText: deposit || null,
      deposit: numericDeposit || null,
      apn: parcelNo || null,
    };

    return {
      id: saleNumber ? `TRSY-${saleNumber}` : `TRSY-${baseName.toUpperCase()}`,
      state: addrParts.state,
      county: addrParts.county || null,
      city: addrParts.city,
      zip: addrParts.zip,
      address: fullAddress,
      lat: null,
      lng: null,
      beds: beds || null,
      baths: baths || null,
      sqft: sqft || landSqft || null,
      year: year || null,
      propType: this.classifyPropertyType(body),
      openingBid: resolvedOpeningBid || null,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate,
      status: 'active',
      plaintiff: null,
      defendant: null,
      judgment: null,
      attorney: null,
      occupancy: null,
      deposit: numericDeposit || null,
      apn: parcelNo || null,
      photo: gallery[0]?.url || null,
      sourceUrl: detailUrl,
      raw: body.substring(0, 2000),
      sourceFacts,
      provenance: {
        origin: 'live',
        observed: true,
        publisher: 'U.S. Department of the Treasury',
        recordId: String(saleNumber || baseName),
        sourceFacts,
        media: gallery.length ? {
          photo: { url: gallery[0].url, origin: 'publisher_record', verification: 'source_extracted', sourceRecordUrl: detailUrl, extraction: { selector: gallery[0].selector, association: 'exact_detail_page' } },
          gallery
        } : {}
      }
    };
  }

  parseAddress(address) {
    // "4705 Battle Creek Road SE, Salem, Oregon 97302"
    // or  "112 North Avenue E, Bruni, Texas 78344"
    // or  "915 E Stewart Ave, Las Vegas, NV 89101"
    const parts = address.split(',').map(s => s.trim());
    if (parts.length < 3) return { state: 'US', zip: '00000', city: '', county: '' };
    const last = parts[parts.length - 1];

    // Try state code (e.g. "NV 89101" or "NV 89101-1234")
    let m = last.match(/^([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/);
    if (m) {
      return { state: m[1], zip: m[2], city: parts[parts.length - 2], county: '' };
    }
    // Try full state name (e.g. "Oregon 97302" or "District of Columbia 20001-1234")
    m = last.match(/^([A-Za-z\s]+?)\s+(\d{5})(?:-\d{4})?$/);
    if (m) {
      const stateNameCandidate = m[1].trim();
      const zip = m[2];
      const matchEntry = Object.entries(STATE_NAME_TO_CODE).find(
        ([name]) => name.toLowerCase() === stateNameCandidate.toLowerCase()
      );
      if (matchEntry) {
        return { state: matchEntry[1], zip, city: parts[parts.length - 2], county: '' };
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
    if (/single.?family|\bhome\b|\bresidence\b/i.test(body)) return 'Single Family';
    if (/CONDO/i.test(body)) return 'Condo';
    if (/MULTI.?FAMILY|MULTIPLEX/i.test(body)) return 'Multi-Family';
    if (/COMMERCIAL/i.test(body)) return 'Commercial';
    if (/LAND|VACANT/i.test(body)) return 'Land';
    return null;
  }

  parseMoney(s) {
    if (!s) return null;
    const m = String(s).match(/(\d[\d,]*(?:\.\d{1,2})?)/);
    if (!m) return null;
    const parsed = parseFloat(m[1].replace(/,/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  }

  parseInt0(s) {
    if (!s) return null;
    const m = String(s).match(/(\d[\d,]*)/);
    return m ? (parseInt(m[1].replace(/,/g, ''), 10) || null) : null;
  }

  // Demo/Unsplash inventory overrides removed (2026-09-14 audit).
  // Live collectors must not fabricate listings; BaseScraper may still read
  // data/listings.snapshot.json as explicitly labeled fixture evidence.

}

module.exports = new TreasuryForfeitureScraper();
module.exports.TreasuryForfeitureScraper = TreasuryForfeitureScraper;
