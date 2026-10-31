// server/scrapers/sheriff.js
//
// Realauction & County Judicial Foreclosure Sheriff Sale Scraper.
// Sources: Realauction Ohio portals (*.sheriffsaleauction.ohio.gov) & County Dockets
//
// Scrapes live sheriff sales, appraised values, upset prices, and court case metadata.

const BaseScraper = require('./base');
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');
const { createRunReport, recordUnitFailure, recordUnitSuccess, finalizeRunReport, applyEmptyInventoryHonesty } = require('./run-report');
const { mapWithConcurrency } = require('./http');
const {
  REALAUCTION_FLORIDA_COUNTIES,
  REALAUCTION_FLORIDA_TAXDEED_COUNTIES,
  decodeRealAuctionMacros,
  parseRealAuctionDocketHtml,
} = require('./adapters/realauction');
const { standardizeListingRecord } = require('./normalization');
const {
  TEXAS_TAX_SALE_COUNTIES,
  parseTexasTaxSaleHtml,
  parseTexasTaxSaleCard,
  getNextTexasTaxSaleDate,
} = require('./adapters/texas-tax-sale');

const DEFAULT_FL_COUNTIES = [
  ...REALAUCTION_FLORIDA_COUNTIES.map((c) => ({
    name: c.charAt(0).toUpperCase() + c.slice(1),
    domain: `${c}.realforeclose.com`,
    state: 'FL',
  })),
  ...REALAUCTION_FLORIDA_TAXDEED_COUNTIES.map((c) => ({
    name: c.charAt(0).toUpperCase() + c.slice(1),
    domain: `${c}.realtaxdeed.com`,
    state: 'FL',
  })),
];

const TOP_FL_COUNTIES = Object.freeze([
  { name: 'Hillsborough', domain: 'hillsborough.realforeclose.com', state: 'FL' },
  { name: 'Hillsborough', domain: 'hillsborough.realtaxdeed.com', state: 'FL' },
  { name: 'Orange', domain: 'orange.realforeclose.com', state: 'FL' },
  { name: 'Orange', domain: 'orange.realtaxdeed.com', state: 'FL' },
  { name: 'PalmBeach', domain: 'palmbeach.realforeclose.com', state: 'FL' },
  { name: 'PalmBeach', domain: 'palmbeach.realtaxdeed.com', state: 'FL' },
  { name: 'Broward', domain: 'broward.realforeclose.com', state: 'FL' },
  { name: 'Broward', domain: 'broward.realtaxdeed.com', state: 'FL' },
  { name: 'Miami-Dade', domain: 'miamidade.realforeclose.com', state: 'FL' },
  { name: 'Miami-Dade', domain: 'miamidade.realtaxdeed.com', state: 'FL' },
  { name: 'Duval', domain: 'duval.realforeclose.com', state: 'FL' },
  { name: 'Duval', domain: 'duval.realtaxdeed.com', state: 'FL' },
  { name: 'Pinellas', domain: 'pinellas.realforeclose.com', state: 'FL' },
  { name: 'Pinellas', domain: 'pinellas.realtaxdeed.com', state: 'FL' },
]);

// Expanded default Ohio Realauction jurisdictions (10x collection footprint).
// SHERIFF_EXTRA_COUNTIES still accepts Name:domain:ST enrollment.
const DEFAULT_OH_COUNTIES = [
  { name: 'Cuyahoga', domain: 'cuyahoga.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Franklin', domain: 'franklin.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Summit', domain: 'summit.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Hamilton', domain: 'hamilton.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Montgomery', domain: 'montgomery.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Lucas', domain: 'lucas.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Butler', domain: 'butler.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Stark', domain: 'stark.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Lorain', domain: 'lorain.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Mahoning', domain: 'mahoning.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Warren', domain: 'warren.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Clermont', domain: 'clermont.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Delaware', domain: 'delaware.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Lake', domain: 'lake.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Trumbull', domain: 'trumbull.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Wood', domain: 'wood.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Allen', domain: 'allen.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Fairfield', domain: 'fairfield.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Clark', domain: 'clark.sheriffsaleauction.ohio.gov', state: 'OH' },
  { name: 'Licking', domain: 'licking.sheriffsaleauction.ohio.gov', state: 'OH' },
];

