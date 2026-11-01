const { capturedRecordUrl } = require('./record-link');
'use strict';

/**
 * server/scrapers/adapters/maricopa-recorder.js
 *
 * Maricopa County, AZ Recorder Adapter (recorder.maricopa.gov).
 * Extracts statutory Notice of Trustee Sale, Notice of Default, and Certificate
 * of Sale filings for the high-volume Phoenix metro distress market.
 */

const MARICOPA_DOC_TYPES = Object.freeze({
  NOTICE_OF_TRUSTEE_SALE: 'NOTICE OF TRUSTEE SALE',
  NOTICE_OF_DEFAULT: 'NOTICE OF DEFAULT',
  CERTIFICATE_OF_SALE: 'CERTIFICATE OF SALE',
  LIS_PENDENS: 'LIS PENDENS',
});

// Alias for cross-adapter naming compatibility
const RECORD_DOC_TYPES = MARICOPA_DOC_TYPES;

const MARICOPA_RECORDER_BASE_URL =
  process.env.MARICOPA_RECORDER_URL || 'https://recorder.maricopa.gov';

/**
 * Builds search URL for Maricopa County Recorder queries
 *
 * @param {string} docType - Document type filter
 * @param {Object} options - Optional query parameters
 * @returns {string} URL
 */
function getMaricopaSearchUrl(docType = MARICOPA_DOC_TYPES.NOTICE_OF_TRUSTEE_SALE, options = {}) {
  const base = (options.baseUrl || MARICOPA_RECORDER_BASE_URL).replace(/\/+$/, '');
  if (options.recordingNumber || options.docket) {
    const id = options.recordingNumber || options.docket;
    throw new Error('A captured publisher record URL is required; no detail URL can be inferred from a recording number');
  }
  const cleanType = encodeURIComponent(docType || MARICOPA_DOC_TYPES.NOTICE_OF_TRUSTEE_SALE);
  return `${base}/recdoc/search?docType=${cleanType}`;
}

/**
 * Clean cell or tag text safely decoding entities and trimming spaces
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
 * Identifies distress stage based on recorded document type
 *
 * @param {string} rawDocType - Recorded document classification
 * @returns {string} 'PRE_FORECLOSURE' | 'SCHEDULED_AUCTION' | 'SOLD_POST_SALE'
 */
function identifyDistressStage(rawDocType = '') {
  const norm = String(rawDocType || '').toUpperCase();
  if (/TRUSTEE\s*SALE/i.test(norm)) {
    return 'SCHEDULED_AUCTION';
  }
  if (/CERTIFICATE(?:\s*OF\s*SALE)?/i.test(norm)) {
    return 'SOLD_POST_SALE';
  }
  return 'PRE_FORECLOSURE';
}

/**
 * Parse an individual row or card HTML snippet from recorder.maricopa.gov
 *
 * @param {string} rowHtml - Row or card markup
 * @param {Object} options - Optional configuration overrides
 * @returns {Object|null} Standardized filing or null if unparseable
 */
