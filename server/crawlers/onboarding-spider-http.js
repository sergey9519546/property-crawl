'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inspectSourceRecordUrl } = require('../scrapers/source-policy');
const { ScraperResponseError } = require('../scrapers/circuit-breaker');
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
    throw new OnboardingSpiderError('Response exceeds 4 MB', 'UPSTREAM_PAYLOAD_TOO_LARGE', { haltSpider: true });
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const body = await response.text();
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
  const timeoutMs = resolveCrawlTimeoutMs(options.timeoutMs);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (breaker.isOpen()) throw new OnboardingSpiderError('Source circuit is open', 'SCRAPER_CIRCUIT_OPEN', { haltSpider: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const requestGeneration = breaker.failureVersion;
    try {
      const response = await options.fetchImpl(url, {
        method: 'GET', redirect: 'manual', credentials: 'omit',
        headers: { 'user-agent': USER_AGENT, 'accept': 'text/html,application/xhtml+xml' },
        signal: controller.signal
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
      if (!validation.isValid) {
        throw new ScraperResponseError(validation.error, {
          code: validation.code,
          status: response.status,
          haltScraper: validation.haltScraper,
          circuitRecorded: true
        });
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
      if (attempt === 0) await crawlJitter({ minMs: 250, maxMs: 750, random: options.random, sleep: options.sleep });
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
  candidateFromLink
};
