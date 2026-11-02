'use strict';

/**
 * server/scrapers/adapters/miami-dade-clerk.js
 *
 * Miami-Dade County, FL Lis Pendens & Tax Deed Public Sale Adapter.
 * Parses:
 * 1. Miami-Dade Clerk of Courts Official Records (onrecords.miamidadeclerk.gov)
 *    for pre-foreclosure Lis Pendens filings and foreclosure case decrees.
 * 2. Miami-Dade RealTaxDeed Public Auction portal (miamidade.realtaxdeed.com)
 *    for statutory tax deed sales (Fla. Stat. Chapter 197).
 *
 * Miami-Dade is Florida's most populous county (Miami metro area).
 */

const { capturedRecordUrl } = require('./record-link');

const MIAMI_DADE_DOC_TYPES = Object.freeze({
  LIS_PENDENS: 'LIS PENDENS',
  TAX_DEED_SALE: 'TAX DEED SALE',
  TAX_CERTIFICATE_SALE: 'TAX CERTIFICATE SALE',
  CERTIFICATE_OF_TITLE: 'CERTIFICATE OF TITLE',
  FINAL_JUDGMENT: 'FINAL JUDGMENT',
  NOTICE_OF_SALE: 'NOTICE OF SALE',
  TAX_DEED: 'TAX DEED',
});

const RECORD_DOC_TYPES = MIAMI_DADE_DOC_TYPES;

const MIAMI_DADE_CLERK_BASE_URL =
  process.env.MIAMI_DADE_CLERK_URL || 'https://onrecords.miamidadeclerk.gov';

const MIAMI_DADE_REALTAXDEED_BASE_URL =
  process.env.MIAMI_DADE_REALTAXDEED_URL || 'https://miamidade.realtaxdeed.com';

/**
 * Normalizes and formats a Miami-Dade 13-digit Folio number (APN / Parcel ID).
 * Format: XX-XXXX-XXX-XXXX (Municipality-Township/Range/Section-Subdivision-Parcel)
 * e.g. 30-4018-001-0120 or 01-3136-024-0010.
 *
 * @param {string|number} rawFolio - Raw folio input
 * @returns {string|null} Standardized Folio format XX-XXXX-XXX-XXXX or null
 */
