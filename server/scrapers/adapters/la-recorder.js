'use strict';

/**
 * server/scrapers/adapters/la-recorder.js
 *
 * Los Angeles County, CA Notice of Default & Notice of Trustee Sale Adapter.
 * Extracts pre-foreclosure (NOD) and scheduled-sale (NTS) recordings from the
 * Los Angeles County Recorder's Office public index.
 *
 * Statutory context (Cal. Civ. Code §§ 2924–2924m):
 * - NOD (Notice of Default): recorded after 3-month payment default.
 * - NTS (Notice of Trustee Sale): recorded ≥21 days before sale, published 3×.
 * - Non-judicial (deed-of-trust) track only; no Lis Pendens required for DOT.
 * - AIN (Assessor's Identification Number): format XX-XXXX-XXX-XX (10 digits).
 * - Trustee sales conducted on courthouse steps between 9am–5pm on weekdays.
 */

const { capturedRecordUrl } = require('./record-link');

// ---------------------------------------------------------------------------
// Document type constants
// ---------------------------------------------------------------------------

const LA_DOC_TYPES = Object.freeze({
  NOD: 'NOTICE OF DEFAULT',
  NTS: 'NOTICE OF TRUSTEE SALE',
  TRUSTEE_DEED: 'TRUSTEE DEED UPON SALE',
  LIS_PENDENS: 'LIS PENDENS',
  NOTICE_OF_RESCISSION: 'NOTICE OF RESCISSION',
  DEED_OF_TRUST: 'DEED OF TRUST',
  RECONVEYANCE: 'FULL RECONVEYANCE',
  SUBSTITUTION_OF_TRUSTEE: 'SUBSTITUTION OF TRUSTEE',
  ASSIGNMENT_OF_DEED_OF_TRUST: 'ASSIGNMENT OF DEED OF TRUST',
  NOTICE_OF_COMPLETION: 'NOTICE OF COMPLETION',
});

const RECORD_DOC_TYPES = LA_DOC_TYPES;

const LA_RECORDER_BASE_URL =
  process.env.LA_RECORDER_URL ||
  'https://lavote.gov/apps/Recorder/Detail/OverviewSearch';

// ---------------------------------------------------------------------------
// AIN (Assessor's Identification Number) utilities
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw LA County AIN into the canonical XX-XXXX-XXX-XX format.
 * The Assessor uses 10 significant digits (book-page-parcel).
 *
 * @param {string|number} rawAin - Raw AIN input (with or without dashes)
 * @returns {string|null} Formatted AIN (e.g. '5001-001-001') or null
 */
function formatLaAin(rawAin) {
  if (rawAin === null || rawAin === undefined) return null;
  const digits = String(rawAin).replace(/\D/g, '');

  // Full 10-digit AIN: XXXX-XXX-XXX (book 4, page 3, parcel 3)
  if (digits.length === 10) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 10)}`;
  }
  // 9-digit form (leading-zero book sometimes omitted): XXX-XXX-XXX
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
  }
  // 7-digit short form (book + page): XXXX-XXX or XXX-XXXX
  if (digits.length === 7) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 7)}`;
  }

  // Already dashed – validate and normalise
  const dashedMatch = String(rawAin)
    .trim()
    .match(/^(\d{3,4})[- ](\d{3})[- ](\d{3})(?:[- ](\d{2}))?$/);
  if (dashedMatch) {
    const [, book, page, parcel, unit] = dashedMatch;
    return unit
      ? `${book}-${page}-${parcel}-${unit}`
      : `${book}-${page}-${parcel}`;
  }

  return null;
}

/**
 * Extracts an LA County AIN from unstructured text.
 *
 * @param {string} text - Input text that may contain an AIN
 * @returns {string|null} Formatted AIN or null
 */
