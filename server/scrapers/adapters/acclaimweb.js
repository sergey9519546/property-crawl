'use strict';

/**
 * server/scrapers/adapters/acclaimweb.js
 *
 * AcclaimWeb (Harris Recording Solutions) Multi-County Recorder Adapter.
 * Powers county recorder document searches (e.g. Clark County NV recorder.clarkcountynv.gov)
 * with targeted statutory document-type filtering for pre-foreclosures and trustee sales.
 */

const RECORD_DOC_TYPES = Object.freeze({
  LIS_PENDENS: 'LIS PENDENS',
  NOTICE_OF_DEFAULT: 'NOTICE OF DEFAULT',
  NOTICE_OF_TRUSTEE_SALE: 'NOTICE OF TRUSTEE SALE',
  CERTIFICATE_OF_SALE: 'CERTIFICATE OF SALE',
});

const DEFAULT_JURISDICTIONS = Object.freeze({
  clark: {
    county: 'Clark',
    state: 'NV',
    portalUrl: 'https://recorder.clarkcountynv.gov/AcclaimWeb',
    docTypeCodes: {
      LIS_PENDENS: 'LP',
      NOTICE_OF_DEFAULT: 'NOD',
      NOTICE_OF_TRUSTEE_SALE: 'NOTS',
    },
  },
  washoe: {
    county: 'Washoe',
    state: 'NV',
    portalUrl: 'https://recorder.washoecounty.gov/AcclaimWeb',
    docTypeCodes: {
      LIS_PENDENS: 'LP',
      NOTICE_OF_DEFAULT: 'NOD',
      NOTICE_OF_TRUSTEE_SALE: 'NOTS',
    },
  },
});

function getAcclaimSearchUrl(jurisdiction = 'clark', docType = 'NOTICE_OF_TRUSTEE_SALE') {
  const config = DEFAULT_JURISDICTIONS[jurisdiction.toLowerCase()] || DEFAULT_JURISDICTIONS.clark;
  return `${config.portalUrl}/search/SearchTypeDocType?docType=${encodeURIComponent(docType)}`;
}

function parseAcclaimRecordRow(rowHtml = '', jurisdiction = 'clark') {
  const text = String(rowHtml || '');
  if (!text) return null;

  const config = DEFAULT_JURISDICTIONS[jurisdiction.toLowerCase()] || DEFAULT_JURISDICTIONS.clark;

  // Instrument number: e.g. "20261009:001482" or "Doc #: 2026-09148"
  const instMatch = text.match(/(?:Instrument|Doc(?:\s*#|\s*Num)?|Record\s*#?):?\s*([0-9A-Za-z:\-_]+)/i);
  // Recording Date: e.g. "Recorded: 10/08/2026" or "10/08/2026"
  const dateMatch = text.match(/(?:Recorded|Date):?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i);
  // Document Type:
  const docTypeMatch = text.match(/(?:Doc\s*Type|Type):?\s*([A-Za-z\s]+?)(?:<|\n|$)/i);
  // Grantor (Borrower / Distressed Owner):
  const grantorMatch = text.match(/(?:Grantor|Borrower|Direct\s*Name):?\s*([A-Za-z0-9\s,\.]+?)(?:<|\n|Grantee|$)/i);
  // Grantee (Lender / Foreclosing Trustee):
  const granteeMatch = text.match(/(?:Grantee|Lender|Indirect\s*Name):?\s*([A-Za-z0-9\s,\.]+?)(?:<|\n|Parcel|$)/i);
  // Parcel Number / APN:
  const apnMatch = text.match(/(?:APN|Parcel(?:\s*#)?):?\s*([0-9A-Za-z\-]+)/i);
  // Legal description or address:
  const descMatch = text.match(/(?:Legal\s*Desc|Address):?\s*([^<\n\r]+)/i);

  if (!instMatch && !apnMatch && !grantorMatch) {
    return null;
  }

  const rawDocType = docTypeMatch ? docTypeMatch[1].trim() : 'NOTICE_OF_DEFAULT';
  let distressStage = 'PRE_FORECLOSURE';
  if (/TRUSTEE\s*SALE/i.test(rawDocType)) {
    distressStage = 'SCHEDULED_AUCTION';
  } else if (/CERTIFICATE/i.test(rawDocType)) {
    distressStage = 'SOLD_POST_SALE';
  }

  return {
    source: 'recorder',
    platform: 'acclaimweb',
    county: config.county,
    state: config.state,
    instrumentNumber: instMatch ? instMatch[1].trim() : null,
    recordedDate: dateMatch ? dateMatch[1].trim() : null,
    docType: rawDocType,
    distressStage,
    grantor: grantorMatch ? grantorMatch[1].trim() : null,
    grantee: granteeMatch ? granteeMatch[1].trim() : null,
    apn: apnMatch ? apnMatch[1].trim() : null,
    legalDescription: descMatch ? descMatch[1].trim() : null,
    sourceUrl: `${config.portalUrl}/search`,
  };
}

/**
 * Standardize full AcclaimWeb search result page HTML into structured filings
 */
function parseAcclaimSearchHtml(html = '', jurisdiction = 'clark') {
  const text = String(html || '');
  const filings = [];

  // Match table rows or search result div blocks
  const rowRegex = /<(?:tr|div)\b[^>]*class="[^"]*(?:search-result-row|GridRow|SearchResultItem)[^"]*"[^>]*>([\s\S]*?)<\/(?:tr|div)>/gi;
  let match;

  while ((match = rowRegex.exec(text)) !== null) {
    const rowHtml = match[1];
    const parsed = parseAcclaimRecordRow(rowHtml, jurisdiction);
    if (parsed && (parsed.instrumentNumber || parsed.apn || parsed.grantor)) {
      filings.push(parsed);
    }
  }

  // Fallback: split on document record dividers
  if (filings.length === 0 && /(?:Instrument|Doc\s*Type|Recorded)/i.test(text)) {
    const blocks = text.split(/(?=(?:Instrument|Doc(?:\s*#)?):)/i);
    for (const block of blocks) {
      const parsed = parseAcclaimRecordRow(block, jurisdiction);
      if (parsed && (parsed.instrumentNumber || parsed.apn)) {
        filings.push(parsed);
      }
    }
  }

  return filings;
}

module.exports = {
  RECORD_DOC_TYPES,
  DEFAULT_JURISDICTIONS,
  getAcclaimSearchUrl,
  parseAcclaimRecordRow,
  parseAcclaimSearchHtml,
};
