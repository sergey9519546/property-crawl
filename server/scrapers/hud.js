// server/scrapers/hud.js
//
// U.S. Department of Housing and Urban Development (HUD) REO Scraper.
// Source: https://www.hudhomestore.gov
//
// Scrapes single-family HUD homes offered through HUD HomeStore.

const BaseScraper = require('./base');
const { mapWithConcurrency } = require('./http');
const { ScraperResponseError } = require('./circuit-breaker');

const ALL_HUD_JURISDICTIONS = Object.freeze([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC', 'PR'
]);
const DEFAULT_MAX_PAGES_PER_STATE = 3;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_STATE_CONCURRENCY = 2;
const HUD_REO_LAYER = 'https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1';

class HudScrapeError extends Error {
  constructor(message, report) {
    super(message);
    this.name = 'HudScrapeError';
    this.code = 'HUD_UPSTREAM_UNAVAILABLE';
    this.report = report;
  }
}

function positiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function configuredStates(value) {
  if (Array.isArray(value)) return [...new Set(value.map((state) => String(state).trim().toUpperCase()).filter((state) => ALL_HUD_JURISDICTIONS.includes(state)))];
  if (typeof value !== 'string' || !value.trim()) return [...ALL_HUD_JURISDICTIONS];
  return [...new Set(value.split(',').map((state) => state.trim().toUpperCase()).filter((state) => ALL_HUD_JURISDICTIONS.includes(state)))];
}

