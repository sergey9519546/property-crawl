'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE_HOSTS, inspectSourceRecordUrl } = require('../scrapers/source-policy');
const { ScraperCircuitBreaker, ScraperResponseError } = require('../scrapers/circuit-breaker');
const { crawlJitter, safeTransportDetails } = require('../scrapers/http');
const scrapling = require('../scrapers/scrapling-bridge');

const VERSION = 1;
const USER_AGENT = 'property-crawl-onboarding';
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGE_BUDGET = 20;
const DEFAULT_MAX_DEPTH = 2;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FRONTIER = 1000;
const MAX_CANDIDATES = 1000;
const SECRET_QUERY = /^(?:access[_-]?token|api[_-]?key|auth|authorization|cookie|key|password|passwd|private[_-]?key|refresh[_-]?token|secret|session|signature|sig|token)$/i;
const DOCUMENT_PATH = /\.pdf$/i;
const BINARY_PATH = /\.(?:7z|avi|bin|bmp|css|csv|docx?|exe|gif|gz|ico|jpe?g|js|json|mp3|mp4|png|pptx?|rar|svg|tar|tiff?|webm|webp|xlsx?|xml|zip)$/i;

class OnboardingSpiderError extends Error {
  constructor(message, code, options = {}) {
    super(message);
    this.name = 'OnboardingSpiderError';
    this.code = code;
    this.haltSpider = Boolean(options.haltSpider);
  }
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
  // IPv6 private/link-local ranges
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  // IPv4-mapped IPv6 (::ffff:x.x.x.x or ::ffff:7f00:1 hex form)
  const v4mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4mapped) return isPrivateHostname(v4mapped[1]);
  // Hex form: ::ffff:XXXX:YYYY where XXXX:YYYY encodes the IPv4
  const v4mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4mappedHex) {
    const hi = parseInt(v4mappedHex[1], 16);
    const lo = parseInt(v4mappedHex[2], 16);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateHostname(ipv4);
  }
  // IPv4-compatible IPv6 (::x.x.x.x)
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

function atomicWriteJson(file, value, fsImpl = fs) {
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fsImpl.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fsImpl.renameSync(temporary, file);
}

