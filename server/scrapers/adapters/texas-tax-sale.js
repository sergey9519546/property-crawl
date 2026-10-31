'use strict';

/**
 * server/scrapers/adapters/texas-tax-sale.js
 *
 * Texas Delinquent Tax Foreclosure & Constable Sale Platform Adapter.
 *
 * Governing Statutes:
 * - Tex. Tax Code § 34.01: Public auction by Constable or Sheriff on First Tuesday of month.
 * - Tex. Tax Code § 34.015: Purchaser registration certificate requirements.
 * - Tex. Tax Code § 34.21: Statutory right of redemption:
 *     - 180 days (6 months) for non-homestead / investor real property (25% penalty).
 *     - 730 days (2 years) for residence homestead or agricultural land (25% Yr 1, 50% Yr 2 penalty).
 * - Texas Const. art. VIII § 29: $0 state transfer tax.
 */

const { normalizeOcrText } = require('../../ai/notice-parser');

const TEXAS_TAX_SALE_COUNTIES = Object.freeze({
  harris: {
    county: 'Harris',
    state: 'TX',
    fips: '48201',
    taxOfficeUrl: 'https://www.hctax.net/Property/TaxSales',
    firmCounsel: ['Linebarger Goggan Blair & Sampson, LLP', 'Perdue Brandon Fielder Collins & Mott, LLP'],
    precincts: [1, 2, 3, 4, 5, 6, 7, 8],
    defaultCity: 'Houston',
  },
  dallas: {
    county: 'Dallas',
    state: 'TX',
    fips: '48113',
    taxOfficeUrl: 'https://www.dallascounty.org/departments/pubworks/property-division.php',
    precincts: [1, 2, 3, 4, 5],
    defaultCity: 'Dallas',
  },
  tarrant: {
    county: 'Tarrant',
    state: 'TX',
    fips: '48439',
    taxOfficeUrl: 'https://www.tarrantcountytx.gov/en/constables/constable-3/delinquent-tax-sales.html',
    precincts: [1, 2, 3, 4, 5, 6, 7, 8],
    defaultCity: 'Fort Worth',
  },
  bexar: {
    county: 'Bexar',
    state: 'TX',
    fips: '48029',
    taxOfficeUrl: 'https://www.bexar.org/DocumentCenter/View/41852/Bexar-County-Resale-Properties-Distribution-List',
    precincts: [1, 2, 3, 4],
    defaultCity: 'San Antonio',
  },
  travis: {
    county: 'Travis',
    state: 'TX',
    fips: '48453',
    taxOfficeUrl: 'https://www.traviscountytx.gov/departments/constable/precinct-3/tax-sales',
    precincts: [1, 2, 3, 4, 5],
    defaultCity: 'Austin',
  },
  collin: {
    county: 'Collin',
    state: 'TX',
    fips: '48085',
    taxOfficeUrl: 'https://www.collincountytx.gov/tax_assessor/Pages/tax_sales.aspx',
    precincts: [1, 2, 3, 4],
    defaultCity: 'McKinney',
  },
  denton: {
    county: 'Denton',
    state: 'TX',
    fips: '48121',
    taxOfficeUrl: 'https://www.dentoncounty.gov',
    precincts: [1, 2, 3, 4, 5, 6],
    defaultCity: 'Denton',
  },
  el_paso: {
    county: 'El Paso',
    state: 'TX',
    fips: '48141',
    taxOfficeUrl: 'https://www.epcounty.com',
    precincts: [1, 2, 3, 4, 5, 6, 7],
    defaultCity: 'El Paso',
  },
  fort_bend: {
    county: 'Fort Bend',
    state: 'TX',
    fips: '48157',
    taxOfficeUrl: 'https://www.fortbendcountytx.gov',
    precincts: [1, 2, 3, 4],
    defaultCity: 'Richmond',
  },
  montgomery: {
    county: 'Montgomery',
    state: 'TX',
    fips: '48339',
    taxOfficeUrl: 'https://www.mctx.org',
    precincts: [1, 2, 3, 4, 5],
    defaultCity: 'Conroe',
  },
  williamson: {
    county: 'Williamson',
    state: 'TX',
    fips: '48491',
    taxOfficeUrl: 'https://www.wilco.org',
    precincts: [1, 2, 3, 4],
    defaultCity: 'Georgetown',
  },
});

