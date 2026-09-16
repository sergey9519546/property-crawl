// server/scrapers/ca-controller-tax-sale.js
//
// California State Controller tax-defaulted property sales directory collector.
//
// Source: https://www.sco.ca.gov/boe_tax_sales.html
//
// The Controller publishes a county-by-county directory of tax-defaulted
// property sale schedules and linked parcel lists. Each county tax collector
// governs the actual sale terms, bidder rules, and parcel inventory.
//
// Strategy:
//   1. Fetch the Controller directory page (discovery index).
//   2. Parse county entries (county name, sale date, parcel-list / sale page
//      links) from HTML tables and linked county pages.
//   3. For each county with an accessible parcel list, fetch and parse the
//      HTML table (or CSV) of tax-defaulted parcels.
//   4. Map published fields only — never fabricate a bid, sale date, or
//      assessed value.
//
// Safety:
//   - Default 50 records per run (configurable, capped).
//   - Circuit breaker on every request (inherited from BaseScraper).
//   - 250-750ms crawl jitter between requests.
//   - Optional Scrapling `table-extract` profile when SCRAPLING_SOURCES
//     includes this source key.
//   - The Controller directory is a DISCOVERY INDEX; county tax-collector
//     notices govern sale terms. Sale dates and minimum bids are only set
//     when published by the Controller directory or the linked county page.

const BaseScraper = require('./base');
const { cleanText } = require('./normalization');
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');
const { buildDocumentReferences } = require('./document-reference');

const SOURCE_KEY = 'ca-controller-tax-sale';
const PUBLISHER = 'California State Controller Tax-Defaulted Sales Directory';
const DIRECTORY_URL = 'https://www.sco.ca.gov/boe_tax_sales.html';
const DEFAULT_MAX_RECORDS = 50;
const MAX_RECORDS_CAP = 500;
const MAX_COUNTIES_PER_RUN = 25;
const MAX_RAW_BYTES = 64 * 1024;
const CA_STATE_FIPS = '06';

// California county name (normalized) → 5-digit FIPS. Used only when the
// directory names a known county; unknown names still collect with null FIPS.
const CA_COUNTY_FIPS = Object.freeze({
  alameda: '06001',
  alpine: '06003',
  amador: '06005',
  butte: '06007',
  calaveras: '06009',
  colusa: '06011',
  'contra costa': '06013',
  'del norte': '06015',
  'el dorado': '06017',
  fresno: '06019',
  glenn: '06021',
  humboldt: '06023',
  imperial: '06025',
  inyo: '06027',
  kern: '06029',
  kings: '06031',
  lake: '06033',
  lassen: '06035',
  'los angeles': '06037',
  madera: '06039',
  marin: '06041',
  mariposa: '06043',
  mendocino: '06045',
  merced: '06047',
  modoc: '06049',
  mono: '06051',
  monterey: '06053',
  napa: '06055',
  nevada: '06057',
  orange: '06059',
  placer: '06061',
  plumas: '06063',
  riverside: '06065',
  sacramento: '06067',
  'san benito': '06069',
  'san bernardino': '06071',
  'san diego': '06073',
  'san francisco': '06075',
  'san joaquin': '06077',
  'san luis obispo': '06079',
  'san mateo': '06081',
  'santa barbara': '06083',
  'santa clara': '06085',
  'santa cruz': '06087',
  shasta: '06089',
  sierra: '06091',
  siskiyou: '06093',
  solano: '06095',
  sonoma: '06097',
  stanislaus: '06099',
  sutter: '06101',
  tehama: '06103',
  trinity: '06105',
  tulare: '06107',
  tuolumne: '06109',
  ventura: '06111',
  yolo: '06113',
  yuba: '06115'
});

const CA_COUNTY_NAMES = Object.freeze(
  Object.fromEntries(
    Object.keys(CA_COUNTY_FIPS).map((slug) => [
      slug,
      slug.split(' ').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    ])
  )
);

