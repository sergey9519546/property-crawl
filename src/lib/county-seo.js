'use strict';

/**
 * Programmatic SEO helper functions for county docket pages.
 * Handles county slug normalization, metadata generation, and schema.org structured data.
 */

const { STATE_REDEMPTION_RULES } = require('../../server/ai/legal-rules.js');

const DEFAULT_BASE_URL = 'https://perfectproperty.org';

const HYPHENATED_COUNTIES = new Set(['miami-dade', 'jo-daviess', 'matanuska-susitna', 'isle-of-wight']);

/**
 * Normalizes a URL slug or raw county parameter to a standardized title-cased county name.
 * e.g. "essex" -> "Essex"
 *      "orange-county" -> "Orange County"
 *      "miami-dade" -> "Miami-Dade"
 *      "san-diego" -> "San Diego"
 *      "Cuyahoga" -> "Cuyahoga"
 *      "prince-george-s" -> "Prince George's"
 */
function normalizeCountySlug(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {}

  const trimmed = decoded.trim();
  if (!trimmed) return '';

  const lowerSlug = trimmed.toLowerCase().replace(/['’]/g, '');

  // Check known hyphenated county names
  if (HYPHENATED_COUNTIES.has(lowerSlug)) {
    return lowerSlug
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('-');
  }

  // Reconstruct possessive 's from URL slug (e.g. prince-george-s -> prince-george's)
  const possessive = trimmed.replace(/[-_]s\b/gi, "'s");
  // Replace hyphens or underscores with spaces
  const spaced = possessive.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');

  // Capitalize words
  return spaced
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      // Special handling for contractions or apostrophes e.g. George's or O'Brien
      if (lower.includes("'")) {
        return lower
          .split("'")
          .map((sub, i) => (i === 0 ? sub.charAt(0).toUpperCase() + sub.slice(1) : sub))
          .join("'");
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Converts a county name to a canonical URL slug.
 * e.g. "Essex" -> "essex"
 *      "Orange County" -> "orange-county"
 *      "Miami-Dade" -> "miami-dade"
 */
function countyToSlug(county) {
  if (!county || typeof county !== 'string') return '';
  return county
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Returns the formal display name for a county.
 * Adds "County" unless it's already present or a Parish/Borough/Census Area.
 */
function formatCountyDisplayName(county) {
  const norm = normalizeCountySlug(county);
  if (!norm) return '';
  if (/(?:county|parish|borough|census area|city)$/i.test(norm)) {
    return norm;
  }
  return `${norm} County`;
}

/**
 * Computes median value from an array of numbers.
 */
function computeMedian(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (nums.length === 0) return null;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/**
 * Computes summary metrics for listings within a county.
 */
function computeCountyStats(listings = []) {
  const list = Array.isArray(listings) ? listings : [];
  const openingBids = [];
  const dealScores = [];
  const sourceBreakdown = {};
  const propertyTypes = {};

  for (const item of list) {
    if (item.openingBid != null) openingBids.push(Number(item.openingBid));
    if (item.dealScore != null) dealScores.push(Number(item.dealScore));

    const source = String(item.source || 'other').toLowerCase();
    sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;

    const pType = String(item.propType || 'Other');
    propertyTypes[pType] = (propertyTypes[pType] || 0) + 1;
  }

  return {
    totalCount: list.length,
    medianOpeningBid: computeMedian(openingBids),
    medianDealScore: computeMedian(dealScores),
    sourceBreakdown,
    propertyTypes,
  };
}

/**
 * Retrieves the statutory redemption overview for a given 2-letter state code.
 */
function getStatutoryRedemption(stateCode) {
  const code = String(stateCode || '').trim().toUpperCase();
  const rule = STATE_REDEMPTION_RULES[code];
  if (!rule) {
    return {
      days: null,
      label: 'Statutory redemption details require review of local judicial confirmation proceedings and state statutes.',
      stateCode: code,
    };
  }
  return {
    days: rule.days,
    label: rule.label,
    stateCode: code,
  };
}

/**
 * Generates dynamic Next.js page metadata for a county docket page.
 */
function generateCountyMetadata({ state, county, count = 0, medianBid = null, baseUrl = DEFAULT_BASE_URL }) {
  const st = String(state || '').trim().toUpperCase();
  const countyFormatted = formatCountyDisplayName(county);
  const countySlug = countyToSlug(county);
  const cleanBase = String(baseUrl).replace(/\/+$/, '');
  const canonicalUrl = `${cleanBase}/states/${st}/${countySlug}`;

  const countStr = count > 0 ? `${count} active` : 'verified';
  const bidStr = medianBid ? ` Median opening bid: $${Math.round(medianBid).toLocaleString('en-US')}.` : '';

  const title = `Distressed & Foreclosure Property in ${countyFormatted}, ${st} | PerfectProperty`;
  const description = `Explore ${countStr} distressed, foreclosure, and tax-deed properties in ${countyFormatted}, ${st}.${bidStr} Access verified docket records and statutory redemption terms.`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: 'PerfectProperty',
      type: 'website',
    },
  };
}

/**
 * Builds Schema.org BreadcrumbList for /states/[state]/[county].
 */
function buildCountyBreadcrumbs({ state, county, baseUrl = DEFAULT_BASE_URL }) {
  const st = String(state || '').trim().toUpperCase();
  const countyFormatted = formatCountyDisplayName(county);
  const countySlug = countyToSlug(county);
  const cleanBase = String(baseUrl).replace(/\/+$/, '');

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: `${cleanBase}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'States',
        item: `${cleanBase}/states`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: st,
        item: `${cleanBase}/states/${st}`,
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: countyFormatted,
        item: `${cleanBase}/states/${st}/${countySlug}`,
      },
    ],
  };
}

/**
 * Builds Schema.org ItemList for county listings.
 */
function buildCountyItemList({ state, county, listings = [], baseUrl = DEFAULT_BASE_URL }) {
  const st = String(state || '').trim().toUpperCase();
  const countyFormatted = formatCountyDisplayName(county);
  const cleanBase = String(baseUrl).replace(/\/+$/, '');

  const elements = (Array.isArray(listings) ? listings : []).slice(0, 50).map((item, index) => {
    const id = encodeURIComponent(String(item.id || index + 1));
    const name = String(item.address || `Distressed Property ${item.id || ''}`).trim();
    const bid = item.openingBid != null ? `$${Math.round(Number(item.openingBid)).toLocaleString('en-US')}` : 'Unpublished bid';
    const score = item.dealScore != null ? ` Deal Score: ${item.dealScore}/99.` : '';
    const desc = `${item.propType || 'Distressed property'} in ${countyFormatted}, ${st}. Opening bid: ${bid}.${score}`;

    return {
      '@type': 'ListItem',
      position: index + 1,
      url: `${cleanBase}/listings/${id}`,
      name,
      description: desc,
    };
  });

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Distressed & Foreclosure Property in ${countyFormatted}, ${st}`,
    numberOfItems: listings.length,
    itemListElement: elements,
  };
}

module.exports = {
  normalizeCountySlug,
  countyToSlug,
  formatCountyDisplayName,
  computeCountyStats,
  getStatutoryRedemption,
  generateCountyMetadata,
  buildCountyBreadcrumbs,
  buildCountyItemList,
  DEFAULT_BASE_URL,
};
