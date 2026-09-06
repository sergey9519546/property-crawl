'use strict';

const { ScraperCircuitBreaker } = require('../scrapers/circuit-breaker');
const { fetchTextWithPolicy } = require('../scrapers/http');
const { submitEvidence } = require('./intake');

const SOURCE_ID = 'federal-register';
const API_ORIGIN = 'https://www.federalregister.gov';
const API_PATH = '/api/v1/documents.json';
const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 20;
const DEFAULT_DAYS_BACK = 30;
const MAX_DAYS_BACK = 366;

function positiveInt(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function asDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new TypeError('now must be a valid date or timestamp');
  return date;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function buildFederalRegisterUrl({ perPage, daysBack, now }) {
  const current = asDate(now);
  const since = new Date(current.getTime() - daysBack * 86_400_000);
  const url = new URL(API_PATH, API_ORIGIN);
  url.searchParams.set('conditions[term]', 'real property');
  url.searchParams.set('conditions[publication_date][gte]', ymd(since));
  url.searchParams.append('conditions[type][]', 'NOTICE');
  url.searchParams.set('order', 'newest');
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', '1');
  return url.toString();
}

function isExactFederalRegisterDocumentUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (url.hostname === 'www.federalregister.gov' || url.hostname === 'federalregister.gov')
      && /^\/documents\/[^/?#]+/.test(url.pathname)
      && !url.username && !url.password;
  } catch (_) {
    return false;
  }
}

function clean(value, maximum = 12_000) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : null;
}

function classifyNotice(notice) {
  const text = `${notice.title || ''} ${notice.abstract || ''}`.toLowerCase();
  const likelyDisposition = /\b(sale|disposition|auction|surplus|conveyance|transfer|offering|offer for sale)\b/.test(text);
  return likelyDisposition ? 'possible_real_property_disposition' : 'real_property_notice_requires_review';
}

function evidenceRecord(notice) {
  return {
    documentNumber: clean(notice.document_number, 120),
    title: clean(notice.title, 2_000),
    abstract: clean(notice.abstract),
    publicationDate: clean(notice.publication_date, 32),
    effectiveOn: clean(notice.effective_on, 32),
    type: clean(notice.type, 80),
    agencies: Array.isArray(notice.agencies)
      ? notice.agencies.slice(0, 40).map((agency) => ({ name: clean(agency?.name, 240), rawName: clean(agency?.raw_name, 240), url: clean(agency?.url, 2_048) }))
      : [],
    htmlUrl: notice.html_url,
    pdfUrl: clean(notice.pdf_url, 2_048),
    jsonUrl: clean(notice.json_url, 2_048),
    classification: classifyNotice(notice),
    inventoryStatus: 'notice_only_not_an_active_property_listing'
  };
}

async function collectFederalNotices(options = {}) {
  const perPage = positiveInt(options.perPage, DEFAULT_PER_PAGE, MAX_PER_PAGE);
  const daysBack = positiveInt(options.daysBack, DEFAULT_DAYS_BACK, MAX_DAYS_BACK);
  const now = asDate(options.now);
  const queryUrl = buildFederalRegisterUrl({ perPage, daysBack, now });
  const circuitBreaker = options.circuitBreaker || new ScraperCircuitBreaker();
  const request = options.request || ((url) => fetchTextWithPolicy(url, {
    fetchImpl: options.fetchImpl || globalThis.fetch,
    circuitBreaker,
    timeoutMs: options.timeoutMs ?? 30_000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'property-crawl-evidence/1.0 (Federal Register notice review)'
    }
  }));
  const capturedAt = now.toISOString();
  const payloadText = await request(queryUrl);
  let payload;
  try { payload = JSON.parse(payloadText); }
  catch (error) {
    circuitBreaker.trip(`Federal Register documents response was not JSON: ${error.message}`);
    const wrapped = new Error('Federal Register API returned invalid JSON');
    wrapped.code = 'FEDERAL_REGISTER_INVALID_JSON';
    throw wrapped;
  }
  if (!payload || !Array.isArray(payload.results)) {
    const error = new Error('Federal Register API response did not contain a results array');
    error.code = 'FEDERAL_REGISTER_INVALID_SCHEMA';
    throw error;
  }

  const results = [];
  let skipped = 0;
  let deduplicated = 0;
  for (const notice of payload.results.slice(0, perPage)) {
    if (!isExactFederalRegisterDocumentUrl(notice?.html_url)) { skipped += 1; continue; }
    const record = evidenceRecord(notice);
    const submission = submitEvidence({
      sourceId: SOURCE_ID,
      sourceUrl: notice.html_url,
      capturedAt,
      kind: 'json',
      records: [record]
    }, { storePath: options.storePath, now });
    if (submission.deduplicated) deduplicated += 1;
    results.push({ sourceUrl: notice.html_url, documentNumber: record.documentNumber, classification: record.classification, evidenceId: submission.record.id, deduplicated: submission.deduplicated });
  }
  return {
    sourceId: SOURCE_ID,
    queryUrl,
    capturedAt,
    perPage,
    daysBack,
    found: payload.results.length,
    submitted: results.length,
    skipped,
    deduplicated,
    references: results
  };
}

module.exports = {
  API_ORIGIN,
  API_PATH,
  DEFAULT_DAYS_BACK,
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
  SOURCE_ID,
  buildFederalRegisterUrl,
  classifyNotice,
  collectFederalNotices,
  evidenceRecord,
  isExactFederalRegisterDocumentUrl
};