function formatMiamiDadeFolio(rawFolio) {
  if (rawFolio === null || rawFolio === undefined) return null;
  const digits = String(rawFolio).replace(/\D/g, '');
  if (digits.length === 13) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 13)}`;
  }
  const dashed = String(rawFolio).trim().match(/^(\d{2})[-.](\d{4})[-.](\d{3})[-.](\d{4})$/);
  if (dashed) {
    return `${dashed[1]}-${dashed[2]}-${dashed[3]}-${dashed[4]}`;
  }
  return null;
}

/**
 * Extracts a Miami-Dade Folio number from unstructured or semi-structured text.
 *
 * @param {string} text - Input text
 * @returns {string|null} Formatted Folio or null
 */
function extractMiamiDadeFolio(text) {
  if (!text) return null;
  const raw = String(text);

  // 1. Labeled Folio / Parcel / APN pattern
  const labeled = raw.match(
    /\b(?:Folio(?:\s*(?:#|ID|No\.?|Number))?|Parcel(?:\s*(?:#|ID|No\.?|Number))?|APN)\s*[:#]?\s*([0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{3}[-\s]?[0-9]{4}|[0-9]{13})\b/i
  );
  if (labeled) {
    const formatted = formatMiamiDadeFolio(labeled[1]);
    if (formatted) return formatted;
  }

  // 2. Exact 13-digit dashed pattern: XX-XXXX-XXX-XXXX
  const dashed = raw.match(/\b([0-9]{2}-[0-9]{4}-[0-9]{3}-[0-9]{4})\b/);
  if (dashed) {
    return formatMiamiDadeFolio(dashed[1]);
  }

  return null;
}

/**
 * Extracts a Miami-Dade Case Number (Circuit Civil or Tax Deed).
 * Formats:
 * - Tax Deed File: 2024-TX-000123, 2024-001234-TD, TD-2024-001234
 * - Circuit Civil Foreclosure: 2024-012345-CA-01, 2024-CA-012345
 *
 * @param {string} text - Input text
 * @returns {string|null} Standardized Case Number or null
 */
function extractMiamiDadeCaseNumber(text) {
  if (!text) return null;
  const raw = cleanCellText(text);

  // Tax Deed file format (e.g. 2024-TX-000123, TD-2024-000456, 2024-001234-TD)
  const tdMatch = raw.match(
    /\b(?:Tax\s*Deed(?:\s*File)?|TD(?:\s*File)?)\s*(?:#|No\.?|Num)?\s*[:#]?\s*([0-9]{4}[-_]?(?:TX|TD)[-_]?[0-9]{3,7}|TD[-_]?[0-9]{4}[-_]?[0-9]{3,7}|[0-9]{4}[-_]?[0-9]{4,7}[-_]?TD)\b/i
  );
  if (tdMatch) {
    return tdMatch[1].replace(/_/g, '-').toUpperCase();
  }

  // Standalone TD / TX format when in tax deed context
  const standaloneTd = raw.match(/\b(TD[-_]?[0-9]{4}[-_]?[0-9]{3,7}|[0-9]{4}[-_]?(?:TX|TD)[-_]?[0-9]{3,7})\b/i);
  if (standaloneTd && /(?:Tax|Deed|TD|Certificate|Auction|AD_LBL)/i.test(raw)) {
    return standaloneTd[1].replace(/_/g, '-').toUpperCase();
  }

  // Circuit Civil case format: YYYY-NNNNNN-CA-01 or YYYY-CA-NNNNNN
  const caMatch = raw.match(
    /\b(?:Case(?:\s*(?:#|No\.?|Number))?\s*[:#]?\s*)?([0-9]{2,4}[-_]?[0-9]{4,7}[-_]?CA(?:[-_]?[0-9]{2})?|[0-9]{4}[-_]?CA[-_]?[0-9]{4,7})\b/i
  );
  if (caMatch) {
    return caMatch[1].replace(/_/g, '-').toUpperCase();
  }

  return null;
}

/**
 * Extracts a Florida Tax Sale Certificate number.
 * Under Fla. Stat. § 197.432, tax certificates are issued annually against delinquent taxes.
 * Format: YYYY-NNNNNN or NNNNNN-YYYY or raw certificate integer.
 *
 * @param {string} text - Input text
 * @returns {string|null} Certificate number or null
 */
function extractMiamiDadeCertificateNumber(text) {
  if (!text) return null;
  const raw = String(text);
  const certMatch = raw.match(
    /\b(?:Cert(?:ificate)?(?:\s*(?:#|No\.?|Number))?|Tax\s*Cert(?:ificate)?)\s*[:#]?\s*([0-9]{4}[-_][0-9]{1,8}|[0-9]{1,8}[-_][0-9]{4}|[0-9]{4,8})\b/i
  );
  if (certMatch) {
    return certMatch[1].trim();
  }
  return null;
}

/**
 * Parses numeric monetary amount for opening / statutory minimum bids.
 * Under Fla. Stat. § 197.502 / § 197.542, the statutory opening bid is the
 * adjudged delinquent taxes, interest, and costs.
 *
 * @param {string|number} val - Raw monetary string
 * @returns {number|null} Parsed float or null
 */
function parseOpeningBid(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0 ? val : null;
  }
  const clean = String(val).replace(/[\$,]/g, '').trim();
  const num = parseFloat(clean);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

/**
 * Cleans HTML text, decoding entities and collapsing whitespace.
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

/**
 * Identifies statutory distress stage for Miami-Dade filings.
 *
 * @param {string} rawDocType - Document classification
 * @returns {'SCHEDULED_AUCTION'|'SOLD_POST_SALE'|'PRE_FORECLOSURE'}
 */
function identifyDistressStage(rawDocType = '') {
  const norm = String(rawDocType || '').toUpperCase();
  if (/TAX\s*DEED\s*SALE/i.test(norm) || /TAX\s*CERTIFICATE\s*SALE/i.test(norm) || /NOTICE\s*OF\s*SALE/i.test(norm)) {
    return 'SCHEDULED_AUCTION';
  }
  if (/CERTIFICATE\s*OF\s*TITLE/i.test(norm) || /TAX\s*DEED/i.test(norm)) {
    return 'SOLD_POST_SALE';
  }
  return 'PRE_FORECLOSURE';
}

/**
 * Builds search URL for Miami-Dade Clerk Official Records queries.
 *
 * @param {Object} [options] - Options
 * @returns {string} Search URL
 */
function getMiamiDadeClerkSearchUrl(options = {}) {
  const base = (options.baseUrl || MIAMI_DADE_CLERK_BASE_URL).replace(/\/+$/, '');
  const docType = options.docType || MIAMI_DADE_DOC_TYPES.LIS_PENDENS;
  let url = `${base}/search?docType=${encodeURIComponent(docType)}`;
  if (options.folio) {
    url += `&folio=${encodeURIComponent(formatMiamiDadeFolio(options.folio) || options.folio)}`;
  }
  if (options.caseNumber) {
    url += `&caseNumber=${encodeURIComponent(options.caseNumber)}`;
  }
  return url;
}

/**
 * Builds auction calendar URL for Miami-Dade RealTaxDeed queries.
 *
 * @param {Object} [options] - Options
 * @returns {string} RealTaxDeed URL
 */
function getMiamiDadeTaxDeedUrl(options = {}) {
  const base = (options.baseUrl || MIAMI_DADE_REALTAXDEED_BASE_URL).replace(/\/+$/, '');
  if (options.auctionId) {
    return `${base}/index.cfm?zaction=AUCTION&zmethod=DETAILS&AID=${encodeURIComponent(options.auctionId)}`;
  }
  return `${base}/index.cfm?zaction=AUCTION&zmethod=CALENDAR`;
}

/**
 * Parses an individual RealTaxDeed public auction card / table from miamidade.realtaxdeed.com.
 *
 * @param {string} cardHtml - Card or table markup
 * @param {Object} [options] - Configuration overrides
 * @returns {Object|null} Standardized tax deed auction record or null
 */
function parseMiamiDadeTaxDeedCard(cardHtml = '', options = {}) {
  const raw = String(cardHtml || '');
  if (!raw.trim()) return null;

  // 1. Auction ID (AID)
  let auctionId = null;
  const aidMatch = raw.match(/AID=([0-9]+)/i) || raw.match(/Auction\s*(?:#|ID|No\.?):?\s*([0-9]+)/i);
  if (aidMatch) auctionId = aidMatch[1].trim();

  // Helper to extract value cell corresponding to a label in RealAuction table row
  function getCellForLabel(labelPattern) {
    const m = raw.match(new RegExp(`<(?:td|th)[^>]*class="[^"]*AD_LBL[^"]*"[^>]*>[\\s\\S]*?${labelPattern}[\\s\\S]*?<\\/(?:td|th)>\\s*<(?:td|th)[^>]*>([\\s\\S]*?)<\\/(?:td|th)>`, 'i'));
    return m ? cleanCellText(m[1]) : null;
  }

  // 2. Case Number / Tax Deed File Number
  const tdCell = getCellForLabel('Tax\\s*Deed');
  const caseNumber = tdCell
    ? (extractMiamiDadeCaseNumber(tdCell) || tdCell.replace(/^#?\s*/, ''))
    : extractMiamiDadeCaseNumber(raw);

  // 3. Certificate Number
  const certCell = getCellForLabel('Cert(?:ificate)?');
  const certificateNumber = certCell
    ? (extractMiamiDadeCertificateNumber(certCell) || certCell.replace(/^#?\s*/, ''))
    : extractMiamiDadeCertificateNumber(raw);

  // 4. Folio / APN
  const folioCell = getCellForLabel('Folio|Parcel');
  const folio = folioCell ? extractMiamiDadeFolio(folioCell) : extractMiamiDadeFolio(raw);

  // 5. Sale Date (Scheduled Auction Date)
  let saleDate = null;
  const dateCell = getCellForLabel('(?:Sale|Auction)\\s*Date');
  const dateStr = dateCell || (raw.match(/\b(?:Auction\s*Date|Sale\s*Date)\s*:(?:<[^>]+>|\s)*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i) || [])[1];
  if (dateStr) {
    const rawDate = dateStr.trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDate)) {
      const [m, d, y] = rawDate.split('/');
      saleDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    } else {
      saleDate = rawDate;
    }
  }

  // 6. Opening Bid (Statutory adjudged taxes / minimum bid under Fla. Stat. § 197.502)
  const bidCell = getCellForLabel('(?:Opening|Statutory|Minimum)\\s*Bid');
  let openingBid = null;
  if (bidCell) {
    openingBid = parseOpeningBid(bidCell);
  } else {
    const bidMatch = raw.match(
      /\b(?:Opening\s*Bid|Statutory\s*Bid|Adjudged\s*Taxes|Minimum\s*Bid)\s*:(?:<[^>]+>|\s)*\$?\s*([0-9,]+(?:\.[0-9]{2})?)/i
    );
    if (bidMatch) {
      openingBid = parseOpeningBid(bidMatch[1]);
    }
  }

  // 7. Legal Description
  const legalCell = getCellForLabel('Legal');
  let legalDescription = legalCell || null;
  if (!legalDescription) {
    const legalMatch = raw.match(
      /\b(?:Legal\s*Desc(?:ription)?|Legal)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-&/#]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Applicant|Certificate|Folio|Opening|$)/i
    );
    if (legalMatch) {
      legalDescription = cleanCellText(legalMatch[1]);
    }
  }

  // 8. Applicant / Certificate Holder / Plaintiff
  const appCell = getCellForLabel('Applicant|Lien');
  let applicant = appCell || null;
  if (!applicant) {
    const appMatch = raw.match(
      /\b(?:Applicant|Certificate\s*Holder|Lien\s*Holder)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Folio|Legal|Opening|$)/i
    );
    if (appMatch) {
      applicant = cleanCellText(appMatch[1]);
    }
  }

  // 9. Property Address (Situs)
  const addrCell = getCellForLabel('Address');
  let address = addrCell || null;
  if (!address) {
    const addrMatch = raw.match(
      /\b(?:Property\s*Address|Situs\s*Address|Address)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-#]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Legal|Opening|Folio|$)/i
    );
    if (addrMatch) {
      address = cleanCellText(addrMatch[1]);
    }
  }

  // Identity gate: require folio, auctionId, caseNumber, or certificateNumber
  if (!folio && !auctionId && !caseNumber && !certificateNumber) {
    return null;
  }

  const base = (options.baseUrl || MIAMI_DADE_REALTAXDEED_BASE_URL).replace(/\/+$/, '');
  const sourceUrl = auctionId
    ? `${base}/index.cfm?zaction=AUCTION&zmethod=DETAILS&AID=${encodeURIComponent(auctionId)}`
    : capturedRecordUrl(cardHtml, base);

  return {
    source: 'sheriff',
    platform: 'realtaxdeed',
    county: 'Miami-Dade',
    state: 'FL',
    auctionId: auctionId || null,
    caseNumber: caseNumber || null,
    certificateNumber: certificateNumber || null,
    folio: folio || null,
    apn: folio || null, // alias for pipeline standard
    saleDate: saleDate || null,
    openingBid: openingBid !== null ? openingBid : null,
    legalDescription: legalDescription || null,
    applicant: applicant || null,
    plaintiff: applicant || null,
    address: address || null,
    sourceUrl,
    distressStage: 'SCHEDULED_AUCTION',
    docType: MIAMI_DADE_DOC_TYPES.TAX_DEED_SALE,
    // Zero-Fabrication Invariants: publisher never provides market estimates
    estLow: null,
    estHigh: null,
    assessed: null,
  };
}

/**
 * Parses an individual Official Records row from Miami-Dade Clerk of Courts.
 *
 * @param {string} rowHtml - Row or card markup
 * @param {Object} [options] - Configuration overrides
 * @returns {Object|null} Standardized official records filing or null
 */
function parseMiamiDadeRecordRow(rowHtml = '', options = {}) {
  const raw = String(rowHtml || '');
  if (!raw.trim()) return null;

  // 1. Clerk File Number (CFN) or Book/Page
  let cfn = null;
  const classCfn = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-cfn|col-doc|cfn-number|document-number)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classCfn) {
    const clean = cleanCellText(classCfn[1]).replace(/^(?:CFN|Doc(?:ument)?)(?:\s*(?:#|Number|No\.?))?:?\s*/i, '');
    const m = clean.match(/([0-9]{4}[A-Za-z]?[0-9]{4,10}|[0-9]{8,14})/);
    if (m) cfn = m[1].trim();
  }
  if (!cfn) {
    const cfnMatch = raw.match(
      /\b(?:CFN|Clerk\s*File\s*(?:#|Number|No\.?)|Doc(?:\s*#)?)\s*:(?:<[^>]+>|\s)*([0-9]{4}[A-Za-z]?[0-9]{4,10}|[0-9]{8,14})/i
    );
    if (cfnMatch) {
      cfn = cfnMatch[1].trim();
    }
  }

  // 2. Recording Date
  let recordedDate = null;
  const classDate = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-date|recording-date|recorded-date)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classDate) {
    const clean = cleanCellText(classDate[1]);
    const m = clean.match(/([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (m) recordedDate = m[1].trim();
  }
  if (!recordedDate) {
    const dateMatch = raw.match(
      /\b(?:Recorded|Recording\s*Date|Rec\s*Date)\s*:(?:<[^>]+>|\s)*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i
    );
    if (dateMatch) {
      recordedDate = dateMatch[1].trim();
    }
  }

  // 3. Document Type
  let docType = null;
  const classType = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-type|doc-type)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classType) {
    const clean = cleanCellText(classType[1]).replace(/^(?:Doc(?:\s*ument)?\s*Type|Type):?\s*/i, '');
    if (clean) docType = clean;
  }
  if (!docType) {
    const typeMatch = raw.match(
      /\b(?:Doc(?:\s*ument)?\s*Type|Type)\s*:(?:<[^>]+>|\s)*([A-Za-z\s]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|$)/i
    );
    if (typeMatch) {
      const val = cleanCellText(typeMatch[1]);
      if (val && !/^(?:Grantor|Grantee|Folio|Parcel|Date)/i.test(val)) {
        docType = val;
      }
    }
  }
  if (!docType) {
    if (/LIS\s*PENDENS/i.test(raw)) {
      docType = MIAMI_DADE_DOC_TYPES.LIS_PENDENS;
    } else if (/CERTIFICATE\s*OF\s*TITLE/i.test(raw)) {
      docType = MIAMI_DADE_DOC_TYPES.CERTIFICATE_OF_TITLE;
    } else if (/TAX\s*DEED/i.test(raw)) {
      docType = MIAMI_DADE_DOC_TYPES.TAX_DEED;
    } else {
      docType = options.docType || MIAMI_DADE_DOC_TYPES.LIS_PENDENS;
    }
  }

  // 4. Case Number (Circuit Civil or Tax Deed)
  const caseNumber = extractMiamiDadeCaseNumber(raw);

  // 5. Folio Number (Miami-Dade APN)
  const folio = extractMiamiDadeFolio(raw);

  // 6. Grantor (Defendant / Borrower / Taxpayer)
  let grantor = null;
  const classGrantor = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-grantor|grantor|defendant|direct-name)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classGrantor) {
    const clean = cleanCellText(classGrantor[1]).replace(/^(?:Grantor|Defendant|Direct\s*Name):?\s*/i, '');
    const firstLine = clean.split('\n')[0].trim();
    if (firstLine) grantor = firstLine;
  }
  if (!grantor) {
    const gMatch = raw.match(
      /\b(?:Grantor|Defendant|Direct\s*Name)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Grantee|Plaintiff|Folio|$)/i
    );
    if (gMatch) {
      grantor = cleanCellText(gMatch[1]);
    }
  }

  // 7. Grantee (Plaintiff / Lender / Foreclosing Party)
  let grantee = null;
  const classGrantee = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-grantee|grantee|plaintiff|indirect-name)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classGrantee) {
    const clean = cleanCellText(classGrantee[1]).replace(/^(?:Grantee|Plaintiff|Indirect\s*Name):?\s*/i, '');
    const firstLine = clean.split('\n')[0].trim();
    if (firstLine) grantee = firstLine;
  }
  if (!grantee) {
    const gMatch = raw.match(
      /\b(?:Grantee|Plaintiff|Indirect\s*Name)\s*:(?:<[^>]+>|\s)*([A-Za-z0-9\s,\.\-&]+?)(?:<br|<\/td|<\/div|<\/span|<\/tr|\n|Folio|Legal|$)/i
    );
    if (gMatch) {
      grantee = cleanCellText(gMatch[1]);
    }
  }

  // 8. Legal Description
  let legalDescription = null;
  const classDesc = raw.match(
    /<(?:td|div|span)\b[^>]*class="[^"]*(?:col-legal|legal-desc|property-desc)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span)>/i
  );
  if (classDesc) {
    const clean = cleanCellText(classDesc[1]).replace(/^(?:Legal\s*Desc(?:ription)?|Legal):?\s*/i, '');
    if (clean) legalDescription = clean;
  }
  if (!legalDescription) {
    const descMatch = raw.match(
      /\b(?:Legal\s*Desc(?:ription)?|Legal)\s*:(?:<[^>]+>|\s)*([^<\n\r]+)/i
    );
    if (descMatch) {
      legalDescription = cleanCellText(descMatch[1]);
    }
  }

  // Identity gate: require cfn, folio, caseNumber, or grantor
  if (!cfn && !folio && !caseNumber && !grantor) {
    return null;
  }

  const distressStage = identifyDistressStage(docType);
  const baseUrl = (options.baseUrl || MIAMI_DADE_CLERK_BASE_URL).replace(/\/+$/, '');
  const sourceUrl = capturedRecordUrl(rowHtml, baseUrl);

  return {
    source: 'recorder',
    platform: 'miami-dade-clerk',
    county: 'Miami-Dade',
    state: 'FL',
    cfn: cfn || null,
    recordingNumber: cfn || null,
    instrumentNumber: cfn || null, // alias
    recordedDate: recordedDate || null,
    docType,
    distressStage,
    caseNumber: caseNumber || null,
    folio: folio || null,
    apn: folio || null, // alias
    grantor: grantor || null,
    defendant: grantor || null, // alias
    grantee: grantee || null,
    plaintiff: grantee || null, // alias
    legalDescription: legalDescription || null,
    sourceUrl,
    // Zero-Fabrication Invariant: Lis Pendens records notice of pending litigation, never an auction bid or valuation
    openingBid: null,
    saleDate: null,
    estLow: null,
    estHigh: null,
    assessed: null,
  };
}

/**
 * Parses full HTML search results or auction calendars for Miami-Dade.
 * Auto-detects RealTaxDeed vs Official Clerk records based on markup characteristics.
 *
 * @param {string} html - HTML page markup
 * @param {Object} [options] - Parsing configuration
 * @returns {Array<Object>} List of standardized parsed records
 */
function parseMiamiDadeSearchHtml(html = '', options = {}) {
  const text = String(html || '');
  if (!text.trim()) return [];

  const filings = [];
  const isTaxDeed = /realtaxdeed|AD_LBL|Tax\s*Deed|Certificate\s*#/i.test(text) && !/onrecords\.miamidadeclerk/i.test(text);

  if (isTaxDeed) {
    // RealTaxDeed cards / tables
    const cardRegex = /<(?:table|div)\b[^>]*class="[^"]*(?:ad_tab|AUCTION_ITEM|auction-card)[^"]*"[^>]*>([\s\S]*?)<\/(?:table|div)>/gi;
    let match;
    while ((match = cardRegex.exec(text)) !== null) {
      const cardHtml = match[1];
      const parsed = parseMiamiDadeTaxDeedCard(cardHtml, options);
      if (parsed && (parsed.folio || parsed.auctionId || parsed.caseNumber || parsed.certificateNumber)) {
        filings.push(parsed);
      }
    }
    // Fallback: split on AID or Auction #
    if (filings.length === 0 && /(?:AID=|Auction\s*#)/i.test(text)) {
      const blocks = text.split(/(?=(?:AID=|Auction\s*#))/i);
      for (const block of blocks) {
        const parsed = parseMiamiDadeTaxDeedCard(block, options);
        if (parsed && (parsed.folio || parsed.auctionId || parsed.caseNumber || parsed.certificateNumber)) {
          filings.push(parsed);
        }
      }
    }
  } else {
    // Official Clerk Records
    const rowRegex =
      /<(?:tr|div)\b[^>]*class="[^"]*(?:miamidade-record-row|search-result-row|record-row|result-row)[^"]*"[^>]*>([\s\S]*?)<\/(?:tr|div)>/gi;
    let match;
    while ((match = rowRegex.exec(text)) !== null) {
      const rowHtml = match[1];
      const parsed = parseMiamiDadeRecordRow(rowHtml, options);
      if (parsed && (parsed.cfn || parsed.folio || parsed.caseNumber || parsed.grantor)) {
        filings.push(parsed);
      }
    }
    // Generic table rows fallback
    if (filings.length === 0 && /<tr\b/i.test(text)) {
      const genericTrRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch;
      while ((trMatch = genericTrRegex.exec(text)) !== null) {
        const rowContent = trMatch[1];
        if (/(?:col-cfn|col-folio|CFN|Folio|Lis\s*Pendens|Grantor|Grantee|Defendant)/i.test(rowContent)) {
          const parsed = parseMiamiDadeRecordRow(rowContent, options);
          if (parsed && (parsed.cfn || parsed.folio || parsed.caseNumber || parsed.grantor)) {
            filings.push(parsed);
          }
        }
      }
    }
  }

  return filings;
}

module.exports = {
  MIAMI_DADE_DOC_TYPES,
  RECORD_DOC_TYPES,
  MIAMI_DADE_CLERK_BASE_URL,
  MIAMI_DADE_REALTAXDEED_BASE_URL,
  formatMiamiDadeFolio,
  extractMiamiDadeFolio,
  extractMiamiDadeCaseNumber,
  extractMiamiDadeCertificateNumber,
  parseOpeningBid,
  identifyDistressStage,
  cleanCellText,
  getMiamiDadeClerkSearchUrl,
  getMiamiDadeTaxDeedUrl,
  parseMiamiDadeTaxDeedCard,
  parseMiamiDadeRecordRow,
  parseMiamiDadeSearchHtml,
};
