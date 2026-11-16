'use strict';

/**
 * server/scrapers/adapters/acclaimweb.js
 *
 * AcclaimWeb (Harris Recording Solutions) Multi-County Recorder Adapter.
 * Powers county recorder document searches (e.g. Clark County NV recorder.clarkcountynv.gov)
 * with targeted statutory document-type filtering for pre-foreclosures and trustee sales.
 */

const { assertFetchableUrl } = require('../http');

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
    livePortalUrl: 'https://or.duvalclerk.com',
    docTypeIds: {
      'LIS PENDENS': { id: '104', display: 'LIS PENDENS (LP)' },
      'NOTICE OF TAX DEED SALE': { id: '149', display: 'NOTICE OF TAX DEED SALE (NTD)' },
    },
    docTypeCodes: {
      LIS_PENDENS: 'LP',
      NOTICE_OF_TAX_DEED_SALE: 'NTD',
    },
  },
  brevard: {
    county: 'Brevard',
    state: 'FL',
    portalUrl: process.env.BREVARD_ACCLAIM_URL || 'https://vaclmweb1.brevardclerk.us/AcclaimWeb',
    livePortalUrl: 'https://vaclmweb1.brevardclerk.us/AcclaimWeb',
    docTypeIds: {
      'LIS PENDENS': { id: '99', display: 'LIS PENDENS (LP)' },
    },
    docTypeCodes: {
      LIS_PENDENS: 'LP',
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

function getAcclaimSearchUrl(jurisdiction = 'clark', docType = 'NOTICE_OF_TRUSTEE_SALE', options = {}) {
  const config = DEFAULT_JURISDICTIONS[jurisdiction.toLowerCase()] || DEFAULT_JURISDICTIONS.clark;
  const base = ((options && options.useLivePortal && config.livePortalUrl) ? config.livePortalUrl : config.portalUrl).replace(/\/$/, '');
  return `${base}/search/SearchTypeDocType?docType=${encodeURIComponent(docType)}`;
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

function parseAcclaimDotNetDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  const msMatch = str.match(/\/Date\((\d+)\)\//i);
  if (msMatch) {
    const dt = new Date(Number(msMatch[1]));
    return Number.isFinite(dt.getTime()) ? dt.toISOString().slice(0, 10) : null;
  }
  const isoMatch = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }
  const usMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (usMatch) {
    const m = Number(usMatch[1]);
    const d = Number(usMatch[2]);
    const y = Number(usMatch[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }
  return null;
}

function extractAcclaimApn(text = '') {
  const m = String(text || '').match(/(?:APN|PARCEL(?:\s*(?:ID|NO|#))?|FOLIO|PIN|TAX\s*ID)\s*[:#-]?\s*([0-9][0-9A-Za-z-]{4,})/i);
  return m && /\d/.test(m[1]) ? m[1].trim() : null;
}

function extractAcclaimAddress(text = '') {
  const m = String(text || '').match(
    /(?:PROPERTY\s*ADDRESS|SITUS(?:\s*ADDRESS)?|ADDRESS)\s*[:#]?\s*(\d{1,6}\s+[A-Za-z0-9.\s'-]+?\b(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|LN|LANE|BLVD|BOULEVARD|CT|COURT|CIR|CIRCLE|WAY|PL|PLACE|PKWY|TER|TRL|HWY)\b[^;\n|]*)/i
  );
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function parseAcclaimGridResultsJson(jsonPayload, jurisdiction = 'clark', options = {}) {
  const key = String(jurisdiction || 'clark').toLowerCase();
  const config = DEFAULT_JURISDICTIONS[key] || DEFAULT_JURISDICTIONS.clark;
  const parsed = typeof jsonPayload === 'string' ? JSON.parse(jsonPayload) : (jsonPayload || {});
  const rows = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed.data) ? parsed.data : (Array.isArray(parsed.Data) ? parsed.Data : []));
  const basePortalUrl = String(options.portalUrl || config.livePortalUrl || config.portalUrl || '').replace(/\/$/, '');

  const out = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const itemId = item.TransactionItemId ?? item.TransactionId ?? null;
    const instrumentNumber = item.InstrumentNumber
      ? String(item.InstrumentNumber).trim()
      : (item.DocNumber ? String(item.DocNumber).trim() : (itemId != null ? String(itemId) : null));
    if (!instrumentNumber) continue;

    const docType = String(item.DocTypeDescription || options.docType || 'LIS PENDENS').trim();
    const recordedDate = parseAcclaimDotNetDate(item.RecordDate);
    const legalDescription = item.DocLegalDescription ? cleanCellText(item.DocLegalDescription) : null;
    const comments = item.Comments ? cleanCellText(item.Comments) : null;
    const combinedText = [comments, legalDescription].filter(Boolean).join(' | ');
    const apn = extractAcclaimApn(combinedText);
    const situsAddress = extractAcclaimAddress(combinedText);
    const evidenceOnly = !apn && !situsAddress;
    const detailUrl = itemId != null
      ? `${basePortalUrl}/Details?id=${encodeURIComponent(String(itemId))}`
      : (options.searchUrl || `${basePortalUrl}/search/SearchTypeDocType`);

    let distressStage = 'PRE_FORECLOSURE';
    if (/TRUSTEE\s*SALE|TAX\s*DEED/i.test(docType)) {
      distressStage = 'SCHEDULED_AUCTION';
    } else if (/CERTIFICATE/i.test(docType)) {
      distressStage = 'SOLD_POST_SALE';
    }

    out.push({
      source: 'recorder',
      platform: 'acclaimweb',
      jurisdiction: key,
      county: config.county,
      state: config.state,
      transactionItemId: itemId != null ? String(itemId) : null,
      instrumentNumber,
      recordedDate,
      docType,
      distressStage,
      grantor: item.DirectName ? cleanCellText(item.DirectName) : null,
      grantee: item.IndirectName ? cleanCellText(item.IndirectName) : null,
      apn,
      situsAddress,
      address: situsAddress,
      legalDescription,
      caseNumber: item.CaseNumber ? cleanCellText(item.CaseNumber) : null,
      bookPage: item.BookPage ? cleanCellText(item.BookPage) : null,
      openingBid: null,
      estLow: null,
      estHigh: null,
      assessed: null,
      sourceUrl: detailUrl,
      detailUrl,
      evidenceOnly,
    });
  }
  return out;
}

function collectResponseCookies(headers, cookies) {
  if (!headers) return;
  const list = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : (typeof headers.get === 'function' && headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
  for (const rawCookie of list) {
    if (!rawCookie) continue;
    const pair = String(rawCookie).split(';')[0];
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      cookies.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
    }
  }
}

function formatAcclaimUsDate(date) {
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const y = String(date.getUTCFullYear());
  return `${m}/${d}/${y}`;
}

async function queryLiveAcclaimPortal(jurisdictionKey = 'clark', docType = 'LIS PENDENS', options = {}) {
  const key = String(jurisdictionKey || 'clark').toLowerCase();
  const config = DEFAULT_JURISDICTIONS[key] || DEFAULT_JURISDICTIONS.clark;
  const base = String(options.portalUrl || config.livePortalUrl || config.portalUrl).replace(/\/$/, '');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is required for AcclaimWeb live query');
  }

  const cookies = new Map();
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 15000;
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const recordBreakerFailure = (err) => {
    if (options.circuitBreaker && err && !err.circuitRecorded && typeof options.circuitBreaker.recordFailure === 'function') {
      options.circuitBreaker.recordFailure(err.message);
      err.circuitRecorded = true;
    }
    return err;
  };

  const requestWithTimeout = async (url, init = {}) => {
    const urlCheck = assertFetchableUrl(url);
    if (!urlCheck.ok) {
      const err = new Error(`Refused unfetchable AcclaimWeb URL (${urlCheck.reason}): ${url}`);
      err.code = 'SSRF_BLOCKED';
      throw err;
    }
    const cookieValue = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const headers = {
      ...defaultHeaders,
      ...(cookieValue ? { Cookie: cookieValue } : {}),
      ...(init.headers || {}),
    };
    const timeoutSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    const callerSignal = init.signal || options.signal;
    const signal = callerSignal
      ? (timeoutSignal && typeof AbortSignal.any === 'function'
          ? AbortSignal.any([callerSignal, timeoutSignal])
          : callerSignal)
      : timeoutSignal;
    try {
      const response = await fetchImpl(url, { ...init, headers, ...(signal ? { signal } : {}) });
      collectResponseCookies(response?.headers, cookies);
      return response;
    } catch (err) {
      throw recordBreakerFailure(err);
    }
  };

  // Step 1: Disclaimer session initialization
  const discResp = await requestWithTimeout(`${base}/search/Disclaimer`, {
    method: 'POST',
    redirect: 'manual',
    body: 'disclaimer=true',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (discResp && typeof discResp.text === 'function') {
    await discResp.text().catch(() => '');
  }

  // Step 2: Load search page & detect reCAPTCHA / anti-bot gates (fail-closed)
  const searchUrl = getAcclaimSearchUrl(key, docType, { useLivePortal: true });
  const pageResp = await requestWithTimeout(searchUrl, { method: 'GET' });
  const searchHtml = pageResp && typeof pageResp.text === 'function' ? await pageResp.text() : '';
  if (
    pageResp.status === 403 ||
    pageResp.status === 429 ||
    /grecaptcha\.execute|class=["'][^"']*g-recaptcha|<input[^>]+id=["']captcha["']/i.test(searchHtml)
  ) {
    const err = new Error(`AcclaimWeb portal for ${config.county}, ${config.state} is gated by reCAPTCHA/bot challenge (HTTP ${pageResp.status})`);
    err.code = 'UPSTREAM_BOT_CHALLENGE';
    err.challengeType = /grecaptcha|captcha/i.test(searchHtml) ? 'recaptcha' : 'http_challenge';
    err.url = searchUrl;
    err.status = pageResp.status;
    throw recordBreakerFailure(err);
  }
  if (pageResp.status >= 400) {
    throw recordBreakerFailure(Object.assign(
      new Error(`HTTP ${pageResp.status} fetching AcclaimWeb search page for ${config.county}, ${config.state}`),
      { status: pageResp.status, url: searchUrl }
    ));
  }

  // Step 3: Telerik SearchTypeDocType POST + GridResults JSON query when docTypeIds configured
  if (config.docTypeIds && typeof config.docTypeIds === 'object') {
    const normalizedDocKey = String(docType || '').toUpperCase().replace(/_/g, ' ').trim();
    const docCfg =
      config.docTypeIds[normalizedDocKey] ||
      config.docTypeIds[String(docType || '').toUpperCase().trim()] ||
      null;
    if (!docCfg) {
      const supported = Object.keys(config.docTypeIds).join(', ');
      throw new Error(`Unsupported AcclaimWeb docType "${docType}" for ${config.county}, ${config.state} (supported: ${supported})`);
    }

    const now = options.now ? new Date(options.now) : new Date();
    const lookbackDays = Number.isFinite(Number(options.lookbackDays)) ? Math.max(1, Number(options.lookbackDays)) : 7;
    const fromDate = new Date(now.getTime() - lookbackDays * 86400_000);

    const searchPostUrl = `${base}/search/SearchTypeDocType?Length=6`;
    const formBody = new URLSearchParams({
      DocTypes: docCfg.id,
      'DocTypesDisplay-input': docCfg.display,
      DocTypesDisplay: '',
      DateRangeList: ' ',
      RecordDateFrom: formatAcclaimUsDate(fromDate),
      RecordDateTo: formatAcclaimUsDate(now),
      X_Requested_With: 'XMLHttpRequest',
    });

    const postResp = await requestWithTimeout(searchPostUrl, {
      method: 'POST',
      body: formBody.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: searchUrl,
      },
    });
    if (postResp && typeof postResp.text === 'function') {
      await postResp.text().catch(() => '');
    }
    if (postResp.status >= 400) {
      throw recordBreakerFailure(Object.assign(
        new Error(`HTTP ${postResp.status} submitting AcclaimWeb search for ${config.county}, ${config.state}`),
        { status: postResp.status, url: searchPostUrl }
      ));
    }

    const gridUrl = `${base}/Search/GridResults`;
    const pageSize = Number.isFinite(Number(options.pageSize)) ? Math.max(1, Number(options.pageSize)) : 50;
    const maxPages = Number.isFinite(Number(options.maxPages))
      ? Math.max(1, Math.min(50, Math.floor(Number(options.maxPages))))
      : 5;
    const allParsedRows = [];
    const seenRowKeys = new Set();
    const rawPayloads = [];
    let totalAvailable = null;
    let pagesFetched = 0;

    for (let page = 1; page <= maxPages; page += 1) {
      const gridResp = await requestWithTimeout(gridUrl, {
        method: 'POST',
        body: `page=${page}&size=${pageSize}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: searchUrl,
        },
      });
      const gridText = gridResp && typeof gridResp.text === 'function' ? await gridResp.text() : '';
      if (gridResp.status >= 400) {
        const err = Object.assign(
          new Error(`HTTP ${gridResp.status} fetching AcclaimWeb GridResults for ${config.county}, ${config.state}`),
          { status: gridResp.status, url: gridUrl }
        );
        if (options.circuitBreaker && !err.circuitRecorded && typeof options.circuitBreaker.recordFailure === 'function') {
          options.circuitBreaker.recordFailure(err.message);
          err.circuitRecorded = true;
        }
        throw err;
      }
      let gridJson;
      try {
        gridJson = JSON.parse(gridText);
      } catch {
        const err = Object.assign(
          new Error(`AcclaimWeb GridResults returned non-JSON payload (${gridResp.status}) for ${config.county}, ${config.state}`),
          { status: gridResp.status, url: gridUrl }
        );
        if (options.circuitBreaker && !err.circuitRecorded && typeof options.circuitBreaker.recordFailure === 'function') {
          options.circuitBreaker.recordFailure(err.message);
          err.circuitRecorded = true;
        }
        throw err;
      }
      pagesFetched += 1;
      rawPayloads.push(gridText);
      const pageRows = parseAcclaimGridResultsJson(gridJson, key, {
        portalUrl: base,
        searchUrl,
        docType: docCfg.display,
      });
      if (Number.isFinite(Number(gridJson.total))) {
        totalAvailable = Number(gridJson.total);
      }
      let addedOnPage = 0;
      for (const row of pageRows) {
        const dedupKey = row?.instrumentNumber || row?.itemId || row?.sourceUrl || JSON.stringify(row);
        if (seenRowKeys.has(dedupKey)) continue;
        seenRowKeys.add(dedupKey);
        allParsedRows.push(row);
        addedOnPage += 1;
      }
      const hasKnownTotal = totalAvailable !== null;
      const effectiveTotal = hasKnownTotal ? totalAvailable : allParsedRows.length;
      if (
        pageRows.length === 0 ||
        addedOnPage === 0 ||
        (hasKnownTotal ? allParsedRows.length >= effectiveTotal : pageRows.length < pageSize)
      ) {
        break;
      }
    }

    const effectiveTotal = totalAvailable !== null ? totalAvailable : allParsedRows.length;
    return {
      url: gridUrl,
      searchUrl,
      rawPayload: rawPayloads.length === 1 ? rawPayloads[0] : JSON.stringify(rawPayloads),
      parsedRows: allParsedRows,
      totalAvailable: effectiveTotal,
      pagesFetched,
      truncated: effectiveTotal > allParsedRows.length,
    };
  }

  const parsedRows = parseAcclaimSearchHtml(searchHtml, key);
  return {
    url: searchUrl,
    searchUrl,
    rawPayload: searchHtml,
    parsedRows,
    totalAvailable: parsedRows.length,
  };
}

module.exports = {
  RECORD_DOC_TYPES,
  DEFAULT_JURISDICTIONS,
  getAcclaimSearchUrl,
  cleanCellText,
  parseAcclaimRecordRow,
  parseAcclaimSearchHtml,
  parseAcclaimDotNetDate,
  parseAcclaimGridResultsJson,
  queryLiveAcclaimPortal,
};