function boundedInt(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function textOrNull(value, maximum = 200) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : null;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(td|th|li|p|div|tr)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).replace(/[$,\s]/g, '');
  if (!text || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDateText(value) {
  if (value === null || value === undefined) return null;
  const text = stripTags(String(value));
  if (!text || /^(tbd|to be determined|n\/a|none|pending|-+)$/i.test(text)) return null;

  // Explicit ISO first.
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) {
    const parsed = Date.parse(iso[1]);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }

  // US numeric: 3/15/2026 or 03-15-2026
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (numeric) {
    const parsed = Date.parse(`${numeric[3]}-${numeric[1].padStart(2, '0')}-${numeric[2].padStart(2, '0')}`);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }

  // Month name forms: March 15, 2026 / Mar 15 2026
  const named = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i
  );
  if (named) {
    const parsed = Date.parse(`${named[1]} ${named[2]}, ${named[3]}`);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

function normalizeCountyName(value) {
  const text = textOrNull(value, 80);
  if (!text) return null;
  let name = text
    .replace(/\bcounty\b/gi, '')
    .replace(/\btax[-\s]?defaulted\b/gi, '')
    .replace(/\btax\s+sale\b/gi, '')
    .replace(/\bsale\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return null;
  // Title-case only when the token looks like a known county slug.
  const slug = name.toLowerCase();
  if (CA_COUNTY_NAMES[slug]) return CA_COUNTY_NAMES[slug];
  // Preserve publisher capitalization for unknown names but strip noise.
  return name.length > 2 ? name : null;
}

function countyFips(countyName) {
  const slug = String(countyName || '').toLowerCase().trim();
  return CA_COUNTY_FIPS[slug] || null;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function resolveHttpsUrl(href, baseUrl) {
  if (!href) return null;
  try {
    const url = new URL(href, baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    url.hash = '';
    return url.toString();
  } catch (_) {
    return null;
  }
}

function truncateRaw(payload, maxBytes = MAX_RAW_BYTES) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxBytes) return text;
  return JSON.stringify({
    truncated: true,
    originalBytes: bytes,
    preview: text.slice(0, Math.floor(maxBytes * 0.8))
  });
}

function classifyPropType(description) {
  const text = String(description || '').toLowerCase();
  if (!text.trim()) return 'Unknown';
  if (/\b(single[\s-]?family|sfr|detached)\b/.test(text)) return 'Single Family';
  if (/\b(condo|condominium)\b/.test(text)) return 'Condo';
  if (/\b(multi[\s-]?family|duplex|triplex|apartment)\b/.test(text)) return 'Multi-Family';
  if (/\b(mobile|manufactured)\b/.test(text)) return 'Mobile Home';
  if (/\b(commercial|retail|office|industrial|warehouse)\b/.test(text)) return 'Commercial';
  if (/\b(agricultural|farm|ranch|orchard)\b/.test(text)) return 'Agricultural';
  if (/\b(vacant|land|lot|acreage|raw land)\b/.test(text)) return 'Land';
  if (/\b(cloud|unknown|n\/a)\b/.test(text)) return 'Unknown';
  // Free-form description is still useful; keep a bounded label.
  const trimmed = textOrNull(description, 40);
  return trimmed || 'Unknown';
}

function parseCsvRows(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (lines.length < 2) return [];
  const splitLine = (line) => {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else inQuotes = !inQuotes;
      } else if ((ch === ',' || ch === '\t') && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else current += ch;
    }
    cells.push(current.trim());
    return cells.map((cell) => decodeEntities(cell).replace(/^"|"$/g, ''));
  };
  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row = {};
    headers.forEach((header, index) => {
      if (header) row[header.toLowerCase()] = cells[index] ?? '';
    });
    return row;
  });
}

