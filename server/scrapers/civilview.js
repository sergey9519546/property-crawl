// CivilView (Tyler Technologies) sheriff-sale scraper.
//
// CivilView's county search page is a discovery surface, not a record URL.
// Each row contains a /Sales/SaleDetails?PropertyId=... link. Detail pages
// require the ASP.NET session cookie established by the county search request,
// so this scraper keeps that cookie while enriching a bounded, polite sample.
//
// Data-integrity policy:
//   - Only emit records backed by a successfully parsed detail page.
//   - An approximate upset price is a qualified estimate, not an opening bid.
//     Preserve it as a source fact and only map an explicitly labeled opening
//     or minimum bid into openingBid.
//   - Unknown facts remain null; no hashes, stock photos, inferred valuations,
//     geocodes, property attributes, or future dates are generated.
//   - Preserve the exact detail URL, source fields, and status history as
//     provenance so downstream consumers can distinguish published facts.

const BaseScraper = require('./base');
const { ScraperResponseError } = require('./circuit-breaker');
const { readResponseText } = require('./http'); const { autoThrottle, noteRetryAfter, recordHostLatency } = require('./auto-throttle');
const { assertFetchableUrl } = require('./http');
const { normalizeOcrText } = require('../ai/notice-parser');
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');
const { ALL_COUNTY_MAP, NATIONWIDE_COUNTY_MAP } = require('./adapters/civilview');
const { attachParcelIdentity } = require('./normalization');

const DETAIL_PATH = '/Sales/SaleDetails';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_COUNTIES = (process.env.RENDER === 'true' || process.env.NODE_ENV === 'production') ? 8 : 4;
const DEFAULT_DETAIL_LIMIT = (process.env.RENDER === 'true' || process.env.NODE_ENV === 'production') ? 120 : 60;

// Module-scope helpers. These are parsing primitives with no scraper state:
// they are not part of the CivilViewScraper interface.
function decodeHtml(value) {
  const named = {
    amp: '&', apos: "'", colon: ':', gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (token, name) => named[name.toLowerCase()] ?? token);
}