/**
 * Calculates the statutory First Tuesday of a given month and year.
 * Texas Tax Code § 34.01 requires tax sales to be held on the first Tuesday of the month.
 *
 * @param {number} year - Full 4-digit year (e.g. 2026)
 * @param {number} month - 1-based month (1 = Jan, 12 = Dec)
 * @returns {string} ISO date string YYYY-MM-DD
 */
function getFirstTuesdayOfMonth(year, month) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  const dayOfWeek = d.getUTCDay(); // 0 = Sun, 2 = Tue
  const offset = (2 - dayOfWeek + 7) % 7;
  const firstTuesday = 1 + offset;
  const mm = String(month).padStart(2, '0');
  const dd = String(firstTuesday).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Gets the next upcoming Texas Tax Sale date from a given baseline date.
 *
 * @param {Date|string} fromDate - Reference date
 * @returns {string} ISO date string YYYY-MM-DD
 */
function getNextTexasTaxSaleDate(fromDate = new Date()) {
  const ref = fromDate instanceof Date ? fromDate : new Date(fromDate);
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth() + 1;

  const currentMonthSale = getFirstTuesdayOfMonth(year, month);
  const refIso = ref.toISOString().slice(0, 10);

  if (currentMonthSale >= refIso) {
    return currentMonthSale;
  }

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return getFirstTuesdayOfMonth(nextYear, nextMonth);
}

/**
 * Statutory redemption details per Tex. Tax Code § 34.21.
 *
 * @param {object} options
 * @param {boolean} options.isHomestead - Whether property is debtor residence homestead or agricultural
 * @returns {object} { redemptionDays, penaltyRatePct, statutoryCitation, isHomestead }
 */
function getTexasTaxSaleRedemption(options = {}) {
  const isHomestead = Boolean(options.isHomestead);
  if (isHomestead) {
    return {
      redemptionDays: 730, // 2 years
      penaltyRatePct: 25, // 25% Yr 1, 50% Yr 2
      statutoryCitation: 'Tex. Tax Code § 34.21(a) (2-year homestead/ag right of redemption; 25% Yr 1, 50% Yr 2 penalty)',
      isHomestead: true,
    };
  }
  return {
    redemptionDays: 180, // 180 days (6 months)
    penaltyRatePct: 25,
    statutoryCitation: 'Tex. Tax Code § 34.21(e) (180-day non-homestead right of redemption; 25% statutory penalty)',
    isHomestead: false,
  };
}

/**
 * Extracts numeric dollars safely without NaN.
 */
