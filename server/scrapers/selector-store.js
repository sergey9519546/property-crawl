'use strict';

/**
 * server/scrapers/selector-store.js
 *
 * Adaptive Presentation Selector Store (P1.8).
 * Manages fallback CSS/XPath selector candidates for non-identity presentation attributes
 * (beds, baths, sqft, propertyType).
 *
 * ZERO-FABRICATION & NON-NEGOTIABLE SECURITY DIRECTIVE:
 * Identity and valuation fields (id, address, openingBid, caseNumber, parcelId, apn, etc.)
 * are STRICTLY NOT ADAPTIVE and MUST remain deterministic (fail closed).
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CACHE_DIR = path.resolve(__dirname, '../../.cache/scrapling-selectors');

const FORBIDDEN_FIELDS = new Set([
  'id',
  'address',
  'openingbid',
  'currentbid',
  'casenumber',
  'parcelid',
  'apn',
  'docketnumber',
  'judgmentamount',
  'depositamount',
  'taxamount',
  'saledate',
  'saledatetext','addresstext','occupancystatus','occupancy','status'
]);

const ALLOWED_PRESENTATION_FIELDS = new Set([
  'beds',
  'baths',
  'sqft',
  'propertytype'
]);

const FIELD_CANONICAL_NAMES = {
  beds: 'beds',
  bedrooms: 'beds',
  baths: 'baths',
  bathrooms: 'baths',
  sqft: 'sqft',
  squarefeet: 'sqft',
  square_feet: 'sqft',
  sq_ft: 'sqft',
  propertytype: 'propertyType',
  prop_type: 'propertyType',
  proptype: 'propertyType',
  property_type: 'propertyType',
  openingbid: 'openingBid',
  opening_bid: 'openingBid',
  currentbid: 'currentBid',
  current_bid: 'currentBid',
  casenumber: 'caseNumber',
  case_number: 'caseNumber',
  parcelid: 'parcelId',
  parcel_id: 'parcelId',
  docketnumber: 'docketNumber',
  docket_number: 'docketNumber',
  saledate: 'saleDate',
  sale_date: 'saleDate'
};

const DEFAULT_CANDIDATE_SELECTORS = {
  beds: [
    '.beds',
    '.bedrooms',
    '[data-field="beds"]',
    '.prop-beds',
    '//span[contains(text(),"Bed")]/following-sibling::text()',
    '//td[contains(text(),"Bed")]/following-sibling::td'
  ],
  baths: [
    '.baths',
    '.bathrooms',
    '[data-field="baths"]',
    '.prop-baths',
    '//span[contains(text(),"Bath")]/following-sibling::text()',
    '//td[contains(text(),"Bath")]/following-sibling::td'
  ],
  sqft: [
    '.sqft',
    '.square-feet',
    '[data-field="sqft"]',
    '.prop-sqft',
    '//span[contains(text(),"Sq Ft") or contains(text(),"Square Feet")]',
    '//td[contains(text(),"Sq Ft") or contains(text(),"Square Feet")]/following-sibling::td'
  ],
  propertyType: [
    '.property-type',
    '.prop-type',
    '[data-field="propertyType"]',
    '//span[contains(text(),"Property Type")]',
    '//td[contains(text(),"Property Type")]/following-sibling::td'
  ]
};

function normalizeFieldKey(field) {
  const clean = String(field || '').trim();
  const lower = clean.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return FIELD_CANONICAL_NAMES[lower] || clean;
}

function isIdentityOrValuationField(field) {
  const clean = String(field || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return FORBIDDEN_FIELDS.has(clean);
}

function isAdaptiveAllowed(field) {
  if (isIdentityOrValuationField(field)) {
    return false;
  }
  const canonical = normalizeFieldKey(field).toLowerCase();
  return ALLOWED_PRESENTATION_FIELDS.has(canonical);
}

class SelectorStore {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
    this.persist = options.persist !== false;
    this.memoryStore = new Map();
  }

  _getStoreKey(sourceKey) {
    return String(sourceKey || 'unknown').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  }

  _getFilePath(sourceKey) {
    const key = this._getStoreKey(sourceKey);
    return path.join(this.cacheDir, `${key}.json`);
  }

  _loadSourceStore(sourceKey) {
    const key = this._getStoreKey(sourceKey);
    if (this.memoryStore.has(key)) {
      return this.memoryStore.get(key);
    }

    let loaded = { selectors: {}, history: [] };
    const filePath = this._getFilePath(sourceKey);

    if (this.persist && fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          loaded = {
            selectors: parsed.selectors || {},
            history: Array.isArray(parsed.history) ? parsed.history : []
          };
        }
      } catch (_) {
        // Fall back to clean state on corrupted cache
      }
    }

    this.memoryStore.set(key, loaded);
    return loaded;
  }

  _saveSourceStore(sourceKey) {
    if (!this.persist) return;
    const key = this._getStoreKey(sourceKey);
    const store = this.memoryStore.get(key);
    if (!store) return;

    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const filePath = this._getFilePath(sourceKey);
      fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
    } catch (_) {
      // Non-fatal persistence write failure
    }
  }

  /**
   * Resolves the primary active selector or fallback candidate for a given presentation field.
   *
   * @param {string} sourceKey - Originating scraper source.
   * @param {string} fieldName - Target field name.
   * @param {Object} [options={}] - Options.
   * @returns {string|null} Resolved CSS/XPath selector string.
   * @throws {Error} If fieldName is an identity or valuation field.
   */
  resolveSelector(sourceKey, fieldName, options = {}) {
    if (isIdentityOrValuationField(fieldName)) {
      const err = new Error(
        `ADAPTIVE_SELECTOR_FORBIDDEN: Field "${fieldName}" is an identity/valuation field and cannot use adaptive selectors (must remain deterministic).`
      );
      err.code = 'ADAPTIVE_SELECTOR_FORBIDDEN';
      throw err;
    }

    if (!isAdaptiveAllowed(fieldName)) {
      if (options.strict) {
        const err = new Error(`Field "${fieldName}" is not a recognized adaptive presentation field.`);
        err.code = 'FIELD_NOT_ADAPTIVE';
        throw err;
      }
      return null;
    }

    const canonicalField = normalizeFieldKey(fieldName);
    const store = this._loadSourceStore(sourceKey);

    // If an adaptive selector was previously recorded as successful for this source & field
    const recorded = store.selectors[canonicalField];
    if (recorded && typeof recorded.activeSelector === 'string') {
      return recorded.activeSelector;
    }

    // Return the default highest-ranked candidate fallback
    const defaults = DEFAULT_CANDIDATE_SELECTORS[canonicalField];
    if (Array.isArray(defaults) && defaults.length > 0) {
      return defaults[0];
    }

    return null;
  }

  /**
   * Retrieves all ordered candidates (with recorded successful selectors first, followed by fallbacks).
   *
   * @param {string} sourceKey - Source key.
   * @param {string} fieldName - Target presentation field name.
   * @returns {string[]} Ordered candidate selectors.
   */
  getCandidateSelectors(sourceKey, fieldName) {
    if (isIdentityOrValuationField(fieldName)) {
      const err = new Error(
        `ADAPTIVE_SELECTOR_FORBIDDEN: Field "${fieldName}" is an identity/valuation field and cannot use adaptive selectors.`
      );
      err.code = 'ADAPTIVE_SELECTOR_FORBIDDEN';
      throw err;
    }

    if (!isAdaptiveAllowed(fieldName)) {
      return [];
    }

    const canonicalField = normalizeFieldKey(fieldName);
    const store = this._loadSourceStore(sourceKey);
    const candidates = [];

    const recorded = store.selectors[canonicalField];
    if (recorded && typeof recorded.activeSelector === 'string') {
      candidates.push(recorded.activeSelector);
    }

    const defaults = DEFAULT_CANDIDATE_SELECTORS[canonicalField] || [];
    for (const def of defaults) {
      if (!candidates.includes(def)) {
        candidates.push(def);
      }
    }

    return candidates;
  }

  /**
   * Records a successful element extraction using an adaptive selector.
   * Promotes the successful selector to top priority for subsequent extractions.
   *
   * @param {string} sourceKey - Scraper source.
   * @param {string} fieldName - Non-identity presentation field.
   * @param {string} selector - CSS or XPath selector that succeeded.
   * @throws {Error} If fieldName is an identity or valuation field.
   */
  recordSelectorSuccess(sourceKey, fieldName, selector) {
    if (isIdentityOrValuationField(fieldName)) {
      const err = new Error(
        `ADAPTIVE_SELECTOR_FORBIDDEN: Cannot record adaptive selector for identity/valuation field "${fieldName}".`
      );
      err.code = 'ADAPTIVE_SELECTOR_FORBIDDEN';
      throw err;
    }

    if (!isAdaptiveAllowed(fieldName)) {
      const err = new Error(`Field "${fieldName}" is not an adaptive presentation field.`);
      err.code = 'FIELD_NOT_ADAPTIVE';
      throw err;
    }

    const canonicalField = normalizeFieldKey(fieldName);
    const cleanSelector = String(selector || '').trim();
    if (!cleanSelector) {
      throw new Error('Selector string cannot be empty.');
    }

    const store = this._loadSourceStore(sourceKey);
    const existing = store.selectors[canonicalField] || {
      activeSelector: cleanSelector,
      successCount: 0,
      candidates: []
    };

    existing.activeSelector = cleanSelector;
    existing.successCount = (existing.successCount || 0) + 1;
    existing.lastSuccessAt = new Date().toISOString();

    if (!existing.candidates.includes(cleanSelector)) {
      existing.candidates.unshift(cleanSelector);
    } else {
      // Re-order to head
      existing.candidates = [cleanSelector, ...existing.candidates.filter((c) => c !== cleanSelector)];
    }

    store.selectors[canonicalField] = existing;
    store.history.push({
      field: canonicalField,
      selector: cleanSelector,
      timestamp: existing.lastSuccessAt
    });

    if (store.history.length > 50) {
      store.history = store.history.slice(-50);
    }

    this._saveSourceStore(sourceKey);
    return existing;
  }
}