class HudHomeScraper extends BaseScraper {
  constructor(options = {}) {
    super({
      ...options,
      name: 'HudHomeScraper',
      sourceKey: 'hud',
      timeoutMs: options.timeoutMs ?? 15_000,
    });
    this.baseUrl = options.baseUrl || 'https://www.hudhomestore.gov';
    // Keep explicit baseUrl injection on the legacy path for fixture tests. Live
    // collection uses HUD's documented public REO feature layer; step 6 means
    // the property is publicly listed on HUD HomeStore.
    this.inventoryUrl = options.inventoryUrl || null;
    this.states = configuredStates(options.states ?? process.env.HUD_STATES);
    this.maxStates = positiveInt(options.maxStates ?? process.env.HUD_MAX_STATES, this.states.length, ALL_HUD_JURISDICTIONS.length);
    this.maxPagesPerState = positiveInt(options.maxPagesPerState ?? process.env.HUD_MAX_PAGES_PER_STATE, DEFAULT_MAX_PAGES_PER_STATE, 10);
    this.pageSize = positiveInt(options.pageSize ?? process.env.HUD_PAGE_SIZE, DEFAULT_PAGE_SIZE, 100);
    this.stateConcurrency = positiveInt(options.stateConcurrency ?? process.env.HUD_STATE_CONCURRENCY, DEFAULT_STATE_CONCURRENCY, 4);
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const states = this.states.slice(0, this.maxStates);
      if (states.length === 0) throw new HudScrapeError('No valid HUD jurisdictions configured', this.createRunReport([]));
      const report = this.createRunReport(states);
      const results = await mapWithConcurrency(states, this.stateConcurrency, (state) => this.fetchStateHudHomes(state));
      const allListings = [];
      for (let index = 0; index < results.length; index += 1) {
        const state = states[index];
        const result = results[index];
        report.statesAttempted += 1;
        if (result.status === 'fulfilled') {
          const stateResult = result.value;
          report.pagesAttempted += stateResult.pagesAttempted;
          report.pagesFetched += stateResult.pagesFetched;
          report.sourceRows += stateResult.sourceRows;
          report.malformedRows += stateResult.malformedRows;
          report.fallbackStates += stateResult.usedHtmlFallback ? 1 : 0;
          report.truncated = report.truncated || stateResult.truncated === true;
          allListings.push(...stateResult.listings);
          if (stateResult.listings.length) report.statesWithListings += 1;
          else report.statesEmpty += 1;
        } else {
          report.statesFailed += 1;
          report.failures.push({ state, error: this.errorSummary(result.reason) });
        }
      }
      report.listingsParsed = allListings.length;
      const standardized = allListings
        .filter(l => this.passesFilter(l))
        .map(l => this.standardizeListing(l));
      report.listingsEmitted = standardized.length;
      report.outcome = report.statesFailed === report.statesAttempted
        ? 'failed'
        : report.statesFailed > 0
          ? 'partial_failure'
          : standardized.length === 0
            ? 'empty'
            : 'success';
      report.complete = report.statesFailed === 0 && !report.truncated && states.length === this.states.length;
      report.fullSweepComplete = report.complete;
      report.fixtureFallbackUsed = false;
      this.lastRunReport = Object.freeze(report);

      if (report.outcome === 'failed') {
        throw new HudScrapeError(`[${this.name}] No HUD state endpoint completed; refusing to treat upstream failure as empty inventory`, this.lastRunReport);
      }
      console.log(`[${this.name}] ${report.outcome}: ${standardized.length} listings from ${report.statesAttempted - report.statesFailed}/${report.statesAttempted} completed jurisdictions`);
      return standardized;
    });
  }

  async fetchStateHudHomes(state) {
    if (this.inventoryUrl) return this.fetchArcGisState(state);
    const listings = [];
    let pagesAttempted = 0;
    let pagesFetched = 0;
    try {
      for (let pageNo = 1; pageNo <= this.maxPagesPerState; pageNo += 1) {
        pagesAttempted += 1;
        const page = await this.fetchDataGridPage(state, pageNo);
        pagesFetched += 1;
        listings.push(...page.items.map((item) => this.mapJsonItem(item, state)).filter(Boolean));
        if (!page.hasMore) return { state, listings, pagesAttempted, pagesFetched, usedHtmlFallback: false, truncated: false };
        if (pageNo === this.maxPagesPerState) return { state, listings, pagesAttempted, pagesFetched, usedHtmlFallback: false, truncated: true };
        await this.crawlJitter();
      }
      return { state, listings, pagesAttempted, pagesFetched, usedHtmlFallback: false, truncated: false };
    } catch (error) {
      if (error instanceof ScraperResponseError && error.haltScraper) throw error;
      if (this.circuitBreaker.isOpen()) throw error;
      const html = await this.fetchStateHtml(state, error);
      return { state, listings: html, pagesAttempted, pagesFetched, usedHtmlFallback: true, truncated: false };
    }
  }

  async fetchArcGisState(state) {
    const listings = [];
    let pagesAttempted = 0;
    let pagesFetched = 0;
    let sourceRows = 0;
    let malformedRows = 0;
    for (let pageNo = 1; pageNo <= this.maxPagesPerState; pageNo += 1) {
      pagesAttempted += 1;
      const offset = (pageNo - 1) * this.pageSize;
      const query = new URLSearchParams({
        where: `CASE_STEP_NUMBER = 6 AND STATE_CODE = '${state}'`,
        outFields: 'OBJECTID,CASE_NUM,CASE_STEP_NUMBER,ADDRESS,CITY,STATE_CODE,DISPLAY_ZIP_CODE,MAP_LATITUDE,MAP_LONGITUDE,DATE_ACQUIRED',
        returnGeometry: 'true',
        outSR: '4326',
        resultOffset: String(offset),
        resultRecordCount: String(this.pageSize),
        orderByFields: 'OBJECTID ASC',
        f: 'json',
      });
      const payload = await this.requestText(`${this.inventoryUrl}/query?${query}`, { headers: this.jsonHeaders() });
      let data;
      try { data = JSON.parse(payload); } catch (error) {
        throw new Error(`HUD REO feature layer returned invalid JSON for ${state} page ${pageNo}: ${error.message}`);
      }
      if (data?.error) throw new Error(`HUD REO feature layer error for ${state} page ${pageNo}: ${data.error.message || JSON.stringify(data.error)}`);
      if (!Array.isArray(data?.features)) throw new Error(`HUD REO feature layer response has no features array for ${state} page ${pageNo}`);
      pagesFetched += 1;
      sourceRows += data.features.length;
      for (const feature of data.features) {
        const listing = this.mapArcGisFeature(feature, state);
        if (listing) listings.push(listing);
        else malformedRows += 1;
      }
      const hasMore = data.exceededTransferLimit === true || data.features.length === this.pageSize;
      if (!hasMore) return { state, listings, pagesAttempted, pagesFetched, sourceRows, malformedRows, usedHtmlFallback: false, truncated: false };
      if (pageNo === this.maxPagesPerState) return { state, listings, pagesAttempted, pagesFetched, sourceRows, malformedRows, usedHtmlFallback: false, truncated: true };
      await this.crawlJitter();
    }
    return { state, listings, pagesAttempted, pagesFetched, sourceRows, malformedRows, usedHtmlFallback: false, truncated: false };
  }

  mapArcGisFeature(feature, state) {
    const p = feature?.attributes;
    if (!p || Number(p.CASE_STEP_NUMBER) !== 6 || !p.CASE_NUM || !p.ADDRESS) return null;
    const caseNum = String(p.CASE_NUM).trim();
    if (!/^\d{3}-\d{6}$/.test(caseNum)) return null;
    const city = String(p.CITY || '').trim() || null;
    const zip = p.DISPLAY_ZIP_CODE == null ? null : String(p.DISPLAY_ZIP_CODE).padStart(5, '0');
    const address = [String(p.ADDRESS).trim(), city, String(p.STATE_CODE || state).trim(), zip].filter(Boolean).join(', ');
    const latValue = p.MAP_LATITUDE ?? feature.geometry?.y;
    const lngValue = p.MAP_LONGITUDE ?? feature.geometry?.x;
    const lat = latValue == null ? null : Number(latValue);
    const lng = lngValue == null ? null : Number(lngValue);
    const objectId = Number(p.OBJECTID);
    if (!Number.isInteger(objectId) || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    const sourceUrl = `${this.inventoryUrl}/query?${new URLSearchParams({ where: `CASE_NUM = '${caseNum}'`, outFields: '*', f: 'pjson' })}`;
    const observedAt = new Date().toISOString();
    return {
      id: `HUD-${caseNum.replace(/[^a-zA-Z0-9-]/g, '')}`,
      state: String(p.STATE_CODE || state).trim(), county: null, city, zip, address,
      lat, lng,
      openingBid: null, estLow: null, estHigh: null, assessed: null,
      saleDate: null, plaintiff: 'U.S. Department of Housing and Urban Development',
      defendant: null, judgment: null, attorney: null, occupancy: null, deposit: null,
      auctionProgram: 'HUD REO', lifecycleStatus: 'publicly_listed', transactionOutcome: null,
      hasDocuments: null, status: 'active',
      sourceUrl,
      raw: JSON.stringify(feature),
      provenance: {
        origin: 'live', observed: true, publisher: 'HUD eGIS — Single Family REO',
        recordId: caseNum, objectId, caseStepNumber: 6,
        observedStatus: 'publicly listed', sourceLayer: this.inventoryUrl,
        sourceFacts: { auctionProgram: 'HUD REO', lifecycleStatus: 'publicly_listed', transactionOutcome: null, hasDocuments: null },
        coordinates: { lat, lng, origin: 'publisher_record', verification: 'source_extracted', sourceRecordUrl: sourceUrl, observedAt },
      },
      sourceObservedAt: observedAt,
    };
  }

  async fetchDataGridPage(state, pageNo) {
    const url = `${this.baseUrl}/Home/DataGrid?state=${encodeURIComponent(state)}&pageNo=${pageNo}&pageSize=${this.pageSize}`;
    const payload = await this.requestText(url, { headers: this.jsonHeaders() });
    let data;
    try { data = JSON.parse(payload); } catch (error) {
      const htmlItems = this.parseHtmlCards(payload, state);
      if (htmlItems.length > 0) return { items: htmlItems, hasMore: false };
      const parseError = new Error(`HUD DataGrid returned neither JSON nor property rows for ${state} page ${pageNo}`);
      parseError.cause = error;
      throw parseError;
    }
    const items = this.extractJsonItems(data);
    if (!Array.isArray(items)) throw new Error(`HUD DataGrid JSON schema has no recognized listing array for ${state} page ${pageNo}`);
    return { items, hasMore: this.hasMorePages(data, items.length, pageNo) };
  }

  async fetchStateHtml(state, primaryError) {
    const searchUrl = `${this.baseUrl}/Home/Index?state=${state}`;
    try {
      const html = await this.requestText(searchUrl, { headers: this.htmlHeaders() });
      return this.parseHtmlCards(html, state);
    } catch (err) {
      const combined = new Error(`HUD DataGrid and HTML fallback both failed for ${state}: ${this.errorSummary(primaryError)}; ${this.errorSummary(err)}`);
      combined.cause = err;
      throw combined;
    }
  }

  extractJsonItems(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return null;
    for (const key of ['aaData', 'data', 'rows', 'properties', 'results', 'items']) {
      if (Array.isArray(data[key])) return data[key];
    }
    if (data.d && typeof data.d === 'object') return this.extractJsonItems(data.d);
    return null;
  }

  hasMorePages(data, itemCount, pageNo) {
    if (pageNo >= this.maxPagesPerState) return false;
    if (data && typeof data === 'object') {
      for (const key of ['hasMore', 'hasNextPage', 'more']) {
        if (typeof data[key] === 'boolean') return data[key];
      }
      const total = ['iTotalRecords', 'recordsTotal', 'total', 'totalCount', 'totalRecords']
        .map((key) => Number(data[key]))
        .find(Number.isFinite);
      if (Number.isFinite(total)) return pageNo * this.pageSize < total;
    }
    return itemCount === this.pageSize;
  }

  jsonHeaders() {
    return { 'User-Agent': 'property-crawl-bot/2.0 (research; contact: ops@property-crawl.example)', Accept: 'application/json, text/html, */*' };
  }

  htmlHeaders() {
    return { 'User-Agent': 'property-crawl-bot/2.0 (research; contact: ops@property-crawl.example)', Accept: 'text/html,application/xhtml+xml' };
  }

  createRunReport(states) {
    const scope = { endpoint: this.inventoryUrl ? `${this.inventoryUrl}/query` : '/Home/DataGrid', states, pageSize: this.pageSize, maxPagesPerState: this.maxPagesPerState };
    if (this.inventoryUrl) scope.filter = 'CASE_STEP_NUMBER = 6';
    return { source: 'hud', startedAt: new Date().toISOString(), configuredStates: states, scope, statesAttempted: 0, statesWithListings: 0, statesEmpty: 0, statesFailed: 0, fallbackStates: 0, pagesAttempted: 0, pagesFetched: 0, sourceRows: 0, malformedRows: 0, listingsParsed: 0, listingsEmitted: 0, failures: [], outcome: 'running', truncated: states.length < this.states.length };
  }

  errorSummary(error) {
    return error instanceof Error ? error.message : String(error);
  }

  parseHtmlCards(html, state) {
    const listings = [];
    const cardRegex = /<tr[^>]*class="[^"]*property-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
      const row = match[1];
      const caseMatch = row.match(/Case\s*#?:\s*([0-9-]+)/i);
      const addressMatch = row.match(/class="[^"]*prop-address[^"]*"[^>]*>([^<]+)<\//i);
      const priceMatch = row.match(/\$([0-9,]+)/);

      if (addressMatch && caseMatch) {
        const address = addressMatch[1].trim();
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
        const caseNum = caseMatch[1];
        const id = `HUD-${caseNum.replace(/[^a-zA-Z0-9-]/g, '')}`;

        listings.push({
          id,
          state,
          county: null,
          city: null,
          zip: null,
          address,
          openingBid: price,
          estLow: null,
          estHigh: null,
          assessed: null,
          saleDate: null,
          plaintiff: null,
          defendant: null,
          occupancy: null,
          deposit: null,
          sourceUrl: `${this.baseUrl}/Property/PropertyDetails?caseNumber=${encodeURIComponent(caseNum)}`,
          raw: row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
          provenance: { origin: 'live', observed: true, publisher: 'HUD HomeStore', recordId: caseNum },
        });
      }
    }

    return listings;
  }

  mapJsonItem(p, state) {
    const caseNum = p.caseNumber || p.CaseNumber || p.id;
    const price = p.listPrice ?? p.ListPrice ?? p.price ?? null;
    const address = p.address || p.Address || `${p.street || ''}, ${p.city || ''}, ${state} ${p.zip || ''}`.trim();

    if (!caseNum || !address || !address.replace(/[\s,]/g, '')) return null;

    return {
      id: `HUD-${caseNum.replace(/[^a-zA-Z0-9-]/g, '')}`,
      state: p.state || state,
      county: p.county ?? null,
      city: p.city ?? null,
      zip: p.zip ?? p.postalCode ?? null,
      address,
      lat: p.lat ?? p.latitude ?? null,
      lng: p.lng ?? p.longitude ?? null,
      beds: p.bedrooms ?? p.beds ?? null,
      baths: p.bathrooms ?? p.baths ?? null,
      sqft: p.sqft ?? p.squareFeet ?? null,
      year: p.yearBuilt ?? null,
      propType: p.propertyType ?? p.propType ?? null,
      openingBid: price,
      estLow: p.estimatedValueLow ?? null,
      estHigh: p.estimatedValueHigh ?? null,
      assessed: p.assessedValue ?? null,
      saleDate: p.bidsDue ?? p.bidDeadline ?? null,
      plaintiff: null,
      defendant: null,
      judgment: null,
      attorney: p.listingBroker ?? null,
      occupancy: p.occupancy ?? null,
      deposit: p.earnestMoney ?? p.deposit ?? null,
      photoUrl: p.photoUrl ?? p.imageUrl ?? null,
      sourceUrl: p.url
        ? (p.url.startsWith('http') ? p.url : `${this.baseUrl}${p.url}`)
        : `${this.baseUrl}/Property/PropertyDetails?caseNumber=${encodeURIComponent(caseNum)}`,
      raw: JSON.stringify(p),
      provenance: { origin: 'live', observed: true, publisher: 'HUD HomeStore', recordId: String(caseNum) },
    };
  }


  getVerifiedInventory() {
    return this.markFixtureInventory([
      {
        id: 'HUD-411-998214',
        state: 'OH',
        county: 'Franklin',
        city: 'Columbus',
        zip: '43207',
        address: '892 S Champion Ave, Columbus, OH 43207',
        lat: 39.945,
        lng: -82.971,
        beds: 3,
        baths: 1,
        sqft: 1180,
        year: 1952,
        propType: 'Single Family',
        openingBid: 52000,
        estLow: 118000,
        estHigh: 139000,
        assessed: 94000,
        saleDate: new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0],
        plaintiff: 'U.S. Dept of Housing and Urban Development (HUD)',
        defendant: '—',
        judgment: 0,
        attorney: 'HUD Registered Listing Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money via HUD HomeStore portal',
        photo: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80',
        sourceUrl: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=411-998214',
        raw: 'HUD CASE 411-998214: 892 S Champion Ave, Columbus OH 43207. List price $52,000. Owner-occupant exclusive bidding period active through HUD HomeStore.'
      },
      {
        id: 'HUD-491-384102',
        state: 'TX',
        county: 'Tarrant',
        city: 'Fort Worth',
        zip: '76119',
        address: '4721 Timberline Dr, Fort Worth, TX 76119',
        lat: 32.684,
        lng: -97.262,
        beds: 3,
        baths: 2,
        sqft: 1420,
        year: 1974,
        propType: 'Single Family',
        openingBid: 68000,
        estLow: 145000,
        estHigh: 170000,
        assessed: 128000,
        saleDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
        plaintiff: 'U.S. Dept of Housing and Urban Development (HUD)',
        defendant: '—',
        judgment: 0,
        attorney: 'HUD Registered Listing Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money via HUD HomeStore portal',
        photo: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80',
        sourceUrl: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=491-384102',
        raw: 'HUD CASE 491-384102: 4721 Timberline Dr, Fort Worth TX 76119. List $68,000. FHA 203(k) eligible single family home.'
      },
      {
        id: 'HUD-091-772184',
        state: 'IL',
        county: 'Cook',
        city: 'Chicago',
        zip: '60622',
        address: '1438 N Paulina St, Chicago, IL 60622',
        lat: 41.908,
        lng: -87.669,
        beds: 3,
        baths: 1.5,
        sqft: 1350,
        year: 1928,
        propType: 'Single Family',
        openingBid: 115000,
        estLow: 230000,
        estHigh: 265000,
        assessed: 195000,
        saleDate: new Date(Date.now() + 12 * 86400000).toISOString().split('T')[0],
        plaintiff: 'U.S. Dept of Housing and Urban Development (HUD)',
        defendant: '—',
        judgment: 0,
        attorney: 'HUD Registered Listing Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money via HUD HomeStore portal',
        photo: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80',
        sourceUrl: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=091-772184',
        raw: 'HUD CASE 091-772184: 1438 N Paulina St, Chicago IL 60622. List $115,000. Owner occupant period active.'
      },
      {
        id: 'HUD-105-829143',
        state: 'GA',
        county: 'Fulton',
        city: 'Atlanta',
        zip: '30315',
        address: '2840 Lakewood Ave SW, Atlanta, GA 30315',
        lat: 33.702,
        lng: -84.408,
        beds: 3,
        baths: 2,
        sqft: 1280,
        year: 1958,
        propType: 'Single Family',
        openingBid: 58000,
        estLow: 135000,
        estHigh: 160000,
        assessed: 110000,
        saleDate: new Date(Date.now() + 9 * 86400000).toISOString().split('T')[0],
        plaintiff: 'U.S. Dept of Housing and Urban Development (HUD)',
        defendant: '—',
        judgment: 0,
        attorney: 'HUD Registered Listing Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money via HUD HomeStore portal',
        photo: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
        sourceUrl: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=105-829143',
        raw: 'HUD CASE 105-829143: 2840 Lakewood Ave SW, Atlanta GA 30315. List $58,000. Insured with escrow.'
      },
      {
        id: 'HUD-093-619284',
        state: 'PA',
        county: 'Allegheny',
        city: 'Pittsburgh',
        zip: '15206',
        address: '7312 Lemington Ave, Pittsburgh, PA 15206',
        lat: 40.468,
        lng: -79.902,
        beds: 3,
        baths: 1,
        sqft: 1220,
        year: 1940,
        propType: 'Single Family',
        openingBid: 45000,
        estLow: 110000,
        estHigh: 132000,
        assessed: 88000,
        saleDate: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
        plaintiff: 'U.S. Dept of Housing and Urban Development (HUD)',
        defendant: '—',
        judgment: 0,
        attorney: 'HUD Registered Listing Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money via HUD HomeStore portal',
        photo: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
        sourceUrl: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=093-619284',
        raw: 'HUD CASE 093-619284: 7312 Lemington Ave, Pittsburgh PA 15206. List $45,000. HUD HomeStore direct listing.'
      },
      {
        id: 'HUD-095-551029',
        state: 'MI',
        county: 'Wayne',
        city: 'Detroit',
        zip: '48219',
        address: '18420 Trinity St, Detroit, MI 48219',
        lat: 42.428,
        lng: -83.255,
        beds: 3,
        baths: 1.5,
        sqft: 1150,
        year: 1951,
        propType: 'Single Family',
        openingBid: 32000,
        estLow: 88000,
        estHigh: 108000,
        assessed: 72000,
        saleDate: new Date(Date.now() + 11 * 86400000).toISOString().split('T')[0],
        plaintiff: 'U.S. Dept of Housing and Urban Development (HUD)',
        defendant: '—',
        judgment: 0,
        attorney: 'HUD Registered Listing Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money via HUD HomeStore portal',
        photo: 'https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=800&q=80',
        sourceUrl: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=095-551029',
        raw: 'HUD CASE 095-551029: 18420 Trinity St, Detroit MI 48219. List $32,000. FHA uninsured repair escrow required.'
      },
      {
        id: 'HUD-092-441829',
        state: 'FL',
        county: 'Duval',
        city: 'Jacksonville',
        zip: '32206',
        address: '312 W 10th St, Jacksonville, FL 32206',
        lat: 30.352,
        lng: -81.658,
        beds: 3,
        baths: 2,
        sqft: 1310,
        year: 1968,
        propType: 'Single Family',
        openingBid: 48000,
        estLow: 120000,
        estHigh: 142000,
        assessed: 98000,
        saleDate: new Date(Date.now() + 13 * 86400000).toISOString().split('T')[0],
        plaintiff: 'U.S. Dept of Housing and Urban Development (HUD)',
        defendant: '—',
        judgment: 0,
        attorney: 'HUD Registered Listing Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money via HUD HomeStore portal',
        photo: 'https://images.unsplash.com/photo-1598228723793-52759bba239c?w=800&q=80',
        sourceUrl: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=092-441829',
        raw: 'HUD CASE 092-441829: 312 W 10th St, Jacksonville FL 32206. List $48,000. Owner occupant period active.'
      },
      {
        id: 'HUD-381-662910',
        state: 'NC',
        county: 'Mecklenburg',
        city: 'Charlotte',
        zip: '28208',
        address: '2415 Rozzelles Ferry Rd, Charlotte, NC 28208',
        lat: 35.248,
        lng: -80.865,
        beds: 3,
        baths: 2,
        sqft: 1400,
        year: 1960,
        propType: 'Single Family',
        openingBid: 62000,
        estLow: 150000,
        estHigh: 180000,
        assessed: 130000,
        saleDate: new Date(Date.now() + 17 * 86400000).toISOString().split('T')[0],
        plaintiff: 'U.S. Dept of Housing and Urban Development (HUD)',
        defendant: '—',
        judgment: 0,
        attorney: 'HUD Registered Listing Broker',
        occupancy: 'Vacant',
        deposit: '$1,000 earnest money via HUD HomeStore portal',
        photo: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800&q=80',
        sourceUrl: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=381-662910',
        raw: 'HUD CASE 381-662910: 2415 Rozzelles Ferry Rd, Charlotte NC 28208. List $62,000. Exclusive bidding period active.'
      }
    ], 'hud-embedded-demo');
  }

}

const hudHomeScraper = new HudHomeScraper({ inventoryUrl: HUD_REO_LAYER });
module.exports = hudHomeScraper;
module.exports.HudHomeScraper = HudHomeScraper;
module.exports.HudScrapeError = HudScrapeError;
module.exports.ALL_HUD_JURISDICTIONS = ALL_HUD_JURISDICTIONS;
module.exports.HUD_REO_LAYER = HUD_REO_LAYER;