function parseDollar(val) {
  if (val == null) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? Math.max(0, val) : null;
  const cleaned = String(val).replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

/**
 * Parses a Texas Tax Sale card or table row HTML block.
 *
 * @param {string} html - HTML fragment of row or card
 * @param {string} countyKey - County key in TEXAS_TAX_SALE_COUNTIES (default 'harris')
 * @param {object} options - Overrides or contextual options
 * @returns {object|null} Canonical listing object or null
 */
function parseTexasTaxSaleCard(html = '', countyKey = 'harris', options = {}) {
  const rawText = String(html || '').replace(/<[^>]+>/g, ' \n ').replace(/&nbsp;/g, ' ');
  const text = normalizeOcrText(rawText);
  if (!text || text.length < 15) return null;

  const countyInfo = TEXAS_TAX_SALE_COUNTIES[String(countyKey).toLowerCase()] || TEXAS_TAX_SALE_COUNTIES.harris;

  // 1. Cause / Suit Number: e.g. "2024-TX-0129", "TX-22-12345", "Case: 2023-88123"
  const causeMatch = text.match(/(?:cause\s*(?:no\.?|#|number)?|suit\s*(?:no\.?|#|number)?|case\s*(?:no\.?|#|number)?)\s*[:#]?\s*([A-Za-z0-9]{2,8}[-\s\/][A-Za-z0-9-]{3,12})/i)
    || text.match(/\b(\d{4}-TX-\d{3,6}|TX-\d{2,4}-\d{3,6})\b/i);
  const causeNumber = causeMatch ? causeMatch[1].trim().replace(/\s+/g, '-') : null;

  // 2. CAD Account / APN: e.g. "Account: 041-234-000-0012", "APN: 04218-104-0120", "CAD: 1234567890"
  const apnMatch = text.match(/(?:account\s*(?:no\.?|#|number)?|cad\s*(?:no\.?|#|acct)?|apn|parcel\s*id)\s*[:#]?\s*([0-9]{3,5}[-.][0-9A-Za-z]{2,6}(?:[-.][0-9A-Za-z]{1,8})+|\d{9,14})/i);
  const apn = apnMatch ? apnMatch[1].trim() : null;

  // 3. Opening / Minimum Bid (Tex. Tax Code § 34.01 statutory opening bid)
  const bidMatch = text.match(/(?:minimum\s*bid|opening\s*bid|min\s*bid|statutory\s*bid|bid\s*amount)\s*[:#]?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i)
    || text.match(/\$([0-9,]+(?:\.[0-9]{2})?)\s*(?:minimum|opening)/i);
  const openingBid = bidMatch ? parseDollar(bidMatch[1]) : null;

  // 4. Adjudged / Assessed Value (Court assessed value under § 34.01)
  const valueMatch = text.match(/(?:adjudged\s*value|assessed\s*value|market\s*value|cad\s*value)\s*[:#]?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
  const assessedValue = valueMatch ? parseDollar(valueMatch[1]) : null;

  // 5. Precinct / Constable: e.g. "Precinct 1", "Pct. 4", "Constable Pct 3"
  const pctMatch = text.match(/(?:precinct|pct\.?)\s*([1-8])/i);
  const precinct = pctMatch ? Number(pctMatch[1]) : null;

  // 6. Address / Legal Description
  const addrMatch = text.match(/(?:property\s*(?:address)?|address|situs)\s*[:#]?\s*(\d{1,6}\s+[^\n\r,]+?(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Blvd|Boulevard|Dr(?:ive)?|Ln|Lane|Ct|Court|Way|Trail|Pkwy|Parkway|Loop|Cir(?:cle)?))\b/i)
    || text.match(/(?:^|[\n\r])\s*(\d{1,6}\s+[A-Za-z0-9\t .,#-]+?(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Blvd|Boulevard|Dr(?:ive)?|Ln|Lane|Ct|Court|Way|Trail|Pkwy|Parkway|Loop|Cir(?:cle)?))\b/i);
  const address = addrMatch ? addrMatch[1].trim().replace(/\s+/g, ' ') : null;

  // Legal description fallback: e.g. "Lot 14, Block 2, Timberwood Sec 1"
  const legalMatch = text.match(/\b(Lot\s+\d+[^,\n]+Block\s+\d+[^,\n]+)/i);
  const legalDescription = legalMatch ? legalMatch[1].trim() : null;

  // If both address and legal description and cause number are missing, not a valid record
  if (!address && !legalDescription && !causeNumber) return null;

  // 7. Homestead flag detection
  const isHomestead = /homestead|residence\s+homestead|ag\s+exempt|agricultural/i.test(text);
  const redemption = getTexasTaxSaleRedemption({ isHomestead });

  // 8. Sale Date: First Tuesday calculation or extracted date
  const dateMatch = text.match(/(?:sale\s*date|auction\s*date)\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},\s*\d{4}|\d{4}-\d{2}-\d{2})/i);
  let saleDate = dateMatch ? dateMatch[1].trim() : null;
  if (!saleDate && options.saleDate) {
    saleDate = options.saleDate;
  }
  if (!saleDate) {
    saleDate = getNextTexasTaxSaleDate(options.fromDate || new Date());
  }
  if (saleDate && !/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) {
    const parsedTs = Date.parse(saleDate);
    if (Number.isFinite(parsedTs)) {
      saleDate = new Date(parsedTs).toISOString().slice(0, 10);
    }
  }

  // 9. Case Parties (Style of Case)
  const styleMatch = text.match(/(?:[\n\r]+|^|[;:]\s*)\s*([A-Z][A-Za-z0-9\s,&]+?)\s+(?:vs\.?|v\.)\s+([A-Za-z0-9\s.,&]+?)(?:,|\n|\s*\((?:homestead|ag)|\s*(?:Property|Legal|Adjudged|Lot|Block|Cause|Suit|Account|CAD|APN)|$)/i);
  const plaintiff = styleMatch ? styleMatch[1].trim() : `${countyInfo.county} County`;
  const defendant = styleMatch ? styleMatch[2].trim() : null;

  const id = `tx-tax-${countyInfo.county.toLowerCase()}-${causeNumber || apn || Math.abs(hashCode(text))}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();

  return {
    id,
    address: address || legalDescription || `${countyInfo.county} County Tax Foreclosure`,
    city: countyInfo.defaultCity,
    state: 'TX',
    zip: options.zip || null,
    county: countyInfo.county,
    apn: apn || null,
    propType: 'Single Family', // Statutory default subject to cadastral enrichment
    source: 'sheriff',
    sourceKey: 'sheriff',
    platform: 'texas-tax-sale',
    sourceUrl: options.sourceUrl || countyInfo.taxOfficeUrl,
    saleDate,
    openingBid: openingBid !== null ? openingBid : null,
    // Zero-fabrication guarantees:
    dealScore: null,
    estLow: null,
    estHigh: null,
    arv: null,
    assessedValue: assessedValue !== null ? assessedValue : null,
    sourceFacts: {
      distressType: 'tax_sale',
      causeNumber,
      constablePrecinct: precinct,
      plaintiff,
      defendant,
      legalDescription,
      adjudgedValue: assessedValue,
      statutoryRedemptionDays: redemption.redemptionDays,
      penaltyRatePct: redemption.penaltyRatePct,
      statutoryCitation: redemption.statutoryCitation,
      isHomestead: redemption.isHomestead,
      cashToCloseTerms: 'Certified cashier funds due at auction gavel (Tex. Tax Code § 34.01)',
      bidderCertificateRequired: true, // Tex. Tax Code § 34.015
    },
    provenance: {
      source: 'sheriff',
      platform: 'texas-tax-sale',
      observedAt: new Date().toISOString(),
      rawId: causeNumber || apn || id,
    },
  };
}

/**
 * Parses full HTML from a Texas Tax Sale portal or constable docket page.
 *
 * @param {string} html - HTML string
 * @param {string} countyKey - County key
 * @param {object} options - Options
 * @returns {Array<object>} Array of canonical listing objects
 */
function parseTexasTaxSaleHtml(html = '', countyKey = 'harris', options = {}) {
  const listings = [];
  const text = String(html || '');
  if (!text) return listings;

  // Split on table rows or card containers
  const rowMatches = text.match(/<tr[\s\S]*?<\/tr>/gi) || text.match(/<div class="[^"]*(?:property|listing|tax-sale|row)[^"]*"[\s\S]*?<\/div>/gi);

  if (rowMatches && rowMatches.length > 0) {
    for (const row of rowMatches) {
      // Strip HTML tags for clean text
      const cleanRow = row.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim();
      const listing = parseTexasTaxSaleCard(cleanRow, countyKey, options);
      if (listing) listings.push(listing);
    }
  } else {
    // Plain text / preformatted docket fallback (split on cause or double newline)
    const blocks = text.split(/(?=\b(?:CAUSE|SUIT|CASE)\s*(?:NO\.?|#)?\s*:)/i);
    for (const block of blocks) {
      const listing = parseTexasTaxSaleCard(block, countyKey, options);
      if (listing) listings.push(listing);
    }
  }

  return listings;
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

module.exports = {
  TEXAS_TAX_SALE_COUNTIES,
  getFirstTuesdayOfMonth,
  getNextTexasTaxSaleDate,
  getTexasTaxSaleRedemption,
  parseTexasTaxSaleCard,
  parseTexasTaxSaleHtml,
};
