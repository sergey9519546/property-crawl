'use strict';

/**
 * server/scrapers/scrapling-runner.js
 *
 * Scrapling profile runner with Adaptive Element Relocation and SPA XHR integration.
 *
 * Core Directives:
 * 1. Strict separation of IDENTITY fields (case #, parcel, APN, docket) vs
 *    PRESENTATION fields (price, dates, address lines).
 * 2. Identity fields NEVER use adaptive guessing or relocation (fail closed).
 * 3. Presentation fields may relocate when DOM classes shift, caching discovered
 *    fingerprints into .cache/scrapling-selectors/{sourceKey}.json.
 * 4. Ties into Scrapling SPA XHR capture lane for JS-rendered portals.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const spaProfileConfig = require('./profiles/spa-xhr.json');
const { captureSpaXhr, mapCapturedItems, spaXhrEnabled } = require('./spa-xhr');

const IDENTITY_FIELDS = new Set(spaProfileConfig.identityFields || [
  'caseNumber',
  'parcelId',
  'apn',
  'auctionId',
  'propertyId',
  'docketNumber',
]);

const PRESENTATION_FIELDS = new Set(spaProfileConfig.presentationFields || [
  'openingBid',
  'currentBid',
  'saleDateText',
  'addressText',
  'occupancyStatus',
  'judgmentAmount',
]);

const DEFAULT_CACHE_DIR = path.resolve(__dirname, '..', '..', '.cache', 'scrapling-selectors');

function isIdentityField(field) {
  return IDENTITY_FIELDS.has(String(field || '').trim());
}

function isPresentationField(field) {
  return PRESENTATION_FIELDS.has(String(field || '').trim());
}

function getSelectorStorePath(sourceKey, cacheDir = DEFAULT_CACHE_DIR) {
  const safeKey = String(sourceKey || 'unknown').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  return path.join(cacheDir, `${safeKey}.json`);
}

function loadSelectorStore(sourceKey, cacheDir = DEFAULT_CACHE_DIR) {
  const target = getSelectorStorePath(sourceKey, cacheDir);
  if (!fs.existsSync(target)) {
    return { version: 1, sourceKey, selectors: {}, relocations: [] };
  }
  try {
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      sourceKey,
      selectors: parsed.selectors || {},
      relocations: Array.isArray(parsed.relocations) ? parsed.relocations : [],
    };
  } catch (_) {
    return { version: 1, sourceKey, selectors: {}, relocations: [] };
  }
}

function saveSelectorStore(sourceKey, store, cacheDir = DEFAULT_CACHE_DIR) {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const target = getSelectorStorePath(sourceKey, cacheDir);
  const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const payload = JSON.stringify({
    version: 1,
    sourceKey,
    updatedAt: new Date().toISOString(),
    selectors: store.selectors || {},
    relocations: (store.relocations || []).slice(-100),
  }, null, 2);

  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, target);
}

/**
 * Relocate presentation element when primary CSS selector fails due to DOM drift.
 * Never called for identity fields.
 */
