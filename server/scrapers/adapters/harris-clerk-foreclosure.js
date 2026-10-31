'use strict';

/**
 * server/scrapers/adapters/harris-clerk-foreclosure.js
 *
 * Harris County, TX County Clerk Foreclosure Notice Adapter (cclerk.hctx.net).
 * Under Texas Property Code § 51.002, statutory foreclosure sale notices must be
 * posted with the County Clerk at least 21 days prior to the first Tuesday auction.
 */

const HARRIS_CLERK_BASE_URL =
  process.env.HARRIS_CLERK_URL || 'https://www.cclerk.hctx.net';

const HARRIS_DOC_TYPES = Object.freeze({
  NOTICE_OF_FORECLOSURE_SALE: 'NOTICE OF FORECLOSURE SALE',
  NOTICE_OF_TRUSTEE_SALE: 'NOTICE OF TRUSTEE SALE',
  APPOINTMENT_OF_SUBSTITUTE_TRUSTEE: 'APPOINTMENT OF SUBSTITUTE TRUSTEE',
});

/**
 * Calculates the statutory First Tuesday of a given month and year in UTC.
 * Tex. Prop. Code § 51.002 / Tex. Tax Code § 34.01 requires sales to be held
 * on the first Tuesday of the month between 10:00 a.m. and 4:00 p.m.
 *
 * @param {number} year - 4-digit year (e.g. 2026)
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
 * Parses date string (MM/DD/YYYY or YYYY-MM-DD) into UTC timestamp
 *
 * @param {string|Date} dateVal - Date input
 * @returns {number|null} Milliseconds timestamp or null if invalid
 */
function parseDateToUtcTimestamp(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    return isNaN(dateVal.getTime()) ? null : dateVal.getTime();
  }
  const str = String(dateVal).trim();
  const mUs = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mUs) {
    return Date.UTC(Number(mUs[3]), Number(mUs[1]) - 1, Number(mUs[2]));
  }
  const mIso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mIso) {
    return Date.UTC(Number(mIso[1]), Number(mIso[2]) - 1, Number(mIso[3]));
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed.getTime();
}

/**
 * Calculates the statutory First Tuesday foreclosure auction date under
 * Texas Property Code § 51.002 based on a 21-day statutory notice posting requirement.
 *
 * The sale must take place on the First Tuesday of a month that is at least
 * 21 days AFTER the posting date.
 *
 * @param {string|Date} postingDate - Date notice was posted/filed
 * @returns {string|null} ISO date string YYYY-MM-DD
 */
function calculateTexasForeclosureSaleDate(postingDate) {
  const postTs = parseDateToUtcTimestamp(postingDate);
  if (!postTs) return null;

  // Tex. Prop. Code § 51.002: Minimum 21 statutory days before the date of the sale
  const minEligibleTs = postTs + 21 * 24 * 60 * 60 * 1000;
  const minEligible = new Date(minEligibleTs);
  let year = minEligible.getUTCFullYear();
  let month = minEligible.getUTCMonth() + 1; // 1-based

  // Check the first Tuesday of minEligible's month
  const candidateDateStr = getFirstTuesdayOfMonth(year, month);
  const candidateTs = parseDateToUtcTimestamp(candidateDateStr);

  if (candidateTs && candidateTs >= minEligibleTs) {
    return candidateDateStr;
  }

  // If the first Tuesday has already passed or provides < 21 days notice,
  // roll over to the following month's First Tuesday
  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return getFirstTuesdayOfMonth(year, month);
}

/**
 * Clean cell text and decode HTML entities
 */