function parseMaricopaRecordRow(rowHtml = '', options = {}) {
  const raw = String(rowHtml || '');
  if (!raw.trim()) return null;

  // 1. Recording Number / Docket
  let recordingNumber = null;
  const classNum = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-recording|col-docket|col-inst|col-instrument|recording-number|docket-number)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classNum) {
    const clean = cleanCellText(classNum[1]).replace(
      /^(?:Recording|Docket|Instrument|Doc)(?:\s*(?:#|Number|No\.?))?:?\s*/i,
      ''
    );
    const m = clean.match(/([0-9]{4}[-_]?[0-9]{4,8})/);
    if (m) recordingNumber = m[1].trim();
  }
  if (!recordingNumber) {
    const numMatch = raw.match(
      /\b(?:Recording|Docket|Instrument|Doc)(?:\s*(?:#|Num|Number|No\.?))?\s*:(?:<[^>]+>|\s)*([0-9]{4}[-_]?[0-9]{4,8})/i
    );
    if (numMatch) {
      recordingNumber = numMatch[1].trim();
    }
  }

  // 2. Recording Date
  let recordedDate = null;
  const classDate = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-date|recording-date|recorded)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classDate) {
    const clean = cleanCellText(classDate[1]);
    const m = clean.match(/([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (m) recordedDate = m[1].trim();
  }
  if (!recordedDate) {
    const dateMatch = raw.match(
      /\b(?:Recorded|Recording\s*Date|Rec\s*Date|Date)\s*:(?:<[^>]+>|\s)*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i
    );
    if (dateMatch) {
      recordedDate = dateMatch[1].trim();
    }
  }

  // 3. Document Type
  let docType = null;
  const classType = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-type|doc-type|record-type)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
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
      /\b(?:Doc(?:\s*ument)?\s*Type|Record\s*Type|Type)\s*:(?:<[^>]+>|\s)*([A-Za-z\s]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|$)/i
    );
    if (typeMatch) {
      const val = cleanCellText(typeMatch[1]);
      if (val && !/^(?:Grantor|Grantee|APN|Parcel|Date)/i.test(val)) {
        docType = val;
      }
    }
  }
  if (!docType) {
    if (/TRUSTEE\s*SALE/i.test(raw)) {
      docType = MARICOPA_DOC_TYPES.NOTICE_OF_TRUSTEE_SALE;
    } else if (/CERTIFICATE\s*OF\s*SALE/i.test(raw)) {
      docType = MARICOPA_DOC_TYPES.CERTIFICATE_OF_SALE;
    } else if (/NOTICE\s*OF\s*DEFAULT/i.test(raw)) {
      docType = MARICOPA_DOC_TYPES.NOTICE_OF_DEFAULT;
    } else {
      docType = options.docType || MARICOPA_DOC_TYPES.NOTICE_OF_TRUSTEE_SALE;
    }
  }

  // 4. Grantor (Borrower / Trustor)
  let grantor = null;
  const classGrantor = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-grantor|grantor|borrower|trustor)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classGrantor) {
    const clean = cleanCellText(classGrantor[1]).replace(
      /^(?:Grantor|Borrower|Trustor|Direct\s*Name):?\s*/i,
      ''
    );
    const firstLine = clean.split('\n')[0].trim();
    if (firstLine) grantor = firstLine;
  }
  if (!grantor) {
    const grantorMatch = raw.match(
      /\b(?:Grantor|Borrower|Trustor|Direct\s*Name)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Grantee|Trustee|Beneficiary|APN|Parcel|$)/i
    );
    if (grantorMatch) {
      grantor = cleanCellText(grantorMatch[1]);
    }
  }

  // 5. Grantee (Trustee / Beneficiary / Foreclosing Party)
  let grantee = null;
  const classGrantee = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-grantee|grantee|trustee|beneficiary)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classGrantee) {
    const clean = cleanCellText(classGrantee[1]).replace(
      /^(?:Grantee|Trustee|Beneficiary|Lender|Indirect\s*Name):?\s*/i,
      ''
    );
    const firstLine = clean.split('\n')[0].trim();
    if (firstLine) grantee = firstLine;
  }
  if (!grantee) {
    // Avoid matching "Trustee" in "Doc Type: NOTICE OF TRUSTEE SALE"
    const granteeMatch = raw.match(
      /\b(?:Grantee|Indirect\s*Name)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|APN|Parcel|Legal|Address|$)/i
    );
    if (granteeMatch) {
      grantee = cleanCellText(granteeMatch[1]);
    } else {
      const trusteeMatch = raw.match(
        /\b(?:Trustee|Beneficiary|Lender)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|APN|Parcel|Legal|Address|$)/i
      );
      if (trusteeMatch) {
        const clean = cleanCellText(trusteeMatch[1]);
        if (clean && !/^(?:SALE|DEFAULT)$/i.test(clean)) {
          grantee = clean;
        }
      }
    }
  }

  // 6. APN / Parcel ID
  let apn = null;
  const classApn = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-apn|col-parcel|parcel-id|apn)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classApn) {
    const clean = cleanCellText(classApn[1]).replace(
      /^(?:APN|Parcel(?:\s*(?:#|ID|Number|No\.?))?):?\s*/i,
      ''
    );
    const m = clean.match(/([0-9]{3}[-\s]?[0-9]{2}[-\s]?[0-9]{3}[A-Za-z]?|[0-9A-Za-z\-]+)/);
    if (m) apn = m[1].trim();
  }
  if (!apn) {
    const apnMatch = raw.match(
      /\b(?:APN|Parcel(?:\s*(?:#|ID|Number|No\.?))?)\s*:(?:<[^>]+>|\s)*([0-9]{3}[-\s]?[0-9]{2}[-\s]?[0-9]{3}[A-Za-z]?|[0-9A-Za-z\-]+)/i
    );
    if (apnMatch) {
      apn = apnMatch[1].trim();
    }
  }

  // 7. Legal Description / Situs Address
  let legalDescription = null;
  const classDesc = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-legal|col-desc|legal-desc|property-desc)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
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
      /\b(?:Legal\s*Desc(?:ription)?|Property\s*Desc(?:ription)?|Legal|Address)\s*:(?:<[^>]+>|\s)*([^<\n\r]+)/i
    );
    if (descMatch) {
      legalDescription = cleanCellText(descMatch[1]);
    }
  }

  // Minimum required identity check: recordingNumber, apn, or grantor
  if (!recordingNumber && !apn && !grantor) {
    return null;
  }

  const distressStage = identifyDistressStage(docType);
  const baseUrl = (options.baseUrl || MARICOPA_RECORDER_BASE_URL).replace(/\/+$/, '');
  const sourceUrl = capturedRecordUrl(rowHtml, baseUrl);

  return {
    source: 'recorder',
    platform: 'maricopa-recorder',
    county: 'Maricopa',
    state: 'AZ',
    recordingNumber,
    instrumentNumber: recordingNumber, // alias for standard pipeline
    docket: recordingNumber, // alias
    recordedDate: recordedDate || null,
    docType,
    distressStage,
    grantor: grantor || null,
    grantee: grantee || null,
    apn: apn || null,
    legalDescription: legalDescription || null,
    sourceUrl,
    // Zero-Fabrication Invariant: statutory recorder notices record debt/default, never opening bids
    openingBid: null,
    estLow: null,
    estHigh: null,
    assessed: null,
  };
}

/**
 * Standardize complete HTML search results page from recorder.maricopa.gov
 *
 * @param {string} html - HTML search result markup
 * @param {Object} options - Search configuration
 * @returns {Array<Object>} List of standardized parsed records
 */
function parseMaricopaSearchHtml(html = '', options = {}) {
  const text = String(html || '');
  if (!text.trim()) return [];

  const filings = [];

  // 1. Structured table rows or search-result divs
  const rowRegex =
    /<(?:tr|div)\b[^>]*class="[^"]*(?:maricopa-record-row|search-result-row|record-row|result-row|SearchResultItem)[^"]*"[^>]*>([\s\S]*?)<\/(?:tr|div)>/gi;
  let match;
  while ((match = rowRegex.exec(text)) !== null) {
    const rowHtml = match[1];
    const parsed = parseMaricopaRecordRow(rowHtml, options);
    if (parsed && (parsed.recordingNumber || parsed.apn || parsed.grantor)) {
      filings.push(parsed);
    }
  }

  // 2. Generic table rows with recording / docket / grantor data
  if (filings.length === 0 && /<tr\b/i.test(text)) {
    const genericTrRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = genericTrRegex.exec(text)) !== null) {
      const rowContent = trMatch[1];
      if (
        /(?:col-recording|col-docket|col-inst|Recording|Docket|Instrument|Grantor|Trustor|APN|Parcel)/i.test(
          rowContent
        )
      ) {
        const parsed = parseMaricopaRecordRow(rowContent, options);
        if (parsed && (parsed.recordingNumber || parsed.apn || parsed.grantor)) {
          filings.push(parsed);
        }
      }
    }
  }

  // 3. Fallback: split on document record headers if present
  if (filings.length === 0 && /(?:Recording|Docket|Instrument)\s*#/i.test(text)) {
    const blocks = text.split(/(?=(?:Recording|Docket|Instrument)\s*#)/i);
    for (const block of blocks) {
      const parsed = parseMaricopaRecordRow(block, options);
      if (parsed && (parsed.recordingNumber || parsed.apn || parsed.grantor)) {
        filings.push(parsed);
      }
    }
  }

  return filings;
}

module.exports = {
  MARICOPA_DOC_TYPES,
  RECORD_DOC_TYPES,
  MARICOPA_RECORDER_BASE_URL,
  getMaricopaSearchUrl,
  cleanCellText,
  identifyDistressStage,
  parseMaricopaRecordRow,
  parseMaricopaSearchHtml,
};