function relocatePresentationSelector(html, field, options = {}) {
  if (isIdentityField(field)) {
    return null; // Hard rule: identity fields never relocate adaptively
  }

  const text = String(html || '');
  if (!text) return null;

  if (field === 'openingBid' || field === 'currentBid' || field === 'judgmentAmount') {
    // Look for monetary tokens with surrounding context
    const moneyRegex = /(?:opening\s*bid|current\s*bid|judgment|amount|upset|minimum|price)[^$]{0,80}\$\s*([\d,]+(?:\.\d{2})?)/i;
    const match = text.match(moneyRegex);
    if (match) {
      return {
        strategy: 'contextual-regex',
        field,
        value: match[1].replace(/,/g, ''),
        confidence: 0.88,
      };
    }
    // Fallback: standalone currency badge
    const standaloneRegex = /class="[^"]*(?:bid|price|amount|val)[^"]*"[^>]*>\s*\$\s*([\d,]+)/i;
    const standMatch = text.match(standaloneRegex);
    if (standMatch) {
      return {
        strategy: 'class-heuristic',
        field,
        value: standMatch[1].replace(/,/g, ''),
        confidence: 0.82,
      };
    }
  }

  if (field === 'saleDateText') {
    const dateRegex = /(?:sale\s*date|auction\s*date)[^A-Za-z0-9]{0,30}([A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i;
    const match = text.match(dateRegex);
    if (match) {
      return {
        strategy: 'contextual-date-regex',
        field,
        value: match[1],
        confidence: 0.90,
      };
    }
  }

  if (field === 'occupancyStatus') {
    const occRegex = /(?:occupancy|status|occupied|vacant)[\s:]*(occupied|vacant|unknown)/i;
    const match = text.match(occRegex);
    if (match) {
      return {
        strategy: 'contextual-occupancy',
        field,
        value: match[1].toLowerCase(),
        confidence: 0.85,
      };
    }
  }

  return null;
}

/**
 * Extract fields from HTML with strict static identity checking and adaptive presentation fallback.
 */
function extractWithAdaptiveFallback(html, sourceKey, fieldConfigs, options = {}) {
  const store = loadSelectorStore(sourceKey, options.cacheDir);
  const result = {
    sourceKey,
    fields: {},
    relocations: [],
    identityPassed: true,
  };

  for (const [field, config] of Object.entries(fieldConfigs || {})) {
    const isId = isIdentityField(field);
    const primarySelector = config.selector;
    let extractedValue = null;

    // Check primary static selector via simulated extraction function or regex
    if (typeof config.extractor === 'function') {
      try {
        extractedValue = config.extractor(html);
      } catch (_) {
        extractedValue = null;
      }
    }

    if (extractedValue != null && extractedValue !== '') {
      result.fields[field] = extractedValue;
      continue;
    }

    // Primary failed. If identity field, FAIL CLOSED (do not guess).
    if (isId) {
      result.fields[field] = null;
      result.identityPassed = false;
      continue;
    }

    // Presentation field: attempt adaptive relocation
    const relocated = relocatePresentationSelector(html, field, options);
    if (relocated && relocated.value) {
      result.fields[field] = relocated.value;
      const relocationRecord = {
        field,
        originalSelector: primarySelector,
        discoveredStrategy: relocated.strategy,
        confidence: relocated.confidence,
        timestamp: new Date().toISOString(),
      };
      result.relocations.push(relocationRecord);
      store.relocations.push(relocationRecord);
      store.selectors[field] = {
        strategy: relocated.strategy,
        lastSuccess: relocationRecord.timestamp,
      };
    } else {
      result.fields[field] = null;
    }
  }

  if (result.relocations.length > 0 && options.persistSelectors !== false) {
    saveSelectorStore(sourceKey, store, options.cacheDir);
  }

  return result;
}

/**
 * Run SPA XHR capture configured through the profile registry.
 */
async function runSpaCaptureWithProfile(sourceKey, options = {}) {
  const profile = (spaProfileConfig.sources || {})[sourceKey];
  if (!profile) {
    return {
      ok: false,
      error: 'PROFILE_NOT_CONFIGURED',
      sourceKey,
    };
  }

  const targetUrl = options.url || profile.portalUrl;
  const pattern = options.pattern || profile.capturePattern;
  const timeoutMs = options.timeoutMs || profile.timeoutMs || 15000;

  const captureResult = await captureSpaXhr(targetUrl, {
    sourceKey,
    pattern,
    timeoutMs,
    env: options.env || process.env,
  });

  return {
    ...captureResult,
    sourceKey,
    profileName: profile.name,
    requiresBrowser: Boolean(profile.requiresBrowser),
  };
}

module.exports = {
  IDENTITY_FIELDS,
  PRESENTATION_FIELDS,
  isIdentityField,
  isPresentationField,
  loadSelectorStore,
  saveSelectorStore,
  relocatePresentationSelector,
  extractWithAdaptiveFallback,
  runSpaCaptureWithProfile,
  spaProfileConfig,
};
