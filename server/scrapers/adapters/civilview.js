'use strict';

/**
 * server/scrapers/adapters/civilview.js
 *
 * Multi-County CivilView (Tyler Technologies) Platform Adapter.
 * URL Scheme: salesweb.civilview.com?countyId={id}
 * Covers dozens of New Jersey & Pennsylvania county sheriff sales on one unified engine.
 */

const { normalizeOcrText } = require('../../ai/notice-parser');

const NJ_COUNTY_MAP = Object.freeze({
  1: { county: 'Bergen', state: 'NJ' },
  2: { county: 'Essex', state: 'NJ' },
  3: { county: 'Burlington', state: 'NJ' },
  4: { county: 'Camden', state: 'NJ' },
  5: { county: 'Cumberland', state: 'NJ' },
  6: { county: 'Gloucester', state: 'NJ' },
  7: { county: 'Hudson', state: 'NJ' },
  8: { county: 'Mercer', state: 'NJ' },
  9: { county: 'Monmouth', state: 'NJ' },
  10: { county: 'Morris', state: 'NJ' },
  11: { county: 'Ocean', state: 'NJ' },
  12: { county: 'Passaic', state: 'NJ' },
  13: { county: 'Salem', state: 'NJ' },
  14: { county: 'Somerset', state: 'NJ' },
  15: { county: 'Sussex', state: 'NJ' },
  16: { county: 'Union', state: 'NJ' },
  17: { county: 'Warren', state: 'NJ' },
  18: { county: 'Atlantic', state: 'NJ' },
  19: { county: 'Cape May', state: 'NJ' },
  20: { county: 'Hunterdon', state: 'NJ' },
  21: { county: 'Middlesex', state: 'NJ' },
  // Verified Tyler SalesWeb IDs
  25: { county: 'Atlantic', state: 'NJ' },
  52: { county: 'Cape May', state: 'NJ' },
  32: { county: 'Hunterdon', state: 'NJ' },
  73: { county: 'Middlesex', state: 'NJ' },
  85: { county: 'Ocean', state: 'NJ' },
  27: { county: 'Sussex', state: 'NJ' },
  29: { county: 'Warren', state: 'NJ' },
});

const PA_COUNTY_MAP = Object.freeze({
  51: { county: 'Lehigh', state: 'PA' },
  23: { county: 'Montgomery', state: 'PA' },
  60: { county: 'Philadelphia', state: 'PA' },
  53: { county: 'Northampton', state: 'PA' },
  46: { county: 'Berks', state: 'PA' },
  50: { county: 'Bucks', state: 'PA' },
  57: { county: 'Delaware', state: 'PA' },
  22: { county: 'Chester', state: 'PA' },
});

const ALL_COUNTY_MAP = Object.freeze({
  ...NJ_COUNTY_MAP,
  ...PA_COUNTY_MAP,
});

function getCivilViewUrl(countyId = 1) {
  return `https://salesweb.civilview.com/Sales/SalesSearch?countyId=${encodeURIComponent(countyId)}`;
}

function parseCivilViewRow(cells = [], countyId = 1) {
  if (!Array.isArray(cells) || cells.length < 5) return null;

  const countyInfo = ALL_COUNTY_MAP[countyId] || { county: 'Unknown', state: 'NJ' };
  const sheriffNumber = String(cells[0] || '').trim();
  const courtCase = String(cells[1] || '').trim();
  const saleDateRaw = String(cells[2] || '').trim();
  const addressRaw = String(cells[3] || '').trim();
  const upsetOrJudgmentRaw = String(cells[4] || '').trim();
  const plaintiff = String(cells[5] || '').trim();
  const defendant = String(cells[6] || '').trim();

  if (!sheriffNumber && !courtCase) return null;

  // Extract monetary token
  const moneyMatch = upsetOrJudgmentRaw.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
  const parsedAmount = moneyMatch ? parseFloat(moneyMatch[1].replace(/,/g, '')) : null;

  // Split address into street and city/zip
  const cleanAddress = normalizeOcrText(addressRaw).replace(/\s+/g, ' ').trim();
  const zipMatch = cleanAddress.match(/\b\d{5}\b/);
  const zip = zipMatch ? zipMatch[0] : null;

  return {
    source: 'civilview',
    countyId: Number(countyId),
    county: countyInfo.county,
    state: countyInfo.state,
    sheriffNumber,
    caseNumber: courtCase,
    saleDate: saleDateRaw,
    address: cleanAddress,
    zip,
    openingBid: parsedAmount,
    judgment: parsedAmount,
    plaintiff: plaintiff || null,
    defendant: defendant || null,
    sourceUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${encodeURIComponent(sheriffNumber)}`,
  };
}

/**
 * Standardize HTML table extraction into canonical CivilView records
 */
function parseCivilViewHtml(html = '', countyId = 1) {
  const text = String(html || '');
  const rows = [];
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRegex.exec(text)) !== null) {
    const rowHtml = trMatch[1];
    if (/class="[^"]*header[^"]*"/i.test(rowHtml) || /<th\b/i.test(rowHtml)) {
      continue;
    }

    const cells = [];
    const tdRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      const cellContent = tdMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .trim();
      cells.push(cellContent);
    }

    const parsed = parseCivilViewRow(cells, countyId);
    if (parsed) {
      rows.push(parsed);
    }
  }

  return rows;
}

module.exports = {
  NJ_COUNTY_MAP,
  PA_COUNTY_MAP,
  ALL_COUNTY_MAP,
  getCivilViewUrl,
  parseCivilViewRow,
  parseCivilViewHtml,
};
