'use strict';

/**
 * server/sources/civilview.js
 *
 * CivilView (Tyler Technologies) All-County Registry & Platform Parser.
 * (docs/STRATEGY.md Hack #2: Platform-level parsers).
 *
 * Covers:
 * - All 21 New Jersey counties with verified county IDs and publisher URL schemes.
 * - Pennsylvania county dockets hosted on salesweb.civilview.com.
 * - Uniform table parsing for docket searches and detail resolution.
 */

const BASE_URL = 'https://salesweb.civilview.com';

const NJ_COUNTIES = Object.freeze([
  { id: '25', name: 'Atlantic', fullName: 'Atlantic County, NJ', state: 'NJ' },
  { id: '7', name: 'Bergen', fullName: 'Bergen County, NJ', state: 'NJ', legacyId: '1' },
  { id: '3', name: 'Burlington', fullName: 'Burlington County, NJ', state: 'NJ' },
  { id: '1', name: 'Camden', fullName: 'Camden County, NJ', state: 'NJ', legacyId: '4' },
  { id: '52', name: 'Cape May', fullName: 'Cape May County, NJ', state: 'NJ' },
  { id: '6', name: 'Cumberland', fullName: 'Cumberland County, NJ', state: 'NJ', legacyId: '5' },
  { id: '2', name: 'Essex', fullName: 'Essex County, NJ', state: 'NJ' },
  { id: '19', name: 'Gloucester', fullName: 'Gloucester County, NJ', state: 'NJ', legacyId: '6' },
  { id: '10', name: 'Hudson', fullName: 'Hudson County, NJ', state: 'NJ', legacyId: '7' },
  { id: '32', name: 'Hunterdon', fullName: 'Hunterdon County, NJ', state: 'NJ' },
  { id: '21', name: 'Mercer', fullName: 'Mercer County, NJ', state: 'NJ', legacyId: '8' },
  { id: '73', name: 'Middlesex', fullName: 'Middlesex County, NJ', state: 'NJ' },
  { id: '8', name: 'Monmouth', fullName: 'Monmouth County, NJ', state: 'NJ', legacyId: '9' },
  { id: '9', name: 'Morris', fullName: 'Morris County, NJ', state: 'NJ', legacyId: '10' },
  { id: '85', name: 'Ocean', fullName: 'Ocean County, NJ', state: 'NJ', legacyId: '11' },
  { id: '17', name: 'Passaic', fullName: 'Passaic County, NJ', state: 'NJ', legacyId: '12' },
  { id: '20', name: 'Salem', fullName: 'Salem County, NJ', state: 'NJ', legacyId: '13' },
  { id: '14', name: 'Somerset', fullName: 'Somerset County, NJ', state: 'NJ' },
  { id: '27', name: 'Sussex', fullName: 'Sussex County, NJ', state: 'NJ', legacyId: '15' },
  { id: '15', name: 'Union', fullName: 'Union County, NJ', state: 'NJ', legacyId: '16' },
  { id: '29', name: 'Warren', fullName: 'Warren County, NJ', state: 'NJ', legacyId: '17' },
]);

const PA_COUNTIES = Object.freeze([
  { id: '51', name: 'Lehigh', fullName: 'Lehigh County, PA', state: 'PA' },
  { id: '23', name: 'Montgomery', fullName: 'Montgomery County, PA', state: 'PA' },
  { id: '60', name: 'Philadelphia', fullName: 'Philadelphia County, PA', state: 'PA' },
  { id: '53', name: 'Northampton', fullName: 'Northampton County, PA', state: 'PA' },
  { id: '46', name: 'Berks', fullName: 'Berks County, PA', state: 'PA' },
  { id: '50', name: 'Bucks', fullName: 'Bucks County, PA', state: 'PA' },
  { id: '57', name: 'Delaware', fullName: 'Delaware County, PA', state: 'PA' },
  { id: '22', name: 'Chester', fullName: 'Chester County, PA', state: 'PA' },
]);

const ALL_COUNTIES = Object.freeze([...NJ_COUNTIES, ...PA_COUNTIES]);

function getCivilViewSearchUrl(countyId, baseUrl = BASE_URL) {
  return `${baseUrl.replace(/\/+$/, '')}/Sales/SalesSearch?countyId=${encodeURIComponent(countyId)}`;
}

function getCivilViewDetailUrl(propertyId, baseUrl = BASE_URL) {
  return `${baseUrl.replace(/\/+$/, '')}/Sales/SaleDetails?PropertyId=${encodeURIComponent(propertyId)}`;
}

function getCounty(identifier, state = null) {
  const query = String(identifier || '').trim().toLowerCase();
  const stUpper = state ? String(state).trim().toUpperCase() : null;

  return ALL_COUNTIES.find((c) => {
    if (stUpper && c.state !== stUpper) return false;
    if (String(c.id) === query) return true;
    if (c.legacyId && String(c.legacyId) === query) return true;
    if (c.name.toLowerCase() === query) return true;
    if (c.fullName.toLowerCase() === query) return true;
    return false;
  }) || null;
}