const DEFAULT_TX_COUNTIES = Object.freeze(
  Object.entries(TEXAS_TAX_SALE_COUNTIES).map(([key, info]) => {
    let domain = '';
    try {
      domain = new URL(info.taxOfficeUrl).hostname;
    } catch (_) {
      domain = `${key}.tx.gov`;
    }
    return Object.freeze({
      key,
      name: info.county,
      domain,
      state: 'TX',
      url: info.taxOfficeUrl,
      precincts: info.precincts,
      defaultCity: info.defaultCity,
    });
  })
);

function normalizeCountyInput(county) {
  if (typeof county === 'string') {
    const key = county.trim().toLowerCase().replace(/\s+/g, '_');
    if (TEXAS_TAX_SALE_COUNTIES[key]) {
      const info = TEXAS_TAX_SALE_COUNTIES[key];
      let domain = '';
      try { domain = new URL(info.taxOfficeUrl).hostname; } catch (_) {}
      return {
        key,
        name: info.county,
        state: 'TX',
        domain,
        url: info.taxOfficeUrl,
        precincts: info.precincts,
        defaultCity: info.defaultCity,
      };
    }
    return { name: county.trim(), state: 'OH' };
  }
  if (county && typeof county === 'object') {
    const key = (county.key || county.name || '').toLowerCase().replace(/\s+/g, '_');
    if (TEXAS_TAX_SALE_COUNTIES[key]) {
      const info = TEXAS_TAX_SALE_COUNTIES[key];
      let domain = county.domain;
      if (!domain) {
        try { domain = new URL(info.taxOfficeUrl).hostname; } catch (_) {}
      }
      return {
        key,
        name: county.name || info.county,
        state: county.state || 'TX',
        domain,
        url: county.url || info.taxOfficeUrl,
        precincts: county.precincts || info.precincts,
        defaultCity: county.defaultCity || info.defaultCity,
        ...county,
      };
    }
    return county;
  }
  return { name: 'Unknown', state: 'OH' };
}

