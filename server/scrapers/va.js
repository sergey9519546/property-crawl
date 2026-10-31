// server/scrapers/va.js
//
// Veterans Affairs (VA) REO Property Scraper.
// Source: https://vrmproperties.com
//
// Scrapes acquired properties managed by VRM Mortgage Services for VA.

const BaseScraper = require('./base');
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');
const {
  createRunReport,
  recordUnitFailure,
  recordUnitSuccess,
  finalizeRunReport,
  looksLikeClientRenderedShell,
  applyEmptyInventoryHonesty,
} = require('./run-report');
const { spaXhrEnabled, captureSpaXhr, mapCapturedItems } = require('./spa-xhr');
const { validateListingShape } = require('./listing-schema');

class VaReoScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'VaReoScraper', sourceKey: 'va' });
    // Publisher base is operator-configurable: the historical vrmproperties.com
    // host has returned 404; VA REO disposition channels have moved over time.
    this.baseUrl = (process.env.VA_REO_BASE_URL || 'https://vrmproperties.com').replace(/\/$/, '');
    this.timeoutMs = 4000;
    this.useScrapling = options.useScrapling ?? isScraplingEnabled('va');
    this.extract = options.extractImpl || extractWithScrapling;
    this.lastRunReport = null;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const topStates = (process.env.VA_REO_STATES || 'TX,FL,OH,GA,NC,VA,PA,CA')
        .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const report = createRunReport('va', { endpoint: this.baseUrl, states: topStates });
      report.statesRequested = [...topStates];
      report.endpointsTried = topStates.length;
      this.lastRunReport = report;

      const results = await Promise.allSettled(topStates.map(state => this.fetchStateListings(state)));
      const allListings = [];
      const htmlSamples = [];
      results.forEach((res, index) => {
        const state = topStates[index];
        if (res.status === 'fulfilled' && Array.isArray(res.value?.listings)) {
          recordUnitSuccess(report, state, res.value.listings.length);
          if (res.value.html) htmlSamples.push(res.value.html);
          allListings.push(...res.value.listings);
        } else if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          recordUnitSuccess(report, state, res.value.length);
          allListings.push(...res.value);
        } else {
          recordUnitFailure(report, state, res.status === 'rejected' ? res.reason : new Error('non-array result'), 'upstream');
        }
      });

      const standardized = allListings
        .filter(l => this.passesFilter(l))
        .map(l => this.standardizeListing(l));
      finalizeRunReport(report, { emitted: standardized.length });
      if (report.outcome === 'failed') {
        throw new Error(`VA_UPSTREAM_UNAVAILABLE: all ${topStates.length} VA REO state endpoints failed for ${this.baseUrl}`);
      }
      applyEmptyInventoryHonesty(report, { emitted: standardized.length, htmlSamples, sourceKey: 'va' });
      console.log(`[${this.name}] Standardized ${standardized.length} VA REO listings (${report.outcome})`);
      return standardized;
    });
  }

  async fetchStateListings(state) {
    const url = `${this.baseUrl}/api/properties?state=${encodeURIComponent(state)}`;
    try {
      const payload = await this.requestText(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
        }
      });
      const data = JSON.parse(payload);
      const items = Array.isArray(data) ? data : (data.properties || data.results || []);
      const listings = items.map(p => this.mapJsonItem(p, state)).filter(Boolean);
      if (!listings.length) return this.fetchStateHtml(state);
      return { listings, html: null };
    } catch (err) {
      return this.fetchStateHtml(state);
    }
  }

  async fetchStateHtml(state) {
    const searchUrl = `${this.baseUrl}/search-properties?state=${state}`;
    const html = await this.requestText(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      }
    });
    let listings = this.parseHtmlCards(html, state);
    if (!listings.length && this.useScrapling && typeof this.extract === 'function') {
      try {
        const extracted = await this.extract('table-extract', { html, url: searchUrl });
        this._lastExtraction = extracted;
        if (Array.isArray(extracted?.rows) && extracted.rows.length) {
          listings = this.parseExtractedRows(extracted.rows, state);
        }
      } catch (err) {
        this._lastExtraction = { error: String(err?.message || err), code: err?.code || null };
      }
    }
    if (!listings.length && typeof this.extractEmbeddedState === 'function') {
      const embedded = this.extractEmbeddedState(html);
      if (embedded.inlineProperties && embedded.inlineProperties.length > 0) {
        listings = embedded.inlineProperties.map((p) => this.mapJsonItem(p, state)).filter(Boolean);
      }
      if (!listings.length && embedded.jsonLd && embedded.jsonLd.length > 0) {
        listings = this.parseJsonLdProperties(embedded.jsonLd, state);
      }
    }
    if (!listings.length && looksLikeClientRenderedShell(html)) {
      if (spaXhrEnabled('va', process.env)) {
        const xhr = await captureSpaXhr(searchUrl, { sourceKey: 'va' });
        if (xhr.ok && Array.isArray(xhr.items) && xhr.items.length) {
          const mapped = mapCapturedItems(this, xhr.items, state)
            .map((item) => ({ ...item, provenance: { ...(item.provenance || {}), spaXhr: true, capturedUrls: xhr.capturedUrls || [] } }));
          const usable = mapped.filter((item) => validateListingShape(item).valid);
          if (usable.length) return { listings: usable, html, spaXhr: true };
        }
      }
      throw new Error(`VA_SPA_SHELL ${state}: client-rendered VA REO page has no parseable listing cards (not empty inventory)`);
    }
    return { listings, html };
  }

  parseHtmlCards(html, state) {
    const listings = [];
    const cardRegex = /<div[^>]*class="[^"]*property-item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];
      const addressMatch = card.match(/class="[^"]*property-address[^"]*"[^>]*>([^<]+)<\//i);
      const priceMatch = card.match(/\$([0-9,]+)/);
      const idMatch = card.match(/data-id="([^"]+)"/i) || card.match(/href="\/property\/([^"]+)"/i);

      if (addressMatch && idMatch) {
        const address = addressMatch[1].trim();
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
        const id = `VA-${idMatch[1]}`;

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
          sourceUrl: `${this.baseUrl}/property/${id.replace(/^VA-/, '')}`,
          raw: card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
          provenance: { origin: 'live', observed: true, publisher: 'VRM Properties', recordId: idMatch[1] },
        });
      }
    }

    return listings;
  }

  parseExtractedRows(rows, state) {
    const listings = [];
    for (const cells of (rows || [])) {
      if (!Array.isArray(cells) || cells.length < 2) continue;
      const line = cells.map((c) => String(c || '').trim()).filter(Boolean).join(' | ');
      const idMatch = line.match(/\b(?:VA-|id\s*[:#]?\s*)([A-Z0-9-]{3,})\b/i) || line.match(/\b(\d{5,})\b/);
      const address = String(cells[0] || cells[1] || '').trim();
      const priceMatch = line.match(/\$([0-9,]+)/);
      if (!idMatch || !/^\d/.test(address)) continue;
      const propId = String(idMatch[1]).replace(/^VA-/i, '');
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
      listings.push({
        id: `VA-${propId}`,
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
        sourceUrl: `${this.baseUrl}/property/${propId}`,
        raw: line.slice(0, 2000),
        provenance: { origin: 'live', observed: true, publisher: 'VRM Properties', recordId: propId, scraplingProfile: 'table-extract' },
      });
    }
    return listings;
  }

  mapJsonItem(p, state) {
    const price = p.listPrice ?? p.price ?? p.openingBid ?? null;
    const propId = p.id || p.propertyId || p.vrmNumber;
    const address = p.address || `${p.street || ''}, ${p.city || ''}, ${state} ${p.zip || ''}`.trim();

    if (!propId || !address || !address.replace(/[\s,]/g, '')) return null;

    return {
      id: `VA-${propId}`,
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
      saleDate: p.auctionDate ?? p.listDate ?? null,
      plaintiff: null,
      defendant: null,
      judgment: null,
      attorney: p.listingAgent ?? null,
      occupancy: p.occupancy ?? null,
      deposit: p.earnestMoney ?? p.deposit ?? null,
      photoUrl: p.photoUrl ?? p.imageUrl ?? null,
      sourceUrl: p.url ? (p.url.startsWith('http') ? p.url : `${this.baseUrl}${p.url}`) : `${this.baseUrl}/property/${propId}`,
      raw: JSON.stringify(p),
      provenance: { origin: 'live', observed: true, publisher: 'VRM Properties', recordId: String(propId) },
    };
  }


  parseJsonLdProperties(jsonLdList, state) {
    const listings = [];
    for (const item of (jsonLdList || [])) {
      if (!item || !item.address) continue;
      const idMatch = item.url ? item.url.match(/property\/([A-Za-z0-9_-]+)/i) : null;
      const propId = idMatch ? idMatch[1] : (item.name ? item.name.replace(/[^A-Za-z0-9-]/g, '') : null);
      if (!propId) continue;
      listings.push({
        id: `VA-${propId}`,
        state,
        county: null,
        city: item.address.split(',')[1]?.trim() || null,
        zip: item.address.match(/\b\d{5}\b/)?.[0] || null,
        address: item.address,
        lat: item.lat || null,
        lng: item.lng || null,
        beds: item.beds || null,
        baths: item.baths || null,
        sqft: item.sqft || null,
        openingBid: item.price || null,
        estLow: null,
        estHigh: null,
        assessed: null,
        saleDate: null,
        plaintiff: null,
        defendant: null,
        occupancy: null,
        deposit: null,
        sourceUrl: item.url || `${this.baseUrl}/property/${propId}`,
        raw: JSON.stringify(item).slice(0, 2000),
        provenance: { origin: 'live', observed: true, publisher: 'VRM Properties', recordId: propId, embeddedFormat: 'json-ld' },
      });
    }
    return listings;
  }

  // Demo/Unsplash inventory overrides removed (2026-09-14 audit).
  // Live collectors must not fabricate listings; BaseScraper may still read
  // data/listings.snapshot.json as explicitly labeled fixture evidence.

}

module.exports = new VaReoScraper();
module.exports.VaReoScraper = VaReoScraper;