function cleanText(html, preserveBreaks = false) {
  const breakReplacement = preserveBreaks ? '\n' : ' ';
  return decodeHtml(
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

function field(fields, name) {
  return fields.get(name.toLowerCase()) || '';
}

function parseAddress(raw) {
  const lines = cleanText(raw, true)
    .split('\n')
    .map((line) => line.replace(/\s*,+\s*,+/g, ', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    const tail = lines[lines.length - 1];
    const tailMatch = tail.match(/^(.+?)\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/);
    if (tailMatch) {
      const city = tailMatch[1].replace(/^,+|,+$/g, '').trim();
      const street = lines.slice(0, -1).join(' ').replace(/,+$/, '').trim();
      if (street && city) {
        return { street, city, state: tailMatch[2], zip: tailMatch[3] };
      }
    }
  }
  const clean = lines.join(' ').replace(/\s*,+\s*,+/g, ', ').replace(/\s+,/g, ',').trim();
  if (!clean) return { street: '', city: '', state: '', zip: '' };
  const stateZip = clean.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
  if (!stateZip) return { street: clean, city: '', state: '', zip: '' };

  const state = stateZip[1];
  const zip = stateZip[2];
  const head = clean.slice(0, stateZip.index).replace(/,+$/, '').trim();
  const commaIdx = head.lastIndexOf(',');
  if (commaIdx > 0 && commaIdx < head.length - 1) {
    const streetPart = head.slice(0, commaIdx).replace(/,+$/, '').trim();
    const cityPart = head.slice(commaIdx + 1).replace(/^,+/, '').trim();
    if (streetPart && cityPart) {
      return { street: streetPart, city: cityPart, state, zip };
    }
  }
  const tokens = head.split(/\s+/);
  const streetTypes = new Set([
    'AVENUE', 'AVE', 'STREET', 'ST', 'ROAD', 'RD', 'DRIVE', 'DR',
    'BOULEVARD', 'BLVD', 'LANE', 'LN', 'COURT', 'CT', 'PLACE', 'PL',
    'TERRACE', 'TER', 'WAY', 'HIGHWAY', 'HWY', 'PARKWAY', 'PKWY',
    'TRAIL', 'TRL', 'CIRCLE', 'CIR', 'PLAZA', 'PLZ', 'SQUARE', 'SQ',
    'LOOP', 'PATH', 'PIKE', 'ROW', 'RUN', 'PASS', 'CROSSING', 'XING',
    'WALK', 'WLK', 'MEWS', 'ALLEY', 'ALY', 'BEND', 'TRACE', 'TRCE',
    'COVE', 'CV', 'RIDGE', 'RDG',
  ]);
  let splitIndex = -1;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (streetTypes.has(tokens[index].toUpperCase().replace(/[.,]$/, ''))) splitIndex = index;
  }
  if (splitIndex < 0) {
    return { street: head, city: '', state, zip };
  }
  return {
    street: tokens.slice(0, splitIndex + 1).join(' ').replace(/,+$/, '').trim(),
    city: tokens.slice(splitIndex + 1).join(' ').replace(/^,+/, '').trim(),
    state,
    zip,
  };
}

function formatAddress(parsed, raw) {
  if (parsed.street && parsed.city && parsed.state && parsed.zip) {
    return `${parsed.street}, ${parsed.city}, ${parsed.state} ${parsed.zip}`;
  }
  return cleanText(raw, true).replace(/\n+/g, ' ').trim();
}

function parseSaleDate(raw) {
  if (!raw) return null;
  const match = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?$/i);
  if (!match) return null;
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

function parseMoney(raw) {
  if (!raw) return 0;
  const normalized = String(raw).replace(/[$,\s]/g, '');
  const match = normalized.match(/-?\d+(?:\.\d{1,2})?/);
  if (!match) return 0;
  const value = Number(match[0]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function parseExecutionAmount(description) {
  const match = String(description || '').match(
    /approximate\s+amount\s+due\s+on\s+this\s+execution\s+is\s+(\$[\d,\s]+(?:\.\d{1,2})?)/i,
  );
  return match ? parseMoney(match[1]) : 0;
}

function parseDescriptionUpsetMatch(description) {
  const text = String(description || '');
  const patterns = [
    {
      regex: /\bplaintiff\s+upset\s+price\s*[:\-]?\s*(\$[\d,\s]+(?:\.\d{1,2})?)/i,
      source: 'CivilView Description — Plaintiff Upset Price',
    },
    {
      regex: /\bgood\s+faith\s+estimated\s+upset\s+price\s*[:\-]?\s*(\$[\d,\s]+(?:\.\d{1,2})?)/i,
      source: 'CivilView Description — Good Faith Estimated Upset Price',
    },
    {
      regex: /\bapproximate\s+upset\s+price\s+(?:is\s+)?[:\-]?\s*(\$[\d,\s]+(?:\.\d{1,2})?)/i,
      source: 'CivilView Description — Approximate Upset Price',
    },
    {
      regex: /\bupset\s+price\s*[:\-]\s*(\$[\d,\s]+(?:\.\d{1,2})?)/i,
      source: 'CivilView Description — Upset Price',
    },
  ];
  for (const { regex, source } of patterns) {
    const match = text.match(regex);
    if (match) return { raw: match[1].trim(), source };
  }
  return null;
}

function parseLotBlockFromNotice(fields, description, propertyNote) {
  const explicitParcel = field(fields, 'parcel #')
    || field(fields, 'parcel number')
    || field(fields, 'lot/block')
    || field(fields, 'block/lot');
  const prose = [explicitParcel, description, propertyNote].filter(Boolean).join('\n');
  let lot = null;
  let block = null;
  let extractedLabel = explicitParcel || null;

  const knownAsMatch = prose.match(/\bbeing\s+known\s+as\s*[:\-]?\s*(Lot\s+[A-Z0-9.,-]+(?:\s*,\s*Block\s+[A-Z0-9.,-]+))/i);
  if (knownAsMatch && !extractedLabel) {
    extractedLabel = knownAsMatch[1].replace(/\s+/g, ' ').trim();
  }

  const lotThenBlock = prose.match(/\bLOT\s*[:#.]?\s*([A-Z0-9.-]+)\b\s*(?:[,;/]|in|of|\s)+\s*BLOCK\s*[:#.]?\s*([A-Z0-9.-]+)\b/i);
  const blockThenLot = prose.match(/\bBLOCK\s*[:#.]?\s*([A-Z0-9.-]+)\b\s*(?:[,;/]|in|of|\s)+\s*LOT\s*[:#.]?\s*([A-Z0-9.-]+)\b/i);
  if (lotThenBlock) {
    lot = lotThenBlock[1].trim();
    block = lotThenBlock[2].trim();
    if (!extractedLabel) extractedLabel = `Lot ${lot}, Block ${block}`;
  } else if (blockThenLot) {
    block = blockThenLot[1].trim();
    lot = blockThenLot[2].trim();
    if (!extractedLabel) extractedLabel = `Block ${block}, Lot ${lot}`;
  }

  return {
    parcelNumber: extractedLabel || null,
    lotBlock: block && lot ? { block, lot } : null,
  };
}

function parseDimensionsFromNotice(description, propertyNote) {
  const combined = [propertyNote, description].filter(Boolean).join('\n');
  const match = combined.match(/(?:Approximate\s+)?Dimensions(?:\s*\(APPROX\.?\))?\s*[:\-]?\s*([^\n;]{2,80})/i);
  return match ? match[1].replace(/[.\s]+$/, '').trim() : null;
}

function parsePriorLiensFromNotice(description) {
  const match = String(description || '').match(
    /Lien\(s\)\/Taxes\s*:\s*([\s\S]*?)(?:\n\s*Note\s*:|\n\s*Subject\s+to\s+any\s+unpaid|\n\s*If\s+the\s+sale|$)/i,
  );
  if (!match) return { priorLiensNotice: null, priorLiensTotal: null };
  const cleaned = match[1]
    .replace(/^\s*Prior\s+Liens\/Encumbrances\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^(?:n\/a|none|unknown)$/i.test(cleaned)) {
    return { priorLiensNotice: null, priorLiensTotal: null };
  }
  const notice = cleaned.length > 500 ? `${cleaned.slice(0, 497)}...` : cleaned;
  let total = null;
  const totalMatch = notice.match(/TOTAL(?:\s+AS\s+OF[^:$]{0,40})?\s*[:\-]?\s*(\$[\d,\s]+(?:\.\d{1,2})?)/i);
  if (totalMatch) {
    total = parseMoney(totalMatch[1]) || null;
  } else {
    const singleAmounts = [...notice.matchAll(/\$[\d,\s]+(?:\.\d{1,2})?/g)]
      .map((m) => parseMoney(m[0]))
      .filter((n) => n > 0);
    if (singleAmounts.length === 1) total = singleAmounts[0];
  }
  return { priorLiensNotice: notice, priorLiensTotal: total };
}

function parseDocketFromDescription(description) {
  const match = String(description || '').match(/\bDOCKET\s*(?:NO\.?|#)\s*[:\-]?\s*([A-Z0-9-]{3,40})/i);
  return match ? match[1].trim() : null;
}

function deriveStatusFromHistory(statusHistory) {
  if (!Array.isArray(statusHistory) || statusHistory.length === 0) {
    return { status: 'scheduled', lifecycleStatus: 'scheduled', transactionOutcome: null };
  }
  let latestEntry = null;
  let latestMs = -Infinity;
  for (const entry of statusHistory) {
    const label = String(entry?.status || '').trim();
    if (!label) continue;
    const ms = entry?.date ? Date.parse(entry.date) : NaN;
    const rank = Number.isFinite(ms) ? ms : -Infinity;
    if (!latestEntry || rank >= latestMs) {
      latestEntry = label;
      latestMs = rank;
    }
  }
  if (!latestEntry) {
    return { status: 'scheduled', lifecycleStatus: 'scheduled', transactionOutcome: null };
  }
  const normalized = latestEntry.toLowerCase();
  if (/purchased\s*[-:]\s*(?:3rd|third)[-\s]*party|\bsold\b.*\b(?:3rd|third)[-\s]*party/.test(normalized)) {
    return { status: 'sold', lifecycleStatus: latestEntry, transactionOutcome: 'sold_to_third_party' };
  }
  if (/reverted\s+to\s+(?:plaintiff|beneficiary)|purchased\s*[-:]\s*(?:plaintiff|beneficiary)|sold\s*[-:]\s*(?:plaintiff|beneficiary)/.test(normalized)) {
    return { status: 'closed', lifecycleStatus: latestEntry, transactionOutcome: 'reverted_to_plaintiff' };
  }
  if (/cancel|withdraw|dismiss|settl|discontinu/.test(normalized)) {
    return { status: 'cancelled', lifecycleStatus: latestEntry, transactionOutcome: null };
  }
  if (/bankruptc|stay/.test(normalized)) {
    if (/lifted|relief|vacated|exhaust/.test(normalized)) {
      return { status: 'scheduled', lifecycleStatus: latestEntry, transactionOutcome: null };
    }
    return { status: 'stayed', lifecycleStatus: latestEntry, transactionOutcome: null };
  }
  if (/postpon/.test(normalized)) {
    return { status: 'postponed', lifecycleStatus: latestEntry, transactionOutcome: null };
  }
  if (/adjourn/.test(normalized)) {
    return { status: 'adjourned', lifecycleStatus: latestEntry, transactionOutcome: null };
  }
  if (/\bsold\b/.test(normalized)) {
    return { status: 'sold', lifecycleStatus: latestEntry, transactionOutcome: null };
  }
  if (/\bclosed\b|\bauctioned\b|\bpost[-\s]?auction\b/.test(normalized)) {
    return { status: 'closed', lifecycleStatus: latestEntry, transactionOutcome: null };
  }
  return { status: 'scheduled', lifecycleStatus: latestEntry, transactionOutcome: null };
}

function parseDescriptionUpset(description) {
  return parseDescriptionUpsetMatch(description)?.raw || '';
}

function parseLabeledNote(note, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(note || '').match(new RegExp(`${escaped}\\s*:\\s*([^;]+)`, 'i'));
  return match ? match[1].trim() : '';
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCountyOffset(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  if (typeof value === 'object') {
    const candidate = value.countyOffset
      ?? value.cursor
      ?? value.continuationToken
      ?? value.nextCursor
      ?? value.countyRotationOffset;
    return parseCountyOffset(candidate);
  }
  return null;
}

function boundedProjectionText(value, maxLength = 255) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function cookieHeader(headers) {
  if (!headers) return '';
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get?.('set-cookie')].filter(Boolean);
  return values
    .map((value) => String(value).split(';', 1)[0].trim())
    .filter(Boolean)
    .join('; ');
}

function orderCounties(counties) {
  const priority = ['7', '10', '8', '17', '2'];
  const byId = new Map(counties.map((county) => [county.id, county]));
  return [
    ...priority.map((id) => byId.get(id)).filter(Boolean),
    ...counties.filter((county) => !priority.includes(county.id)),
  ];
}

/**
 * Take a bounded window of counties that ADVANCES across runs.
 *
 * orderCounties() is deterministic - the same priority list every time - so
 * slicing its head meant every run re-selected the same four counties and the
 * collector never once reached the other sixty-three it had discovered. That is
 * why the stale CivilView records never refreshed: they sit inside the frozen
 * window, not outside a coverage gap.
 *
 * The scheduler persists a cursor between runs (see hud.js, which carries its
 * sweep position the same way), so the window starts where the previous run
 * stopped and wraps back to the start after the last county.
 */
function rotateCounties(counties, startIndex, limit) {
  if (!Array.isArray(counties) || counties.length === 0) return [];
  const size = Math.max(0, Math.floor(Number(limit) || 0));
  if (size === 0) return [];
  if (size >= counties.length) return [...counties];
  const length = counties.length;
  const start = ((Math.floor(Number(startIndex) || 0) % length) + length) % length;
  const window = [];
  for (let index = 0; index < size; index += 1) {
    window.push(counties[(start + index) % length]);
  }
  return window;
}

function toSummary(cells, county, pageUrl, detailUrl) {
  const [sheriffNumber, saleDateRaw, plaintiff, defendant, addressRaw] = cells;
  const propertyId = new URL(detailUrl).searchParams.get('PropertyId');
  return {
    propertyId,
    sheriffNumber: sheriffNumber.trim(),
    saleDateRaw: saleDateRaw.trim(),
    plaintiff: plaintiff.trim(),
    defendant: defendant.trim(),
    addressRaw: addressRaw.trim(),
    parsedAddress: parseAddress(addressRaw),
    county,
    countySearchUrl: pageUrl,
    detailUrl,
  };
}

function parseDetailFields(html) {
  const fields = new Map();
  const itemRe =
    /<div\b[^>]*class=["'][^"']*\bsale-detail-item\b[^"']*["'][^>]*>[\s\S]*?<div\b[^>]*class=["'][^"']*\bsale-detail-label\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class=["'][^"']*\bsale-detail-value\b[^"']*["'][^>]*>([\s\S]*?)<\/div>[\s\S]*?<\/div>/gi;
  let match;
  while ((match = itemRe.exec(html)) !== null) {
    const label = cleanText(match[1]).replace(/\s*:\s*$/, '').toLowerCase();
    const value = cleanText(match[2], true);
    if (label && value && !fields.has(label)) fields.set(label, value);
  }
  return fields;
}

function parseStatusHistory(html) {
  const table = (html || '').match(/<table\b[^>]*id=["']longTable["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!table) return [];
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(table[1])) !== null) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => cleanText(match[1]));
    if (cells.length >= 2 && cells[0] && cells[1]) {
      rows.push({ status: cells[0], date: parseSaleDate(cells[1]) || cells[1] });
    }
  }
  return rows;
}

class CivilViewScraper extends BaseScraper {
  constructor(options = {}) {
    super({
      name: 'CivilViewScraper',
      sourceKey: 'civilview',
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries || 3,
    });
    this.baseUrl = options.baseUrl || 'https://salesweb.civilview.com';
    this.useScrapling = options.useScrapling ?? isScraplingEnabled('civilview');
    this.extract = options.extractImpl || extractWithScrapling;
    this.targetState = options.targetState ?? process.env.CIVILVIEW_TARGET_STATE ?? 'NJ';
    const configuredCountyId = options.countyId ?? process.env.CIVILVIEW_COUNTY_ID;
    this.countyId = configuredCountyId == null || configuredCountyId === ''
      ? null
      : String(configuredCountyId).trim();
    // Optional comma-separated countyId enrollment for multi-county collection.
    this.extraCountyIds = String(options.extraCountyIds ?? process.env.CIVILVIEW_EXTRA_COUNTIES ?? '')
      .split(',')
      .map((value) => String(value).trim())
      .filter((value) => /^\d+$/.test(value));
    // Nationwide mode: rotate through all published CivilView counties.
    this.nationwide = String(options.nationwide ?? process.env.CIVILVIEW_NATIONWIDE ?? '') === '1'
      || String(options.nationwide ?? process.env.CIVILVIEW_NATIONWIDE ?? '').toLowerCase() === 'true';
    if (!/^[A-Z]{2}$/.test(this.targetState) && !this.nationwide) {
      throw new TypeError('CivilView targetState must be a two-letter uppercase state code');
    }
    if (this.countyId != null && !/^\d+$/.test(this.countyId)) {
      throw new TypeError('CivilView countyId must contain only digits');
    }
    this.observedRecordIds = new Set(
      Array.isArray(options.observedRecordIds)
        ? options.observedRecordIds.map(String)
        : (options.observedRecordIds instanceof Set ? Array.from(options.observedRecordIds, String) : [])
    );
    this.maxCounties = positiveInt(
      options.maxCounties ?? process.env.CIVILVIEW_MAX_COUNTIES,
      DEFAULT_MAX_COUNTIES,
    );
    this.maxDetailPages = positiveInt(
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
    // Which county the next run starts from. Supports options.countyOffset,
    // options.cursor, or options.checkpoint.
    const initialOffset = parseCountyOffset(
      options.countyOffset ?? options.cursor ?? options.continuationToken ?? options.checkpoint
    );
    this.countyRotationOffset = initialOffset != null ? initialOffset : 0;
  }

  /**
   * Accept the rotation cursor the scheduler persisted from the previous run.
   * Matches the shape hud.js uses: the token is an opaque string there and an
   * index here, and anything unparseable restarts the rotation from the top
   * rather than guessing.
   */
  setCheckpoint(checkpoint) {
    const offset = parseCountyOffset(checkpoint);
    this.countyRotationOffset = offset != null ? offset : 0;
    return this;
  }

  async scrapeFeed(options = {}) {
    if (options && typeof options === 'object') {
      const runOffset = parseCountyOffset(
        options.countyOffset ?? options.cursor ?? options.continuationToken ?? options.checkpoint
      );
      if (runOffset != null) this.countyRotationOffset = runOffset;
      if (options.maxCounties) this.maxCounties = positiveInt(options.maxCounties, DEFAULT_MAX_COUNTIES);
      if (options.maxDetailPages) this.maxDetailPages = positiveInt(options.maxDetailPages, DEFAULT_DETAIL_LIMIT);
    }
    return this.executeWithRetry(async () => {
      const report = {
        outcome: 'failed',
        scope: {
          endpoint: '/Sales/SalesSearch',
          filters: this.countyId
            ? { state: this.targetState, countyId: this.countyId }
            : { state: this.targetState, selection: 'bounded-priority-sample' },
        },
        countiesDiscovered: 0,
        countiesAttempted: 0,
        summariesDiscovered: 0,
        detailPagesAttempted: 0,
        detailPagesParsed: 0,
        recordsEmitted: 0,
        recordsAccepted: 0,
        recordsRejected: 0,
        unattemptedSummaries: 0,
        newDetailsAttempted: 0,
        refreshDetailsAttempted: 0,
        failures: [],
        completedCounties: [],
        boundedSample: true,
        truncated: true,
        complete: false,
        fullSweepComplete: false,
      };
      this.lastRunReport = report;
      const counties = await this.fetchCounties();
      report.countiesDiscovered = counties.length;
      // Counties eligible for the rotating window. A run pinned to one county, or
      // given an explicit county list, has nothing to rotate through.
      const stateCounties = counties.filter((county) => county.state === this.targetState);
      const rotationTotal = (this.countyId || this.extraCountyIds.length > 0)
        ? 0
        : (this.nationwide ? counties.length : stateCounties.length);
      let ordered;
      if (this.nationwide) {
        // Bounded sample across all participating states (nationwide set).
        const shuffled = [...counties];
        // Deterministic order: alphabetical by state then name (no RNG dependency).
        shuffled.sort((a, b) => String(a.state || '').localeCompare(String(b.state || '')) || String(a.name || '').localeCompare(String(b.name || '')));
        ordered = rotateCounties(shuffled, this.countyRotationOffset, this.maxCounties);
        report.scope = {
          endpoint: '/Sales/SalesSearch',
          filters: { mode: 'nationwide-participating', maxCounties: this.maxCounties },
        };
      } else {
        const stateCounties = counties.filter((county) => county.state === this.targetState);
        if (this.extraCountyIds.length > 0) {
          const byId = new Map(stateCounties.map((county) => [String(county.id), county]));
          ordered = this.extraCountyIds
            .map((id) => byId.get(id))
            .filter(Boolean);
          if (this.countyId && !this.extraCountyIds.includes(this.countyId)) {
            const primary = byId.get(this.countyId);
            if (primary) ordered = [primary, ...ordered];
          }
        } else if (this.countyId) {
          ordered = stateCounties.filter((county) => String(county.id) === this.countyId);
        } else {
          ordered = rotateCounties(orderCounties(stateCounties), this.countyRotationOffset, this.maxCounties);
        }
      }

      if (ordered.length === 0) {
        throw new Error(this.nationwide
          ? 'CivilView nationwide registry returned no published counties'
          : this.countyId
            ? `CivilView county ${this.countyId} was not published for ${this.targetState}`
            : `No CivilView counties found for ${this.targetState}`);
      }

      const emitted = [];
      const seenPropertyIds = new Set();
      let remainingDetailBudget = this.maxDetailPages;

      for (let index = 0; index < ordered.length; index += 1) {
        const county = ordered[index];
        report.countiesAttempted += 1;
        const failuresBefore = report.failures.length;
        let discoveredCounty = null;
        try {
          const discovered = await this.fetchCountySummaries(county);
          discoveredCounty = discovered;
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
              this.observedRecordIds.add(`CIV-${county.state}-${county.id}-${listing.provenance.propertyId}`);
              if (listing.id) this.observedRecordIds.add(String(listing.id));
              emitted.push(listing);
            } catch (error) {
              report.failures.push({
                scope: 'detail-fetch',
                sourceUrl: summary.detailUrl,
                error: errorMessage(error),
              });
            }
          }
        } catch (error) {
          report.failures.push({
            scope: 'county-fetch',
            county: county.name,
            error: errorMessage(error),
          });
        }

        if (report.failures.length === failuresBefore && discoveredCounty && Array.isArray(discoveredCounty.summaries) && discoveredCounty.summaries.length > 0) {
          report.completedCounties.push({
            state: county.state,
            county: county.name,
            countyId: String(county.id),
            seenIds: [...new Set(
              discoveredCounty.summaries
                .map((summary) => (summary?.propertyId ? `CIV-${county.state}-${county.id}-${summary.propertyId}` : null))
                .filter(Boolean),
            )],
          });
        }
        if (remainingDetailBudget <= 0 || this.circuitBreaker.isOpen()) break;
        if (index < ordered.length - 1) await this.crawlJitter();
      }

      report.recordsEmitted = emitted.length;
      report.unattemptedSummaries = Math.max(0, report.summariesDiscovered - report.detailPagesAttempted);
      report.boundedSample = report.unattemptedSummaries > 0 || (
        !this.countyId && (report.countiesDiscovered || ordered.length) > report.countiesAttempted
      );
      report.recordsAccepted = emitted.length;
      report.recordsRejected = Math.max(0, report.detailPagesAttempted - emitted.length);
      const expectedCounties = ordered.length;
      report.countiesExpected = expectedCounties;
      // Legacy state-sample (no explicit countyId) is never a promotable complete sweep.
      report.truncated = report.unattemptedSummaries > 0 || !this.countyId;
      report.complete = Boolean(
        this.countyId &&
        report.countiesAttempted === expectedCounties &&
        report.failures.length === 0 &&
        report.recordsRejected === 0 &&
        report.unattemptedSummaries === 0,
      );
      report.fullSweepComplete = report.complete;
      // Hand the next start position back so the following run covers different
      // counties. The scheduler persists nextContinuationToken as this source's
      // cursor and feeds it to setCheckpoint before the next scrapeFeed. A null
      // token means the window already covered every county, so the rotation
      // restarts from the priority list rather than staying wedged.
      report.nextContinuationToken = rotationTotal > this.maxCounties
        ? String((this.countyRotationOffset + this.maxCounties) % rotationTotal)
        : null;
      const stoppedAtCountyCap = rotationTotal > this.maxCounties;
      const stoppedAtDetailCap = report.unattemptedSummaries > 0;
      report.partialSweep = Boolean(stoppedAtCountyCap || stoppedAtDetailCap);
      report.nextCursor = report.nextContinuationToken;
      Object.defineProperties(emitted, {
        partialSweep: { value: report.partialSweep, enumerable: false, writable: true, configurable: true },
        nextCursor: { value: report.nextCursor, enumerable: false, writable: true, configurable: true },
        nextContinuationToken: { value: report.nextContinuationToken, enumerable: false, writable: true, configurable: true },
        report: { value: report, enumerable: false, writable: true, configurable: true },
      });
      report.outcome = report.failures.length > 0
        ? 'partial_failure'
        : emitted.length > 0
          ? 'success'
          : 'empty';
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
      await autoThrottle(url); const requestStart = Date.now(); const response = await this.fetchImpl(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml',
          ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      recordHostLatency(url, Date.now() - requestStart); const retryAfter = response.headers?.get?.('retry-after') ?? null; if (retryAfter) noteRetryAfter(url, retryAfter); // redirect: "follow" can land on a private host; re-validate before any
      // body bytes are read so a publisher redirect cannot reach internal
      // services or leak their responses.
      const ssrfCheck = assertFetchableUrl(response.url || url);
      if (!ssrfCheck.ok) {
        throw new ScraperResponseError(`${ssrfCheck.reason} after redirect for ${url} -> ${response.url || '(no final url)'}`, {
          code: ssrfCheck.reason,
          status: response.status,
          haltScraper: false,
          circuitRecorded: false,
        });
      }
      const body = await readResponseText(response, controller.signal);
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
        sessionCookie: cookieHeader(response.headers),
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
      this.circuitBreaker.trip(errorMessage(error));
      throw new ScraperResponseError(errorMessage(error), {
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
      const fullName = cleanText(match[3]);
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
    if (this.useScrapling && typeof this.extract === 'function') {
      try {
        this._lastExtraction = await this.extract('civilview-sales', { html: page.body, url: pageUrl });
      } catch (error) {
        this._lastExtraction = { error: String(error?.message || error), code: error?.code || null };
      }
    }
    const summaries = this.parseSalesTable(page.body, county, pageUrl);
    if (summaries.length > 0 && !page.sessionCookie) {
      throw new Error('CivilView county page did not establish the session required for detail pages');
    }
    return { summaries, sessionCookie: page.sessionCookie, pageUrl };
  }

  async _fetchCountyListings(county, detailLimit = this.maxDetailPages) {
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
      const detailUrl = this._resolveDetailUrl(linkMatch[1], pageUrl);
      if (!detailUrl) continue;

      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        cells.push({ text: cleanText(cellMatch[1]) });
      }
      if (cells.length < 6) continue;
      const dataCells = /View\s+Details/i.test(cells[0].text)
        ? cells.slice(1, 6).map((cell) => cell.text)
        : cells.slice(-5).map((cell) => cell.text);
      if (!dataCells[0] || !dataCells[4]) continue;

      summaries.push(toSummary(dataCells, county, pageUrl, detailUrl));
    }
    return summaries;
  }

  parseDetailPage(html, summary) {
    if (!html || !/sale-details-list/i.test(html)) return null;
    const fields = parseDetailFields(html);
    const sheriffNumber = field(fields, 'sheriff #') || summary.sheriffNumber;
    const rawCourtCaseNumber = field(fields, 'court case #');
    const detailAddressRaw = field(fields, 'address') || summary.addressRaw;
    const parsedAddress = parseAddress(detailAddressRaw);
    const saleDateRaw = field(fields, 'sales date') || summary.saleDateRaw;
    const description = normalizeOcrText(field(fields, 'description'));
    const propertyNote = normalizeOcrText(field(fields, 'property note'));
    const detailUpsetRaw = field(fields, 'approx. upset*') || field(fields, 'approx. upset');
    const noteUpsetRaw = parseLabeledNote(propertyNote, 'GOOD FAITH ESTIMATED UPSET PRICE');
    const courtCaseNumber = rawCourtCaseNumber || parseDocketFromDescription(description);
    const descriptionUpset = parseDescriptionUpsetMatch(description);
    const lotBlockInfo = parseLotBlockFromNotice(fields, description, propertyNote);
    const dimensions = parseDimensionsFromNotice(description, propertyNote);
    const { priorLiensNotice, priorLiensTotal } = parsePriorLiensFromNotice(description);
    const upsetRaw = detailUpsetRaw || noteUpsetRaw || descriptionUpset?.raw || '';
    const approximateUpsetPrice = parseMoney(upsetRaw);
    const approximateUpsetSource = detailUpsetRaw
      ? 'CivilView Approx. Upset'
      : noteUpsetRaw
        ? 'CivilView Property Note — Good Faith Estimated Upset Price'
        : descriptionUpset?.raw
          ? descriptionUpset.source
          : null;
    const openingBidRaw = field(fields, 'opening bid') || field(fields, 'minimum bid');
    const openingBid = parseMoney(openingBidRaw);
    const openingBidSource = field(fields, 'opening bid')
      ? 'CivilView Opening Bid'
      : field(fields, 'minimum bid')
        ? 'CivilView Minimum Bid'
        : null;
    const judgment = parseExecutionAmount(description);
    let occupancy = this.parseOccupancy(propertyNote) || this.parseOccupancy(description);
    if (!occupancy && typeof this.extractWithAdaptiveFallback === 'function') {
      const adaptive = this.extractWithAdaptiveFallback(html, {
        caseNumber: { selector: '.sale-detail-value', extractor: (h) => (h.match(/Sheriff\s*#:[^<]*<span[^>]*class="sale-detail-value"[^>]*>([^<]+)<\/span>/i)?.[1]?.trim() || sheriffNumber || null) },
        occupancyStatus: { selector: '.occupancy', extractor: (h) => (h.match(/(?:occupancy|status)[\s:]*(occupied|vacant|unknown)/i)?.[1] || null) },
      }, { persistSelectors: false });
      if (adaptive && adaptive.identityPassed && adaptive.fields.occupancyStatus) {
        occupancy = adaptive.fields.occupancyStatus.toUpperCase();
      }
    }
    const statusHistory = parseStatusHistory(html);
    const propertyId = summary.propertyId || new URL(summary.detailUrl).searchParams.get('PropertyId');
    const sourceObservedAt = new Date(this.now()).toISOString();

    if (!propertyId || !sheriffNumber || !detailAddressRaw) return null;

    let priorPostponements = 0;
    let debtorAdjournments = 0;
    let plaintiffAdjournments = 0;
    let stayActive = false;
    let statutoryStayExhausted = null;
    let lastAdjournmentDate = null;

    if (Array.isArray(statusHistory) && statusHistory.length > 0) {
      for (const entry of statusHistory) {
        const s = String(entry.status || '').toLowerCase();
        if (/adjourn|postpone|continu/i.test(s)) {
          priorPostponements += 1;
          if (/debtor|defendant/i.test(s)) debtorAdjournments += 1;
          if (/plaintiff|bank|lender/i.test(s)) plaintiffAdjournments += 1;
          if (entry.date) lastAdjournmentDate = entry.date;
        }
        if (/bankruptcy|automatic\s*stay|stay/i.test(s)) {
          if (/lifted|relief|vacated|exhaust/i.test(s)) {
            statutoryStayExhausted = true;
            stayActive = false;
          } else {
            stayActive = true;
            statutoryStayExhausted = false;
          }
        }
      }
      if (debtorAdjournments >= 2 && statutoryStayExhausted == null) {
        statutoryStayExhausted = true;
      }
    }

    const derivedStatus = deriveStatusFromHistory(statusHistory);
    const sourceFacts = {
      priorPostponements,
      statutoryStayExhausted,
      stayActive,
      upsetPrice: approximateUpsetPrice || null,
      lotBlock: lotBlockInfo.lotBlock,
      dimensions,
      priorLiensNotice,
      priorLiensTotal,
      adjournmentTrajectory: {
        totalAdjournments: priorPostponements,
        debtorAdjournments,
        plaintiffAdjournments,
        stayActive,
        lastAdjournmentDate,
      },
      saleDate: { raw: saleDateRaw, normalized: parseSaleDate(saleDateRaw) },
      approximateUpsetPrice: approximateUpsetPrice
        ? {
            raw: upsetRaw,
            amount: approximateUpsetPrice,
            qualifier: 'approximate',
            source: approximateUpsetSource,
          }
        : null,
      openingBid: openingBid
        ? { raw: openingBidRaw, amount: openingBid, source: openingBidSource }
        : null,
    };

    const sourceFields = Object.fromEntries(fields.entries());
    return {
      id: `CIV-${summary.county.state}-${summary.county.id}-${propertyId}`,
      source: 'civilview',
      state: parsedAddress.state || summary.county.state,
      county: summary.county.name,
      city: parsedAddress.city || null,
      zip: parsedAddress.zip || null,
      address: formatAddress(parsedAddress, detailAddressRaw),
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
      saleDate: parseSaleDate(saleDateRaw),
      plaintiff: boundedProjectionText(field(fields, 'plaintiff') || summary.plaintiff),
      defendant: boundedProjectionText(field(fields, 'defendant') || summary.defendant),
      judgment: judgment || null,
      attorney: boundedProjectionText(field(fields, 'attorney')),
      occupancy: occupancy || null,
      deposit: null,
      photo: null,
      sourceUrl: summary.detailUrl,
      raw: description || propertyNote || JSON.stringify(sourceFields),
      status: derivedStatus.status,
      lifecycleStatus: derivedStatus.lifecycleStatus,
      transactionOutcome: derivedStatus.transactionOutcome,
      sourceObservedAt,
      apn: lotBlockInfo.parcelNumber,
      parcelId: lotBlockInfo.parcelNumber,
      parcelKey: attachParcelIdentity({
        state: parsedAddress.state || summary.county.state,
        county: summary.county.name,
        apn: lotBlockInfo.parcelNumber,
        parcelId: lotBlockInfo.parcelNumber,
      }),
      sourceFacts,
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
        parcelNumber: lotBlockInfo.parcelNumber,
        countySearchUrl: summary.countySearchUrl,
        detailUrl: summary.detailUrl,
        detailUrlRequiresCountySession: true,
        detailPageFetched: true,
        saleDateRaw,
        approximateUpsetPrice: approximateUpsetPrice
          ? {
              raw: upsetRaw,
              amount: approximateUpsetPrice,
              qualifier: 'approximate',
              source: approximateUpsetSource,
            }
          : null,
        sourceFacts,
        openingBidSource: openingBid ? openingBidSource : null,
        openingBidSourceNote: openingBid
          ? 'Publisher explicitly labels this amount as an opening or minimum bid.'
          : null,
        statusHistory,
        sourceFields,
      },
    };
  }

  _resolveDetailUrl(rawHref, pageUrl) {
    try {
      const decodedHref = decodeHtml(rawHref).trim();
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

  passesFilter(item) {
    if (!item) return false;
    if (!/^CIV-[A-Z]{2}-\d+-\d+$/.test(item.id || '')) return false;
    if (this.nationwide) {
      if (!/^[A-Z]{2}$/.test(item.state || '')) return false;
    } else if (item.state !== this.targetState) {
      return false;
    }
    if (!item.address || item.address.length < 8) return false;
    if (item.openingBid != null && (!Number.isFinite(item.openingBid) || item.openingBid <= 0)) return false;
    if (!this._resolveDetailUrl(item.sourceUrl, this.baseUrl)) return false;
    if (!item.provenance?.detailPageFetched) return false;
    return true;
  }

  parseOccupancy(note) {
    const raw = parseLabeledNote(note, 'OCCUPANCY STATUS');
    if (!raw) return '';
    const known = raw.match(
      /\b(OWNER[ -]?OCCUPIED|TENANT[ -]?OCCUPIED|UNOCCUPIED|VACANT|OCCUPIED|UNKNOWN)\b/i,
    );
    return known ? known[1].toUpperCase().replace('-', ' ') : raw.split(/[.;]/, 1)[0].trim();
  }
}

async function collectCivilView(options = {}) {
  const scraper = new CivilViewScraper(options);
  return scraper.scrapeFeed(options);
}

const civilView = new CivilViewScraper();
module.exports = civilView;
module.exports.CivilViewScraper = CivilViewScraper;
module.exports.collectCivilView = collectCivilView;
module.exports.parseCountyOffset = parseCountyOffset;
module.exports.orderCounties = orderCounties;
module.exports.rotateCounties = rotateCounties;
module.exports.deriveStatusFromHistory = deriveStatusFromHistory;
module.exports.parseLotBlockFromNotice = parseLotBlockFromNotice;
module.exports.ALL_COUNTY_MAP = ALL_COUNTY_MAP;
module.exports.NATIONWIDE_COUNTY_MAP = NATIONWIDE_COUNTY_MAP;