function getNJCounties() {
  return [...NJ_COUNTIES];
}

function getPACounties() {
  return [...PA_COUNTIES];
}

function decodeHtml(value) {
  const named = { amp: '&', apos: "'", colon: ':', gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (token, name) => named[name.toLowerCase()] ?? token);
}

function cleanText(html) {
  return decodeHtml(
    String(html || '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(raw) {
  if (!raw) return null;
  const match = String(raw).replace(/[$,\s]/g, '').match(/-?\d+(?:\.\d{1,2})?/);
  if (!match) return null;
  const val = Number(match[0]);
  return Number.isFinite(val) && val > 0 ? val : null;
}

/**
 * Parse standard CivilView sales search HTML table.
 * Supports both 6-column and 7-column formats across New Jersey and Pennsylvania dockets.
 */
function parseSalesTable(html = '', countyOrId = null, pageUrl = null) {
  const county = typeof countyOrId === 'object' && countyOrId !== null
    ? countyOrId
    : getCounty(countyOrId) || { name: 'Unknown', state: 'NJ', id: String(countyOrId || '') };

  const effectivePageUrl = pageUrl || getCivilViewSearchUrl(county.id);
  const rows = [];
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let trMatch;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    if (/class="[^"]*header[^"]*"/i.test(rowHtml) || /<th\b/i.test(rowHtml)) {
      continue;
    }

    const linkMatch = rowHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*View\s+Details\s*<\/a>/i);
    const href = linkMatch ? linkMatch[1] : null;

    let propertyId = null;
    let detailUrl = null;
    if (href) {
      try {
        const parsed = new URL(href, effectivePageUrl);
        if (parsed.origin === new URL(effectivePageUrl).origin && parsed.pathname.toLowerCase().includes('saledetails')) {
          propertyId = parsed.searchParams.get('PropertyId');
          detailUrl = parsed.toString();
        }
      } catch (_) {}
      if (!detailUrl) continue;
    }

    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(cleanText(tdMatch[1]));
    }

    if (cells.length < 5) continue;

    let sheriffNumber = '';
    let courtCase = '';
    let saleDate = '';
    let plaintiff = '';
    let defendant = '';
    let address = '';
    let judgmentOrUpset = null;

    if (cells.length >= 7) {
      // 7-column format: [Sheriff#, Case#, Sale Date, Address, Judgment/Upset, Plaintiff, Defendant]
      sheriffNumber = cells[0];
      courtCase = cells[1];
      saleDate = cells[2];
      address = cells[3];
      judgmentOrUpset = parseMoney(cells[4]);
      plaintiff = cells[5];
      defendant = cells[6];
    } else if (cells.length === 6) {
      // Standard Tyler SalesWeb format:
      // cells[0] is often "View Details", cells[1..5] are Sheriff#, SaleDate, Plaintiff, Defendant, Address
      if (/View\s+Details/i.test(cells[0])) {
        sheriffNumber = cells[1];
        saleDate = cells[2];
        plaintiff = cells[3];
        defendant = cells[4];
        address = cells[5];
      } else {
        sheriffNumber = cells[0];
        saleDate = cells[1];
        plaintiff = cells[2];
        defendant = cells[3];
        address = cells[4];
        judgmentOrUpset = parseMoney(cells[5]);
      }
    } else if (cells.length === 5) {
      sheriffNumber = cells[0];
      saleDate = cells[1];
      plaintiff = cells[2];
      defendant = cells[3];
      address = cells[4];
    }

    if (!propertyId && sheriffNumber) {
      propertyId = sheriffNumber.replace(/[^A-Za-z0-9_-]/g, '');
    }
    if (!detailUrl && propertyId) {
      detailUrl = getCivilViewDetailUrl(propertyId);
    }

    if (!sheriffNumber && !courtCase && !propertyId) continue;

    // Extract zip from address if available
    const zipMatch = address.match(/\b\d{5}(?:-\d{4})?\b/);
    const zip = zipMatch ? zipMatch[0] : null;

    const record = {
      id: `CIV-${county.state}-${county.id}-${propertyId || sheriffNumber}`,
      source: 'civilview',
      countyId: String(county.id),
      county: county.name,
      state: county.state,
      propertyId,
      sheriffNumber,
      caseNumber: courtCase || null,
      saleDate,
      address,
      zip,
      openingBid: null,
      judgment: judgmentOrUpset,
      plaintiff: plaintiff || null,
      defendant: defendant || null,
      detailUrl,
      sourceUrl: detailUrl,
      countySearchUrl: effectivePageUrl,
      provenance: {
        origin: 'live',
        observed: true,
        publisher: 'CivilView (Tyler Technologies)',
        recordId: propertyId || sheriffNumber,
        state: county.state,
        county: county.name,
      },
    };

    rows.push(record);
  }

  return rows;
}

module.exports = {
  BASE_URL,
  NJ_COUNTIES,
  PA_COUNTIES,
  ALL_COUNTIES,
  getCivilViewSearchUrl,
  getCivilViewDetailUrl,
  getCounty,
  getNJCounties,
  getPACounties,
  parseSalesTable,
};
