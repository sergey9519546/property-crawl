'use strict';

/**
 * server/scrapers/adapters/cook-recorder.js
 *
 * Cook County, IL Pre-Foreclosure Recorder Adapter.
 * Extracts statutory Lis Pendens foreclosure notices, chancery case filings,
 * and Sheriff sale notices recorded with the Cook County Clerk (Recording Division).
 *
 * Cook County is the 2nd most populous US county (Chicago metro) and operates
 * under judicial foreclosure rules (735 ILCS 5/Art. XV). Foreclosure actions
 * originate in Circuit Court Chancery Division and require recorded Lis Pendens.
 */

const { capturedRecordUrl } = require('./record-link');

const COOK_DOC_TYPES = Object.freeze({
  LIS_PENDENS: 'LIS PENDENS',
  LIS_PENDENS_FORECLOSURE: 'LIS PENDENS FORECLOSURE',
  FORECLOSURE_CHANCERY: 'FORECLOSURE CHANCERY',
  SHERIFF_SALE_NOTICE: 'SHERIFF SALE NOTICE',
  NOTICE_OF_SHERIFF_SALE: 'NOTICE OF SHERIFF SALE',
  SHERIFF_DEED: 'SHERIFF DEED',
  CERTIFICATE_OF_SALE: 'CERTIFICATE OF SALE',
  NOTICE_OF_DEFAULT: 'NOTICE OF DEFAULT',
  RELEASE_OF_LIS_PENDENS: 'RELEASE OF LIS PENDENS',
});

const RECORD_DOC_TYPES = COOK_DOC_TYPES;

const COOK_RECORDER_BASE_URL =
  process.env.COOK_RECORDER_URL || 'https://recording.cookcountyclerkil.gov';

/**
 * Normalizes and formats a Cook County Permanent Index Number (PIN / APN).
 * Cook County PIN format: XX-XX-XXX-XXX-XXXX (14 digits: Area-SubArea-Block-Parcel-Unit)
 * or 10 digits: XX-XX-XXX-XXX (when unit is omitted).
 *
 * @param {string|number} rawPin - Raw PIN input
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.padUnit=false] - If true, pads 10-digit PIN with -0000
 * @returns {string|null} Standardized PIN format XX-XX-XXX-XXX-XXXX or XX-XX-XXX-XXX
 */
