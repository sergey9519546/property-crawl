// server/scrapers/hud.js
//
// U.S. Department of Housing and Urban Development (HUD) REO Scraper.
// Source: https://www.hudhomestore.gov
//
// Scrapes single-family HUD homes offered through HUD HomeStore.

const BaseScraper = require('./base');
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');
const crypto = require('node:crypto');
const { mapWithConcurrency } = require('./http');
const { ScraperResponseError } = require('./circuit-breaker');
const { buildDocumentReferences } = require('./document-reference');

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
const CHECKPOINT_VERSION = 1;
const MAX_CHECKPOINT_BYTES = 16_384;

function scopeHash(scope) {
  return crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}

function encodeCheckpoint(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCheckpoint(token) {
  if (token == null || token === '') return null;
  if (typeof token !== 'string' || token.length > MAX_CHECKPOINT_BYTES) throw new Error('HUD checkpoint continuation token is malformed');
  let value;
  try { value = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')); } catch (_) {
    throw new Error('HUD checkpoint continuation token is malformed');
  }
  const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
  if (!value || keys.join(',') !== 'completedStates,nextPages,scopeHash,v' ||
      value.v !== CHECKPOINT_VERSION || !/^[a-f0-9]{64}$/.test(value.scopeHash) ||
      !Array.isArray(value.completedStates) || !value.nextPages || typeof value.nextPages !== 'object' || Array.isArray(value.nextPages)) {
    throw new Error('HUD checkpoint continuation token is malformed');
  }
  return value;
}

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
    // Accept either the ArcGIS layer URL or its query endpoint, but keep one
    // canonical layer base so requests and scope evidence never gain /query/query.
    this.inventoryUrl = options.inventoryUrl ? String(options.inventoryUrl).replace(/\/query\/?$/i, '').replace(/\/$/, '') : null;
    this.states = configuredStates(options.states ?? process.env.HUD_STATES);
    this.maxStates = positiveInt(options.maxStates ?? process.env.HUD_MAX_STATES, this.states.length, ALL_HUD_JURISDICTIONS.length);
    this.maxPagesPerState = positiveInt(options.maxPagesPerState ?? process.env.HUD_MAX_PAGES_PER_STATE, DEFAULT_MAX_PAGES_PER_STATE, 10);
    this.pageSize = positiveInt(options.pageSize ?? process.env.HUD_PAGE_SIZE, DEFAULT_PAGE_SIZE, 100);
    this.stateConcurrency = positiveInt(options.stateConcurrency ?? process.env.HUD_STATE_CONCURRENCY, DEFAULT_STATE_CONCURRENCY, 4);
    this.lastRunReport = null;
    this.checkpointToken = null;
    this.sweepStartedAt = null;
    this.pagesCommitted = 0;
    this.useScrapling = options.useScrapling ?? isScraplingEnabled('hud');
    this.extract = options.extractImpl || extractWithScrapling;
  }

  checkpointScope() {
    return this.getCollectionScope();
  }

  getCollectionScope() {
    return {
      endpoint: this.inventoryUrl ? `${this.inventoryUrl}/query` : new URL('/Home/DataGrid', this.baseUrl).toString(),
      states: this.states,
      pageSize: this.pageSize,
      filters: this.inventoryUrl ? { caseStepNumber: 6 } : {},
    };
  }

  checkpointState() {
    const decoded = decodeCheckpoint(this.checkpointToken);
    const scope = this.checkpointScope();
    if (!decoded) return { scope, completedStates: new Set(), nextPages: {} };
    if (decoded.scopeHash !== scopeHash(scope)) throw new Error('HUD checkpoint scope does not match this collector configuration');
    const known = new Set(this.states);
    const completedStates = new Set(decoded.completedStates);
    if (completedStates.size !== decoded.completedStates.length ||
        [...completedStates].some((state) => !known.has(state)) ||
        Object.keys(decoded.nextPages).some((state) => !known.has(state) || completedStates.has(state)) ||
        Object.values(decoded.nextPages).some((page) => !Number.isSafeInteger(page) || page < 1 || page > 1_000_000)) {
      throw new Error('HUD checkpoint continuation token is malformed');
    }
    if (completedStates.size === this.states.length && Object.keys(decoded.nextPages).length === 0) {
      throw new Error('HUD checkpoint continuation token is already exhausted');
    }
    return { scope, completedStates, nextPages: { ...decoded.nextPages } };
  }

  setCheckpoint(checkpoint) {
    this.checkpointToken = checkpoint?.continuationToken ?? null;
    this.sweepStartedAt = typeof checkpoint?.sweepStartedAt === 'string' ? checkpoint.sweepStartedAt : null;
    this.pagesCommitted = Math.max(0, Math.floor(Number(checkpoint?.pagesCommitted) || 0));
    return this;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      if (this.states.length === 0) throw new HudScrapeError('No valid HUD jurisdictions configured', this.createRunReport([]));
      const checkpoint = this.checkpointState();
      const pendingStates = this.states.filter((state) => !checkpoint.completedStates.has(state));
      const states = pendingStates.slice(0, this.maxStates);
      const report = this.createRunReport(this.states);
      report.sweepStartedAt = this.sweepStartedAt || report.startedAt;
      report.pagesPreviouslyCommitted = this.pagesCommitted;
      report.statesPreviouslyCompleted = checkpoint.completedStates.size;
      report.attemptedStates = states;
      const results = await mapWithConcurrency(states, this.stateConcurrency,
        (state) => this.fetchStateHudHomes(state, checkpoint.nextPages[state] || 1));
      const allListings = [];
      for (let index = 0; index < results.length; index += 1) {
        const state = states[index];
        const result = results[index];
        report.statesAttempted += 1;
        if (result.status === 'fulfilled') {
          const stateResult = result.value;
          if (stateResult.truncated === true &&
              (!Number.isSafeInteger(stateResult.nextPage) || stateResult.nextPage < 1 || stateResult.nextPage > 1_000_000)) {
            throw new Error(`HUD checkpoint next page is invalid for ${state}`);
          }
          report.pagesAttempted += stateResult.pagesAttempted;
          report.pagesFetched += stateResult.pagesFetched;
          report.sourceRows = stateResult.sourceRows == null || report.sourceRows == null
            ? null : report.sourceRows + stateResult.sourceRows;
          report.malformedRows = stateResult.malformedRows == null || report.malformedRows == null
            ? null : report.malformedRows + stateResult.malformedRows;
          report.fallbackStates += stateResult.usedHtmlFallback ? 1 : 0;
          report.truncated = report.truncated || stateResult.truncated === true;
          if (stateResult.truncated) checkpoint.nextPages[state] = stateResult.nextPage;
          else {
            checkpoint.completedStates.add(state);
            delete checkpoint.nextPages[state];
          }
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
      const remainingStates = this.states.filter((state) => !checkpoint.completedStates.has(state));
      report.completedStates = [...checkpoint.completedStates];
      report.remainingStates = remainingStates;
      report.truncated = remainingStates.length > 0;
      report.outcome = report.statesFailed === report.statesAttempted
        ? 'failed'
        : report.statesFailed > 0
          ? 'partial_failure'
          : standardized.length === 0
            ? 'empty'
            : 'success';
      report.complete = remainingStates.length === 0;
      report.fullSweepComplete = report.complete;
      if (!report.complete) {
        report.nextContinuationToken = encodeCheckpoint({
          v: CHECKPOINT_VERSION,
          scopeHash: scopeHash(checkpoint.scope),
          completedStates: report.completedStates,
          nextPages: checkpoint.nextPages,
        });
      }
      report.fixtureFallbackUsed = false;
      this.lastRunReport = Object.freeze(report);

      if (report.outcome === 'failed') {
        throw new HudScrapeError(`[${this.name}] No HUD state endpoint completed; refusing to treat upstream failure as empty inventory`, this.lastRunReport);
      }
      console.log(`[${this.name}] ${report.outcome}: ${standardized.length} listings from ${report.statesAttempted - report.statesFailed}/${report.statesAttempted} completed jurisdictions`);
      return standardized;
    });
  }

  async fetchStateHudHomes(state, startPage = 1) {
    if (this.inventoryUrl) return this.fetchArcGisState(state, startPage);
    const listings = [];
    let pagesAttempted = 0;
    let pagesFetched = 0;
    let sourceRows = 0;
    let malformedRows = 0;
    try {
      for (let pageIndex = 0; pageIndex < this.maxPagesPerState; pageIndex += 1) {
        const pageNo = startPage + pageIndex;
        pagesAttempted += 1;
        const page = await this.fetchDataGridPage(state, pageNo);
        pagesFetched += 1;
        sourceRows += page.items.length;
        const pageUrl = `${this.baseUrl}/Home/DataGrid?state=${encodeURIComponent(state)}&pageNo=${pageNo}&pageSize=${this.pageSize}`;
      const mappedListings = page.items.map((item) => this.mapJsonItem(item, state, { pageUrl })).filter(Boolean);
        malformedRows += page.items.length - mappedListings.length;
        listings.push(...mappedListings);
        if (!page.hasMore) return { state, listings, pagesAttempted, pagesFetched, sourceRows, malformedRows, usedHtmlFallback: false, truncated: false };
        if (pageIndex + 1 === this.maxPagesPerState) return { state, listings, pagesAttempted, pagesFetched, sourceRows, malformedRows, usedHtmlFallback: false, truncated: true, nextPage: pageNo + 1 };
        await this.crawlJitter();
      }
      return { state, listings, pagesAttempted, pagesFetched, sourceRows, malformedRows, usedHtmlFallback: false, truncated: false };
    } catch (error) {
      if (error instanceof ScraperResponseError && error.haltScraper) throw error;
      if (this.circuitBreaker.isOpen()) throw error;
      // A fallback after any paginated progress cannot prove that it covers
      // the uncommitted suffix. Leave the jurisdiction pending at its prior
      // checkpoint so the committed batch can be replayed safely.
      if (pagesFetched > 0 || startPage > 1) throw error;
      const html = await this.fetchStateHtml(state, error);
      return { state, listings: html, pagesAttempted, pagesFetched, sourceRows: null, malformedRows: null, usedHtmlFallback: true, truncated: false };
    }
  }

  async fetchArcGisState(state, startPage = 1) {
    const listings = [];
    let pagesAttempted = 0;
    let pagesFetched = 0;
    let sourceRows = 0;
    let malformedRows = 0;
    for (let pageIndex = 0; pageIndex < this.maxPagesPerState; pageIndex += 1) {
      const pageNo = startPage + pageIndex;
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
        const listing = this.mapArcGisFeature(feature, state, { pageUrl: `${this.inventoryUrl}/query?${query}` });
        if (listing) listings.push(listing);
        else malformedRows += 1;
      }
      const hasMore = data.exceededTransferLimit === true || data.features.length === this.pageSize;
      if (!hasMore) return { state, listings, pagesAttempted, pagesFetched, sourceRows, malformedRows, usedHtmlFallback: false, truncated: false };
      if (pageIndex + 1 === this.maxPagesPerState) return { state, listings, pagesAttempted, pagesFetched, sourceRows, malformedRows, usedHtmlFallback: false, truncated: true, nextPage: pageNo + 1 };
      await this.crawlJitter();
    }
    return { state, listings, pagesAttempted, pagesFetched, sourceRows, malformedRows, usedHtmlFallback: false, truncated: false };
  }

  // Build the sourceFacts.documents array for a HUD listing. Only URLs the
  // scraper actually observed are surfaced — never construct per-listing
  // detail URLs that the scraper did not visit.
  //
  // Inputs:
  //   observedAt      timestamp stamped on each document
  //   pageUrl         the page-level URL the scraper visited that contained
  //                   this listing (ArcGIS feature-layer page query, HUD
  //                   HomeStore DataGrid page, etc.). Surfaced as 'parcel'
  //                   so the document-evidence pipeline can render the
  //                   publisher's authoritative listing page.
  //   perListingUrl   a per-listing URL the publisher itself included in the
  //                   fetched payload (e.g. the JSON item's p.url). When
  //                   present, surfaced as 'detail'.
  //
  // Returns: Array of normalized references (already filtered by buildDocumentReferences).
  mapArcGisFeature(feature, state, options = {}) {
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
    const documents = buildDocumentReferences([
      options.pageUrl && { kind: 'parcel', url: options.pageUrl, label: `HUD REO ${state} feature page (OBJECTID ${objectId})` },
      options.perListingUrl && { kind: 'detail', url: options.perListingUrl, label: `HUD REO detail (${caseNum})` }
    ], { observedAt });
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
        sourceFacts: {
          auctionProgram: 'HUD REO',
          lifecycleStatus: 'publicly_listed',
          transactionOutcome: null,
          hasDocuments: documents.length > 0,
          ...(documents.length > 0 ? { documents } : {})
        },
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
      const htmlItems = this.useScrapling
        ? await this.parseCardsWithScrapling(payload, state, url)
        : this.parseHtmlCards(payload, state, url);
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
      if (this.useScrapling) return this.parseCardsWithScrapling(html, state, searchUrl);
      return this.parseHtmlCards(html, state, searchUrl);
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
    const scope = { ...this.getCollectionScope(), states, maxPagesPerState: this.maxPagesPerState };
    return { source: 'hud', startedAt: new Date().toISOString(), configuredStates: states, scope, statesAttempted: 0, statesWithListings: 0, statesEmpty: 0, statesFailed: 0, fallbackStates: 0, pagesAttempted: 0, pagesFetched: 0, sourceRows: 0, malformedRows: 0, listingsParsed: 0, listingsEmitted: 0, failures: [], outcome: 'running', truncated: states.length < this.states.length };
  }

  errorSummary(error) {
    return error instanceof Error ? error.message : String(error);
  }

  parseHtmlCards(html, state, sourceUrl = null) {
    return this.parseHtmlCardsNative(html, state, sourceUrl);
  }

  async parseCardsWithScrapling(html, state, sourceUrl) {
    if (!html || !html.length) return [];
    let evidence;
    try {
      evidence = await this.extract('hud-cards', { html, url: sourceUrl });
    } catch (_) {
      return [];
    }
    const extracted = Array.isArray(evidence?.items) ? evidence.items : [];
    return extracted.map((item) => this.mapScraplingCard(item, state, sourceUrl)).filter(Boolean);
  }

  mapScraplingCard(item, state, sourceUrl) {
    const caseNum = String(item.caseNumber || '').trim();
    if (!caseNum) return null;
    const id = `HUD-${caseNum.replace(/[^a-zA-Z0-9-]/g, '')}`;
    const address = String(item.address || '').trim();
    const openingBid = Number.isFinite(item.currentBid) ? item.currentBid : null;
    const documents = buildDocumentReferences([
      sourceUrl && { kind: 'parcel', url: sourceUrl, label: `HUD HomeStore ${state} listings index (Scrapling)` }
    ], { observedAt: new Date().toISOString() });
    return {
      id,
      state,
      county: null,
      city: null,
      zip: null,
      address,
      openingBid,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate: null,
      plaintiff: null,
      defendant: null,
      occupancy: null,
      deposit: null,
      sourceUrl: sourceUrl || `${this.baseUrl}/Property/PropertyDetails?caseNumber=${encodeURIComponent(caseNum)}`,
      raw: `caseNumber=${caseNum};address=${address};currentBid=${openingBid}`,
      provenance: {
        origin: 'live',
        observed: true,
        publisher: 'HUD HomeStore',
        recordId: caseNum,
        sourceFacts: sourceUrl
          ? (documents.length > 0
              ? { documents, hasDocuments: true, extractedFromUrl: sourceUrl }
              : { hasDocuments: false, extractedFromUrl: sourceUrl })
          : { hasDocuments: false }
      }
    };
  }

  parseHtmlCardsNative(html, state, sourceUrl = null) {
    const listings = [];
    const cardRegex = /<tr[^>]*class="[^"]*property-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;
    const observedAt = new Date().toISOString();

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
        const documents = buildDocumentReferences([
          sourceUrl && { kind: 'parcel', url: sourceUrl, label: `HUD HomeStore ${state} listings index` }
        ], { observedAt });

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
          provenance: {
            origin: 'live',
            observed: true,
            publisher: 'HUD HomeStore',
            recordId: caseNum,
            sourceFacts: documents.length > 0
              ? { documents, hasDocuments: true }
              : { hasDocuments: false }
          },
        });
      }
    }

    return listings;
  }

  mapJsonItem(p, state, options = {}) {
    const caseNum = p.caseNumber || p.CaseNumber || p.id;
    const price = p.listPrice ?? p.ListPrice ?? p.price ?? null;
    const address = p.address || p.Address || `${p.street || ''}, ${p.city || ''}, ${state} ${p.zip || ''}`.trim();

    if (!caseNum || !address || !address.replace(/[\s,]/g, '')) return null;

    // Resolve the publisher-supplied per-listing URL only when it points at
    // the publisher's host. A foreign URL in p.url would let a publisher
    // payload promote attacker-controlled links into our listing — drop it.
    const candidatePerListingUrl = typeof p.url === 'string' && p.url.trim()
      ? (p.url.startsWith('http') ? p.url : `${this.baseUrl}${p.url}`)
      : null;
    let perListingUrl = null;
    if (candidatePerListingUrl) {
      try {
        const parsed = new URL(candidatePerListingUrl);
        if (parsed.hostname === 'www.hudhomestore.gov' || parsed.hostname === 'hudhomestore.gov') {
          perListingUrl = parsed.toString();
        }
      } catch (_) { perListingUrl = null; }
    }
    const observedAt = new Date().toISOString();
    const documents = buildDocumentReferences([
      options.pageUrl && { kind: 'parcel', url: options.pageUrl, label: `HUD HomeStore ${state} DataGrid page` },
      perListingUrl && { kind: 'detail', url: perListingUrl, label: `HUD HomeStore detail (${caseNum})` }
    ], { observedAt });

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
      sourceUrl: perListingUrl || `${this.baseUrl}/Property/PropertyDetails?caseNumber=${encodeURIComponent(caseNum)}`,
      raw: JSON.stringify(p),
      provenance: {
        origin: 'live',
        observed: true,
        publisher: 'HUD HomeStore',
        recordId: String(caseNum),
        sourceFacts: {
          auctionProgram: 'HUD REO',
          ...(documents.length > 0 ? { documents, hasDocuments: true } : { hasDocuments: false })
        }
      },
    };
  }


  // Demo/Unsplash inventory overrides removed (2026-09-14 audit).
  // Live collectors must not fabricate listings; BaseScraper may still read
  // data/listings.snapshot.json as explicitly labeled fixture evidence.

}

const hudHomeScraper = new HudHomeScraper({ inventoryUrl: HUD_REO_LAYER });
module.exports = hudHomeScraper;
module.exports.HudHomeScraper = HudHomeScraper;
module.exports.HudScrapeError = HudScrapeError;
module.exports.ALL_HUD_JURISDICTIONS = ALL_HUD_JURISDICTIONS;
module.exports.HUD_REO_LAYER = HUD_REO_LAYER;
