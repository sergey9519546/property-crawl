'use strict';

/**
 * server/scrapers/adapters/civilview.js
 *
 * Multi-County CivilView (Tyler Technologies) Platform Adapter.
 * URL Scheme: salesweb.civilview.com?countyId={id}
 * Covers dozens of New Jersey & Pennsylvania county sheriff sales on one unified engine.
 */

const { normalizeOcrText } = require('../../ai/notice-parser');
const { CIVILVIEW_NATIONWIDE } = require('../../../config/nationwide-civilview');

function cleanCivilViewCountyName(rawName = '') {
  return String(rawName || '')
    .replace(/,\s*[A-Z]{2}(?:\s*,.*)?$/i, '')
    .replace(/\s+(?:County|Parish)\b.*$/i, '')
    .trim();
}

const NATIONWIDE_COUNTY_MAP = Object.freeze(
  Object.fromEntries(
    (CIVILVIEW_NATIONWIDE.counties || []).map((entry) => [
      Number(entry.id),
      Object.freeze({
        county: cleanCivilViewCountyName(entry.name),
        state: entry.state,
        fullName: entry.name,
      }),
    ]),
  ),
);

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
  48: { county: 'Cumberland', state: 'PA' },
  49: { county: 'Lancaster', state: 'PA' },
  54: { county: 'Monroe', state: 'PA' },
  55: { county: 'Luzerne', state: 'PA' },
  56: { county: 'Lackawanna', state: 'PA' },
  58: { county: 'Schuylkill', state: 'PA' },
  61: { county: 'Lebanon', state: 'PA' },
  62: { county: 'York', state: 'PA' },
  63: { county: 'Carbon', state: 'PA' },
  64: { county: 'Columbia', state: 'PA' },
});

const ALL_COUNTY_MAP = Object.freeze({
  ...NATIONWIDE_COUNTY_MAP,
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

/**
 * Analyzes CivilView detail history for statutory adjournments and price trajectory.
 * Under N.J.S.A. § 2A:17-36, debtors are entitled to two statutory adjournments.
 */
function analyzeCivilViewStatusHistory(historyRows = []) {
  if (!Array.isArray(historyRows)) {
    return {
      priorPostponements: 0,
      debtorAdjournments: 0,
      statutoryStayExhausted: false,
      latestStatus: null,
      history: []
    };
  }

  let priorPostponements = 0;
  let debtorAdjournments = 0;
  const history = [];

  for (const item of historyRows) {
    const statusText = typeof item === 'string' ? item : (item?.status || item?.event || '');
    const cleanStatus = statusText.trim().toLowerCase();
    if (!cleanStatus) continue;

    const isAdjournment = /adjourn|postpone|stay|continued|reschedule/i.test(cleanStatus);
    if (isAdjournment) {
      priorPostponements += 1;
      if (/debtor|defendant|borrower|owner|statutory/i.test(cleanStatus) || cleanStatus === 'adjourned') {
        debtorAdjournments += 1;
      }
    }
    history.push({
      status: statusText,
      date: item?.date || null,
      amount: typeof item?.amount === 'number' ? item.amount : null,
      isAdjournment
    });
  }

  const statutoryStayExhausted = debtorAdjournments >= 2;
  const latestStatus = history.length > 0 ? history[history.length - 1].status : null;

  return {
    priorPostponements,
    debtorAdjournments,
    statutoryStayExhausted,
    latestStatus,
    history
  };
}

module.exports = {
  analyzeCivilViewStatusHistory,
  NJ_COUNTY_MAP,
  PA_COUNTY_MAP,
  NATIONWIDE_COUNTY_MAP,
  ALL_COUNTY_MAP,
  getCivilViewUrl,
  parseCivilViewRow,
  parseCivilViewHtml,
};