// Global default singleton
const defaultSelectorStore = new SelectorStore();

function resolveSelector(sourceKey, fieldName, options) {
  return defaultSelectorStore.resolveSelector(sourceKey, fieldName, options);
}

function recordSelectorSuccess(sourceKey, fieldName, selector) {
  return defaultSelectorStore.recordSelectorSuccess(sourceKey, fieldName, selector);
}

function getCandidateSelectors(sourceKey, fieldName) {
  return defaultSelectorStore.getCandidateSelectors(sourceKey, fieldName);
}

// Only predeclared presentation candidates are evaluated. No learned selector
// can relocate identity, money, dates, occupancy or legal status.
function extractPresentationValue(html, sourceKey, field, options = {}) {
  if (!isAdaptiveAllowed(field)) return null;
  const store = options.selectorStore || defaultSelectorStore;
  const candidates = store.getCandidateSelectors(sourceKey, field);
  for (const selector of candidates) {
    const className = /^\.([a-zA-Z0-9_-]+)$/.exec(selector)?.[1];
    const dataField = /^\[data-field="([a-zA-Z0-9_-]+)"\]$/.exec(selector)?.[1];
    if (!className && !dataField) continue;
    const tags = /<([a-z][\w-]*)\b([^>]*)>/gi;
    let match;
    while ((match = tags.exec(String(html || '')))) {
      const attrs = match[2];
      const classes = /\bclass\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.split(/\s+/) || [];
      const data = /\bdata-field\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
      if (!(className ? classes.includes(className) : data === dataField)) continue;
      const body = String(html).slice(tags.lastIndex).split(new RegExp('</'+match[1]+'\\s*>','i'))[0].replace(/<[^>]*>/g,' ').trim();
      const canonical = normalizeFieldKey(field);
      if (canonical === 'propertyType' && body && body.length <= 120) return {value:body,selector};
      const numeric = body.replace(/,/g,'').match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:beds?|bedrooms?|baths?|bathrooms?|sq\.?\s*ft|sqft)?$/i);
      if (numeric && Number.isFinite(Number(numeric[1]))) return {value:Number(numeric[1]),selector};
    }
  }
  return null;
}

module.exports = {
  extractPresentationValue,
  SelectorStore,
  defaultSelectorStore,
  resolveSelector,
  recordSelectorSuccess,
  getCandidateSelectors,
  isAdaptiveAllowed,
  isIdentityOrValuationField,
  FORBIDDEN_FIELDS,
  ALLOWED_PRESENTATION_FIELDS,
  DEFAULT_CANDIDATE_SELECTORS
};
