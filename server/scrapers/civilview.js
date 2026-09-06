// CivilView (Tyler Technologies) sheriff-sale scraper.
//
// CivilView's county search page is a discovery surface, not a record URL.
// Each row contains a /Sales/SaleDetails?PropertyId=... link. Detail pages
// require the ASP.NET session cookie established by the county search request,
// so this scraper keeps that cookie while enriching a bounded, polite sample.
//
// Data-integrity policy:
//   - Only emit records backed by a successfully parsed detail page.
//   - Only use CivilView's published "Approx. Upset" as openingBid; preserve
//     the exact record with a null bid when that amount has not been published.
//   - Unknown facts remain null; no hashes, stock photos, inferred valuations,
//     geocodes, property attributes, or future dates are generated.
//   - Preserve the exact detail URL, source fields, and status history as
//     provenance so downstream consumers can distinguish published facts.

const BaseScraper = require('./base');
const { ScraperResponseError } = require('./circuit-breaker');
const { normalizeOcrText } = require('../ai/notice-parser');

const DETAIL_PATH = '/Sales/SaleDetails';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_COUNTIES = 4;
const DEFAULT_DETAIL_LIMIT = 60;

class CivilViewScraper extends BaseScraper {
  constructor(options = {}) {
    super({
      name: 'CivilViewScraper',
      sourceKey: 'civilview',
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries || 3,
    });
    this.baseUrl = options.baseUrl || 'https://salesweb.civilview.com';
    this.targetState = options.targetState || 'NJ';
    this.observedRecordIds = new Set(options.observedRecordIds || []);
    this.maxCounties = this.positiveInt(
      options.maxCounties ?? process.env.CIVILVIEW_MAX_COUNTIES,
      DEFAULT_MAX_COUNTIES,
    );
    this.maxDetailPages = this.positiveInt(
      options.maxDetailPages ?? process.env.CIVILVIEW_DETAIL_LIMIT,
      DEFAULT_DETAIL_LIMIT,
    );
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.random = options.random || Math.random;
    this.sleepImpl = options.sleepImpl || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now || (() => new Date());
    this.userAgent =
      options.userAgent ||
      'property-crawl-bot/2.0 (+https://github.com/property-crawl; contact: ops@property-crawl.example)';
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const counties = await this.fetchCounties();
      const stateCounties = counties.filter((county) => county.state === this.targetState);
      const ordered = this.orderCounties(stateCounties).slice(0, this.maxCounties);

      if (ordered.length === 0) {
        throw new Error(`No CivilView counties found for ${this.targetState}`);
      }

      const report = {
        countiesDiscovered: counties.length,
        countiesAttempted: 0,
        summariesDiscovered: 0,
        detailPagesAttempted: 0,
        detailPagesParsed: 0,
        recordsEmitted: 0,
        newDetailsAttempted: 0,
        refreshDetailsAttempted: 0,
        failures: [],
      };
      const emitted = [];
      const seenPropertyIds = new Set();
      let remainingDetailBudget = this.maxDetailPages;

      for (let index = 0; index < ordered.length; index += 1) {
        const county = ordered[index];
        report.countiesAttempted += 1;
        try {
          const discovered = await this.fetchCountySummaries(county);
          report.summariesDiscovered += discovered.summaries.length;

          const countiesRemaining = ordered.length - index;
          const countyBudget = Math.min(
            discovered.summaries.length,
            Math.ceil(remainingDetailBudget / Math.max(1, countiesRemaining)),
          );
          const selected = this.prioritizeSummaries(discovered.summaries, county).slice(0, countyBudget);

          for (const summary of selected) {
            if (this.circuitBreaker.isOpen()) {
              report.failures.push({
                scope: 'circuit-breaker',
                county: county.name,
                error: 'Circuit breaker opened; remaining detail requests were not attempted',
              });
              break;
            }

            report.detailPagesAttempted += 1;
            if (this.observedRecordIds.has(`CIV-${county.state}-${county.id}-${summary.propertyId}`)) report.refreshDetailsAttempted += 1;
            else report.newDetailsAttempted += 1;
            remainingDetailBudget -= 1;
            await this.crawlJitter();

            try {
              const detailHtml = await this.fetchText(
                summary.detailUrl,
                this.timeoutMs,
                discovered.sessionCookie,
              );
              const listing = this.parseDetailPage(detailHtml, summary);
              if (!listing) {
                throw new Error('Detail page did not contain a CivilView sale record');
              }
              report.detailPagesParsed += 1;

              if (!this.passesFilter(listing)) {
                report.failures.push({
                  scope: 'detail-validation',
                  sourceUrl: summary.detailUrl,
                  error: 'Record omitted: required identity or exact detail evidence is invalid',
                });
                continue;
              }
              if (seenPropertyIds.has(listing.provenance.propertyId)) continue;
              seenPropertyIds.add(listing.provenance.propertyId);
              emitted.push(listing);
            } catch (error) {
              report.failures.push({
                scope: 'detail-fetch',
                sourceUrl: summary.detailUrl,
                error: this.errorMessage(error),
              });
            }
          }
        } catch (error) {
          report.failures.push({
            scope: 'county-fetch',
            county: county.name,
            error: this.errorMessage(error),
          });
        }

        if (remainingDetailBudget <= 0 || this.circuitBreaker.isOpen()) break;
        if (index < ordered.length - 1) await this.crawlJitter();
      }

      report.recordsEmitted = emitted.length;
      report.unattemptedSummaries = Math.max(0, report.summariesDiscovered - report.detailPagesAttempted);
      report.boundedSample = report.unattemptedSummaries > 0 || stateCounties.length > report.countiesAttempted;
      this.lastRunReport = report;

      if (emitted.length === 0) {
        const reason = report.failures[0]?.error || 'No detail-backed records were available';
        throw new Error(`CivilView produced no trustworthy records: ${reason}`);
      }

      console.log(
        `[${this.name}] ${report.recordsEmitted} detail-backed records emitted from ` +
        `${report.summariesDiscovered} summaries; ${report.failures.length} records/requests omitted`,
      );
      return emitted;
    });
  }

  orderCounties(counties) {
    const priority = ['7', '10', '8', '17', '2'];
    const byId = new Map(counties.map((county) => [county.id, county]));
    return [
      ...priority.map((id) => byId.get(id)).filter(Boolean),
      ...counties.filter((county) => !priority.includes(county.id)),
    ];
  }

  prioritizeSummaries(summaries, county) {
    // Preserve publisher order within each group. Never mutate discovery data.
    const known = (summary) => this.observedRecordIds.has(`CIV-${county.state}-${county.id}-${summary.propertyId}`);
    return [...summaries.filter((summary) => !known(summary)), ...summaries.filter(known)];
  }

  async fetchPage(url, timeoutMs = this.timeoutMs, sessionCookie = '') {
    if (this.circuitBreaker.isOpen()) {
      throw new Error(`[${this.name}] request blocked: circuit breaker is OPEN`);
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error(`[${this.name}] fetch implementation is unavailable`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml',
          ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      const body = await response.text();
      const validation = this.circuitBreaker.validateResponse({
        status: response.status,
        body,
        headers: Object.fromEntries(response.headers?.entries?.() || []),
      });
      if (!validation.isValid) {
        throw new ScraperResponseError(`${validation.error} for ${url}`, {
          code: validation.code,
          status: response.status,
          haltScraper: validation.haltScraper,
          circuitRecorded: true,
        });
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

      return {
        body,
        finalUrl: response.url || url,
        sessionCookie: this.cookieHeader(response.headers),
      };
    } catch (error) {
      if (error instanceof ScraperResponseError) throw error;
      if (error?.name === 'AbortError') {
        this.circuitBreaker.trip(`Timeout after ${timeoutMs}ms for ${url}`);
        throw new ScraperResponseError(`TIMEOUT after ${timeoutMs}ms for ${url}`, {
          code: 'UPSTREAM_TIMEOUT',
          circuitRecorded: true,
        });
      }
      this.circuitBreaker.trip(this.errorMessage(error));
      throw new ScraperResponseError(this.errorMessage(error), {
        code: 'UPSTREAM_TRANSPORT_ERROR',
        circuitRecorded: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchText(url, timeoutMs = this.timeoutMs, sessionCookie = '') {
    const page = await this.fetchPage(url, timeoutMs, sessionCookie);
    return page.body;
  }

  async fetchCounties() {
    const page = await this.fetchPage(`${this.baseUrl}/`, this.timeoutMs);
    const linkRe = /href=["'](\/Sales\/SalesSearch\?countyId=(\d+))["'][^>]*>([\s\S]*?)<\/a>/gi;
    const counties = [];
    const seen = new Set();
    let match;
    while ((match = linkRe.exec(page.body)) !== null) {
      const id = match[2];
      if (seen.has(id)) continue;
      seen.add(id);
      const fullName = this.cleanText(match[3]);
      const stateMatch = fullName.match(/,\s*([A-Z]{2})(?:\b|,)/);
      if (!stateMatch) continue;
      const state = stateMatch[1];
      const name = fullName.slice(0, stateMatch.index).trim();
      counties.push({ id, name, state, fullName });
    }
    return counties;
  }

  async fetchCountySummaries(county) {
    const pageUrl = `${this.baseUrl}/Sales/SalesSearch?countyId=${encodeURIComponent(county.id)}`;
    const page = await this.fetchPage(pageUrl, this.timeoutMs);
    const summaries = this.parseSalesTable(page.body, county, pageUrl);
    if (summaries.length > 0 && !page.sessionCookie) {
      throw new Error('CivilView county page did not establish the session required for detail pages');
    }
    return { summaries, sessionCookie: page.sessionCookie, pageUrl };
  }

  async fetchCountyListings(county, detailLimit = this.maxDetailPages) {
    const discovered = await this.fetchCountySummaries(county);
    const listings = [];
    for (const summary of discovered.summaries.slice(0, detailLimit)) {
      await this.crawlJitter();
      const html = await this.fetchText(summary.detailUrl, this.timeoutMs, discovered.sessionCookie);
      const listing = this.parseDetailPage(html, summary);
      if (listing && this.passesFilter(listing)) listings.push(listing);
    }
    return listings;
  }

  parseSalesTable(html, county, pageUrl) {
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    const summaries = [];
    let rowMatch;

    while ((rowMatch = rowRe.exec(html || '')) !== null) {
      const rowHtml = rowMatch[1];
      const linkMatch = rowHtml.match(
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*View\s+Details\s*<\/a>/i,
      );
      if (!linkMatch) continue;
      const detailUrl = this.resolveDetailUrl(linkMatch[1], pageUrl);
      if (!detailUrl) continue;

      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        cells.push({ text: this.cleanText(cellMatch[1]) });
      }
      if (cells.length < 6) continue;
      const dataCells = /View\s+Details/i.test(cells[0].text)
        ? cells.slice(1, 6).map((cell) => cell.text)
        : cells.slice(-5).map((cell) => cell.text);
      if (!dataCells[0] || !dataCells[4]) continue;

      summaries.push(this.toSummary(dataCells, county, pageUrl, detailUrl));
    }
    return summaries;
  }

  toSummary(cells, county, pageUrl, detailUrl) {
    const [sheriffNumber, saleDateRaw, plaintiff, defendant, addressRaw] = cells;
    const propertyId = new URL(detailUrl).searchParams.get('PropertyId');
    return {
      propertyId,
      sheriffNumber: sheriffNumber.trim(),
      saleDateRaw: saleDateRaw.trim(),
      plaintiff: plaintiff.trim(),
      defendant: defendant.trim(),
      addressRaw: addressRaw.trim(),
      parsedAddress: this.parseAddress(addressRaw),
      county,
      countySearchUrl: pageUrl,
      detailUrl,
    };
  }

  parseDetailPage(html, summary) {
    if (!html || !/sale-details-list/i.test(html)) return null;
    const fields = this.parseDetailFields(html);
    const sheriffNumber = this.field(fields, 'sheriff #') || summary.sheriffNumber;
    const courtCaseNumber = this.field(fields, 'court case #');
    const detailAddressRaw = this.field(fields, 'address') || summary.addressRaw;
    const parsedAddress = this.parseAddress(detailAddressRaw);
    const saleDateRaw = this.field(fields, 'sales date') || summary.saleDateRaw;
    const description = normalizeOcrText(this.field(fields, 'description'));
    const propertyNote = normalizeOcrText(this.field(fields, 'property note'));
    const detailUpsetRaw = this.field(fields, 'approx. upset*') || this.field(fields, 'approx. upset');
    const noteUpsetRaw = this.parseLabeledNote(propertyNote, 'GOOD FAITH ESTIMATED UPSET PRICE');
    const upsetRaw = detailUpsetRaw || noteUpsetRaw;
    const openingBid = this.parseMoney(upsetRaw);
    const openingBidSource = detailUpsetRaw
      ? 'CivilView Approx. Upset'
      : noteUpsetRaw
        ? 'CivilView Property Note — Good Faith Estimated Upset Price'
        : null;
    const judgment = this.parseExecutionAmount(description);
    const occupancy = this.parseOccupancy(propertyNote);
    const statusHistory = this.parseStatusHistory(html);
    const propertyId = summary.propertyId || new URL(summary.detailUrl).searchParams.get('PropertyId');
    const sourceObservedAt = new Date(this.now()).toISOString();

    if (!propertyId || !sheriffNumber || !detailAddressRaw) return null;

    const sourceFields = Object.fromEntries(fields.entries());
    return {
      id: `CIV-${summary.county.state}-${summary.county.id}-${propertyId}`,
      source: 'civilview',
      state: parsedAddress.state || summary.county.state,
      county: summary.county.name,
      city: parsedAddress.city || null,
      zip: parsedAddress.zip || null,
      address: this.formatAddress(parsedAddress, detailAddressRaw),
      lat: null,
      lng: null,
      beds: null,
      baths: null,
      sqft: null,
      year: null,
      propType: 'Unknown',
      openingBid: openingBid || null,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate: this.parseSaleDate(saleDateRaw),
      plaintiff: this.field(fields, 'plaintiff') || summary.plaintiff || null,
      defendant: this.field(fields, 'defendant') || summary.defendant || null,
      judgment: judgment || null,
      attorney: this.field(fields, 'attorney') || null,
      occupancy: occupancy || null,
      deposit: null,
      photo: null,
      sourceUrl: summary.detailUrl,
      raw: description || propertyNote || JSON.stringify(sourceFields),
      status: 'scheduled',
      sourceObservedAt,
      provenance: {
        origin: 'live',
        observed: true,
        observedAt: sourceObservedAt,
        recordKind: 'source_record',
        publisher: 'CivilView / participating county sheriff office',
        recordId: propertyId,
        propertyId,
        sheriffNumber,
        courtCaseNumber: courtCaseNumber || null,
        parcelNumber: this.field(fields, 'parcel #') || null,
        countySearchUrl: summary.countySearchUrl,
        detailUrl: summary.detailUrl,
        detailUrlRequiresCountySession: true,
        detailPageFetched: true,
        openingBidSource: openingBid ? openingBidSource : null,
        openingBidSourceNote: openingBid
          ? 'Publisher labels this amount Approx. Upset and states that judgment interest and sheriff fees are excluded.'
          : null,
        statusHistory,
        sourceFields,
      },
    };
  }

  parseDetailFields(html) {
    const fields = new Map();
    const itemRe =
      /<div\b[^>]*class=["'][^"']*\bsale-detail-item\b[^"']*["'][^>]*>[\s\S]*?<div\b[^>]*class=["'][^"']*\bsale-detail-label\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class=["'][^"']*\bsale-detail-value\b[^"']*["'][^>]*>([\s\S]*?)<\/div>[\s\S]*?<\/div>/gi;
    let match;
    while ((match = itemRe.exec(html)) !== null) {
      const label = this.cleanText(match[1]).replace(/\s*:\s*$/, '').toLowerCase();
      const value = this.cleanText(match[2], true);
      if (label && value && !fields.has(label)) fields.set(label, value);
    }
    return fields;
  }

  parseStatusHistory(html) {
    const table = (html || '').match(/<table\b[^>]*id=["']longTable["'][^>]*>([\s\S]*?)<\/table>/i);
    if (!table) return [];
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(table[1])) !== null) {
      const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
        .map((match) => this.cleanText(match[1]));
      if (cells.length >= 2 && cells[0] && cells[1]) {
        rows.push({ status: cells[0], date: this.parseSaleDate(cells[1]) || cells[1] });
      }
    }
    return rows;
  }

  resolveDetailUrl(rawHref, pageUrl) {
    try {
      const decodedHref = this.decodeHtml(rawHref).trim();
      const resolved = new URL(decodedHref, pageUrl);
      const expectedOrigin = new URL(this.baseUrl).origin;
      const propertyId = resolved.searchParams.get('PropertyId');
      if (resolved.origin !== expectedOrigin) return null;
      if (resolved.pathname.toLowerCase() !== DETAIL_PATH.toLowerCase()) return null;
      if (!/^\d+$/.test(propertyId || '')) return null;
      return resolved.href;
    } catch (_) {
      return null;
    }
  }

  cookieHeader(headers) {
    if (!headers) return '';
    const values = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get?.('set-cookie')].filter(Boolean);
    return values
      .map((value) => String(value).split(';', 1)[0].trim())
      .filter(Boolean)
      .join('; ');
  }

  field(fields, name) {
    return fields.get(name.toLowerCase()) || '';
  }

  parseAddress(raw) {
    const clean = this.cleanText(raw, true).replace(/\n+/g, ' ').trim();
    if (!clean) return { street: '', city: '', state: '', zip: '' };
    const stateZip = clean.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
    if (!stateZip) return { street: clean, city: '', state: '', zip: '' };

    const state = stateZip[1];
    const zip = stateZip[2];
    const head = clean.slice(0, stateZip.index).replace(/,+$/, '').trim();
    const tokens = head.split(/\s+/);
    const streetTypes = new Set([
      'AVENUE', 'AVE', 'STREET', 'ST', 'ROAD', 'RD', 'DRIVE', 'DR',
      'BOULEVARD', 'BLVD', 'LANE', 'LN', 'COURT', 'CT', 'PLACE', 'PL',
      'TERRACE', 'TER', 'WAY', 'HIGHWAY', 'HWY', 'PARKWAY', 'PKWY',
      'TRAIL', 'TRL', 'CIRCLE', 'CIR', 'PLAZA', 'PLZ', 'SQUARE', 'SQ',
      'LOOP', 'PATH', 'PIKE', 'ROW', 'RUN', 'PASS', 'CROSSING', 'XING',
    ]);
    let splitIndex = -1;
    for (let index = 0; index < tokens.length; index += 1) {
      if (streetTypes.has(tokens[index].toUpperCase().replace(/[.,]$/, ''))) splitIndex = index;
    }
    if (splitIndex < 0 || splitIndex >= tokens.length - 1) {
      return { street: head, city: '', state, zip };
    }
    return {
      street: tokens.slice(0, splitIndex + 1).join(' '),
      city: tokens.slice(splitIndex + 1).join(' '),
      state,
      zip,
    };
  }

  formatAddress(parsed, raw) {
    if (parsed.street && parsed.city && parsed.state && parsed.zip) {
      return `${parsed.street}, ${parsed.city}, ${parsed.state} ${parsed.zip}`;
    }
    return this.cleanText(raw, true).replace(/\n+/g, ' ').trim();
  }

  parseSaleDate(raw) {
    if (!raw) return null;
    const match = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  }

  parseMoney(raw) {
    if (!raw) return 0;
    const normalized = String(raw).replace(/[$,\s]/g, '');
    const match = normalized.match(/-?\d+(?:\.\d{1,2})?/);
    if (!match) return 0;
    const value = Number(match[0]);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  parseExecutionAmount(description) {
    const match = String(description || '').match(
      /approximate\s+amount\s+due\s+on\s+this\s+execution\s+is\s+(\$[\d,\s]+(?:\.\d{1,2})?)/i,
    );
    return match ? this.parseMoney(match[1]) : 0;
  }

  parseLabeledNote(note, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(note || '').match(new RegExp(`${escaped}\\s*:\\s*([^;]+)`, 'i'));
    return match ? match[1].trim() : '';
  }

  parseOccupancy(note) {
    const raw = this.parseLabeledNote(note, 'OCCUPANCY STATUS');
    if (!raw) return '';
    const known = raw.match(
      /\b(OWNER[ -]?OCCUPIED|TENANT[ -]?OCCUPIED|UNOCCUPIED|VACANT|OCCUPIED|UNKNOWN)\b/i,
    );
    return known ? known[1].toUpperCase().replace('-', ' ') : raw.split(/[.;]/, 1)[0].trim();
  }

  cleanText(html, preserveBreaks = false) {
    const breakReplacement = preserveBreaks ? '\n' : ' ';
    return this.decodeHtml(
      String(html || '')
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, breakReplacement)
        .replace(/<[^>]+>/g, ' '),
    )
      .replace(preserveBreaks ? /[ \t\f\v]+/g : /\s+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
  }

  decodeHtml(value) {
    const named = {
      amp: '&', apos: "'", colon: ':', gt: '>', lt: '<', nbsp: ' ', quot: '"',
    };
    return String(value || '')
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
      .replace(/&([a-z]+);/gi, (token, name) => named[name.toLowerCase()] ?? token);
  }

  passesFilter(item) {
    if (!item) return false;
    if (!/^CIV-[A-Z]{2}-\d+-\d+$/.test(item.id || '')) return false;
    if (item.state !== this.targetState) return false;
    if (!item.address || item.address.length < 8) return false;
    if (item.openingBid != null && (!Number.isFinite(item.openingBid) || item.openingBid <= 0)) return false;
    if (!this.resolveDetailUrl(item.sourceUrl, this.baseUrl)) return false;
    if (!item.provenance?.detailPageFetched) return false;
    return true;
  }

  positiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const civilView = new CivilViewScraper();
module.exports = civilView;
module.exports.CivilViewScraper = CivilViewScraper;
