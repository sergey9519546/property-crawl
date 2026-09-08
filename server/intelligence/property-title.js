'use strict';

const https = require('https');

const DEFAULT_BASE_URL = 'https://prod.api.market/api/v1/nicheapi-llc-1/propertytitle/v1/propertytitle';
const DEFAULT_API_KEY = 'cmjgtcjea0001jr04c5ckyyk0';

const RISK_BANDS = {
  CLEAN: { min: 0, max: 15, label: 'Clean Title', action: 'Proceed', color: 'green' },
  LOW: { min: 16, max: 35, label: 'Low Risk', action: 'Proceed with Caution', color: 'yellow' },
  MODERATE: { min: 36, max: 55, label: 'Moderate Risk', action: 'Enhanced Search', color: 'orange' },
  HIGH: { min: 56, max: 75, label: 'High Risk', action: 'Title Curative Required', color: 'red' },
  UNMARKETABLE: { min: 76, max: 100, label: 'Unmarketable Title', action: 'Do Not Bid / Escalate', color: 'darkred' }
};

class PropertyTitleClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.PROPERTY_TITLE_API_KEY || process.env.API_MARKET_KEY || DEFAULT_API_KEY;
    this.baseUrl = (options.baseUrl || process.env.PROPERTY_TITLE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = options.timeout || 12000;
  }

  async _request(path, method = 'GET', data = null) {
    const url = new URL(this.baseUrl + path);
    const headers = {
      'x-api-market-key': this.apiKey,
      'Content-Type': 'application/json'
    };

    let payload = null;
    if (data && (method === 'POST' || method === 'PUT')) {
      payload = typeof data === 'string' ? data : JSON.stringify(data);
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method,
        headers,
        timeout: this.timeout
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          let parsed;
          try {
            parsed = body ? JSON.parse(body) : null;
          } catch {
            parsed = { raw: body };
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, status: res.statusCode, data: parsed });
          } else {
            resolve({
              ok: false,
              status: res.statusCode,
              error: (parsed && parsed.message) || `HTTP error ${res.statusCode}`,
              data: parsed
            });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`PropertyTitle request timeout after ${this.timeout}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  async healthCheck() {
    try {
      const res = await this._request('/health', 'GET');
      return res.ok ? res.data : { status: 'error', error: res.error };
    } catch (err) {
      return { status: 'offline', error: err.message };
    }
  }

  async listProperties(params = {}) {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    if (params.state) query.set('state', String(params.state));
    if (params.county) query.set('country', String(params.county));
    if (params.property_type) query.set('property_type', String(params.property_type));
    if (params.q) query.set('q', String(params.q));

    const qs = query.toString() ? `?${query.toString()}` : '';
    return this._request(`/properties${qs}`, 'GET');
  }

  async getProperty(propertyId) {
    if (!propertyId) throw new Error('propertyId is required');
    return this._request(`/properties/${encodeURIComponent(propertyId)}`, 'GET');
  }

  async analyzeProperty(propertyId, factorWeights = null) {
    if (!propertyId) throw new Error('propertyId is required');
    const body = { property_id: propertyId };
    if (factorWeights && typeof factorWeights === 'object') {
      body.factor_weights = factorWeights;
    }
    return this._request('/analyze', 'POST', body);
  }

  async batchAnalyze(analyses) {
    if (!Array.isArray(analyses) || analyses.length === 0) {
      throw new Error('analyses must be a non-empty array');
    }
    return this._request('/analyze/batch', 'POST', { analyses });
  }

  async listLiens(params = {}) {
    const query = new URLSearchParams();
    if (typeof params === 'string') {
      query.set('property_id', params);
    } else {
      if (params.property_id) query.set('property_id', String(params.property_id));
      if (params.status) query.set('status', String(params.status));
      if (params.lien_type) query.set('lien_type', String(params.lien_type));
      if (params.min_amount) query.set('min_amount', String(params.min_amount));
      if (params.q) query.set('q', String(params.q));
    }
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this._request(`/liens${qs}`, 'GET');
  }

  async listEasements(params = {}) {
    const query = new URLSearchParams();
    if (typeof params === 'string') {
      query.set('property_id', params);
    } else {
      if (params.property_id) query.set('property_id', String(params.property_id));
      if (params.easement_type) query.set('easement_type', String(params.easement_type));
      if (params.burden_level) query.set('burden_level', String(params.burden_level));
    }
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this._request(`/easements${qs}`, 'GET');
  }

  async listTitleIssues(params = {}) {
    const query = new URLSearchParams();
    if (typeof params === 'string') {
      query.set('property_id', params);
    } else {
      if (params.property_id) query.set('property_id', String(params.property_id));
      if (params.severity) query.set('severity', String(params.severity));
      if (params.resolved !== undefined) query.set('resolved', String(params.resolved));
    }
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this._request(`/title-issues${qs}`, 'GET');
  }

  async getTaxStatus(params = {}) {
    const query = new URLSearchParams();
    if (typeof params === 'string') {
      query.set('property_id', params);
    } else {
      if (params.property_id) query.set('property_id', String(params.property_id));
      if (params.status) query.set('status', String(params.status));
      if (params.year) query.set('year', String(params.year));
    }
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this._request(`/tax-status${qs}`, 'GET');
  }

  async compareProperties(propertyIds) {
    const ids = Array.isArray(propertyIds) ? propertyIds.join(',') : propertyIds;
    if (!ids) throw new Error('propertyIds is required');
    return this._request(`/compare?ids=${encodeURIComponent(ids)}`, 'GET');
  }

  async getStatistics() {
    return this._request('/statistics', 'GET');
  }

  /**
   * Underwrite title risk by fusing auction notice details with title encumbrance intelligence.
   * Calculates surviving lien exposure, delinquent tax adders, and cash-to-close adjustments.
   *
   * @param {Object} listing - Auction listing details (openingBid, foreclosingParty, etc.)
   * @param {Object} titleAnalysis - Result from analyzeProperty() or raw title data
   */
  underwriteAuctionTitle(listing = {}, titleAnalysis = {}) {
    const analysis = titleAnalysis.data || titleAnalysis;
    const encumbranceScore = typeof analysis.composite_encumbrance_score === 'number'
      ? analysis.composite_encumbrance_score
      : 0;

    let riskClassification = RISK_BANDS.CLEAN;
    for (const band of Object.values(RISK_BANDS)) {
      if (encumbranceScore >= band.min && encumbranceScore <= band.max) {
        riskClassification = band;
        break;
      }
    }

    const delinquentTaxes = (analysis.tax_status && analysis.tax_status.total_balance_due) || 0;
    const courtJudgments = (analysis.court_judgments && analysis.court_judgments.total_amount) || 0;
    const hoaDue = (analysis.hoa_status && analysis.hoa_status.total_due) || 0;

    // Lien survival analysis
    const foreclosingType = (listing.foreclosureType || listing.sourceType || '').toLowerCase();
    const isJuniorForeclosure = foreclosingType.includes('hoa') || foreclosingType.includes('mechanic');

    let survivingSeniorLiens = 0;
    if (isJuniorForeclosure && analysis.factor_attribution && analysis.factor_attribution.liens) {
      // In junior foreclosures, senior mortgages survive the sale
      survivingSeniorLiens = analysis.active_lien_value || 0;
    }

    // Required cash adders on top of bid
    const estimatedCashAdders = delinquentTaxes + (isJuniorForeclosure ? survivingSeniorLiens : 0);

    return {
      propertyId: analysis.property_id || listing.id,
      address: analysis.property_address || listing.address,
      encumbranceScore,
      riskBand: riskClassification.label,
      recommendedAction: riskClassification.action,
      riskColor: riskClassification.color,
      lienSurvival: {
        isJuniorForeclosure,
        survivingSeniorLiens,
        rationale: isJuniorForeclosure
          ? 'Foreclosing party appears junior; senior mortgages may survive auction sale in full.'
          : 'Foreclosure appears to be senior lender; junior judgment liens extinguished upon confirmation.'
      },
      cashToCloseImpact: {
        delinquentTaxes,
        hoaDue,
        survivingSeniorLiens,
        estimatedTotalAdders: estimatedCashAdders
      },
      curativeRecommendations: analysis.recommendations || [],
      underwrittenAt: new Date().toISOString()
    };
  }
}

const defaultClient = new PropertyTitleClient();

module.exports = {
  PropertyTitleClient,
  RISK_BANDS,
  defaultClient,
  analyzeProperty: (id, weights) => defaultClient.analyzeProperty(id, weights),
  batchAnalyze: (analyses) => defaultClient.batchAnalyze(analyses),
  listProperties: (params) => defaultClient.listProperties(params),
  getProperty: (id) => defaultClient.getProperty(id),
  listLiens: (params) => defaultClient.listLiens(params),
  getTaxStatus: (params) => defaultClient.getTaxStatus(params),
  underwriteAuctionTitle: (listing, titleData) => defaultClient.underwriteAuctionTitle(listing, titleData)
};