function parseExtraCounties(raw) {
  // Format: Name:domain:ST,Name:domain:ST
  return String(raw || '').split(',').map(entry => {
    const parts = entry.trim().split(':').map(p => p.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return {
      name: parts[0],
      domain: parts[1].replace(/^https?:\/\//, ''),
      state: (parts[2] || 'OH').toUpperCase(),
    };
  }).filter(Boolean);
}

class SheriffSaleScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'SheriffSaleScraper', sourceKey: 'sheriff' });
    const flCounties = (options.includeFlorida || process.env.SHERIFF_INCLUDE_FL === '1')
      ? DEFAULT_FL_COUNTIES
      : (process.env.SHERIFF_INCLUDE_FL === '0' ? [] : TOP_FL_COUNTIES);
    const txCounties = (options.includeTexas || process.env.SHERIFF_INCLUDE_TX === '1')
      ? DEFAULT_TX_COUNTIES
      : (process.env.SHERIFF_INCLUDE_TX === '0' ? [] : DEFAULT_TX_COUNTIES);
    this.counties = options.counties
      || [
        ...DEFAULT_OH_COUNTIES,
        ...flCounties,
        ...txCounties,
        ...parseExtraCounties(process.env.SHERIFF_EXTRA_COUNTIES),
      ];
    this.timeoutMs = 30000;
    this.useScrapling = options.useScrapling ?? isScraplingEnabled('sheriff');
    this.extract = options.extractImpl || extractWithScrapling;
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const report = createRunReport('sheriff', {
        platform: 'realauction-ohio',
        counties: this.counties.map(c => `${c.name},${c.state}`),
      });
      report.statesRequested = this.counties.map(c => `${c.name},${c.state}`);
      report.endpointsTried = this.counties.length;
      this.lastRunReport = report;

      const allListings = [];
      this._htmlSamples = [];
      this._lastExtraction = null;
      const concurrency = Math.max(1, Math.min(4, Number(process.env.SHERIFF_COUNTY_CONCURRENCY) || 3));
      const countyResults = await mapWithConcurrency(this.counties, concurrency, async (c) => {
        const unit = `${c.name},${c.state}`;
        try {
          const countyListings = await this.scrapeCounty(c, report);
          return countyListings;
        } catch (err) {
          recordUnitFailure(report, unit, err, 'county');
          console.warn(`[${this.name}] Warning for ${c.name} County: ${err.message}`);
          return [];
        }
      });
      for (const result of countyResults) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) allListings.push(...result.value);
      }

      const standardized = [];
      let schemaRejected = 0;
      for (const l of allListings) {
        if (!this.passesFilter(l)) continue;
        if (l._alreadyStandardized) {
          standardized.push(l);
          continue;
        }
        try {
          standardized.push(this.standardizeListing(l));
        } catch (err) {
          if (err && err.code === "LISTING_SCHEMA_INVALID") {
            schemaRejected += 1;
            console.warn(`[${this.name}] Dropped schema-invalid listing: ${err.message}`);
            continue;
          }
          throw err;
        }
      }
      finalizeRunReport(report, { emitted: standardized.length, rejected: schemaRejected });
      report.scrapling = this.useScrapling
        ? { enabled: true, profile: 'table-extract', engine: this._lastExtraction?.engine || null, error: this._lastExtraction?.error || null }
        : { enabled: false };
      if (report.outcome === 'failed') {
        throw new Error(`SHERIFF_UPSTREAM_UNAVAILABLE: all ${this.counties.length} county endpoints failed`);
      }
      applyEmptyInventoryHonesty(report, { emitted: standardized.length, htmlSamples: this._htmlSamples || [], sourceKey: 'sheriff' });
      console.log(`[${this.name}] Standardized ${standardized.length} Sheriff Sale listings (${report.outcome})`);
      return standardized;
    });
  }

  isTexasCounty(county) {
    if (!county) return false;
    const c = typeof county === 'string' ? normalizeCountyInput(county) : county;
    const state = String(c.state || '').toUpperCase();
    if (state === 'TX') return true;
    const domain = String(c.domain || c.url || '').toLowerCase();
    const txDomains = [
      'hctax.net', 'dallascounty.org', 'tarrantcountytx.gov', 'bexar.org',
      'traviscountytx.gov', 'collincountytx.gov', 'dentoncounty.gov',
      'epcounty.com', 'fortbendcountytx.gov', 'mctx.org', 'wilco.org',
      'lgbs.com', 'mvbalaw.com', 'pbfcm.com',
    ];
    if (txDomains.some((d) => domain.includes(d))) return true;
    const key = String(c.key || c.name || '').toLowerCase().replace(/\s+/g, '_');
    if (TEXAS_TAX_SALE_COUNTIES[key]) return true;
    return String(c.platform || '').includes('texas');
  }

  async scrapeCounty(county, runReport = null, options = {}) {
    const c = typeof county === 'string' ? normalizeCountyInput(county) : county;
    const isTx = this.isTexasCounty(c);
    if (isTx) {
      return this.fetchCountyTexasTaxSale(c, runReport, options);
    }
    const listings = await this.fetchCountyRealauction(c);
    if (runReport) {
      const unit = `${c.name},${c.state}`;
      recordUnitSuccess(runReport, unit, listings.length);
    }
    return listings;
  }

  async fetchCountyTexasTaxSale(county, runReport = null, options = {}) {
    const c = typeof county === 'string' ? normalizeCountyInput(county) : county;
    const countyKey = (c.key || c.name || 'harris').toLowerCase().replace(/\s+/g, '_');
    const countyInfo = TEXAS_TAX_SALE_COUNTIES[countyKey] || TEXAS_TAX_SALE_COUNTIES.harris;
    const targetUrl = c.url
      || (c.domain ? (c.domain.startsWith('http') ? c.domain : `https://${c.domain}`) : countyInfo?.taxOfficeUrl);

    let html = options.html || c.html;
    if (!html) {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
      html = await this.requestText(targetUrl, {
        headers: {
          'User-Agent': ua,
          Accept: 'text/html,application/xhtml+xml',
        },
      });
    }

    if (Array.isArray(this._htmlSamples) && html) {
      this._htmlSamples.push(html);
    }

    const parseOptions = {
      ...options,
      sourceUrl: targetUrl,
      saleDate: options.saleDate || c.saleDate,
    };

    const rawListings = parseTexasTaxSaleHtml(html, countyKey, parseOptions);

    const standardizedListings = [];
    for (const raw of rawListings) {
      if (!this.passesFilter(raw)) continue;
      try {
        const listing = standardizeListingRecord(raw, { sourceKey: this.sourceKey });
        if (this._publisherRecords && raw && typeof raw === 'object') {
          this._publisherRecords.set(listing, raw);
        }
        Object.defineProperty(listing, '_alreadyStandardized', {
          value: true,
          enumerable: false,
          writable: true,
          configurable: true,
        });
        standardizedListings.push(listing);
      } catch (err) {
        if (err && err.code === 'LISTING_SCHEMA_INVALID') {
          console.warn(`[${this.name}] Dropped schema-invalid listing: ${err.message}`);
          continue;
        }
        throw err;
      }
    }

    if (runReport) {
      const unit = `${c.name || countyInfo.county},${c.state || 'TX'}`;
      recordUnitSuccess(runReport, unit, standardizedListings.length);
    }

    return standardizedListings;
  }

  parseTexasTaxSaleHtml(html, countyKey, options = {}) {
    return parseTexasTaxSaleHtml(html, countyKey, options);
  }

  parseTexasTaxSaleCard(html, countyKey, options = {}) {
    return parseTexasTaxSaleCard(html, countyKey, options);
  }

  getNextTexasTaxSaleDate(fromDate) {
    return getNextTexasTaxSaleDate(fromDate);
  }

  async fetchCountyRealauction(county) {
    const isTaxDeed = String(county.domain || '').toLowerCase().includes('realtaxdeed.com');
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    const baseUrl = `https://${county.domain}`;
    const url = `${baseUrl}/index.cfm?zaction=AUCTION&zmethod=PREVIEW`;
    try {
      const html = await this.requestText(url, {
        headers: {
          'User-Agent': ua,
          Accept: 'text/html,application/xhtml+xml',
        }
      });
      if (Array.isArray(this._htmlSamples)) this._htmlSamples.push(html);
      let listings = this.parseRealauctionHtml(html, county);

      // If initial page has no parseable rows, execute ColdFusion session + AJAX load protocol
      if (listings.length === 0 && !html.includes('nonstandard skin') && !html.includes('<div id="root">')) {
        try {
          const fetcher = this.fetchImpl || globalThis.fetch;
          const res1 = await fetcher(url, {
            headers: {
              'User-Agent': ua,
              Accept: 'text/html,application/xhtml+xml',
            },
          });
          const rawCookies = res1?.headers?.getSetCookie ? res1.headers.getSetCookie() : [res1?.headers?.get?.('set-cookie')];
          const cookieHeader = (rawCookies || []).filter(Boolean).map((c) => c.split(';')[0]).join('; ');

          const nextMatch = html.match(/class="BLHeaderNext[^"]*"[\s\S]*?AuctionDate=([0-9\/]+)/i);
          const todayMatch = html.match(/class="BLHeaderToday[^"]*"[\s\S]*?AuctionDate=([0-9\/]+)/i);
          const allDates = [...html.matchAll(/AuctionDate=([0-9\/]+)/gi)].map((m) => m[1]);
          const candidateDates = [...new Set([todayMatch?.[1], nextMatch?.[1], ...allDates].filter(Boolean))];

          const datesToTry = candidateDates.length > 0 ? candidateDates.slice(0, 2) : [null];

          for (const targetDate of datesToTry) {
            if (targetDate) {
              try {
                await fetcher(`${url}&AuctionDate=${encodeURIComponent(targetDate)}`, {
                  headers: { 'User-Agent': ua, Cookie: cookieHeader },
                });
              } catch (_) {}
            }

            const accumulatedListings = [];
            const maxPages = Math.max(1, Math.min(5, Number(process.env.REALAUCTION_MAX_PAGES_PER_DATE) || 3));
            for (let page = 0; page < maxPages; page++) {
              const ajaxUrl = `${baseUrl}/index.cfm?zaction=AUCTION&Zmethod=UPDATE&FNC=LOAD&AREA=W&PageDir=${page}&doR=1&tx=${Date.now()}&bypassPage=1&test=1`;
              const res2 = await fetcher(ajaxUrl, {
                headers: {
                  'User-Agent': ua,
                  Cookie: cookieHeader,
                  'X-Requested-With': 'XMLHttpRequest',
                },
              });
              if (res2 && res2.ok) {
                const rawJson = (await res2.text()).trim();
                let json = null;
                try { json = JSON.parse(rawJson); } catch (_) {}
                if (json && json.retHTML) {
                  const decoded = decodeRealAuctionMacros(json.retHTML);
                  if (Array.isArray(this._htmlSamples)) this._htmlSamples.push(decoded);
                  const pageListings = this.parseRealauctionHtml(decoded, county, { saleDate: targetDate });
                  if (pageListings.length > 0) {
                    accumulatedListings.push(...pageListings);
                  }
                  if (pageListings.length < 10) break;
                } else {
                  break;
                }
              } else {
                break;
              }
            }

            try {
              const cancelUrl = `${baseUrl}/index.cfm?zaction=AUCTION&Zmethod=UPDATE&FNC=LOAD&AREA=C&PageDir=0&doR=1&tx=${Date.now()}&bypassPage=1&test=1`;
              const resCancel = await fetcher(cancelUrl, {
                headers: {
                  'User-Agent': ua,
                  Cookie: cookieHeader,
                  'X-Requested-With': 'XMLHttpRequest',
                },
              });
              if (resCancel && resCancel.ok) {
                const rawCancelJson = (await resCancel.text()).trim();
                let cancelJson = null;
                try { cancelJson = JSON.parse(rawCancelJson); } catch (_) {}
                if (cancelJson && cancelJson.retHTML) {
                  const decodedCancel = decodeRealAuctionMacros(cancelJson.retHTML);
                  if (Array.isArray(this._htmlSamples)) this._htmlSamples.push(decodedCancel);
                  const cancelListings = this.parseRealauctionHtml(decodedCancel, county, { saleDate: targetDate, area: 'C' });
                  if (cancelListings.length > 0) {
                    accumulatedListings.push(...cancelListings);
                  }
                }
              }
            } catch (_) {}

            if (accumulatedListings.length > 0) {
              return accumulatedListings;
            }
          }
        } catch (_) {
          // ColdFusion AJAX failed or mock rejected; fall through to Scrapling
        }
      }

      if (!listings.length && this.useScrapling && typeof this.extract === 'function') {
        try {
          const extracted = await this.extract('table-extract', { html, url });
          this._lastExtraction = extracted;
          if (Array.isArray(extracted?.rows) && extracted.rows.length) {
            listings = this.parseExtractedTableRows(extracted.rows, county, url);
          }
        } catch (err) {
          this._lastExtraction = { error: String(err?.message || err), code: err?.code || null };
        }
      }
      return listings;
    } catch (err) {
      throw err;
    }
  }

  parseRealauctionHtml(html, county, options = {}) {
    const listings = [];
    const isTaxDeed = String(county.domain || '').toLowerCase().includes('realtaxdeed.com');

    // Broader row matcher: Realauction markup varies by county skin.
    const itemRegex = /<tr[^>]*class="[^"]*(?:table-row|auction-row|sale-row|DataRow)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;

    while ((match = itemRegex.exec(html)) !== null) {
      const row = match[1];
      const caseMatch = row.match(/Case\s*(?:#|No\.)?\s*([A-Z0-9-]+)/i) || row.match(/CV-[0-9-]+/i) || row.match(/\b(\d{2,4}[A-Z]{0,2}-\d{2,6})\b/);
      const addressMatch =
        row.match(/class="[^"]*address[^"]*"[^>]*>([^<]+)<\//i) ||
        row.match(/(?:property\s*address|address)\s*:?\s*([^<\n]{8,120})/i) ||
        row.match(/>(\d{1,6}\s+[NSEW]?\s*[A-Za-z0-9 .'-]{4,80}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Place|Pl)\.?[^<]*)</i);
      const bidMatch =
        row.match(/(?:Opening|Upset|Minimum)\s*Bid\s*:?\s*\$?\s*([0-9,]+)/i) ||
        row.match(/bid\s*:?\s*\$([0-9,]+)/i);
      const appraisalMatch = row.match(/Apprais(?:al|ed(?:\s*Value)?)\s*:?\s*\$?\s*([0-9,]+)/i);
      const saleDateMatch = row.match(/(?:Sale|Auction)\s*Date\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
      const linkMatch = row.match(/href=["']([^"']+)["']/i);

      if (addressMatch && caseMatch && linkMatch) {
        const address = addressMatch[1].trim();
        const openingBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, ''), 10) : null;
        const appraisal = appraisalMatch ? parseInt(appraisalMatch[1].replace(/,/g, ''), 10) : null;
        const saleDate = saleDateMatch ? this.normalizeSaleDate(saleDateMatch[1]) : null;
        const caseNum = caseMatch[1] || caseMatch[0];
        const id = `SHERIFF-${county.state}-${county.name.slice(0, 3).toUpperCase()}-${caseNum.replace(/[^a-zA-Z0-9-]/g, '')}`;
        const sourceUrl = linkMatch[1].startsWith('http')
          ? linkMatch[1]
          : new URL(linkMatch[1], `https://${county.domain}`).toString();

        listings.push({
          id,
          state: county.state,
          county: county.name,
          city: null,
          zip: null,
          address,
          openingBid,
          estLow: null,
          estHigh: null,
          assessed: appraisal,
          saleDate,
          plaintiff: null,
          defendant: null,
          judgment: null,
          attorney: null,
          occupancy: null,
          deposit: null,
          sourceUrl,
          raw: row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
          sourceFacts: appraisal == null ? null : { appraisedValue: appraisal },
          provenance: {
            origin: 'live',
            observed: true,
            publisher: isTaxDeed ? `${county.name} County Tax Deed` : `${county.name} County Sheriff`,
            recordId: caseNum,
            platform: isTaxDeed ? 'realtaxdeed' : 'realauction',
          },
        });
      }
    }

    if (listings.length === 0) {
      const docketCards = parseRealAuctionDocketHtml(html, county.name, county.state, {
        domain: county.domain,
        mode: isTaxDeed ? 'taxdeed' : 'foreclosure',
        saleDate: options && options.saleDate ? options.saleDate : null,
      });
      for (const parsed of docketCards) {
        const refId = parsed.caseNumber || parsed.certificateNumber || parsed.auctionId;
        if (!refId || !parsed.address) continue;
        let openingBid = parsed.openingBid;
        let saleDate = parsed.saleDate ? this.normalizeSaleDate(parsed.saleDate) : null;
        if ((openingBid == null || saleDate == null) && parsed.cardHtml && typeof this.extractWithAdaptiveFallback === 'function') {
          const adaptive = this.extractWithAdaptiveFallback(parsed.cardHtml, {
            caseNumber: { selector: '.case-id', extractor: (h) => (h.match(/(?:case\s*(?:#|no\.?)|certificate\s*(?:#|no\.?)):?\s*([0-9a-za-z\-_]+)/i)?.[1] || String(refId)) },
            openingBid: { selector: '.opening-bid', extractor: (h) => (h.match(/(?:opening|starting|minimum|upset)\s*bid:?\s*\$([\d,]+(?:\.\d{2})?)/i)?.[1]?.replace(/,/g, '') || null) },
            saleDateText: { selector: '.sale-date', extractor: (h) => (h.match(/(?:auction|sale)\s*date:?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i)?.[1] || null) },
          }, { persistSelectors: false });
          if (adaptive && adaptive.identityPassed) {
            if (openingBid == null && adaptive.fields.openingBid) {
              const num = parseFloat(String(adaptive.fields.openingBid).replace(/,/g, ''));
              if (Number.isFinite(num) && num > 0) openingBid = Math.round(num);
            }
            if (saleDate == null && adaptive.fields.saleDateText) {
              saleDate = this.normalizeSaleDate(adaptive.fields.saleDateText);
            }
          }
        }
        const id = `SHERIFF-${county.state}-${county.name.slice(0, 3).toUpperCase()}-${String(refId).replace(/[^a-zA-Z0-9-]/g, '')}`;

        let sourceFacts = null;
        if (parsed.assessed != null || parsed.certificateNumber || parsed.homestead != null || parsed.status || parsed.cancellationReason || parsed.priorPostponements != null || parsed.statutoryStayExhausted != null) {
          sourceFacts = {};
          if (parsed.assessed != null) {
            sourceFacts.appraisedValue = Math.round(parsed.assessed);
          }
          if (parsed.certificateNumber) {
            sourceFacts.certificateNumber = parsed.certificateNumber;
          }
          if (parsed.homestead != null) {
            sourceFacts.homestead = parsed.homestead;
          }
          if (parsed.status) {
            sourceFacts.auctionStatus = parsed.status;
          }
          if (parsed.cancellationReason) {
            sourceFacts.cancellationReason = parsed.cancellationReason;
          }
          if (parsed.priorPostponements != null) {
            sourceFacts.priorPostponements = parsed.priorPostponements;
          }
          if (parsed.statutoryStayExhausted != null) {
            sourceFacts.statutoryStayExhausted = parsed.statutoryStayExhausted;
          }
        }

        listings.push({
          id,
          state: county.state,
          county: county.name,
          city: null,
          zip: parsed.zip || null,
          address: parsed.address,
          apn: parsed.parcelId || null,
          openingBid: openingBid != null ? Math.round(openingBid) : null,
          estLow: null,
          estHigh: null,
          assessed: parsed.assessed != null ? Math.round(parsed.assessed) : null,
          saleDate,
          propType: parsed.propType || null,
          plaintiff: parsed.plaintiff || null,
          defendant: parsed.defendant || null,
          judgment: parsed.judgment != null ? Math.round(parsed.judgment) : null,
          attorney: parsed.attorney || null,
          occupancy: null,
          deposit: null,
          sourceUrl: parsed.sourceUrl,
          raw: JSON.stringify(parsed).slice(0, 2000),
          sourceFacts,
          provenance: {
            origin: 'live',
            observed: true,
            publisher: isTaxDeed ? `${county.name} County Tax Deed` : `${county.name} County Sheriff`,
            recordId: String(refId),
            platform: isTaxDeed ? 'realtaxdeed' : (parsed.platform || 'realauction'),
            sourceFacts,
          },
        });
      }
    }

    return listings;
  }

  normalizeSaleDate(raw) {
    if (!raw) return null;
    const text = String(raw).trim();
    let m = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      let [, mo, dy, yr] = m;
      if (yr.length === 2) {
        yr = '20' + yr;
      }
      return `${yr}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}`;
    }
    m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return text;
    return null;
  }

  parseExtractedTableRows(rows, county, baseUrl) {
    const listings = [];
    for (const cells of (rows || [])) {
      if (!Array.isArray(cells) || cells.length < 2) continue;
      const line = cells.map((c) => String(c || '').trim()).filter(Boolean).join(' | ');
      const caseMatch = line.match(/Case\s*(?:#|No\.)?\s*([A-Z0-9-]+)/i) || line.match(/\b(CV-[0-9-]+|\d{2,4}[A-Z]{0,2}-\d{2,6})\b/i);
      const addressMatch = line.match(/\b(\d{1,6}\s+[NSEW]?\s*[A-Za-z0-9 .'-]{4,80}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Trail|Trl)\.?[^|]*)/i);
      if (!caseMatch || !addressMatch) continue;
      const bidMatch = line.match(/(?:Opening|Upset|Minimum)\s*Bid\s*:?\s*\$?\s*([0-9,]+)/i) || line.match(/\$([0-9,]+)/);
      const appraisalMatch = line.match(/Apprais(?:al|ed(?:\s*Value)?)\s*:?\s*\$?\s*([0-9,]+)/i);
      const saleDateMatch = line.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/);
      const caseNum = caseMatch[1] || caseMatch[0];
      const address = addressMatch[1].trim();
      const openingBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, ''), 10) : null;
      const appraisal = appraisalMatch ? parseInt(appraisalMatch[1].replace(/,/g, ''), 10) : null;
      const saleDate = saleDateMatch ? this.normalizeSaleDate(saleDateMatch[1]) : null;
      const id = `SHERIFF-${county.state}-${county.name.slice(0, 3).toUpperCase()}-${caseNum.replace(/[^a-zA-Z0-9-]/g, '')}`;
      let sourceUrl = `${baseUrl}#case-${encodeURIComponent(caseNum)}`;
      try {
        const u = new URL(baseUrl);
        u.searchParams.set('case', caseNum);
        u.hash = `case-${encodeURIComponent(caseNum)}`;
        sourceUrl = u.toString();
      } catch (_) {}
      listings.push({
        id,
        state: county.state,
        county: county.name,
        city: null,
        zip: null,
        address,
        openingBid,
        estLow: null,
        estHigh: null,
        assessed: appraisal,
        saleDate,
        plaintiff: null,
        defendant: null,
        judgment: null,
        attorney: null,
        occupancy: null,
        deposit: null,
        sourceUrl,
        raw: line.slice(0, 2000),
        sourceFacts: appraisal == null ? null : { appraisedValue: appraisal },
        provenance: { origin: 'live', observed: true, publisher: `${county.name} County Sheriff`, recordId: caseNum, scraplingProfile: 'table-extract' },
      });
    }
    return listings;
  }

  async fetchCountyPublicNotices(county) {
    // Fallback public notice aggregation query
    const fallbackUrl = `https://publicnoticesohio.com/search?county=${encodeURIComponent(county.name)}`;
    try {
      const html = await this.requestText(fallbackUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        }
      });
      if (Array.isArray(this._htmlSamples)) this._htmlSamples.push(html);
      return this.parsePublicNoticeHtml(html, county);
    } catch (err) {
      // Rethrow rather than return [].
      //
      // This is the fallback leg: fetchCountyRealauction reaches it whenever the
      // primary portal returns no rows OR throws. Returning [] here made a
      // county with BOTH endpoints down indistinguishable from a county that
      // genuinely has no sheriff sales this week -- the caller then ran
      // recordUnitSuccess(unit, 0) and the run report reported a successful
      // county that had in fact collected nothing.
      //
      // Rethrowing puts it through the existing recordUnitFailure path in
      // collect(), so a dead endpoint shows up as a failure with a reason
      // instead of quietly becoming zero coverage.
      throw new Error(`[${this.name}] ${county.name}, ${county.state}: primary and public-notice fallback both failed: ${err.message}`);
    }
  }

  parsePublicNoticeHtml(html, county) {
    const listings = [];
    const noticeRegex = /<div[^>]*class="[^"]*notice-item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let match;

    while ((match = noticeRegex.exec(html)) !== null) {
      const block = match[1];
      const caseMatch = block.match(/CASE\s*NO\.?\s*([A-Z0-9-]+)/i);
      const addressMatch = block.match(/(\d+\s+[A-Za-z0-9\s,]+(?:Ave|St|Rd|Blvd|Dr|Lane|Ln|Way|Ct|Pl)[A-Za-z0-9\s,]*)/i);
      const bidMatch = block.match(/(?:Minimum bid|Opening bid|Appraised at)\s*\$([0-9,]+)/i);
      const linkMatch = block.match(/href=["']([^"']+)["']/i);

      if (addressMatch && caseMatch && linkMatch) {
        const address = addressMatch[1].trim();
        const openingBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, ''), 10) : null;
        const caseNum = caseMatch[1];
        const id = `SHERIFF-${county.state}-${county.name.slice(0, 3).toUpperCase()}-${caseNum.replace(/[^a-zA-Z0-9-]/g, '')}`;
        const sourceUrl = linkMatch[1].startsWith('http')
          ? linkMatch[1]
          : new URL(linkMatch[1], 'https://publicnoticesohio.com').toString();

        listings.push({
          id,
          state: county.state,
          county: county.name,
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
          judgment: null,
          attorney: null,
          occupancy: null,
          deposit: null,
          sourceUrl,
          raw: block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
          provenance: { origin: 'live', observed: true, publisher: 'Public Notices Ohio', recordId: caseNum },
        });
      }
    }

    return listings;
  }


  // Demo/Unsplash inventory overrides removed (2026-09-14 audit).
  // Live collectors must not fabricate listings; BaseScraper may still read
  // data/listings.snapshot.json as explicitly labeled fixture evidence.

}

module.exports = new SheriffSaleScraper();
module.exports.SheriffSaleScraper = SheriffSaleScraper;
module.exports.DEFAULT_OH_COUNTIES = DEFAULT_OH_COUNTIES;
module.exports.DEFAULT_FL_COUNTIES = DEFAULT_FL_COUNTIES;
module.exports.DEFAULT_TX_COUNTIES = DEFAULT_TX_COUNTIES;
module.exports.TEXAS_TAX_SALE_COUNTIES = TEXAS_TAX_SALE_COUNTIES;
module.exports.parseTexasTaxSaleHtml = parseTexasTaxSaleHtml;
module.exports.parseTexasTaxSaleCard = parseTexasTaxSaleCard;
module.exports.getNextTexasTaxSaleDate = getNextTexasTaxSaleDate;
module.exports.normalizeCountyInput = normalizeCountyInput;
module.exports.parseExtraCounties = parseExtraCounties;
