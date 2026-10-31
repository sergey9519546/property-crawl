'use strict';

/**
 * server/scrapers/drift-detector.js
 *
 * DOM Structure Fingerprinting & Field Extraction Yield Collapse Alarms (P0.6).
 *
 * Detects structural upstream layout changes by computing a deterministic SHA-256
 * tag-skeleton fingerprint of scraped HTML, and tracks field-level extraction yields
 * to detect selector drift before malformed records pollute the inventory.
 */

const crypto = require('node:crypto');

const ESSENTIAL_FIELDS = [
  'openingBid',
  'saleDate',
  'apn',
  'address',
  'city',
  'state',
  'zip',
  'latitude',
  'longitude'
];

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

/**
 * Extracts a normalized, hierarchical HTML tag skeleton.
 * Strips all comments, script/style/noscript contents, DOCTYPEs, text nodes,
 * whitespace, and attributes, leaving only the structural tag hierarchy.
 *
 * @param {string} html - Raw HTML document or fragment.
 * @returns {string} Normalized tag skeleton (e.g. "<html><body><div></div></body></html>").
 */
function extractDomSkeleton(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return '';
  }

  // Strip non-DOM and non-structural tags and contents
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!DOCTYPE\b[^>]*>/gi, '')
    .replace(/<\?xml\b[^>]*\?>/gi, '');

  // Match all remaining tags while handling quotes inside tag attributes
  const tagRegex = /<\/?([a-zA-Z0-9:-]+)(?:\s+(?:[^\x27">]+|\x27[^\x27]*\x27|"[^"]*")*)?(\/?)>/g;
  let skeleton = '';
  let match;

  while ((match = tagRegex.exec(stripped)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const isSelfClosing = Boolean(match[2]);
    const isClosing = fullTag.startsWith('</');

    if (isClosing) {
      skeleton += `</${tagName}>`;
    } else if (isSelfClosing || VOID_TAGS.has(tagName)) {
      skeleton += `<${tagName}/>`;
    } else {
      skeleton += `<${tagName}>`;
    }
  }

  return skeleton;
}

/**
 * Computes a SHA-256 hex digest of the normalized DOM tag skeleton.
 *
 * @param {string} html - Raw HTML content.
 * @returns {string} 64-character SHA-256 hex digest.
 */
function computeDomStructureHash(html) {
  const skeleton = extractDomSkeleton(html);
  return crypto.createHash('sha256').update(skeleton).digest('hex');
}

/**
 * Tests whether an individual field is present in a standardized listing record.
 *
 * @param {Object} listing - Standardized listing object.
 * @param {string} field - Field name to check.
 * @returns {boolean} True if field is non-empty and valid.
 */
function isFieldPresent(listing, field) {
  if (!listing || typeof listing !== 'object') return false;
  const val = listing[field];
  if (val === null || val === undefined) return false;

  if (field === 'openingBid') {
    return typeof val === 'number' && Number.isFinite(val) && val > 0;
  }

  if (field === 'latitude' || field === 'longitude') {
    return (
      (typeof val === 'number' && Number.isFinite(val)) ||
      (typeof val === 'string' && val.trim() !== '' && Number.isFinite(Number(val)))
    );
  }

  if (typeof val === 'string') {
    return val.trim().length > 0;
  }

  if (typeof val === 'number') {
    return Number.isFinite(val);
  }

  if (Array.isArray(val)) {
    return val.length > 0;
  }

  return false;
}

/**
 * Computes field extraction yields (0.0 to 1.0) for essential listing fields.
 *
 * @param {Array<Object>} listings - Array of standardized listing objects.
 * @returns {Object} Yield rates keyed by field name and inside a fieldYield object.
 */
function calculateFieldYield(listings) {
  const list = Array.isArray(listings) ? listings : [];
  const totalCount = list.length;
  const fieldYield = {};

  for (const field of ESSENTIAL_FIELDS) {
    if (totalCount === 0) {
      fieldYield[field] = 0;
    } else {
      let count = 0;
      for (const item of list) {
        if (isFieldPresent(item, field)) {
          count++;
        }
      }
      fieldYield[field] = Math.round((count / totalCount) * 10000) / 10000;
    }
  }

  return {
    ...fieldYield,
    fieldYield,
    totalCount
  };
}

/**
 * Evaluates DOM structure drift and field extraction yield collapse against a historical baseline.
 *
 * @param {string} sourceKey - Source key (e.g. 'civilview', 'hud', 'sheriff').
 * @param {string} html - Current raw HTML docket or index page.
 * @param {Array<Object>} listings - Parsed standardized listings for this run.
 * @param {Object} historicalBaseline - Historical baseline data ({ domHash, fieldYield }).
 * @returns {Object} Drift evaluation report with flags and collapse details.
 */
function evaluateDrift(sourceKey, html, listings, historicalBaseline = {}) {
  const safeSource = String(sourceKey || 'unknown').trim().toLowerCase();
  const currentDomHash = computeDomStructureHash(html);
  const currentYieldResult = calculateFieldYield(listings);
  const currentYield = currentYieldResult.fieldYield;

  const baseline = historicalBaseline || {};
  const baselineDomHash = baseline.domHash || baseline.domStructureHash || null;
  const baselineYield = baseline.fieldYield || baseline.yield || baseline;

  const flags = [];
  let domDrift = false;

  if (baselineDomHash && currentDomHash && baselineDomHash !== currentDomHash) {
    flags.push('DOM_STRUCTURE_DRIFT');
    domDrift = true;
  }

  const affectedFields = [];
  for (const field of ESSENTIAL_FIELDS) {
    const rawBase = baselineYield[field];
    if (typeof rawBase !== 'number' || !Number.isFinite(rawBase)) {
      continue;
    }

    const baseVal = Math.max(0, Math.min(1, rawBase));
    const currVal = currentYield[field] || 0;
    const droppedToZero = baseVal > 0 && currVal === 0;
    const dropRatio = baseVal > 0 ? (baseVal - currVal) / baseVal : 0;
    const absoluteDrop = baseVal - currVal;

    // Trigger if yield drops to 0 while baseline > 0, or drops by > 25%
    if (droppedToZero || dropRatio > 0.25 || absoluteDrop > 0.25) {
      affectedFields.push({
        field,
        baselineYield: baseVal,
        currentYield: currVal,
        dropRatio: Math.round(dropRatio * 10000) / 10000,
        dropPct: Math.round(dropRatio * 100),
        reason: droppedToZero ? 'DROPPED_TO_ZERO' : 'COLLAPSED_OVER_25_PCT'
      });
    }
  }

  let yieldCollapse = false;
  if (affectedFields.length > 0) {
    flags.push('FIELD_YIELD_COLLAPSE');
    yieldCollapse = true;
  }

  return {
    sourceKey: safeSource,
    hasDrift: flags.length > 0,
    flags,
    domDrift,
    yieldCollapse,
    domHash: {
      current: currentDomHash,
      baseline: baselineDomHash,
      matches: baselineDomHash ? currentDomHash === baselineDomHash : true
    },
    fieldYield: currentYield,
    baselineYield: typeof baselineYield === 'object' ? baselineYield : {},
    affectedFields,
    collapsedFields: affectedFields,
    totalListings: currentYieldResult.totalCount,
    evaluatedAt: new Date().toISOString()
  };
}

module.exports = {
  ESSENTIAL_FIELDS,
  VOID_TAGS,
  extractDomSkeleton,
  computeDomStructureHash,
  isFieldPresent,
  calculateFieldYield,
  evaluateDrift
};