function extractTableRows(html) {
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRe.exec(html || '')) !== null) {
    const tableHtml = tableMatch[1];
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
      const cells = [];
      const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        const raw = cellMatch[2];
        const hrefMatch = raw.match(/<a\b[^>]*href=["']([^"']+)["']/i);
        cells.push({
          text: stripTags(raw),
          href: hrefMatch ? hrefMatch[1] : null,
          isHeader: cellMatch[1].toLowerCase() === 'th'
        });
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function headerKey(label) {
  const text = String(label || '').toLowerCase().trim();
  // Link/list columns first — they often embed the words parcel, list, or sale.
  if (/\b(parcel\s*list|sale\s*page|county\s*sale|schedule|details|more\s*info|link)\b/.test(text)) {
    return 'link';
  }
  if (/\b(county|jurisdiction)\b/.test(text) && !/\b(sale|date|list|page|schedule)\b/.test(text)) {
    return 'county';
  }
  if (/\b(sale\s*date|auction\s*date|date\s*of\s*sale)\b/.test(text)) return 'saleDate';
  if (/\b(parcel|apn|assessor|property\s*(id|number|no))\b/.test(text)) return 'parcel';
  if (/\b(situs|site\s*address|property\s*address|address|location)\b/.test(text)) return 'address';
  if (/\b(assessed|assessed\s*value|taxable)\b/.test(text)) return 'assessed';
  if (/\b(minimum\s*bid|min\.?\s*bid|opening\s*bid|minimum|upset)\b/.test(text)) return 'minimumBid';
  if (/\b(type|class|description|property\s*type|use)\b/.test(text)) return 'description';
  return null;
}

class CaControllerTaxSaleError extends Error {
  constructor(message, code = 'CA_TAX_SALE_UPSTREAM_UNAVAILABLE') {
    super(message);
    this.name = 'CaControllerTaxSaleError';
    this.code = code;
  }
}

class CaControllerTaxSaleScraper extends BaseScraper {
  constructor(options = {}) {
    super({
      ...options,
      name: options.name || 'CaControllerTaxSaleCollector',
      sourceKey: SOURCE_KEY
    });
    this.directoryUrl = options.directoryUrl || DIRECTORY_URL;
    this.maxRecords = boundedInt(
      options.maxRecords ?? process.env.CA_TAX_SALE_MAX_RECORDS,
      DEFAULT_MAX_RECORDS,
      MAX_RECORDS_CAP
    );
    this.maxCounties = boundedInt(
      options.maxCounties ?? process.env.CA_TAX_SALE_MAX_COUNTIES,
      MAX_COUNTIES_PER_RUN,
      MAX_COUNTIES_PER_RUN
    );
    this.lastRunReport = null;
    this.useScrapling = options.useScrapling ?? isScraplingEnabled(SOURCE_KEY);
    this.extract = options.extractImpl || extractWithScrapling;
    this.rawPublisherRecords = new WeakMap();
  }

  getCollectionScope() {
    return {
      endpoint: '/boe_tax_sales.html',
      filters: { states: ['CA'], program: 'tax_defaulted_sales' },
      maxRecords: this.maxRecords
    };
  }

  getRawPublisherRecord(listing) {
    return this.rawPublisherRecords.get(listing) || null;
  }

  async fetchText(url, options = {}) {
    return super.requestText(url, {
      timeoutMs: options.timeoutMs ?? 30_000,
      headers: {
        'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)',
        Accept: 'text/html,application/xhtml+xml,text/csv;q=0.9,*/*;q=0.8'
      },
      ...options
    });
  }

  async extractTableEvidence(html, url) {
    if (!this.useScrapling || typeof this.extract !== 'function') return null;
    try {
      return await this.extract('table-extract', { html, url });
    } catch (error) {
      console.warn(`[${this.name}] Scrapling table-extract failed for ${url}: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse the Controller directory page into county sale entries.
   * Accepts HTML tables (with Scrapling table-extract when enabled) and
   * falls back to link/heading heuristics for pages without clean tables.
   */
  parseDirectory(html, directoryUrl = this.directoryUrl) {
    const counties = [];
    const seen = new Set();
    const pushCounty = (entry) => {
      if (!entry || !entry.county) return;
      const key = `${entry.county.toLowerCase()}|${entry.saleDate || ''}|${entry.parcelListUrl || entry.countyPageUrl || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      counties.push(entry);
    };

    const tables = extractTableRows(html);
    for (const rows of tables) {
      if (!rows.length) continue;
      // Detect header row when present.
      let headerMap = null;
      let start = 0;
      const firstRow = rows[0];
      if (firstRow.every((cell) => cell.isHeader) || firstRow.some((cell) => headerKey(cell.text))) {
        headerMap = firstRow.map((cell) => headerKey(cell.text));
        start = 1;
        // A pure date header is still a date column.
        if (!headerMap.includes('saleDate')) {
          headerMap = headerMap.map((key, index) => {
            if (key) return key;
            return /date/i.test(firstRow[index]?.text || '') ? 'saleDate' : null;
          });
        }
        if (rows.length < 2) continue;
      }

      for (let i = start; i < rows.length; i += 1) {
        const cells = rows[i];
        const mapped = { county: null, saleDate: null, parcelListUrl: null, countyPageUrl: null, linkLabel: null };
        if (headerMap) {
          cells.forEach((cell, index) => {
            const key = headerMap[index];
            if (!key) return;
            if (key === 'county') mapped.county = normalizeCountyName(cell.text);
            else if (key === 'saleDate') mapped.saleDate = parseDateText(cell.text);
            else if (key === 'link') {
              const url = resolveHttpsUrl(cell.href, directoryUrl);
              if (url) {
                if (/\.(pdf|csv|xlsx?)($|\?)/i.test(url) || /parcel|list|schedule|inventory/i.test(cell.text) || /parcel|list|schedule|inventory/i.test(url)) {
                  mapped.parcelListUrl = url;
                } else {
                  mapped.countyPageUrl = url;
                }
                mapped.linkLabel = textOrNull(cell.text, 80);
              }
            }
          });
        } else {
          // Heuristic: county-ish text | date-ish text | link
          for (const cell of cells) {
            if (!mapped.county && cell.text && !/^\d/.test(cell.text) && !/\.(pdf|csv)/i.test(cell.text)) {
              const candidate = normalizeCountyName(cell.text);
              if (candidate && candidate.length >= 3) mapped.county = candidate;
            } else if (!mapped.saleDate) {
              const date = parseDateText(cell.text);
              if (date) mapped.saleDate = date;
            }
            if (cell.href) {
              const url = resolveHttpsUrl(cell.href, directoryUrl);
              if (url) {
                if (/\.(pdf|csv|xlsx?)($|\?)/i.test(url) || /parcel|list|schedule/i.test(cell.text) || /parcel|list|schedule/i.test(url)) {
                  mapped.parcelListUrl = url;
                } else if (!mapped.countyPageUrl) {
                  mapped.countyPageUrl = url;
                }
              }
            }
          }
        }

        // Capture the first remaining link even when the header did not label it.
        if (!mapped.parcelListUrl && !mapped.countyPageUrl) {
          for (const cell of cells) {
            if (!cell.href) continue;
            const url = resolveHttpsUrl(cell.href, directoryUrl);
            if (!url) continue;
            if (/\.(pdf|csv|xlsx?)($|\?)/i.test(url) || /parcel|list|schedule|tax/i.test(url) || /parcel|list|schedule/i.test(cell.text || '')) {
              mapped.parcelListUrl = url;
              break;
            }
            if (!mapped.countyPageUrl) mapped.countyPageUrl = url;
          }
        }

        if (mapped.county) pushCounty({ ...mapped, source: 'directory_table' });
      }
    }

    // Link/heuristic pass only when the directory is not a clean table.
    if (!counties.length) {
      const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let linkMatch;
      while ((linkMatch = linkRe.exec(html || '')) !== null) {
        const href = resolveHttpsUrl(linkMatch[1], directoryUrl);
        if (!href) continue;
        const label = stripTags(linkMatch[2]);
        const combined = `${label} ${href}`;
        if (!/tax|parcel|default|sale/i.test(combined)) continue;
        const countyCandidate = normalizeCountyName(label)
          || normalizeCountyName((combined.match(/([A-Za-z][A-Za-z .]+)\s+County/i) || [])[1]);
        if (!countyCandidate) continue;
        const isDocument = /\.(pdf|csv|xlsx?)($|\?)/i.test(href) || /parcel|list|inventory/i.test(combined);
        pushCounty({
          county: countyCandidate,
          saleDate: parseDateText(label) || parseDateText(
            String(html).slice(linkMatch.index, linkMatch.index + 400)
          ),
          parcelListUrl: isDocument ? href : null,
          countyPageUrl: isDocument ? null : href,
          linkLabel: textOrNull(label, 80),
          source: 'directory_link'
        });
      }
    }

    return counties;
  }

  /**
   * Parse a county parcel list (HTML table or CSV) into raw parcel rows.
   */
  parseParcelList(htmlOrCsv, { sourceUrl, county, saleDate } = {}) {
    const looksLikeCsv = !/<table\b/i.test(htmlOrCsv) && /,|\t/.test(htmlOrCsv) && /\n/.test(htmlOrCsv);
    if (looksLikeCsv) {
      const rows = parseCsvRows(htmlOrCsv);
      return rows.map((row) => this.mapCsvRow(row, { sourceUrl, county, saleDate })).filter(Boolean);
    }

    const tables = extractTableRows(htmlOrCsv);
    const parcels = [];
    for (const rows of tables) {
      if (!rows.length) continue;
      let headerMap = null;
      let start = 0;
      const first = rows[0];
      const looksLikeHeader = first.every((cell) => cell.isHeader)
        || first.some((cell) => headerKey(cell.text));
      if (looksLikeHeader) {
        headerMap = first.map((cell) => headerKey(cell.text));
        start = 1;
        // Header-only tables produce no parcels.
        if (rows.length < 2) continue;
      }
      for (let i = start; i < rows.length; i += 1) {
        const cells = rows[i].map((cell) => cell.text);
        const parcel = this.mapParcelCells(cells, { headerMap, sourceUrl, county, saleDate });
        if (parcel) parcels.push(parcel);
      }
    }
    return parcels;
  }

  mapCsvRow(row, { sourceUrl, county, saleDate } = {}) {
    const pick = (...keys) => {
      for (const key of keys) {
        const found = Object.keys(row).find((k) => k.includes(key));
        if (found && row[found]) return row[found];
      }
      return null;
    };
    const parcel = textOrNull(pick('parcel', 'apn', 'assessor', 'property id', 'property number'), 40);
    if (!parcel) return null;
    const address = textOrNull(pick('situs', 'address', 'location', 'site'), 200);
    const description = textOrNull(pick('description', 'type', 'class', 'use'), 120);
    return {
      parcel,
      address,
      description,
      assessedValue: parseMoney(pick('assessed', 'av', 'taxable')),
      minimumBid: parseMoney(pick('minimum', 'min bid', 'opening', 'upset')),
      saleDate: parseDateText(pick('sale date', 'date')) || saleDate || null,
      county: normalizeCountyName(pick('county')) || county || null,
      sourceUrl,
      rawRow: { ...row }
    };
  }

  mapParcelCells(cells, { headerMap, sourceUrl, county, saleDate } = {}) {
    const mapped = {
      parcel: null,
      address: null,
      description: null,
      assessedValue: null,
      minimumBid: null,
      saleDate: saleDate || null,
      county: county || null
    };
    if (headerMap) {
      cells.forEach((text, index) => {
        const key = headerMap[index];
        if (!key || !text) return;
        if (key === 'parcel') mapped.parcel = textOrNull(text, 40);
        else if (key === 'address') mapped.address = textOrNull(text, 200);
        else if (key === 'description') mapped.description = textOrNull(text, 120);
        else if (key === 'assessed') mapped.assessedValue = parseMoney(text);
        else if (key === 'minimumBid') mapped.minimumBid = parseMoney(text);
        else if (key === 'saleDate') mapped.saleDate = parseDateText(text) || mapped.saleDate;
        else if (key === 'county') mapped.county = normalizeCountyName(text) || mapped.county;
      });
    } else {
      // Positional fallback: parcel | address/description | assessed | min bid
      for (const text of cells) {
        if (!mapped.parcel && text && /^[\w.-]{4,}$/.test(text) && !/^\$/.test(text) && !parseDateText(text)) {
          mapped.parcel = textOrNull(text, 40);
          continue;
        }
        if (!mapped.minimumBid) {
          const money = parseMoney(text);
          if (money !== null) {
            // First money is assessed, second is minimum bid when both exist.
            if (mapped.assessedValue === null) mapped.assessedValue = money;
            else mapped.minimumBid = money;
            continue;
          }
        }
        if (!mapped.saleDate) {
          const date = parseDateText(text);
          if (date) {
            mapped.saleDate = date;
            continue;
          }
        }
        if (!mapped.address && text && /\d/.test(text) && text.length >= 8) {
          mapped.address = textOrNull(text, 200);
        } else if (!mapped.description && text && text.length >= 3) {
          mapped.description = textOrNull(text, 120);
        }
      }
    }
    if (!mapped.parcel) return null;
    return {
      ...mapped,
      sourceUrl,
      rawRow: cells
    };
  }

  mapParcelToListing(parcel, { countyEntry, directoryUrl, observedAt }) {
    const countyName = parcel.county || countyEntry?.county || null;
    if (!countyName || !parcel.parcel) return null;

    const saleDate = parcel.saleDate || countyEntry?.saleDate || null;
    // Never fabricate a sale date or bid — only published values.
    const openingBid = parcel.minimumBid !== null && parcel.minimumBid > 0 ? parcel.minimumBid : null;

    const address = parcel.address
      || `Parcel ${parcel.parcel}, ${countyName} County`;
    if (address.length < 8) return null;

    const listingId = `ca-tax-${slugify(countyName)}-${slugify(parcel.parcel)}`;
    const fips = countyFips(countyName);
    // Prefer an SCO-hosted sale-page URL for source-policy; county parcel
    // lists on other domains stay in provenance as intermediate evidence.
    const sourceUrl = this.preferredSourceUrl(countyEntry, directoryUrl);
    if (!sourceUrl) return null;

    const propType = classifyPropType(parcel.description);
    const rawPayload = {
      directoryUrl,
      countyEntry: {
        county: countyEntry?.county || null,
        saleDate: countyEntry?.saleDate || null,
        parcelListUrl: countyEntry?.parcelListUrl || null,
        countyPageUrl: countyEntry?.countyPageUrl || null
      },
      parcel: {
        parcel: parcel.parcel,
        address: parcel.address || null,
        description: parcel.description || null,
        assessedValue: parcel.assessedValue ?? null,
        minimumBid: parcel.minimumBid ?? null,
        saleDate: parcel.saleDate || null,
        county: parcel.county || null
      },
      rawRow: parcel.rawRow
    };

    const preNormalized = {
      id: listingId,
      source: SOURCE_KEY,
      state: 'CA',
      county: countyName,
      city: null,
      zip: null,
      address,
      lat: null,
      lng: null,
      beds: null,
      baths: null,
      sqft: null,
      year: null,
      propType,
      openingBid,
      price: null,
      estLow: null,
      estHigh: null,
      assessed: parcel.assessedValue !== null && parcel.assessedValue >= 0 ? parcel.assessedValue : null,
      saleDate,
      sourceUrl,
      raw: truncateRaw(rawPayload),
      apn: parcel.parcel,
      parcelId: parcel.parcel,
      parcelNumber: parcel.parcel,
      countyFips: fips,
      stateFips: CA_STATE_FIPS,
      provenance: {
        origin: 'live',
        observed: true,
        publisher: PUBLISHER,
        recordId: listingId,
        countyFips: fips,
        stateFips: CA_STATE_FIPS,
        sourceFacts: {
          directoryUrl: this.directoryUrl,
          controllerDirectoryUrl: directoryUrl,
          countyName,
          saleDate,
          parcelNumber: parcel.parcel,
          assessedValue: parcel.assessedValue ?? null,
          minimumBid: openingBid,
          openingBid,
          propertyDescription: parcel.description || null,
          situsAddress: parcel.address || null,
          countyPageUrl: countyEntry?.countyPageUrl || null,
          parcelListUrl: countyEntry?.parcelListUrl || null,
          countyFips: fips,
          evidenceClass: 'publisher_reported',
          caveat: 'The Controller directory is a discovery index. County tax-collector notices govern sale terms, redemption status, and bidder requirements.',
          documents: buildDocumentReferences([
            sourceUrl && { kind: 'reference', url: sourceUrl, label: `CA Controller sale notice ${parcel.parcel}` },
            countyEntry?.parcelListUrl && { kind: 'parcel', url: countyEntry.parcelListUrl, label: `${countyName || 'County'} parcel list` }
          ], { observedAt })
        }
      },
      sourceObservedAt: observedAt
    };

    const listing = this.standardizeListing(preNormalized);
    this.rawPublisherRecords.set(listing, rawPayload);
    return listing;
  }

  preferredSourceUrl(countyEntry, directoryUrl) {
    // Prefer a Controller-hosted sale page that satisfies source-policy.
    const candidates = [
      countyEntry?.countyPageUrl,
      directoryUrl,
      this.directoryUrl
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const url = new URL(candidate);
        if (url.hostname.toLowerCase().replace(/^www\./, '') !== 'sco.ca.gov') continue;
        if (url.protocol !== 'https:' || url.username || url.password || url.port) continue;
        url.hash = '';
        return url.toString();
      } catch (_) {
        // try next
      }
    }
    // Fall back to the directory URL so every listing remains policy-valid.
    return directoryUrl || this.directoryUrl;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const observedAt = new Date().toISOString();
      const collected = [];
      const failures = [];
      let directoryHtml;
      try {
        directoryHtml = await this.fetchText(this.directoryUrl);
      } catch (error) {
        throw new CaControllerTaxSaleError(
          `Unable to fetch Controller tax-sale directory: ${error.message}`,
          error.code || 'CA_TAX_SALE_DIRECTORY_UNAVAILABLE'
        );
      }

      const tableEvidence = await this.extractTableEvidence(directoryHtml, this.directoryUrl);
      let counties = this.parseDirectory(directoryHtml, this.directoryUrl);
      if (tableEvidence && Array.isArray(tableEvidence.rows) && !counties.length) {
        // Scrapling table-extract fallback: treat headers/rows as a county table.
        const headers = tableEvidence.headers.map((h) => headerKey(h));
        counties = tableEvidence.rows
          .map((row) => {
            const mapped = { county: null, saleDate: null, parcelListUrl: null, countyPageUrl: null };
            row.forEach((cell, index) => {
              const key = headers[index];
              if (key === 'county') mapped.county = normalizeCountyName(cell);
              else if (key === 'saleDate') mapped.saleDate = parseDateText(cell);
            });
            return mapped.county ? mapped : null;
          })
          .filter(Boolean);
      }

      // Only visit counties that published a parcel list (or an HTML page
      // likely to contain one). Counties without accessible lists are
      // recorded as skips — never invented.
      const visitable = counties
        .filter((entry) => entry.parcelListUrl || entry.countyPageUrl)
        .slice(0, this.maxCounties);

      let countiesVisited = 0;
      let countiesSkipped = 0;
      let parcelsDiscovered = 0;
      let parcelsRejected = 0;

      for (const countyEntry of visitable) {
        if (collected.length >= this.maxRecords) break;
        const listUrl = countyEntry.parcelListUrl || countyEntry.countyPageUrl;
        let body;
        try {
          body = await this.fetchText(listUrl);
          countiesVisited += 1;
        } catch (error) {
          // Missing/unreachable county pages are expected; skip gracefully.
          countiesSkipped += 1;
          failures.push({ county: countyEntry.county, url: listUrl, error: error.message });
          if (error.haltScraper === true) throw error;
          await this.crawlJitter();
          continue;
        }

        let parcels;
        try {
          parcels = this.parseParcelList(body, {
            sourceUrl: listUrl,
            county: countyEntry.county,
            saleDate: countyEntry.saleDate
          });
        } catch (error) {
          countiesSkipped += 1;
          failures.push({ county: countyEntry.county, url: listUrl, error: error.message });
          await this.crawlJitter();
          continue;
        }

        parcelsDiscovered += parcels.length;
        for (const parcel of parcels) {
          if (collected.length >= this.maxRecords) break;
          const listing = this.mapParcelToListing(parcel, {
            countyEntry,
            directoryUrl: this.directoryUrl,
            observedAt
          });
          if (listing) collected.push(listing);
          else parcelsRejected += 1;
        }

        await this.crawlJitter();
      }

      // Counties named in the directory with no usable list link.
      for (const entry of counties) {
        if (!entry.parcelListUrl && !entry.countyPageUrl) countiesSkipped += 1;
      }

      const truncated = collected.length >= this.maxRecords
        || visitable.length < counties.filter((c) => c.parcelListUrl || c.countyPageUrl).length;
      const complete = failures.length === 0 && !truncated;
      this.lastRunReport = {
        outcome: failures.length
          ? (collected.length ? 'partial_failure' : 'failed')
          : (collected.length ? 'success' : 'empty'),
        scope: this.getCollectionScope(),
        countiesDiscovered: counties.length,
        countiesVisited,
        countiesSkipped,
        parcelsDiscovered,
        recordsDiscovered: parcelsDiscovered,
        recordsEmitted: collected.length,
        recordsRejected: parcelsRejected,
        truncated,
        complete,
        fullSweepComplete: complete,
        fixtureFallbackUsed: false,
        failures,
        sweepStartedAt: observedAt,
        nextContinuationToken: null
      };

      console.log(
        `[${this.name}] Scraped ${collected.length} CA tax-defaulted parcels ` +
        `(${countiesVisited} county page(s), ${counties.length} directory entries)`
      );
      return collected;
    });
  }
}

module.exports = new CaControllerTaxSaleScraper();
module.exports.CaControllerTaxSaleScraper = CaControllerTaxSaleScraper;
module.exports.CA_COUNTY_FIPS = CA_COUNTY_FIPS;
module.exports.CA_COUNTY_NAMES = CA_COUNTY_NAMES;
module.exports.DIRECTORY_URL = DIRECTORY_URL;
module.exports.SOURCE_KEY = SOURCE_KEY;
module.exports.classifyPropType = classifyPropType;
module.exports.parseDateText = parseDateText;
module.exports.parseMoney = parseMoney;
module.exports.normalizeCountyName = normalizeCountyName;
