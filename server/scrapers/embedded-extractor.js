'use strict';

/**
 * Universal Hydration, JSON-LD & Embedded State Extractor.
 *
 * Extracts structured property and listing records embedded within HTML:
 * 1. Schema.org JSON-LD scripts (<script type="application/ld+json">)
 * 2. Next.js hydration payload (<script id="__NEXT_DATA__">)
 * 3. Nuxt / Redux / window state objects (window.__INITIAL_STATE__, window.__NUXT__)
 * 4. Inline JSON assignments (var properties = [...])
 *
 * Zero-fabrication: only extracts fields explicitly published in upstream state.
 */

function cleanStr(val) {
  if (val == null) return null;
  const s = String(val).replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : null;
}

function parseNum(val) {
  if (val == null) return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalizes Schema.org PostalAddress to a standard string.
 */
function normalizePostalAddress(addr) {
  if (!addr) return null;
  if (typeof addr === 'string') return cleanStr(addr);
  if (typeof addr === 'object') {
    const street = cleanStr(addr.streetAddress || addr.street);
    const city = cleanStr(addr.addressLocality || addr.city);
    const state = cleanStr(addr.addressRegion || addr.state);
    const zip = cleanStr(addr.postalCode || addr.zip);
    const parts = [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  return null;
}

/**
 * Extracts and parses all JSON-LD blocks from HTML.
 */
function extractJsonLd(html = '') {
  const text = String(html || '');
  const results = [];
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed['@graph'])) {
          results.push(...parsed['@graph']);
        } else {
          results.push(parsed);
        }
      }
    } catch (_) {
      // Malformed JSON block — skip cleanly
    }
  }

  const propertyItems = [];
  const targetTypes = new Set([
    'singlefamilyresidence', 'realestatelisting', 'residence', 'house',
    'place', 'accommodation', 'apartment', 'product', 'offer'
  ]);

  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    const rawType = String(item['@type'] || item.type || '').toLowerCase();
    const isTargetType = targetTypes.has(rawType);
    const hasAddress = item.address || item.postalAddress;

    if (isTargetType || hasAddress) {
      const address = normalizePostalAddress(item.address || item.postalAddress);
      const offers = Array.isArray(item.offers) ? item.offers[0] : (item.offers || {});
      const price = parseNum(offers.price ?? item.price);
      const geo = item.geo || {};

      propertyItems.push({
        type: item['@type'] || 'RealEstateListing',
        name: cleanStr(item.name || item.title),
        address,
        price: price != null && price > 0 ? price : null,
        url: cleanStr(item.url || offers.url),
        lat: parseNum(geo.latitude || item.latitude),
        lng: parseNum(geo.longitude || item.longitude),
        beds: parseNum(item.numberOfBedrooms || item.numberOfRooms),
        baths: parseNum(item.numberOfBathroomsTotal || item.numberOfBathrooms),
        sqft: parseNum(item.floorSize?.value || item.floorSize),
        rawJsonLd: item,
      });
    }
  }

  return propertyItems;
}

/**
 * Extracts Next.js __NEXT_DATA__ payload if present.
 */
function extractNextData(html = '') {
  const text = String(html || '');
  const match = text.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch (_) {
    return null;
  }
}

/**
 * Recursively inspects a data structure to find arrays of property-like objects.
 */
function findPropertyArraysInObject(obj, maxDepth = 6, currentDepth = 0) {
  if (!obj || typeof obj !== 'object' || currentDepth > maxDepth) return [];
  const candidates = [];

  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
      // Check if items look like property records
      const sample = obj[0];
      const hasId = Boolean(sample.id || sample.propertyId || sample.listingId || sample.mlsNumber || sample.caseNumber || sample.aid);
      const hasAddress = Boolean(sample.address || sample.streetAddress || sample.street || sample.propAddress || sample.situs);
      const hasPrice = sample.price != null || sample.openingBid != null || sample.listPrice != null || sample.appraisal != null;

      if ((hasId && hasAddress) || (hasAddress && hasPrice)) {
        return [obj];
      }
    }
    for (const item of obj) {
      candidates.push(...findPropertyArraysInObject(item, maxDepth, currentDepth + 1));
    }
  } else {
    for (const key of Object.keys(obj)) {
      candidates.push(...findPropertyArraysInObject(obj[key], maxDepth, currentDepth + 1));
    }
  }

  return candidates;
}

/**
 * Extracts inline JSON property objects or arrays from scripts.
 */
function extractInlineScriptData(html = '') {
  const text = String(html || '');
  const found = [];

  // 1. Next.js __NEXT_DATA__
  const nextData = extractNextData(text);
  if (nextData) {
    const arrays = findPropertyArraysInObject(nextData.props || nextData);
    for (const arr of arrays) found.push(...arr);
  }

  // 2. window.__INITIAL_STATE__ or window.__NUXT__
  const stateRegex = /window\.(?:__INITIAL_STATE__|__NUXT__|__PRELOADED_STATE__)\s*=\s*(\{[\s\S]*?\});/gi;
  let sMatch;
  while ((sMatch = stateRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(sMatch[1]);
      const arrays = findPropertyArraysInObject(parsed);
      for (const arr of arrays) found.push(...arr);
    } catch (_) {}
  }

  // 3. var/let/const properties/listings = [...]
  const varRegex = /(?:var|let|const)\s+(?:properties|listings|inventory|auctionItems|items)\s*=\s*(\[[\s\S]*?\]);/gi;
  let vMatch;
  while ((vMatch = varRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(vMatch[1]);
      if (Array.isArray(parsed)) found.push(...parsed);
    } catch (_) {}
  }

  return found;
}

/**
 * Universal extractor combining JSON-LD, NextData, and inline scripts.
 */
function extractEmbeddedState(html = '') {
  const jsonLd = extractJsonLd(html);
  const inline = extractInlineScriptData(html);
  return {
    jsonLd,
    inlineProperties: inline,
    hasEmbeddedData: jsonLd.length > 0 || inline.length > 0,
  };
}

module.exports = {
  cleanStr,
  parseNum,
  normalizePostalAddress,
  extractJsonLd,
  extractNextData,
  findPropertyArraysInObject,
  extractInlineScriptData,
  extractEmbeddedState,
};
