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
    portalUrl: process.env.CLARK_ACCLAIM_URL || 'https://recorder.clarkcountynv.gov/AcclaimWeb',
    livePortalUrl: 'https://recorderecomm.clarkcountynv.gov/AcclaimWeb',
    docTypeCodes: {
      LIS_PENDENS: 'LP',
      NOTICE_OF_DEFAULT: 'NOD',
      NOTICE_OF_TRUSTEE_SALE: 'NOTS',
    },
  },
  washoe: {
    county: 'Washoe',
    state: 'NV',
    portalUrl: process.env.WASHOE_RECORDER_URL || 'https://recorder.washoecounty.gov/AcclaimWeb',
    livePortalUrl: 'https://icris.washoecounty.us/ssrecorder/user/disclaimer',
    docTypeCodes: {
      LIS_PENDENS: 'LP',
      NOTICE_OF_DEFAULT: 'NOD',
      NOTICE_OF_TRUSTEE_SALE: 'NOTS',
    },
  },
  collin: {
    county: 'Collin',
    state: 'TX',
    portalUrl: process.env.COLLIN_ACCLAIM_URL || 'https://collin.tx.publicsearch.us/AcclaimWeb',
    livePortalUrl: 'https://collin.tx.publicsearch.us/AcclaimWeb',
    docTypeCodes: {
      LIS_PENDENS: 'LP',
      NOTICE_OF_DEFAULT: 'NOD',
      NOTICE_OF_TRUSTEE_SALE: 'NOTS',
    },
  },
  denton: {
    county: 'Denton',
    state: 'TX',
    portalUrl: process.env.DENTON_ACCLAIM_URL || 'https://denton.tx.publicsearch.us/AcclaimWeb',
    livePortalUrl: 'https://denton.tx.publicsearch.us/AcclaimWeb',
    docTypeCodes: {
      LIS_PENDENS: 'LP',
      NOTICE_OF_DEFAULT: 'NOD',
      NOTICE_OF_TRUSTEE_SALE: 'NOTS',
    },
  },
  travis: {
    county: 'Travis',
    state: 'TX',
    portalUrl: process.env.TRAVIS_ACCLAIM_URL || 'https://travis.tx.publicsearch.us/AcclaimWeb',
    livePortalUrl: 'https://travis.tx.publicsearch.us/AcclaimWeb',
    docTypeCodes: {
      LIS_PENDENS: 'LP',
      NOTICE_OF_DEFAULT: 'NOD',
      NOTICE_OF_TRUSTEE_SALE: 'NOTS',
    },
  },
  duval: {
    county: 'Duval',
    state: 'FL',
    portalUrl: process.env.DUVAL_ACCLAIM_URL || 'https://oncore.duvalclerk.com/AcclaimWeb',
    livePortalUrl: 'https://oncore.duvalclerk.com/AcclaimWeb',
    docTypeCodes: {
      LIS_PENDENS: 'LP',
      NOTICE_OF_DEFAULT: 'NOD',
      NOTICE_OF_TRUSTEE_SALE: 'NOTS',
    },
  },
  brevard: {
    county: 'Brevard',
    state: 'FL',
    portalUrl: process.env.BREVARD_ACCLAIM_URL || 'https://vaclmweb1.brevardclerk.us/AcclaimWeb',
    livePortalUrl: 'https://vaclmweb1.brevardclerk.us/AcclaimWeb',
    docTypeCodes: {
      LIS_PENDENS: 'LP',
      NOTICE_OF_DEFAULT: 'NOD',
      NOTICE_OF_TRUSTEE_SALE: 'NOTS',
    },
  },
  arapahoe: {
    county: 'Arapahoe',
    state: 'CO',
    portalUrl: process.env.ARAPAHOE_ACCLAIM_URL || 'https://clerk.arapahoegov.com/AcclaimWeb',
    livePortalUrl: 'https://clerk.arapahoegov.com/AcclaimWeb',
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

function parseAcclaimRecordRow(rowHtml = '', jurisdiction = 'clark') {
  const raw = String(rowHtml || '');
  if (!raw) return null;
  if (/<(?:th|input|select|option|label)\b/i.test(raw)) return null;
  if (/such as a trust or corporation name/i.test(raw)) return null;

  const config = DEFAULT_JURISDICTIONS[jurisdiction.toLowerCase()] || DEFAULT_JURISDICTIONS.clark;

  // 1. Instrument number: e.g. "20261009:001482" or "Doc #: 2026-09148"
  // Handles plain text, tag-wrapped labels (<b>Instrument:</b>), or class="col-inst"
  let instNum = null;
  const instMatch = raw.match(/(?:Instrument|Doc(?:\s*#|\s*Num)?|Record\s*#?)(?::|\b)(?:<[^>]+>|\s)*([0-9A-Za-z:\-_]+)/i);
  if (instMatch) {
    instNum = instMatch[1].trim();
  } else {
    const classInst = raw.match(/<td\b[^>]*class="[^"]*(?:col-inst|col-instrument|instrument)[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (classInst) {
      const clean = cleanCellText(classInst[1]).replace(/^(?:Instrument|Doc(?:\s*#|\s*Num)?|Record\s*#?):?\s*/i, '');
      const m = clean.match(/([0-9A-Za-z:\-_]+)/);
      if (m) instNum = m[1].trim();
    }
  }

  if (instNum && !/\d/.test(instNum)) instNum = null;

  // 2. Recording Date: e.g. "Recorded: 10/08/2026" or "10/08/2026"
  let recordedDate = null;
  const dateMatch = raw.match(/(?:Recorded|Date)(?::|\b)(?:<[^>]+>|\s)*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i);
  if (dateMatch) {
    recordedDate = dateMatch[1].trim();
  } else {
    const classDate = raw.match(/<td\b[^>]*class="[^"]*(?:col-date|recording-date|recorded)[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (classDate) {
      const clean = cleanCellText(classDate[1]);
      const m = clean.match(/([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/);
      if (m) recordedDate = m[1].trim();
    }
  }

  // 3. Document Type:
  let rawDocType = null;
  const docTypeMatch = raw.match(/(?:Doc\s*Type|Type)(?::|\b)(?:<[^>]+>|\s)*([A-Za-z\s]+?)(?:<|\n|$)/i);
  if (docTypeMatch) {
    rawDocType = docTypeMatch[1].trim();
  } else {
    const classType = raw.match(/<td\b[^>]*class="[^"]*(?:col-type|doc-type)[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (classType) {
      const clean = cleanCellText(classType[1]).replace(/^(?:Doc\s*Type|Type):?\s*/i, '');
      if (clean) rawDocType = clean;
    }
  }
  if (!rawDocType) rawDocType = 'NOTICE_OF_DEFAULT';

  // 4. Grantor (Borrower / Distressed Owner) - tolerant of multi-line alias names
  let grantor = null;
  const grantorMatch = raw.match(/(?:Grantor|Borrower|Direct\s*Name)(?::|\b)(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.]+?)(?:<br|<\/td|<\/div|<\/tr|\n|Grantee|$)/i);
  if (grantorMatch) {
    grantor = cleanCellText(grantorMatch[1]);
  } else {
    const classGrantor = raw.match(/<td\b[^>]*class="[^"]*(?:col-grantor|grantor|borrower)[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (classGrantor) {
      const clean = cleanCellText(classGrantor[1]).replace(/^(?:Grantor|Borrower|Direct\s*Name):?\s*/i, '');
      const firstLine = clean.split('\n')[0].trim();
      if (firstLine) grantor = firstLine;
    }
  }

  // 5. Grantee (Lender / Foreclosing Trustee)
  let grantee = null;
  const granteeMatch = raw.match(/(?:Grantee|Lender|Indirect\s*Name)(?::|\b)(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.]+?)(?:<br|<\/td|<\/div|<\/tr|\n|Parcel|APN|$)/i);
  if (granteeMatch) {
    grantee = cleanCellText(granteeMatch[1]);
  } else {
    const classGrantee = raw.match(/<td\b[^>]*class="[^"]*(?:col-grantee|grantee|lender)[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (classGrantee) {
      const clean = cleanCellText(classGrantee[1]).replace(/^(?:Grantee|Lender|Indirect\s*Name):?\s*/i, '');
      const firstLine = clean.split('\n')[0].trim();
      if (firstLine) grantee = firstLine;
    }
  }

  // 6. Parcel Number / APN:
  let apn = null;
  const apnMatch = raw.match(/(?:APN|Parcel(?:\s*#)?)(?::|\b)(?:<[^>]+>|\s)*([0-9A-Za-z\-]+)/i);
  if (apnMatch) {
    apn = apnMatch[1].trim();
  } else {
    const classApn = raw.match(/<td\b[^>]*class="[^"]*(?:col-apn|parcel-id|apn)[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (classApn) {
      const clean = cleanCellText(classApn[1]).replace(/^(?:APN|Parcel(?:\s*#)?):?\s*/i, '');
      const m = clean.match(/([0-9A-Za-z\-]+)/);
      if (m) apn = m[1].trim();
    }
  }

  if (apn && !/\d/.test(apn)) apn = null;

  // 7. Legal description or address:
  let legalDescription = null;
  const descMatch = raw.match(/(?:Legal\s*Desc|Address)(?::|\b)(?:<[^>]+>|\s)*([^<\n\r]+)/i);
  if (descMatch) {
    legalDescription = cleanCellText(descMatch[1]);
  } else {
    const classDesc = raw.match(/<td\b[^>]*class="[^"]*(?:col-desc|legal-desc|address)[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (classDesc) {
      const clean = cleanCellText(classDesc[1]).replace(/^(?:Legal\s*Desc|Address):?\s*/i, '');
      if (clean) legalDescription = clean;
    }
  }

  if (!instNum && !apn && !grantor) {
    return null;
  }

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
    instrumentNumber: instNum,
    recordedDate,
    docType: rawDocType,
    distressStage,
    grantor: grantor || null,
    grantee: grantee || null,
    apn: apn || null,
    legalDescription: legalDescription || null,
    sourceUrl: instNum ? `${config.portalUrl}/details?id=${encodeURIComponent(instNum)}` : `${config.portalUrl}/search`,
  };
}

/**
 * Standardize full AcclaimWeb search result page HTML into structured filings
 */
function parseAcclaimSearchHtml(html = '', jurisdiction = 'clark') {
  const text = String(html || '');
  const filings = [];

  // 1. Match table rows or search result div blocks with typical class names
  const rowRegex = /<(?:tr|div)\b[^>]*class="[^"]*(?:search-result-row|GridRow|SearchResultItem)[^"]*"[^>]*>([\s\S]*?)<\/(?:tr|div)>/gi;
  let match;

  while ((match = rowRegex.exec(text)) !== null) {
    const rowHtml = match[1];
    const parsed = parseAcclaimRecordRow(rowHtml, jurisdiction);
    if (parsed && (parsed.instrumentNumber || parsed.apn || parsed.grantor)) {
      filings.push(parsed);
    }
  }

  // 2. Generic table row discovery: any <tr> that contains instrument or recording data
  if (filings.length === 0 && /<tr\b/i.test(text)) {
    const genericTrRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = genericTrRegex.exec(text)) !== null) {
      const rowContent = trMatch[1];
      if (/(?:col-inst|col-apn|Instrument|Doc(?:\s*#|\s*Type)|Recorded|Grantor)/i.test(rowContent)) {
        const parsed = parseAcclaimRecordRow(rowContent, jurisdiction);
        if (parsed && (parsed.instrumentNumber || parsed.apn || parsed.grantor)) {
          filings.push(parsed);
        }
      }
    }
  }

  // 3. Fallback: split on document record dividers
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
  cleanCellText,
  parseAcclaimRecordRow,
  parseAcclaimSearchHtml,
};