function cleanCellText(str) {
  if (!str) return '';
  return String(str)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Builds search or detail URL for Harris County Clerk Foreclosures
 *
 * @param {Object} options - Search or detail configuration
 * @returns {string} URL
 */
function getHarrisClerkSearchUrl(options = {}) {
  const base = (options.baseUrl || HARRIS_CLERK_BASE_URL).replace(/\/+$/, '');
  if (options.fileNumber || options.instrumentNumber || options.id) {
    const id = options.fileNumber || options.instrumentNumber || options.id;
    return `${base}/Foreclosure/details?id=${encodeURIComponent(id)}`;
  }
  return `${base}/Foreclosure/Search`;
}

/**
 * Parse a single Harris County Clerk foreclosure notice row or card
 *
 * @param {string} noticeHtmlOrText - HTML or text content of notice
 * @param {Object} options - Configuration overrides
 * @returns {Object|null} Standardized notice or null if invalid
 */
function parseHarrisClerkNotice(noticeHtmlOrText = '', options = {}) {
  const raw = String(noticeHtmlOrText || '');
  if (!raw.trim()) return null;

  // 1. File Number / Instrument Number
  let fileNumber = null;
  const classFile = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-file|col-instrument|col-notice|file-number|fileno)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classFile) {
    const clean = cleanCellText(classFile[1]).replace(
      /^(?:File|Instrument|Notice)(?:\s*(?:#|Number|No\.?))?:?\s*/i,
      ''
    );
    const m = clean.match(/([A-Za-z0-9\-_/]+)/);
    if (m) fileNumber = m[1].trim();
  }
  if (!fileNumber) {
    const fileMatch = raw.match(
      /\b(?:File(?:\s*(?:#|Num|Number|No\.?))?|Instrument(?:\s*(?:#|Num|Number|No\.?))?|Doc(?:\s*(?:#|Num|Number|No\.?))?|Notice\s*(?:#|Num|Number|No\.?))\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\-_/]+)/i
    );
    if (fileMatch) {
      fileNumber = fileMatch[1].trim();
    }
  }

  // 2. Posting Date
  let postingDate = null;
  const classPost = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-post|posting-date|posted-date)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classPost) {
    const clean = cleanCellText(classPost[1]);
    const m = clean.match(/([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (m) postingDate = m[1].trim();
  }
  if (!postingDate) {
    const postMatch = raw.match(
      /\b(?:Posting\s*Date|Posted|Filing\s*Date|Filed)\s*:(?:<[^>]+>|\s)*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i
    );
    if (postMatch) {
      postingDate = postMatch[1].trim();
    }
  }

  // 3. Sale Date
  let explicitSaleDate = null;
  const saleMatch = raw.match(
    /\b(?:Sale\s*Date|Auction\s*Date)\s*:(?:<[^>]+>|\s)*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i
  );
  if (saleMatch) {
    const rawSale = saleMatch[1].trim();
    const ts = parseDateToUtcTimestamp(rawSale);
    if (ts) {
      const d = new Date(ts);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      explicitSaleDate = `${yyyy}-${mm}-${dd}`;
    }
  }

  // Calculate First Tuesday from posting date per Texas Property Code § 51.002
  const calculatedSaleDate = postingDate ? calculateTexasForeclosureSaleDate(postingDate) : null;
  const saleDate = explicitSaleDate || calculatedSaleDate || null;

  // 4. Debtor / Mortgagor (Borrower)
  let debtor = null;
  const classDebtor = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-debtor|col-mortgagor|debtor|borrower)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classDebtor) {
    const clean = cleanCellText(classDebtor[1]).replace(
      /^(?:Debtor|Mortgagor|Borrower|Grantor|Owner):?\s*/i,
      ''
    );
    const firstLine = clean.split('\n')[0].trim();
    if (firstLine) debtor = firstLine;
  }
  if (!debtor) {
    const debtorMatch = raw.match(
      /\b(?:Debtor|Mortgagor|Borrower|Grantor|Owner)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Trustee|Mortgagee|Lender|Situs|Address|Legal|$)/i
    );
    if (debtorMatch) {
      debtor = cleanCellText(debtorMatch[1]);
    }
  }

  // 5. Trustee / Substitute Trustee
  let trustee = null;
  const classTrustee = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-trustee|trustee|substitute-trustee)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classTrustee) {
    const clean = cleanCellText(classTrustee[1]).replace(
      /^(?:Substitute\s*Trustee|Trustee|Mortgagee|Lender):?\s*/i,
      ''
    );
    const firstLine = clean.split('\n')[0].trim();
    if (firstLine) trustee = firstLine;
  }
  if (!trustee) {
    const trusteeMatch = raw.match(
      /\b(?:Substitute\s*Trustee|Trustee|Mortgagee|Lender)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Situs|Address|Legal|Property|APN|Account|$)/i
    );
    if (trusteeMatch) {
      trustee = cleanCellText(trusteeMatch[1]);
    }
  }

  // 6. Situs Address / Property Address / Legal Description
  let situsAddress = null;
  let legalDescription = null;
  const classSitus = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-situs|col-address|property-address|situs-address)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classSitus) {
    const clean = cleanCellText(classSitus[1]).replace(
      /^(?:Property\s*Address|Situs(?:\s*Address)?|Address):?\s*/i,
      ''
    );
    if (clean) situsAddress = clean;
  }
  if (!situsAddress) {
    const situsMatch = raw.match(
      /\b(?:Property\s*Address|Situs(?:\s*Address)?|Address)\s*:(?:<[^>]+>|\s)*([^<\n\r]+)/i
    );
    if (situsMatch) {
      situsAddress = cleanCellText(situsMatch[1]);
    }
  }

  const legalMatch = raw.match(
    /\b(?:Legal\s*Desc(?:ription)?|Legal)\s*:(?:<[^>]+>|\s)*([^<\n\r]+)/i
  );
  if (legalMatch) {
    legalDescription = cleanCellText(legalMatch[1]);
  }

  // 7. APN / HCAD Account Number
  let apn = null;
  const classApn = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-apn|col-hcad|col-parcel|account-number|hcad-account)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classApn) {
    const clean = cleanCellText(classApn[1]).replace(
      /^(?:HCAD(?:\s*Account)?|APN|Account|Parcel)(?:\s*(?:#|Number|No\.?))?:?\s*/i,
      ''
    );
    const m = clean.match(/([0-9]{3}[-\s]?[0-9]{3}[-\s]?[0-9]{3}[-\s]?[0-9]{4}|[0-9]{13}|[0-9A-Za-z\-]+)/);
    if (m) apn = m[1].trim();
  }
  if (!apn) {
    const apnMatch = raw.match(
      /\b(?:HCAD(?:\s*Account)?|APN|Account(?:\s*(?:#|Num|No\.?))?|Parcel(?:\s*#)?)\s*:(?:<[^>]+>|\s)*([0-9]{3}[-\s]?[0-9]{3}[-\s]?[0-9]{3}[-\s]?[0-9]{4}|[0-9]{13}|[0-9A-Za-z\-]+)/i
    );
    if (apnMatch) {
      apn = apnMatch[1].trim();
    }
  }

  // Minimum required identity check: fileNumber, apn, debtor, or situsAddress
  if (!fileNumber && !apn && !debtor && !situsAddress) {
    return null;
  }

  const baseUrl = (options.baseUrl || HARRIS_CLERK_BASE_URL).replace(/\/+$/, '');
  const sourceUrl = fileNumber
    ? `${baseUrl}/Foreclosure/details?id=${encodeURIComponent(fileNumber)}`
    : `${baseUrl}/Foreclosure/Search`;

  return {
    source: 'recorder',
    platform: 'harris-clerk-foreclosure',
    county: 'Harris',
    state: 'TX',
    fileNumber,
    instrumentNumber: fileNumber, // alias for standard pipeline
    postingDate: postingDate || null,
    saleDate: saleDate || null,
    debtor: debtor || null,
    grantor: debtor || null, // alias
    trustee: trustee || null,
    grantee: trustee || null, // alias
    situsAddress: situsAddress || null,
    legalDescription: legalDescription || situsAddress || null,
    apn: apn || null,
    docType: HARRIS_DOC_TYPES.NOTICE_OF_FORECLOSURE_SALE,
    distressStage: 'SCHEDULED_AUCTION', // Notice under § 51.002 is for statutory first Tuesday auction
    sourceUrl,
    // Zero-Fabrication Invariant: Texas foreclosure postings carry unpaid debt, not opening bid
    openingBid: null,
    estLow: null,
    estHigh: null,
    assessed: null,
  };
}

/**
 * Standardize complete HTML page from Harris County Clerk Foreclosure postings
 *
 * @param {string} html - HTML content
 * @param {Object} options - Search options
 * @returns {Array<Object>} List of parsed notices
 */
function parseHarrisClerkHtml(html = '', options = {}) {
  const text = String(html || '');
  if (!text.trim()) return [];

  const notices = [];

  // 1. Structured table rows or notice containers
  const rowRegex =
    /<(?:tr|div)\b[^>]*class="[^"]*(?:harris-notice-row|foreclosure-row|search-result-row|NoticeItem|notice-card)[^"]*"[^>]*>([\s\S]*?)<\/(?:tr|div)>/gi;
  let match;
  while ((match = rowRegex.exec(text)) !== null) {
    const rowHtml = match[1];
    const parsed = parseHarrisClerkNotice(rowHtml, options);
    if (parsed && (parsed.fileNumber || parsed.apn || parsed.debtor || parsed.situsAddress)) {
      notices.push(parsed);
    }
  }

  // 2. Generic table rows with foreclosure notice data
  if (notices.length === 0 && /<tr\b/i.test(text)) {
    const genericTrRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = genericTrRegex.exec(text)) !== null) {
      const rowContent = trMatch[1];
      if (
        /(?:col-file|File(?:\s*#)?|Posting\s*Date|Debtor|Substitute\s*Trustee|Situs|HCAD)/i.test(
          rowContent
        )
      ) {
        const parsed = parseHarrisClerkNotice(rowContent, options);
        if (parsed && (parsed.fileNumber || parsed.apn || parsed.debtor || parsed.situsAddress)) {
          notices.push(parsed);
        }
      }
    }
  }

  // 3. Fallback: split on notice record headers
  if (notices.length === 0 && /(?:File\s*#|Notice\s*#)/i.test(text)) {
    const blocks = text.split(/(?=(?:File\s*#|Notice\s*#))/i);
    for (const block of blocks) {
      const parsed = parseHarrisClerkNotice(block, options);
      if (parsed && (parsed.fileNumber || parsed.apn || parsed.debtor || parsed.situsAddress)) {
        notices.push(parsed);
      }
    }
  }

  return notices;
}

module.exports = {
  HARRIS_DOC_TYPES,
  HARRIS_CLERK_BASE_URL,
  getFirstTuesdayOfMonth,
  calculateTexasForeclosureSaleDate,
  cleanCellText,
  getHarrisClerkSearchUrl,
  parseHarrisClerkNotice,
  parseHarrisClerkHtml,
};