function formatCookPin(rawPin, options = {}) {
  if (rawPin === null || rawPin === undefined) return null;
  const digits = String(rawPin).replace(/\D/g, '');
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 10)}-${digits.slice(10, 14)}`;
  }
  if (digits.length === 10) {
    if (options.padUnit) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 10)}-0000`;
    }
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 10)}`;
  }
  // If input matches dashed pattern XX-XX-XXX-XXX-XXXX
  const dashedMatch = String(rawPin).trim().match(/^(\d{2})[-.](\d{2})[-.](\d{3})[-.](\d{3})(?:[-.](\d{4}))?$/);
  if (dashedMatch) {
    const [, area, sub, blk, parcel, unit] = dashedMatch;
    if (unit) {
      return `${area}-${sub}-${blk}-${parcel}-${unit}`;
    }
    return options.padUnit
      ? `${area}-${sub}-${blk}-${parcel}-0000`
      : `${area}-${sub}-${blk}-${parcel}`;
  }
  return null;
}

/**
 * Extracts a Cook County PIN from unstructured or semi-structured text.
 *
 * @param {string} text - Input text containing parcel / PIN data
 * @param {Object} [options] - Options passed to formatCookPin
 * @returns {string|null} Formatted Cook PIN or null
 */
function extractCookPin(text, options = {}) {
  if (!text) return null;
  const raw = String(text);

  // 1. Labeled PIN pattern
  const labeled = raw.match(
    /\b(?:PIN|Permanent\s*Index\s*Number|Property\s*Index\s*Number|Parcel(?:\s*(?:#|ID|No\.?|Number))?|APN)\s*[:#]?\s*([0-9]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{3}[-\s]?[0-9]{3}(?:[-\s]?[0-9]{4})?|[0-9]{10,14})\b/i
  );
  if (labeled) {
    const formatted = formatCookPin(labeled[1], options);
    if (formatted) return formatted;
  }

  // 2. Exact 14-digit dashed pattern: XX-XX-XXX-XXX-XXXX
  const dashed14 = raw.match(/\b([0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{3}-[0-9]{4})\b/);
  if (dashed14) {
    return formatCookPin(dashed14[1], options);
  }

  // 3. Exact 10-digit dashed pattern: XX-XX-XXX-XXX
  const dashed10 = raw.match(/\b([0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{3})\b/);
  if (dashed10) {
    return formatCookPin(dashed10[1], options);
  }

  return null;
}

/**
 * Extracts a Cook County Circuit Court Chancery division case number.
 * Cook County Foreclosures are filed in the Chancery Division (CH).
 * Standard format: YYYY-CH-NNNNN or YY-CH-NNNN (e.g., 2024-CH-04821 or 2025CH00123).
 *
 * @param {string} text - Input text
 * @returns {string|null} Standardized Case Number (e.g. '2024-CH-04821') or null
 */
function extractCookCaseNumber(text) {
  if (!text) return null;
  const raw = String(text);

  // Case with explicit CH designation
  const chMatch = raw.match(
    /\b(?:Case(?:\s*(?:#|No\.?|Number))?\s*[:#]?\s*)?([0-9]{2,4})\s*[-_ ]?\s*(CH|CHANCERY)\s*[-_ ]?\s*([0-9]{1,7})\b/i
  );
  if (chMatch) {
    let year = chMatch[1];
    if (year.length === 2) {
      const num = parseInt(year, 10);
      year = num > 50 ? `19${year}` : `20${year}`;
    }
    const seq = chMatch[3].padStart(5, '0');
    return `${year}-CH-${seq}`;
  }

  // General civil or municipal division foreclosure decree: YYYY-L-NNNNN or YYYY-M-NNNNN
  const divMatch = raw.match(
    /\b(?:Case(?:\s*(?:#|No\.?|Number))?\s*[:#]?\s*)?([0-9]{4})\s*[-_ ]?\s*(L|M[1-6])\s*[-_ ]?\s*([0-9]{4,7})\b/i
  );
  if (divMatch) {
    return `${divMatch[1]}-${divMatch[2].toUpperCase()}-${divMatch[3]}`;
  }

  return null;
}

/**
 * Cleans HTML text, decoding entities and collapsing whitespace.
 *
 * @param {string} str - Raw HTML string
 * @returns {string} Clean plain text
 */
/**
 * Normalizes numeric money values for judgment and opening bid amounts.
 * Returns null for missing, non-numeric, or negative amounts.
 *
 * @param {number|string} val - Currency or numeric string
 * @returns {number|null} Clean numeric float or null
 */
function parseCookMoney(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0 ? val : null;
  }
  const clean = String(val).replace(/[\$,]/g, '').trim();
  const num = parseFloat(clean);
  return Number.isFinite(num) && num >= 0 ? num : null;
}
const parseOpeningBid = parseCookMoney;
const parseCookJudgment = parseCookMoney;

function cleanCellText(str) {
  if (!str) return '';
  return String(str)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Identifies statutory distress stage for Cook County filings.
 *
 * @param {string} rawDocType - Document classification
 * @returns {'SCHEDULED_AUCTION'|'SOLD_POST_SALE'|'PRE_FORECLOSURE'}
 */
function identifyDistressStage(rawDocType = '') {
  const norm = String(rawDocType || '').toUpperCase();
  if (/SHERIFF\s*(?:SALE|AUCTION)/i.test(norm) || /NOTICE\s*OF\s*SALE/i.test(norm)) {
    return 'SCHEDULED_AUCTION';
  }
  if (/SHERIFF(?:\s*['’]?S)?\s*DEED/i.test(norm) || /CERTIFICATE\s*OF\s*SALE/i.test(norm)) {
    return 'SOLD_POST_SALE';
  }
  return 'PRE_FORECLOSURE';
}

/**
 * Builds search URL for Cook County Clerk recording division queries.
 *
 * @param {string} [docType] - Document type filter
 * @param {Object} [options] - Options
 * @returns {string} Search URL
 */
function getCookRecorderSearchUrl(docType = COOK_DOC_TYPES.LIS_PENDENS, options = {}) {
  const base = (options.baseUrl || COOK_RECORDER_BASE_URL).replace(/\/+$/, '');
  if (options.recordingNumber || options.documentNumber) {
    const id = options.recordingNumber || options.documentNumber;
    throw new Error('A captured publisher record URL is required; no detail URL can be inferred from a recording number');
  }
  const cleanType = encodeURIComponent(docType || COOK_DOC_TYPES.LIS_PENDENS);
  let url = `${base}/search?docType=${cleanType}`;
  if (options.pin) {
    const cleanPin = encodeURIComponent(formatCookPin(options.pin) || options.pin);
    url += `&pin=${cleanPin}`;
  }
  if (options.caseNumber) {
    url += `&caseNumber=${encodeURIComponent(options.caseNumber)}`;
  }
  return url;
}

/**
 * Parses an individual row or card HTML snippet from Cook County Clerk records.
 *
 * @param {string} rowHtml - Row or card markup
 * @param {Object} [options] - Configuration overrides
 * @returns {Object|null} Standardized filing or null if unparseable
 */
function parseCookRecordRow(rowHtml = '', options = {}) {
  const raw = String(rowHtml || '');
  if (!raw.trim()) return null;

  // 1. Document / Recording / Instrument Number
  let docNum = null;
  const classNum = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-doc|col-recording|col-instrument|doc-number|document-number|recording-number|inst-num)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classNum) {
    const clean = cleanCellText(classNum[1]).replace(
      /^(?:Doc(?:ument)?|Recording|Instrument)(?:\s*(?:#|Number|No\.?))?:?\s*/i,
      ''
    );
    const m = clean.match(/([0-9]{8,14}|[0-9]{4}[-_][0-9]{4,10})/);
    if (m) docNum = m[1].trim();
  }
  if (!docNum) {
    const numMatch = raw.match(
      /\b(?:Doc(?:ument)?|Recording|Instrument)(?:\s*(?:#|Num|Number|No\.?))?\s*:(?:<[^>]+>|\s)*([0-9]{8,14}|[0-9]{4}[-_][0-9]{4,10})/i
    );
    if (numMatch) {
      docNum = numMatch[1].trim();
    }
  }

  // 2. Recording Date
  let recordedDate = null;
  const classDate = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-date|recording-date|recorded-date|date-recorded|rec-date)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classDate) {
    const clean = cleanCellText(classDate[1]);
    const m = clean.match(/([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (m) recordedDate = m[1].trim();
  }
  if (!recordedDate) {
    const dateMatch = raw.match(
      /\b(?:Recorded|Recording\s*Date|Rec\s*Date|Date\s*Recorded)\s*:(?:<[^>]+>|\s)*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i
    );
    if (dateMatch) {
      recordedDate = dateMatch[1].trim();
    }
  }

  // 3. Document Type
  let docType = null;
  const classType = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-type|doc-type|document-type)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classType) {
    const clean = cleanCellText(classType[1]).replace(
      /^(?:Doc(?:\s*ument)?\s*Type|Record\s*Type|Type):?\s*/i,
      ''
    );
    if (clean) docType = clean;
  }
  if (!docType) {
    const typeMatch = raw.match(
      /\b(?:Doc(?:\s*ument)?\s*Type|Record\s*Type|Type)\s*:(?:<[^>]+>|\s)*([A-Za-z\s'’]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|$)/i
    );
    if (typeMatch) {
      const val = cleanCellText(typeMatch[1]);
      if (val && !/^(?:Grantor|Grantee|Plaintiff|Defendant|PIN|Parcel|Date)/i.test(val)) {
        docType = val;
      }
    }
  }
  if (!docType) {
    if (/SHERIFF\s*(?:SALE|AUCTION)/i.test(raw)) {
      docType = COOK_DOC_TYPES.SHERIFF_SALE_NOTICE;
    } else if (/SHERIFF(?:\s*['’]?S)?\s*DEED/i.test(raw)) {
      docType = COOK_DOC_TYPES.SHERIFF_DEED;
    } else if (/LIS\s*PENDENS(?:\s*FORECLOSURE)?/i.test(raw)) {
      docType = COOK_DOC_TYPES.LIS_PENDENS_FORECLOSURE;
    } else if (/CHANCERY|FORECLOSURE/i.test(raw)) {
      docType = COOK_DOC_TYPES.FORECLOSURE_CHANCERY;
    } else {
      docType = options.docType || COOK_DOC_TYPES.LIS_PENDENS;
    }
  }

  // 4. Case Number (Chancery Court Foreclosure Case)
  let caseNumber = extractCookCaseNumber(raw);
  if (!caseNumber) {
    const classCase = raw.match(
      /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-case|case-number|chancery-case)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
    );
    if (classCase) {
      caseNumber = extractCookCaseNumber(cleanCellText(classCase[1]));
    }
  }

  // 5. PIN (Cook County Permanent Index Number / APN)
  let pin = extractCookPin(raw, options);
  if (!pin) {
    const classPin = raw.match(
      /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-pin|col-parcel|parcel-id|pin-number)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
    );
    if (classPin) {
      pin = extractCookPin(cleanCellText(classPin[1]), options);
    }
  }

  // 6. Plaintiff (Lender / Servicer / Mortgagee / Grantee)
  let plaintiff = null;
  const classPlaintiff = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-plaintiff|col-grantee|plaintiff|lender|mortgagee)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classPlaintiff) {
    const clean = cleanCellText(classPlaintiff[1]).replace(
      /^(?:Plaintiff|Lender|Mortgagee|Grantee|Indirect\s*Name):?\s*/i,
      ''
    );
    const firstLine = clean.split('\n')[0].trim();
    if (firstLine) plaintiff = firstLine;
  }
  if (!plaintiff) {
    const pMatch = raw.match(
      /\b(?:Plaintiff|Lender|Mortgagee|Grantee|Indirect\s*Name)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Defendant|Borrower|PIN|Parcel|$)/i
    );
    if (pMatch) {
      plaintiff = cleanCellText(pMatch[1]);
    }
  }

  // 7. Defendant (Borrower / Mortgagor / Grantor)
  let defendant = null;
  const classDefendant = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-defendant|col-grantor|defendant|borrower|mortgagor)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classDefendant) {
    const clean = cleanCellText(classDefendant[1]).replace(
      /^(?:Defendant|Borrower|Mortgagor|Grantor|Direct\s*Name):?\s*/i,
      ''
    );
    const firstLine = clean.split('\n')[0].trim();
    if (firstLine) defendant = firstLine;
  }
  if (!defendant) {
    const dMatch = raw.match(
      /\b(?:Defendant|Borrower|Mortgagor|Grantor|Direct\s*Name)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Plaintiff|Lender|PIN|Parcel|Legal|$)/i
    );
    if (dMatch) {
      defendant = cleanCellText(dMatch[1]);
    }
  }

  // 8. Legal Description
  let legalDescription = null;
  const classDesc = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-legal|legal-desc|property-desc)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classDesc) {
    const clean = cleanCellText(classDesc[1]).replace(
      /^(?:Legal\s*Desc(?:ription)?|Property\s*Desc(?:ription)?|Legal|Address):?\s*/i,
      ''
    );
    if (clean) legalDescription = clean;
  }
  if (!legalDescription) {
    const descMatch = raw.match(
      /\b(?:Legal\s*Desc(?:ription)?|Property\s*Desc(?:ription)?|Legal)\s*:(?:<[^>]+>|\s)*([^<\n\r]+)/i
    );
    if (descMatch) {
      legalDescription = cleanCellText(descMatch[1]);
    }
  }

  // Identity gate: require at least docNum, pin, caseNumber, or defendant
  if (!docNum && !pin && !caseNumber && !defendant) {
    return null;
  }

  const distressStage = identifyDistressStage(docType);

  // 9. Judgment / Decree Amount (for Chancery foreclosure decrees or Sheriff sale notices)
  let judgment = null;
  const classJudgment = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-judgment|judgment-amount|decree-amount)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classJudgment) {
    judgment = parseCookMoney(cleanCellText(classJudgment[1]));
  }
  if (judgment === null) {
    const jMatch = raw.match(/\b(?:Judgment(?:\s*Amount)?|Decree(?:\s*Amount)?)\s*:(?:<[^>]+>|\s)*\$?\s*([0-9,]+(?:\.[0-9]{2})?)/i);
    if (jMatch) {
      judgment = parseCookMoney(jMatch[1]);
    }
  }

  // 10. Opening Bid (for Sheriff Sale notices where published)
  let openingBid = null;
  if (distressStage === 'SCHEDULED_AUCTION') {
    const classBid = raw.match(
      /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-bid|col-opening-bid|opening-bid)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
    );
    if (classBid) {
      openingBid = parseCookMoney(cleanCellText(classBid[1]));
    }
    if (openingBid === null) {
      const bMatch = raw.match(/\b(?:Opening\s*Bid|Minimum\s*Bid|Starting\s*Bid)\s*:(?:<[^>]+>|\s)*\$?\s*([0-9,]+(?:\.[0-9]{2})?)/i);
      if (bMatch) {
        openingBid = parseCookMoney(bMatch[1]);
      }
    }
  }
  const baseUrl = (options.baseUrl || COOK_RECORDER_BASE_URL).replace(/\/+$/, '');
  const sourceUrl = capturedRecordUrl(rowHtml, baseUrl);

  return {
    source: 'recorder',
    platform: 'cook-recorder',
    county: 'Cook',
    state: 'IL',
    documentNumber: docNum || null,
    recordingNumber: docNum || null,
    instrumentNumber: docNum || null,
    recordedDate: recordedDate || null,
    docType,
    distressStage,
    caseNumber: caseNumber || null,
    pin: pin || null,
    apn: pin || null,
    plaintiff: plaintiff || null,
    grantee: plaintiff || null,
    defendant: defendant || null,
    grantor: defendant || null,
    legalDescription: legalDescription || null,
    sourceUrl,
    // Zero-Fabrication Invariant: statutory recorder notices record debt/lis pendens, never bids or valuations
    openingBid: openingBid !== null ? openingBid : null,
    judgment: judgment !== null ? judgment : null,
    estLow: null,
    estHigh: null,
    assessed: null,
  };
}

/**
 * Parses full HTML search results from Cook County Clerk recording division.
 *
 * @param {string} html - HTML search result page markup
 * @param {Object} [options] - Search options
 * @returns {Array<Object>} List of standardized parsed records
 */
function parseCookSearchHtml(html = '', options = {}) {
  const text = String(html || '');
  if (!text.trim()) return [];

  const filings = [];

  // 1. Structured table rows or search-result cards
  const rowRegex =
    /<(?:tr|div)\b[^>]*class="[^"]*(?:cook-record-row|search-result-row|record-row|result-row|record-card)[^"]*"[^>]*>([\s\S]*?)<\/(?:tr|div)>/gi;
  let match;
  while ((match = rowRegex.exec(text)) !== null) {
    const rowHtml = match[1];
    const parsed = parseCookRecordRow(rowHtml, options);
    if (parsed && (parsed.recordingNumber || parsed.pin || parsed.caseNumber || parsed.defendant)) {
      filings.push(parsed);
    }
  }

  // 2. Generic table rows with document / PIN / case content
  if (filings.length === 0 && /<tr\b/i.test(text)) {
    const genericTrRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = genericTrRegex.exec(text)) !== null) {
      const rowContent = trMatch[1];
      if (
        /(?:col-doc|col-pin|col-case|Recording|Document|Instrument|PIN|Permanent\s*Index|Chancery|Lis\s*Pendens|Plaintiff|Defendant)/i.test(
          rowContent
        )
      ) {
        const parsed = parseCookRecordRow(rowContent, options);
        if (parsed && (parsed.recordingNumber || parsed.pin || parsed.caseNumber || parsed.defendant)) {
          filings.push(parsed);
        }
      }
    }
  }

  // 3. Fallback: split on document / instrument headers
  if (filings.length === 0 && /(?:Document|Recording|Instrument)\s*#/i.test(text)) {
    const blocks = text.split(/(?=(?:Document|Recording|Instrument)\s*#)/i);
    for (const block of blocks) {
      const parsed = parseCookRecordRow(block, options);
      if (parsed && (parsed.recordingNumber || parsed.pin || parsed.caseNumber || parsed.defendant)) {
        filings.push(parsed);
      }
    }
  }

  return filings;
}

module.exports = {
  COOK_DOC_TYPES,
  RECORD_DOC_TYPES,
  COOK_RECORDER_BASE_URL,
  formatCookPin,
  extractCookPin,
  extractCookCaseNumber,
  identifyDistressStage,
  cleanCellText,
  getCookRecorderSearchUrl,
  parseCookMoney,
  parseOpeningBid,
  parseCookJudgment,
  parseCookRecordRow,
  parseCookSearchHtml,
};