async function responseTextLimited(response, maxBytes = MAX_BYTES) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new OnboardingSpiderError('Response exceeds 4 MB', 'UPSTREAM_PAYLOAD_TOO_LARGE', { haltSpider: true });
  if (!response.body || typeof response.body.getReader !== 'function') {
    const body = await response.text();
    if (Buffer.byteLength(body) > maxBytes) throw new OnboardingSpiderError('Response exceeds 4 MB', 'UPSTREAM_PAYLOAD_TOO_LARGE', { haltSpider: true });
    return body;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new OnboardingSpiderError('Response exceeds 4 MB', 'UPSTREAM_PAYLOAD_TOO_LARGE', { haltSpider: true });
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (bytes > maxBytes) await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchPage(url, options) {
  const breaker = options.circuitBreaker;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (breaker.isOpen()) throw new OnboardingSpiderError('Source circuit is open', 'SCRAPER_CIRCUIT_OPEN', { haltSpider: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(30_000, options.timeoutMs || 30_000));
    const requestGeneration = breaker.failureVersion;
    try {
      const response = await options.fetchImpl(url, {
        method: 'GET', redirect: 'manual', credentials: 'omit',
        headers: { 'user-agent': USER_AGENT, 'accept': 'text/html,application/xhtml+xml' }, signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        breaker.trip(`Redirect rejected for ${new URL(url).hostname}`, { immediate: true });
        throw new OnboardingSpiderError('Redirects are not followed', 'UPSTREAM_REDIRECT_REJECTED', { haltSpider: true });
      }
      const type = String(response.headers?.get?.('content-type') || '').toLowerCase();
      if (type && !type.includes('text/html') && !type.includes('application/xhtml+xml')) {
        throw new OnboardingSpiderError(`Non-HTML response rejected (${type.split(';')[0]})`, 'UPSTREAM_NON_HTML', { haltSpider: true });
      }
      const body = await responseTextLimited(response);
      const validation = breaker.validateResponse({ status: response.status, body, headers: response.headers }, { requestGeneration });
      if (!validation.isValid) throw new ScraperResponseError(validation.error, {
        code: validation.code, status: response.status, haltScraper: validation.haltScraper, circuitRecorded: true,
      });
      return body;
    } catch (error) {
      if (error instanceof OnboardingSpiderError || error instanceof ScraperResponseError) {
        if (error.haltSpider || error.haltScraper || breaker.isOpen()) throw error;
        lastError = error;
      } else {
        const detail = safeTransportDetails(error, url, controller.signal.aborted);
        lastError = new OnboardingSpiderError(detail.message, detail.transportCode);
        breaker.trip(detail.message);
        if (!detail.retryable || breaker.isOpen()) throw lastError;
      }
      if (attempt === 0) await crawlJitter({ minMs: 250, maxMs: 750, random: options.random, sleep: options.sleep });
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

function defaultRobotsFactory(body, origin) {
  return require('robots-parser')(new URL('/robots.txt', origin).toString(), body);
}

async function loadRobots(origin, options) {
  if (options.robots) return options.robots;
  const response = await options.fetchImpl(new URL('/robots.txt', origin).toString(), {
    method: 'GET', redirect: 'manual', credentials: 'omit',
    headers: { 'user-agent': USER_AGENT, 'accept': 'text/plain' }, signal: AbortSignal.timeout(30_000),
  });
  if (response.status >= 300 && response.status < 400) throw new OnboardingSpiderError('Robots redirect rejected', 'ROBOTS_REDIRECT_REJECTED', { haltSpider: true });
  const body = response.status === 404 ? '' : await responseTextLimited(response, 512 * 1024);
  if (response.status !== 404) {
    const validation = options.circuitBreaker.validateResponse({ status: response.status, body, headers: response.headers });
    if (!validation.isValid) throw new OnboardingSpiderError(validation.error, validation.code, { haltSpider: true });
  }
  return (options.robotsFactory || defaultRobotsFactory)(body, origin);
}

function candidateFromLink(source, page, link) {
  const record = inspectSourceRecordUrl(source, link.href);
  const document = Boolean(link.document) || DOCUMENT_PATH.test(new URL(link.href).pathname);
  if (!record.isValid && !document) return null;
  return {
    type: record.isValid ? 'listing' : 'document', source,
    url: record.isValid ? record.url : link.href,
    text: String(link.text || '').trim().slice(0, 500), discoveredFrom: page.url,
    observedAt: page.observedAt, pageContentSha256: page.contentSha256,
    parserEngineVersion: page.engineVersion,
  };
}

async function crawlOnboardingSource(input = {}, dependencies = {}) {
  const source = String(input.source || '').trim().toLowerCase();
  const maxDepth = Math.min(DEFAULT_MAX_DEPTH, Math.max(0, Number.isInteger(input.maxDepth) ? input.maxDepth : DEFAULT_MAX_DEPTH));
  const maxPages = Math.min(MAX_PAGE_BUDGET, Math.max(1, Number.isInteger(input.maxPages) ? input.maxPages : DEFAULT_MAX_PAGES));
  const start = inspectCrawlUrl(source, input.url);
  if (!start.isValid) throw new OnboardingSpiderError(`Start URL rejected: ${start.error}`, 'INVALID_START_URL');
  if (DOCUMENT_PATH.test(new URL(start.url).pathname) || BINARY_PATH.test(new URL(start.url).pathname)) throw new OnboardingSpiderError('Start URL must be an HTML page', 'INVALID_START_URL');
  const origin = new URL(start.url).origin;
  const scopeHash = scopeFor(source, start.url, maxDepth);
  const sourceScope = { source, startUrl: start.url, maxDepth };
  const cacheRoot = path.resolve(dependencies.cacheRoot || path.resolve(process.cwd(), '.cache', 'crawler-tools', 'crawls'));
  const statePath = path.join(cacheRoot, `${scopeHash}.json`);
  const fsImpl = dependencies.fs || fs;
  let state;
  if (fsImpl.existsSync(statePath)) {
    state = JSON.parse(fsImpl.readFileSync(statePath, 'utf8'));
    if (state.version !== VERSION || state.scopeHash !== scopeHash) throw new OnboardingSpiderError('Checkpoint scope mismatch', 'CHECKPOINT_SCOPE_MISMATCH');
    state.truncated = Boolean(state.truncated);
    state.blockedCount = Number(state.blockedCount || 0);
  } else {
    state = { version: VERSION, scopeHash, sourceScope, visited: [], candidates: [], pending: [{ url: start.url, depth: 0 }], complete: false, truncated: false, blockedCount: 0, halted: null };
  }
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const extract = dependencies.extractWithScrapling || scrapling.extractWithScrapling;
  const breaker = dependencies.circuitBreaker || new ScraperCircuitBreaker();
  const robots = await loadRobots(origin, { ...dependencies, fetchImpl, circuitBreaker: breaker });
  const visitedUrls = new Set(state.visited.map((entry) => entry.url));
  const pendingUrls = new Set(state.pending.map((entry) => entry.url));
  const candidateKeys = new Set(state.candidates.map((entry) => `${entry.type}:${entry.url}`));
  let processed = 0;
  // Recompute this run's resumability signal; it is advisory and never
  // changes robots, challenge, or candidate promotion decisions.
  state.nextAction = null;

  while (state.pending.length && processed < maxPages) {
    const current = state.pending[0];
    const checkpointUrl = inspectCrawlUrl(source, current.url, { origin });
    if (!checkpointUrl.isValid || checkpointUrl.url !== current.url) {
      state.halted = { code: 'CHECKPOINT_URL_REJECTED', message: checkpointUrl.error || 'checkpoint_url_changed', url: String(current.url) };
      break;
    }
    if (visitedUrls.has(current.url)) { state.pending.shift(); pendingUrls.delete(current.url); continue; }
    if (robots?.isAllowed && robots.isAllowed(current.url, USER_AGENT) === false) {
      state.pending.shift(); pendingUrls.delete(current.url); state.blockedCount += 1;
      state.visited.push({ url: current.url, depth: current.depth, status: 'robots_disallowed', observedAt: new Date().toISOString() });
      visitedUrls.add(current.url); atomicWriteJson(statePath, state, fsImpl); continue;
    }
    try {
      if (processed > 0) await crawlJitter({ minMs: 250, maxMs: 750, random: dependencies.random, sleep: dependencies.sleep });
      const html = await fetchPage(current.url, { fetchImpl, circuitBreaker: breaker, timeoutMs: dependencies.timeoutMs, random: dependencies.random, sleep: dependencies.sleep });
      const parsed = await extract('page-links', { html, url: current.url, signal: dependencies.signal });
      const contentSha256 = isValidContentHash(parsed.contentSha256) ? parsed.contentSha256 : null;
      if (!contentSha256) throw new OnboardingSpiderError('Parser returned invalid content hash', 'INVALID_CONTENT_HASH', { haltSpider: true });
      const page = { url: current.url, depth: current.depth, status: 'visited', observedAt: dependencies.now ? dependencies.now() : new Date().toISOString(), contentSha256, engineVersion: parsed.engineVersion || parsed.engine };
      state.visited.push(page); visitedUrls.add(current.url); processed += 1;
      for (const rawLink of Array.isArray(parsed.links) ? parsed.links : []) {
        const checked = inspectCrawlUrl(source, rawLink?.href, { baseUrl: current.url, origin });
        if (!checked.isValid) continue;
        const candidate = candidateFromLink(source, page, { href: checked.url, text: rawLink.text, document: rawLink.document });
        if (candidate) {
          const key = `${candidate.type}:${candidate.url}`;
          if (!candidateKeys.has(key)) {
            if (state.candidates.length >= MAX_CANDIDATES) state.truncated = true;
            else { candidateKeys.add(key); state.candidates.push(candidate); }
          }
        }
        const pathname = new URL(checked.url).pathname;
        if (!candidate && current.depth < maxDepth && !DOCUMENT_PATH.test(pathname) && !BINARY_PATH.test(pathname) && !visitedUrls.has(checked.url) && !pendingUrls.has(checked.url)) {
          if (state.pending.length >= MAX_FRONTIER) state.truncated = true;
          else { state.pending.push({ url: checked.url, depth: current.depth + 1 }); pendingUrls.add(checked.url); }
        }
      }
      state.pending.shift(); pendingUrls.delete(current.url); state.halted = null;
      atomicWriteJson(statePath, state, fsImpl);
    } catch (error) {
      state.complete = false;
      state.halted = { code: error.code || 'PAGE_FAILED', message: String(error.message || error).slice(0, 500), url: current.url };
      atomicWriteJson(statePath, state, fsImpl);
      break;
    }
  }
  state.complete = state.pending.length === 0 && !state.halted && !state.truncated && state.blockedCount === 0;
  if (!state.complete) {
    if (state.halted) state.nextAction = 'resume_after_halt';
    else if (state.blockedCount > 0) state.nextAction = 'review_robots_permissions';
    else if (state.truncated) state.nextAction = 'increase_checkpoint_budget';
    else if (state.pending.length > 0) state.nextAction = 'resume_with_more_pages';
  }
  atomicWriteJson(statePath, state, fsImpl);
  return { ...state, statePath, pagesProcessed: processed };
}

module.exports = {
  crawlOnboardingSource, inspectCrawlUrl, scopeFor, isValidContentHash, OnboardingSpiderError,
  VERSION, USER_AGENT, MAX_PAGE_BUDGET, DEFAULT_MAX_PAGES, DEFAULT_MAX_DEPTH,
  MAX_FRONTIER, MAX_CANDIDATES,
};
