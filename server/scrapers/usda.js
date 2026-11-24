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
// Rate limit: shared 250-750ms crawl jitter between sequential state POSTs.

const BaseScraper = require('./base');
const { inspectImageUrl } = require('./media-policy');
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');

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
const USDA_JURISDICTIONS = new Set(Object.values(STATE_NAME_TO_CODE));
const MAX_PUBLISHER_JURISDICTIONS = USDA_JURISDICTIONS.size;

class UsdaScrapeError extends Error {
  constructor(message, code = 'USDA_UPSTREAM_UNAVAILABLE') {
    super(message);
    this.name = 'UsdaScrapeError';
    this.code = code;
  }
}

function parseOffset(value) {
  if (value == null) return 0;
  const raw = (typeof value === 'object' && !Array.isArray(value))
    ? (value.continuationToken ?? value.cursor ?? value.nextCursor ?? value.offset ?? value.token)
    : value;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

class UsdaResalesScraper extends BaseScraper {
  constructor(options = {}) {
    super({
      name: 'UsdaResalesCollector',
      sourceKey: 'usda',
      maxRetries: options.maxRetries || ((process.env.VERCEL === '1' || process.env.NOW_REGION) ? 1 : 2),
    });
    this.baseUrl = 'https://www.resales.usda.gov';
    this.lastRunReport = null;
    this.useScrapling = options.useScrapling ?? isScraplingEnabled('usda');
    this.extract = options.extractImpl || extractWithScrapling;
    this.maxStates = Math.max(
      1,
      Number(options.maxStates || process.env.USDA_MAX_STATES || ((process.env.VERCEL === '1' || process.env.NOW_REGION) ? 10 : MAX_PUBLISHER_JURISDICTIONS)),
    );
    this.stateOffset = parseOffset(options.stateOffset ?? options.cursor ?? options.checkpoint ?? 0);
  }

  setCheckpoint(checkpoint) {
    this.stateOffset = parseOffset(checkpoint);
    return this;
  }

  getCollectionScope() {
    return { endpoint: '/resales/public/searchSFH', filters: { propertyType: 'Single Family' }, jurisdictionSelection: 'publisher_inventory_options' };
  }

  async scrapeFeed(options = {}) {
    if (options && typeof options === 'object') {
      const cp = options.cursor ?? options.continuationToken ?? options.checkpoint;
      if (cp != null) this.setCheckpoint(cp);
      if (options.maxStates) this.maxStates = Math.max(1, Number(options.maxStates));
    }
    const deadlineAt = Number(options?.deadlineAt) || 0;
    return this.executeWithRetry(async () => {
      // 1. Load the SFH search page to discover which states have inventory.
      const formHtml = await this.fetchText(`${this.baseUrl}/resales/public/searchSFH`);
      const states = this.parseStateOptions(formHtml);
      console.log(`[${this.name}] ${states.length} states with SFH inventory: ${states.map(s => s.code).join(', ')}`);

      const totalStates = states.length;
      const startOffset = totalStates > 0 ? (this.stateOffset % totalStates) : 0;
      const targetStates = totalStates > this.maxStates ? states.slice(startOffset, startOffset + this.maxStates) : states;
      let deadlineStopped = false;

      // 2. POST a search for each state → parse the summary table.
      const listings = [];
      const attemptedStatesList = [];
      const completedStates = [];
      const completedStateOptions = [];
      const failures = [];
      let sourceRows = 0;
      let malformedRows = 0;
      for (const { code, state } of targetStates) {
        if (deadlineAt && Date.now() >= deadlineAt - 1800) {
          deadlineStopped = true;
          break;
        }
        attemptedStatesList.push(state);
        try {
          const rows = await this.searchState(code);
          sourceRows += rows.length;
          for (const row of rows) {
            const listing = this.rowToListing(row);
            if (listing) listings.push(listing);
            else malformedRows += 1;
          }
          completedStates.push(state);
          completedStateOptions.push(code);
          await this.crawlJitter();
        } catch (err) {
          console.warn(`[${this.name}] Failed state ${state} (option ${code}): ${err.message}`);
          failures.push({ state, optionCode: code, error: err.message });
        }
      }

      const nextIndex = startOffset + attemptedStatesList.length;
      const partialSweep = deadlineStopped || (targetStates.length < totalStates) || (attemptedStatesList.length < targetStates.length);
      const hasMoreAhead = totalStates > 0 && (deadlineStopped || nextIndex < totalStates);
      const nextContinuationToken = hasMoreAhead ? String(nextIndex % totalStates) : null;
      this.stateOffset = nextContinuationToken ? Number(nextContinuationToken) : 0;

      this.lastRunReport = {
        outcome: failures.length ? 'partial_failure' : listings.length ? 'success' : 'empty',
        scope: this.getCollectionScope(),
        statesDiscovered: states.length,
        discoveredStates: states.map(({ state }) => state),
        discoveredStateOptions: states.map(({ code }) => code),
        attemptedStates: attemptedStatesList,
        statesCompleted: completedStates,
        completedStates,
        completedStateOptions,
        statesFailed: failures.length,
        sourceRows,
        malformedRows,
        recordsDiscovered: sourceRows,
        recordsEmitted: listings.length,
        recordsRejected: malformedRows,
        failures,
        complete: failures.length === 0 && !partialSweep,
        fullSweepComplete: failures.length === 0 && !partialSweep,
        partialSweep,
        truncated: partialSweep,
        nextContinuationToken,
        nextCursor: nextContinuationToken,
        fixtureFallbackUsed: false,
        scrapling: this.useScrapling
          ? {
            enabled: true,
            profile: 'usda-table',
            engine: this._lastExtraction?.engine || null,
            engineVersion: this._lastExtraction?.engineVersion || null,
            contentSha256: this._lastExtraction?.contentSha256 || null,
            itemCount: Array.isArray(this._lastExtraction?.items) ? this._lastExtraction.items.length : null,
            error: this._lastExtraction?.error || null,
          }
          : { enabled: false },
      };
      console.log(`[${this.name}] Scraped ${listings.length} USDA properties`);
      const standardized = [];
      let schemaRejected = 0;
      for (const item of listings) {
        try {
          standardized.push(this.standardizeListing(item));
        } catch (err) {
          if (err && err.code === 'LISTING_SCHEMA_INVALID') {
            schemaRejected += 1;
            if (this.lastRunReport) {
              this.lastRunReport.recordsRejected = (this.lastRunReport.recordsRejected || 0) + 1;
            }
            console.warn(`[${this.name}] Dropped schema-invalid USDA listing: ${err.message}`);
            continue;
          }
          throw err;
        }
      }
      if (this.lastRunReport) {
        this.lastRunReport.recordsEmitted = standardized.length;
        const totalRejected = this.lastRunReport.recordsRejected || 0;
        if (failures.length > 0 && standardized.length === 0) {
          this.lastRunReport.outcome = 'failed';
          this.lastRunReport.complete = false;
          this.lastRunReport.fullSweepComplete = false;
        } else if (failures.length > 0) {
          this.lastRunReport.outcome = 'partial_failure';
          this.lastRunReport.complete = false;
          this.lastRunReport.fullSweepComplete = false;
        } else if (standardized.length === 0 && (totalRejected > 0 || listings.length > 0)) {
          this.lastRunReport.outcome = 'failed';
          this.lastRunReport.complete = false;
          this.lastRunReport.fullSweepComplete = false;
        } else if (schemaRejected > 0 || malformedRows > 0) {
          this.lastRunReport.outcome = 'degraded';
        } else if (standardized.length > 0) {
          this.lastRunReport.outcome = 'success';
        } else {
          this.lastRunReport.outcome = 'empty';
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

  // Parse the <select id="stateCode"> options that have a non-empty value
  // (the dropdown only lists states with active properties).
  parseStateOptions(html) {
    const m = String(html || '').match(/<select[^>]*id\s*=\s*["']stateCode["'][^>]*>[\s\S]*?<\/select>/i);
    if (!m) throw new UsdaScrapeError('USDA SFH search page has no state inventory selector', 'USDA_SEARCH_SCHEMA_UNRECOGNIZED');
    const opts = [...m[0].matchAll(/<option\b[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi)];
    const states = opts
      .filter(o => o[1] && o[1].trim() !== '')
      .map(o => {
        const code = o[1].trim();
        const publisherLabel = this.text(o[2]);
        const label = publisherLabel.replace(/\s*\(\d+\)\s*$/, '').trim();
        const labelUpper = label.toUpperCase();
        const stateEntry = Object.entries(STATE_NAME_TO_CODE).find(([k]) => k.toLowerCase() === label.toLowerCase());
        const state = STATE_NAME_TO_CODE[label] || (stateEntry ? stateEntry[1] : null) || (/^[A-Z]{2}$/.test(labelUpper) && USDA_JURISDICTIONS.has(labelUpper) ? labelUpper : null);
        if (!/^\d{1,3}$/.test(code) || !state) {
          throw new UsdaScrapeError(`USDA SFH search page exposed an unrecognized jurisdiction option (${code || 'empty'}: ${publisherLabel || 'empty'})`, 'USDA_SEARCH_SCHEMA_UNRECOGNIZED');
        }
        return { code, label: publisherLabel, state };
      });
    if (states.length > MAX_PUBLISHER_JURISDICTIONS ||
        new Set(states.map(({ code }) => code)).size !== states.length ||
        new Set(states.map(({ state }) => state)).size !== states.length) {
      throw new UsdaScrapeError('USDA SFH search page exposed duplicate or excessive jurisdiction options', 'USDA_SEARCH_SCHEMA_UNRECOGNIZED');
    }
    return states;
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

    const pageUrl = `${this.baseUrl}/resales/public/searchSFH`;
    const html = await this.fetchText(pageUrl, 30000, 'POST', body);
    this._lastExtraction = null;
    if (this.useScrapling && typeof this.extract === 'function') {
      try {
        this._lastExtraction = await this.extract('usda-table', { html, url: pageUrl });
      } catch (error) {
        this._lastExtraction = { error: String(error?.message || error), code: error?.code || null };
      }
    }
    try {
      return this.parseSummaryTable(html);
    } catch (err) {
      if (
        err instanceof UsdaScrapeError
        && err.code === 'USDA_RESULT_SCHEMA_UNRECOGNIZED'
        && this.useScrapling
        && this._lastExtraction
        && Array.isArray(this._lastExtraction.rows)
        && this._lastExtraction.rows.length > 0
      ) {
        const items = Array.isArray(this._lastExtraction.items) ? this._lastExtraction.items : [];
        return this._lastExtraction.rows.map((row, idx) => {
          const cells = Array.isArray(row) ? row.map((c) => String(c ?? '')) : [];
          const item = items[idx];
          if (cells.length >= 1 && !/href\s*=/i.test(cells[0]) && item && typeof item.detailUrl === 'string' && item.detailUrl) {
            const safeHref = item.detailUrl.replace(/"/g, '&quot;');
            cells[0] = `<a href="${safeHref}">${this.text(cells[0]) || 'detail'}</a>`;
          }
          return cells;
        });
      }
      throw err;
    }
  }

  parseSummaryTable(html) {
    const m = String(html || '').match(/<table[^>]*id\s*=\s*["']propertySummariesTable["'][^>]*>([\s\S]*?)<\/table>/i);
    if (!m) throw new UsdaScrapeError('USDA SFH state response has no property summary table', 'USDA_RESULT_SCHEMA_UNRECOGNIZED');
    const rows = [...m[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => r[1]);
    // Skip the header row (first row). Each data row has 11 cells.
    return rows.slice(1).map(rowHtml => [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]));
  }

  rowToListing(cells) {
    if (!cells || cells.length < 11) return null;

    // cell[0]: <img src="..."> + <a href="/resales/public/SFHPropertyDetail?id=N&...">
    const photoMatch = cells[0].match(/src=["']([^"']+)["']/i);
    const detailMatch = cells[0].match(/href=["']([^"']*SFHPropertyDetail[^"']*)["']/i);

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

    const stateEntry = Object.entries(STATE_NAME_TO_CODE).find(([k]) => k.toLowerCase() === stateName.toLowerCase());
    const stateUpper = stateName.toUpperCase();
    const state = STATE_NAME_TO_CODE[stateName] || (stateEntry ? stateEntry[1] : null) || (/^[A-Z]{2}$/.test(stateUpper) && USDA_JURISDICTIONS.has(stateUpper) ? stateUpper : null);
    if (!state || !/^\d/.test(address)) return null;

    const detailHref = detailMatch ? detailMatch[1].replace(/&amp;/g, '&') : null;
    const detailId = detailHref ? (detailHref.match(/[?&]id=(\d+)/) || [])[1] : null;
    let sourceUrl = null;
    if (detailHref) {
      try {
        sourceUrl = new URL(detailHref, this.baseUrl).toString();
      } catch (_) {
        sourceUrl = null;
      }
    }
    let photoCandidate = null;
    if (photoMatch) {
      try {
        photoCandidate = new URL(photoMatch[1].replace(/&amp;/g, '&'), this.baseUrl).toString();
      } catch (_) {
        photoCandidate = null;
      }
    }
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
      auctionProgram: listingType || 'USDA SFH',
      lifecycleStatus: 'active',
      status: 'active',
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
            url: photo,
            origin: 'publisher_record',
            verification: 'source_extracted',
            sourceRecordUrl: sourceUrl,
            extraction: { selector: '#propertySummariesTable td:first-child img', association: 'exact_detail_record' }
          },
          gallery: [{
            url: photo,
            origin: 'publisher_record',
            verification: 'source_extracted',
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
module.exports.UsdaScrapeError = UsdaScrapeError;
