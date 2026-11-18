'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inspectSourceRecordUrl } = require('../scrapers/source-policy');
const { ScraperResponseError } = require('../scrapers/circuit-breaker');
const { autoThrottle, noteRetryAfter, parseRetryAfterMs, recordHostLatency } = require('../scrapers/auto-throttle');
const { crawlJitter, safeTransportDetails } = require('../scrapers/http');
const {
  OnboardingSpiderError,
  resolveCrawlTimeoutMs,
  USER_AGENT,
  MAX_BYTES,
  DOCUMENT_PATH
} = require('./onboarding-spider-policy');

function atomicWriteJson(file, value, fsImpl = fs) {
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fsImpl.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fsImpl.renameSync(temporary, file);
}

async function responseTextLimited(response, maxBytes = MAX_BYTES) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel().catch(() => {});
    }
    throw new OnboardingSpiderError('Response exceeds 4 MB', 'UPSTREAM_PAYLOAD_TOO_LARGE', { haltSpider: true });
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const body = String((await response.text()) ?? '');
    if (Buffer.byteLength(body) > maxBytes) {
      throw new OnboardingSpiderError('Response exceeds 4 MB', 'UPSTREAM_PAYLOAD_TOO_LARGE', { haltSpider: true });
    }
    return body;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.isBuffer(value)
        ? value
        : typeof value === 'string'
          ? Buffer.from(value, 'utf8')
          : Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new OnboardingSpiderError('Response exceeds 4 MB', 'UPSTREAM_PAYLOAD_TOO_LARGE', { haltSpider: true });
      chunks.push(chunk);
    }
  } finally {
    if (bytes > maxBytes) await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchPage(url, options) {
  const breaker = options.circuitBreaker;
  const timeoutMs = resolveCrawlTimeoutMs(options.timeoutMs);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (breaker.isOpen()) throw new OnboardingSpiderError('Source circuit is open', 'SCRAPER_CIRCUIT_OPEN', { haltSpider: true });
    if (options.autoThrottle !== false) {
      await autoThrottle(url, { minIntervalMs: options.minIntervalMs, sleep: options.sleep });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const requestGeneration = breaker.failureVersion;
    const requestStart = Date.now();
    try {
      const response = await options.fetchImpl(url, {
        method: 'GET', redirect: 'manual', credentials: 'omit',
        headers: { 'user-agent': USER_AGENT, 'accept': 'text/html,application/xhtml+xml' },
        signal: controller.signal
      });
      recordHostLatency(url, Date.now() - requestStart);
      if (response.status >= 300 && response.status < 400) {
        breaker.trip(`Redirect rejected for ${new URL(url).hostname}`, { immediate: true });
        throw new OnboardingSpiderError('Redirects are not followed', 'UPSTREAM_REDIRECT_REJECTED', { haltSpider: true });
      }
      const isRateOrUnavailable = response.status === 429 || response.status === 503;
      const retryAfter = response.headers?.get?.('retry-after') ?? null;
      const retryAfterMs = retryAfter ? parseRetryAfterMs(retryAfter) : null;
      if (retryAfter && (!isRateOrUnavailable || attempt > 0)) {
        noteRetryAfter(url, retryAfter);
      }
      const type = String(response.headers?.get?.('content-type') || '').toLowerCase();
      if (!isRateOrUnavailable && type && !type.includes('text/html') && !type.includes('application/xhtml+xml')) {
        throw new OnboardingSpiderError(`Non-HTML response rejected (${type.split(';')[0]})`, 'UPSTREAM_NON_HTML', { haltSpider: true });
      }
      const body = await responseTextLimited(response);
      if (isRateOrUnavailable && body.trim().length === 0) {
        breaker.trip(`HTTP ${response.status} received from upstream endpoint.`);
        if (retryAfter && breaker.isOpen()) noteRetryAfter(url, retryAfter);
        const rateError = new ScraperResponseError(`CIRCUIT_BREAKER_REJECTED: HTTP ${response.status}`, {
          code: response.status === 429 ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_HTTP_ERROR',
          status: response.status,
          haltScraper: breaker.isOpen(),
          circuitRecorded: true
        });
        if (retryAfterMs != null) rateError.retryAfterMs = retryAfterMs;
        throw rateError;
      }
      const validation = breaker.validateResponse({ status: response.status, body, headers: response.headers }, { requestGeneration });
      if (!validation.isValid) {
        if (retryAfter && validation.haltScraper) noteRetryAfter(url, retryAfter);
        const responseError = new ScraperResponseError(validation.error, {
          code: validation.code,
          status: response.status,
          haltScraper: validation.haltScraper,
          circuitRecorded: true
        });
        if (isRateOrUnavailable && retryAfterMs != null) responseError.retryAfterMs = retryAfterMs;
        throw responseError;
      }
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
      if (attempt === 0) {
        const baseMs = Number.isFinite(lastError?.retryAfterMs)
          ? Math.min(lastError.retryAfterMs, timeoutMs, 30_000)
          : 0;
        await crawlJitter({ baseMs, minMs: 250, maxMs: 750, random: options.random, sleep: options.sleep });
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function defaultRobotsFactory(body, origin) {
  return require('robots-parser')(new URL('/robots.txt', origin).toString(), body);
}

async function loadRobots(origin, options) {
  if (options.robots) return options.robots;
  const response = await options.fetchImpl(new URL('/robots.txt', origin).toString(), {
    method: 'GET',
    redirect: 'manual',
    credentials: 'omit',
    headers: { 'user-agent': USER_AGENT, 'accept': 'text/plain' },
    signal: AbortSignal.timeout(resolveCrawlTimeoutMs(options.timeoutMs))
  });
  if (response.status >= 300 && response.status < 400) {
    throw new OnboardingSpiderError('Robots redirect rejected', 'ROBOTS_REDIRECT_REJECTED', { haltSpider: true });
  }
  const body = response.status === 404 ? '' : await responseTextLimited(response, 512 * 1024);
  if (response.status !== 404 && (response.status >= 400 || body.trim().length > 0)) {
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
    type: record.isValid ? 'listing' : 'document',
    source,
    url: record.isValid ? record.url : link.href,
    text: String(link.text || '').trim().slice(0, 500),
    discoveredFrom: page.url,
    observedAt: page.observedAt,
    pageContentSha256: page.contentSha256,
    parserEngineVersion: page.engineVersion
  };
}

module.exports = {
  atomicWriteJson,
  fetchPage,
  loadRobots,
  candidateFromLink,
  responseTextLimited
};