function extractLaAin(text) {
  if (!text) return null;
  const raw = String(text);

  // 1. Labeled AIN / APN / Parcel pattern
  const labeled = raw.match(
    /\b(?:AIN|APN|Assessor(?:'?s)?\s*(?:Identification|Parcel|ID)\s*(?:Number|No\.?|#)?|Parcel(?:\s*(?:#|ID|No\.?|Number))?)[\s:#]*([0-9]{4}-[0-9]{3}-[0-9]{3}(?:-[0-9]{2})?|[0-9]{7,10})\b/i
  );
  if (labeled) {
    const formatted = formatLaAin(labeled[1]);
    if (formatted) return formatted;
  }

  // 2. Exact dashed 10-digit pattern XXXX-XXX-XXX
  const dashed10 = raw.match(/\b(\d{4}-\d{3}-\d{3})\b/);
  if (dashed10) {
    return formatLaAin(dashed10[1]);
  }

  // 3. Exact dashed 9-digit pattern XXX-XXX-XXX
  const dashed9 = raw.match(/\b(\d{3}-\d{3}-\d{3})\b/);
  if (dashed9) {
    return formatLaAin(dashed9[1]);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Trustee / TS# case number utilities
// ---------------------------------------------------------------------------

/**
 * Extracts a trustee case number or TS# from text.
 * Common formats: TS# 12345678, T.S. No. 2024-01234, CA-24-000001-CL
 *
 * @param {string} text - Input text
 * @returns {string|null} Raw TS# string or null
 */
function extractLaCaseNumber(text) {
  if (!text) return null;
  const raw = String(text);

  // 1. Explicit TS# / T.S. No. reference
  const tsMatch = raw.match(
    /\b(?:T\.?\s*S\.?\s*(?:#|No\.?|Number)?|Trustee(?:'?s)?\s*(?:Sale\s*)?(?:#|No\.?|Number)?|TS\s*(?:#|No\.?|Number)?)\s*[:#]?\s*([A-Z0-9][-A-Z0-9.]{4,24})/i
  );
  if (tsMatch) {
    return tsMatch[1].trim().replace(/\.$/, '');
  }

  // 2. Servicer/trustee internal reference: CA-YY-NNNNNN-CL / YYYY-NNNNNN
  const serviceRef = raw.match(
    /\b(CA[-_]?\d{2}[-_]?\d{4,8}[-_]?[A-Z]{0,4})\b/i
  );
  if (serviceRef) {
    return serviceRef[1].toUpperCase();
  }

  // 3. DOC / Instrument number that may serve as case reference
  const docRef = raw.match(
    /\b(?:Doc(?:ument)?|Instrument|Recording)\s*(?:#|No\.?|Number)?\s*[:#]?\s*([0-9]{6,14})\b/i
  );
  if (docRef) {
    return docRef[1].trim();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Distress stage classification
// ---------------------------------------------------------------------------

/**
 * Identifies the statutory distress stage from an LA County document type.
 *
 * @param {string} docType - Raw or normalized document type
 * @returns {'pre-foreclosure'|'scheduled-sale'|'post-sale'|'lis-pendens'|'unknown'}
 */
function identifyDistressStage(docType) {
  const norm = String(docType || '').toUpperCase();

  if (/NOTICE\s*OF\s*TRUSTEE\s*SALE|NTS\b/.test(norm)) {
    return 'scheduled-sale';
  }
  if (/TRUSTEE\s*DEED(?:\s*UPON\s*SALE)?/.test(norm)) {
    return 'post-sale';
  }
  if (/LIS\s*PENDENS/.test(norm)) {
    return 'lis-pendens';
  }
  if (
    /NOTICE\s*OF\s*DEFAULT|NOD\b|SUBSTITUTION\s*OF\s*TRUSTEE|ASSIGNMENT\s*OF\s*DEED/.test(norm)
  ) {
    return 'pre-foreclosure';
  }
  if (/DEED\s*OF\s*TRUST|RECONVEYANCE|RESCISSION|RELEASE/.test(norm)) {
    return 'pre-foreclosure';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Opening bid parser — Zero-Fabrication Invariant
// ---------------------------------------------------------------------------

/**
 * Parses an explicitly stated opening bid amount from text.
 * Returns null whenever no opening bid is present in the source text.
 * Never imputes or estimates from assessed value or any proxy.
 *
 * @param {string} text - Input text (NTS body, table cell content, etc.)
 * @returns {number|null} Dollar amount or null if not explicitly stated
 */
function parseOpeningBid(text) {
  if (!text) return null;
  const raw = String(text);

  // Require an explicit label + amount pairing
  const bidMatch = raw.match(
    /\b(?:Opening\s*Bid|Minimum\s*Bid|Starting\s*Bid|Amount\s*of\s*(?:Opening\s*)?Bid|Bid\s*Amount)\s*[:#]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i
  );
  if (bidMatch) {
    const amount = parseFloat(bidMatch[1].replace(/,/g, ''));
    if (!isNaN(amount) && amount > 0) return amount;
  }

  return null; // Zero-Fabrication: never return a guessed value
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

/**
 * Builds a search URL for the LA County Recorder public records portal.
 *
 * @param {Object} [opts] - Query options
 * @param {string} [opts.docType] - Document type filter (uses LA_DOC_TYPES)
 * @param {string} [opts.ain] - AIN / parcel number
 * @param {string} [opts.grantor] - Grantor (trustor / borrower) name
 * @param {string} [opts.grantee] - Grantee (trustee / lender) name
 * @param {string} [opts.startDate] - Start date (MM/DD/YYYY)
 * @param {string} [opts.endDate] - End date (MM/DD/YYYY)
 * @param {string} [opts.baseUrl] - Override base URL
 * @returns {string} Fully qualified search URL
 */
function getLaRecorderSearchUrl(opts = {}) {
  const base = (opts.baseUrl || LA_RECORDER_BASE_URL).replace(/\/+$/, '');
  const params = new URLSearchParams();

  const docType = opts.docType || LA_DOC_TYPES.NOD;
  params.set('DocumentType', docType);

  if (opts.ain) {
    const normalized = formatLaAin(opts.ain) || opts.ain;
    params.set('AIN', normalized);
  }
  if (opts.grantor) {
    params.set('GrantorName', String(opts.grantor).trim());
  }
  if (opts.grantee) {
    params.set('GranteeName', String(opts.grantee).trim());
  }
  if (opts.startDate) {
    params.set('StartDate', String(opts.startDate).trim());
  }
  if (opts.endDate) {
    params.set('EndDate', String(opts.endDate).trim());
  }

  return `${base}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// HTML cell text cleaner (shared utility)
// ---------------------------------------------------------------------------

/**
 * Strips HTML tags and normalizes whitespace from a cell value.
 *
 * @param {string} str - Raw HTML string
 * @returns {string} Clean plain text
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
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Row parser
// ---------------------------------------------------------------------------

/**
 * Standardizes a single scraped HTML row / card into the canonical listing schema.
 *
 * @param {string} rowHtml - Row or card markup
 * @param {Object} [options] - Configuration overrides
 * @param {string} [options.baseUrl] - Recorder base URL for capturedRecordUrl
 * @returns {Object|null} Canonical record or null if row is unidentifiable
 */
function parseLaRecordRow(rowHtml = '', options = {}) {
  const raw = String(rowHtml || '');
  if (!raw.trim()) return null;

  // 1. Document / Instrument Number
  let docNum = null;
  const classNum = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-doc|col-instrument|col-recording|doc-number|recording-number|instrument-num)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classNum) {
    const clean = cleanCellText(classNum[1]);
    const m = clean.match(/([0-9]{6,14}|[0-9]{4}-[0-9]{4,10})/);
    if (m) docNum = m[1].trim();
  }
  if (!docNum) {
    const numMatch = raw.match(
      /\b(?:Doc(?:ument)?|Instrument|Recording)\s*(?:#|No\.?|Number)\s*[:#]?\s*([0-9]{6,14}|[0-9]{4}-[0-9]{4,10})/i
    );
    if (numMatch) docNum = numMatch[1].trim();
  }

  // 2. Recording Date
  let recordedDate = null;
  const classDate = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-date|recording-date|rec-date|recorded-date)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classDate) {
    const clean = cleanCellText(classDate[1]);
    const m = clean.match(/([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (m) recordedDate = m[1].trim();
  }
  if (!recordedDate) {
    const dateMatch = raw.match(
      /\b(?:Recorded|Recording\s*Date|Rec(?:orded)?\s*Date|Date\s*Recorded)\s*[:#]?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i
    );
    if (dateMatch) recordedDate = dateMatch[1].trim();
  }

  // 3. Document Type
  let docType = null;
  const classType = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-type|doc-type|document-type|record-type)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classType) {
    const clean = cleanCellText(classType[1]).replace(
      /^(?:Doc(?:\s*ument)?\s*Type|Record\s*Type|Type):?\s*/i,
      ''
    );
    if (clean) docType = clean;
  }
  if (!docType) {
    if (/NOTICE\s*OF\s*TRUSTEE\s*SALE|NTS\b/i.test(raw)) {
      docType = LA_DOC_TYPES.NTS;
    } else if (/NOTICE\s*OF\s*DEFAULT|NOD\b/i.test(raw)) {
      docType = LA_DOC_TYPES.NOD;
    } else if (/TRUSTEE\s*DEED(?:\s*UPON\s*SALE)?/i.test(raw)) {
      docType = LA_DOC_TYPES.TRUSTEE_DEED;
    } else if (/LIS\s*PENDENS/i.test(raw)) {
      docType = LA_DOC_TYPES.LIS_PENDENS;
    } else {
      docType = options.docType || null;
    }
  }

  // 4. AIN (Assessor's Identification Number)
  let ain = extractLaAin(raw);
  if (!ain) {
    const classAin = raw.match(
      /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-ain|col-apn|col-parcel|parcel-id|ain-number)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
    );
    if (classAin) ain = extractLaAin(cleanCellText(classAin[1]));
  }

  // 5. Case / TS# Number
  let caseNumber = extractLaCaseNumber(raw);
  if (!caseNumber) {
    const classCase = raw.match(
      /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-case|col-ts|case-number|ts-number)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
    );
    if (classCase) caseNumber = extractLaCaseNumber(cleanCellText(classCase[1]));
  }

  // 6. Grantor (Trustor / Borrower)
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
      /\b(?:Grantor|Borrower|Trustor|Direct\s*Name)\s*[:#]\s*([A-Za-z0-9\s,.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Grantee|Trustee|AIN|Parcel|$)/i
    );
    if (grantorMatch) grantor = cleanCellText(grantorMatch[1]);
  }

  // 7. Grantee (Trustee / Lender / Beneficiary)
  let grantee = null;
  const classGrantee = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-grantee|grantee|trustee|lender|beneficiary)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classGrantee) {
    const clean = cleanCellText(classGrantee[1]).replace(
      /^(?:Grantee|Trustee|Lender|Beneficiary|Indirect\s*Name):?\s*/i,
      ''
    );
    const firstLine = clean.split('\n')[0].trim();
    if (firstLine) grantee = firstLine;
  }
  if (!grantee) {
    const granteeMatch = raw.match(
      /\b(?:Grantee|Trustee|Lender|Beneficiary|Indirect\s*Name)\s*[:#]\s*([A-Za-z0-9\s,.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Grantor|Borrower|AIN|Parcel|$)/i
    );
    if (granteeMatch) grantee = cleanCellText(granteeMatch[1]);
  }

  // 8. Legal Description
  let legalDescription = null;
  const classDesc = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-legal|legal-desc|property-desc|legal-description)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classDesc) {
    const clean = cleanCellText(classDesc[1]).replace(
      /^(?:Legal\s*Desc(?:ription)?|Property\s*Desc(?:ription)?|Legal):?\s*/i,
      ''
    );
    if (clean) legalDescription = clean;
  }
  if (!legalDescription) {
    const descMatch = raw.match(
      /\b(?:Legal\s*Desc(?:ription)?|Property\s*Desc(?:ription)?)\s*[:#]\s*([^<\n\r]+)/i
    );
    if (descMatch) legalDescription = cleanCellText(descMatch[1]);
  }

  // 9. Opening bid (NOD/NTS may include bid on some portal views — zero-fabrication)
  const openingBid = parseOpeningBid(raw);

  // Identity gate: at least one identifier must be present
  if (!docNum && !ain && !caseNumber && !grantor) {
    return null;
  }

  const distressStage = identifyDistressStage(docType);
  const baseUrl = (options.baseUrl || LA_RECORDER_BASE_URL).replace(/\/+$/, '');
  const sourceUrl = capturedRecordUrl(rowHtml, baseUrl);

  return {
    source: 'recorder',
    platform: 'la-recorder',
    county: 'Los Angeles',
    state: 'CA',
    documentNumber: docNum || null,
    recordingNumber: docNum || null,
    instrumentNumber: docNum || null,
    recordedDate: recordedDate || null,
    docType: docType || null,
    distressStage,
    caseNumber: caseNumber || null,
    ain: ain || null,
    apn: ain || null,
    grantor: grantor || null,
    trustor: grantor || null,
    grantee: grantee || null,
    trustee: grantee || null,
    legalDescription: legalDescription || null,
    sourceUrl,
    // Zero-Fabrication Invariant: recorder filings are not auction listings
    openingBid: openingBid || null,
    estLow: null,
    estHigh: null,
    assessed: null,
  };
}

// ---------------------------------------------------------------------------
// Full HTML search result parser
// ---------------------------------------------------------------------------

/**
 * Parses full HTML from an LA County Recorder search results page.
 *
 * @param {string} html - Full HTML page markup
 * @param {Object} [options] - Options forwarded to parseLaRecordRow
 * @returns {Array<Object>} Array of standardized records
 */
function parseLaSearchHtml(html = '', options = {}) {
  const text = String(html || '');
  if (!text.trim()) return [];

  const records = [];

  // 1. Structured search-result rows / cards
  const rowRegex =
    /<(?:tr|div)\b[^>]*class="[^"]*(?:la-record-row|search-result-row|record-row|result-row|record-card|result-item)[^"]*"[^>]*>([\s\S]*?)<\/(?:tr|div)>/gi;
  let match;
  while ((match = rowRegex.exec(text)) !== null) {
    const parsed = parseLaRecordRow(match[1], options);
    if (parsed && (parsed.documentNumber || parsed.ain || parsed.caseNumber || parsed.grantor)) {
      records.push(parsed);
    }
  }

  // 2. Generic table rows with recorder-relevant content
  if (records.length === 0 && /<tr\b/i.test(text)) {
    const genericTrRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = genericTrRegex.exec(text)) !== null) {
      const rowContent = trMatch[1];
      if (
        /(?:Notice\s*of\s*Default|Notice\s*of\s*Trustee|NOD|NTS|AIN|Assessor|Recording|Document|Instrument)/i.test(
          rowContent
        )
      ) {
        const parsed = parseLaRecordRow(rowContent, options);
        if (parsed && (parsed.documentNumber || parsed.ain || parsed.caseNumber || parsed.grantor)) {
          records.push(parsed);
        }
      }
    }
  }

  // 3. Fallback: split on document / instrument number headers
  if (records.length === 0 && /(?:Document|Instrument|Recording)\s*(?:#|No\.?|Number)/i.test(text)) {
    const blocks = text.split(/(?=(?:Document|Instrument|Recording)\s*(?:#|No\.?|Number))/i);
    for (const block of blocks) {
      const parsed = parseLaRecordRow(block, options);
      if (parsed && (parsed.documentNumber || parsed.ain || parsed.caseNumber || parsed.grantor)) {
        records.push(parsed);
      }
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  LA_DOC_TYPES,
  RECORD_DOC_TYPES,
  LA_RECORDER_BASE_URL,
  formatLaAin,
  extractLaAin,
  extractLaCaseNumber,
  identifyDistressStage,
  parseOpeningBid,
  getLaRecorderSearchUrl,
  cleanCellText,
  parseLaRecordRow,
  parseLaSearchHtml,
};
