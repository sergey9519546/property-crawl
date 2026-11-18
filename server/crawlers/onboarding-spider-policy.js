'use strict';

const crypto = require('node:crypto');
const { SOURCE_HOSTS } = require('../scrapers/source-policy');

const VERSION = 1;
const USER_AGENT = 'property-crawl-onboarding';
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGE_BUDGET = 50;
const DEFAULT_MAX_DEPTH = 2;
const MAX_DEPTH = 5;
const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FRONTIER = 1000;
const MAX_CANDIDATES = 1000;
const SECRET_QUERY = /^(?:access[_-]?token|api[_-]?key|auth|authorization|cookie|key|password|passwd|private[_-]?key|refresh[_-]?token|secret|session|signature|sig|token)$/i;
const DOCUMENT_PATH = /\.pdf$/i;
const BINARY_PATH = /\.(?:7z|avi|bin|bmp|css|csv|docx?|exe|gif|gz|ico|jpe?g|js|json|mp3|mp4|png|pptx?|rar|svg|tar|tiff?|webm|webp|xlsx?|xml|zip)$/i;
const FRONTIER_PAGINATION_QUERY = /[?&](?:page|p|offset|start)=\d+/i;
const FRONTIER_PAGINATION_PATH = /\/page\/\d+/i;
const FRONTIER_PAGINATION_TEXT = /\b(?:next|more\s+results|page\s+\d+)\b/i;
const FRONTIER_DISCOVERY_TOKENS = /\b(?:auction|sale|sheriff|foreclosure|tax|deed|surplus|reo|forfeiture|seized|docket|listing|propert(?:y|ies)|parcel|bid|calendar|schedule)\b/i;
const FRONTIER_BOILERPLATE_TOKENS = /\b(?:about|contact|privacy|terms|faq|help|login|signin|register|accessibility|careers|press|news|sitemap|disclaimer|cookie)\b/i;

class OnboardingSpiderError extends Error {
  constructor(message, code, options = {}) {
    super(message);
    this.name = 'OnboardingSpiderError';
    this.code = code;
    this.haltSpider = Boolean(options.haltSpider);
  }
}

function resolveCrawlTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const n = Number.isInteger(value) ? value : fallback;
  if (n < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS;
  if (n > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  return n;
}

function allowedSourceHosts(source) {
  const configured = SOURCE_HOSTS[String(source || '').toLowerCase()];
  if (!configured) return null;
  const hosts = new Set();
  for (const value of configured) {
    const host = String(value).toLowerCase();
    hosts.add(host);
    hosts.add(host.startsWith('www.') ? host.slice(4) : `www.${host}`);
  }
  return hosts;
}

function isPrivateHostname(value) {
  const host = String(value || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (/^(?:10|127|169\.254|192\.168)\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (/^(?:0|224|240)\./.test(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  const v4mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4mapped) return isPrivateHostname(v4mapped[1]);
  const v4mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4mappedHex) {
    const hi = parseInt(v4mappedHex[1], 16);
    const lo = parseInt(v4mappedHex[2], 16);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateHostname(ipv4);
  }
  const v4compat = host.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4compat) return isPrivateHostname(v4compat[1]);
  return false;
}

function inspectCrawlUrl(source, value, options = {}) {
  let url;
  try { url = new URL(String(value || ''), options.baseUrl); }
  catch { return { isValid: false, error: 'invalid_url' }; }
  const hosts = allowedSourceHosts(source);
  if (!hosts) return { isValid: false, error: 'unsupported_source' };
  if (url.protocol !== 'https:' || url.username || url.password || url.port || isPrivateHostname(url.hostname)) {
    return { isValid: false, error: 'unsafe_url' };
  }
  if (!hosts.has(url.hostname.toLowerCase())) return { isValid: false, error: 'source_host_mismatch' };
  if ([...url.searchParams.keys()].some((key) => SECRET_QUERY.test(key))) return { isValid: false, error: 'secret_query_parameter' };
  if (options.origin && url.origin !== options.origin) return { isValid: false, error: 'cross_origin_url' };
  url.hash = '';
  return { isValid: true, error: null, url: url.toString() };
}

function scopeFor(source, startUrl, maxDepth) {
  return crypto.createHash('sha256').update(JSON.stringify({ version: VERSION, source, startUrl, maxDepth })).digest('hex');
}

function isValidContentHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/**
 * Scores a frontier URL + anchor text for best-first onboarding crawl priority.
 */
function scoreFrontierLink({ url, text = '', depth = 0 } = {}) {
  let pathname = '';
  let search = '';
  const rawUrl = String(url || '').trim();
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl, 'https://frontier.invalid');
      pathname = parsed.pathname || '';
      search = parsed.search || '';
    } catch {
      const queryIndex = rawUrl.indexOf('?');
      if (queryIndex >= 0) {
        pathname = rawUrl.slice(0, queryIndex);
        search = rawUrl.slice(queryIndex);
      } else {
        pathname = rawUrl;
      }
    }
  }
  const pathAndSearch = `${pathname}${search}`;
  const anchorText = String(text || '');
  const searchAndText = `${pathAndSearch} ${anchorText}`;
  let score = 0;
  if (
    FRONTIER_PAGINATION_QUERY.test(pathAndSearch)
    || FRONTIER_PAGINATION_PATH.test(pathname)
    || FRONTIER_PAGINATION_TEXT.test(searchAndText)
  ) {
    score += 30;
  }
  if (FRONTIER_DISCOVERY_TOKENS.test(searchAndText)) {
    score += 25;
  }
  if (FRONTIER_BOILERPLATE_TOKENS.test(`${pathname} ${anchorText}`)) {
    score -= 40;
  }
  const numericDepth = Number(depth || 0);
  score -= (Number.isFinite(numericDepth) ? numericDepth : 0) * 2;
  return score;
}

module.exports = {
  OnboardingSpiderError,
  resolveCrawlTimeoutMs,
  inspectCrawlUrl,
  scopeFor,
  isValidContentHash,
  scoreFrontierLink,
  VERSION,
  USER_AGENT,
  DEFAULT_MAX_PAGES,
  MAX_PAGE_BUDGET,
  DEFAULT_MAX_DEPTH,
  MAX_DEPTH,
  MAX_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  MAX_BYTES,
  MAX_FRONTIER,
  MAX_CANDIDATES,
  DOCUMENT_PATH,
  BINARY_PATH
};
