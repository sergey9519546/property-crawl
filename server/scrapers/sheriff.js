// server/scrapers/sheriff.js
//
// Realauction & County Judicial Foreclosure Sheriff Sale Scraper.
// Sources: Realauction Ohio portals (*.sheriffsaleauction.ohio.gov) & County Dockets
//
// Scrapes live sheriff sales, appraised values, upset prices, and court case metadata.

const BaseScraper = require('./base');
const { extractWithScrapling, isScraplingEnabled } = require('./scrapling-bridge');
const { createRunReport, recordUnitFailure, recordUnitSuccess, finalizeRunReport } = require('./run-report');

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
];

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
    this.counties = options.counties
      || [...DEFAULT_OH_COUNTIES, ...parseExtraCounties(process.env.SHERIFF_EXTRA_COUNTIES)];
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
      for (const c of this.counties) {
        const unit = `${c.name},${c.state}`;
        try {
          const countyListings = await this.fetchCountyRealauction(c);
          recordUnitSuccess(report, unit, countyListings.length);
          allListings.push(...countyListings);
        } catch (err) {
          recordUnitFailure(report, unit, err, 'county');
          console.warn(`[${this.name}] Warning for ${c.name} County: ${err.message}`);
        }
      }

      const standardized = allListings
        .filter(l => this.passesFilter(l))
        .map(l => this.standardizeListing(l));
      finalizeRunReport(report, { emitted: standardized.length });
      if (report.outcome === 'failed') {
        throw new Error(`SHERIFF_UPSTREAM_UNAVAILABLE: all ${this.counties.length} county endpoints failed`);
      }
      console.log(`[${this.name}] Standardized ${standardized.length} Sheriff Sale listings (${report.outcome})`);
      return standardized;
    });
  }

  async fetchCountyRealauction(county) {
    const url = `https://${county.domain}/index.cfm?zaction=AUCTION&zmethod=PREVIEW`;
    try {
      const html = await this.requestText(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        }
      });
      const listings = this.parseRealauctionHtml(html, county);
      return listings.length > 0 ? listings : this.fetchCountyPublicNotices(county);
    } catch (err) {
      return this.fetchCountyPublicNotices(county);
    }
  }

  parseRealauctionHtml(html, county) {
    const listings = [];
    const itemRegex = /<tr[^>]*class="[^"]*table-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;

    while ((match = itemRegex.exec(html)) !== null) {
      const row = match[1];
      const caseMatch = row.match(/Case\s*(?:#|No\.)?\s*([A-Z0-9-]+)/i) || row.match(/CV-[0-9-]+/i);
      const addressMatch = row.match(/class="[^"]*address[^"]*"[^>]*>([^<]+)<\//i);
      const bidMatch = row.match(/Opening Bid:\s*\$([0-9,]+)/i) || row.match(/\$([0-9,]+)/);
      const appraisalMatch = row.match(/Appraisal:\s*\$([0-9,]+)/i);
      const linkMatch = row.match(/href=["']([^"']+)["']/i);

      if (addressMatch && caseMatch && linkMatch) {
        const address = addressMatch[1].trim();
        const openingBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, ''), 10) : null;
        const appraisal = appraisalMatch ? parseInt(appraisalMatch[1].replace(/,/g, ''), 10) : null;
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
          assessed: null,
          saleDate: null,
          plaintiff: null,
          defendant: null,
          judgment: null,
          attorney: null,
          occupancy: null,
          deposit: null,
          sourceUrl,
          raw: row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
          sourceFacts: appraisal == null ? null : { appraisedValue: appraisal },
          provenance: { origin: 'live', observed: true, publisher: `${county.name} County Sheriff`, recordId: caseNum },
        });
      }
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
      return this.parsePublicNoticeHtml(html, county);
    } catch (err) {
      return [];
    }
  }

  parsePublicNoticeHtml(html, county) {
    const listings = [];
    const noticeRegex = /<div[^>]*class="[^"]*notice-item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let match;

    while ((match = noticeRegex.exec(html)) !== null) {
      const block = match[1];
      const caseMatch = block.match(/CASE\s*NO\.?\s*([A-Z0-9-]+)/i);
      const addressMatch = block.match(/(\d+\s+[A-Za-z0-9\s,]+(?:Ave|St|Rd|Blvd|Dr|Ln|Way|Ct|Pl)[A-Za-z0-9\s,]*)/i);
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
module.exports.parseExtraCounties = parseExtraCounties;
