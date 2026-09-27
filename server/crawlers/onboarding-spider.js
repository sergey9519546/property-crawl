'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ScraperCircuitBreaker } = require('../scrapers/circuit-breaker');
const { crawlJitter } = require('../scrapers/http');
const scrapling = require('../scrapers/scrapling-bridge');
const {
  OnboardingSpiderError,
  resolveCrawlTimeoutMs,
  inspectCrawlUrl,
  scopeFor,
  isValidContentHash,
  VERSION,
  USER_AGENT,
  DEFAULT_MAX_PAGES,
  MAX_PAGE_BUDGET,
  DEFAULT_MAX_DEPTH,
  MAX_DEPTH,
  MAX_TIMEOUT_MS,
  MAX_FRONTIER,
  MAX_CANDIDATES,
  DOCUMENT_PATH,
  BINARY_PATH
} = require('./onboarding-spider-policy');
const {
  atomicWriteJson,
  fetchPage,
  loadRobots,
  candidateFromLink
} = require('./onboarding-spider-http');

async function crawlOnboardingSource(input = {}, dependencies = {}) {
  const source = String(input.source || '').trim().toLowerCase();
  const maxDepth = Math.min(MAX_DEPTH, Math.max(0, Number.isInteger(input.maxDepth) ? input.maxDepth : DEFAULT_MAX_DEPTH));
  const maxPages = Math.min(MAX_PAGE_BUDGET, Math.max(1, Number.isInteger(input.maxPages) ? input.maxPages : DEFAULT_MAX_PAGES));
  const timeoutMs = resolveCrawlTimeoutMs(Number.isInteger(input.timeoutMs) ? input.timeoutMs : dependencies.timeoutMs);
  const start = inspectCrawlUrl(source, input.url);
  if (!start.isValid) throw new OnboardingSpiderError(`Start URL rejected: ${start.error}`, 'INVALID_START_URL');
  if (DOCUMENT_PATH.test(new URL(start.url).pathname) || BINARY_PATH.test(new URL(start.url).pathname)) {
    throw new OnboardingSpiderError('Start URL must be an HTML page', 'INVALID_START_URL');
  }
  const origin = new URL(start.url).origin;
  const scopeHash = scopeFor(source, start.url, maxDepth);
  const sourceScope = { source, startUrl: start.url, maxDepth };
  const cacheRoot = path.resolve(dependencies.cacheRoot || path.resolve(process.cwd(), '.cache', 'crawler-tools', 'crawls'));
  const statePath = path.join(cacheRoot, `${scopeHash}.json`);
  const fsImpl = dependencies.fs || fs;
  let state;
  if (fsImpl.existsSync(statePath)) {
    state = JSON.parse(fsImpl.readFileSync(statePath, 'utf8'));
    if (state.version !== VERSION || state.scopeHash !== scopeHash) {
      throw new OnboardingSpiderError('Checkpoint scope mismatch', 'CHECKPOINT_SCOPE_MISMATCH');
    }
    state.truncated = Boolean(state.truncated);
    state.blockedCount = Number(state.blockedCount || 0);
  } else {
    state = {
      version: VERSION,
      scopeHash,
      sourceScope,
      visited: [],
      candidates: [],
      pending: [{ url: start.url, depth: 0 }],
      complete: false,
      truncated: false,
      blockedCount: 0,
      halted: null
    };
  }
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const extract = dependencies.extractWithScrapling || scrapling.extractWithScrapling;
  const breaker = dependencies.circuitBreaker || new ScraperCircuitBreaker();
  const robots = await loadRobots(origin, { ...dependencies, fetchImpl, circuitBreaker: breaker, timeoutMs });
  const visitedUrls = new Set(state.visited.map((entry) => entry.url));
  const pendingUrls = new Set(state.pending.map((entry) => entry.url));
  const candidateKeys = new Set(state.candidates.map((entry) => `${entry.type}:${entry.url}`));
  let processed = 0;
  state.nextAction = null;

  while (state.pending.length && processed < maxPages) {
    const current = state.pending[0];
    const checkpointUrl = inspectCrawlUrl(source, current.url, { origin });
    if (!checkpointUrl.isValid || checkpointUrl.url !== current.url) {
      state.halted = { code: 'CHECKPOINT_URL_REJECTED', message: checkpointUrl.error || 'checkpoint_url_changed', url: String(current.url) };
      break;
    }
    if (visitedUrls.has(current.url)) {
      state.pending.shift();
      pendingUrls.delete(current.url);
      continue;
    }
    if (robots?.isAllowed && robots.isAllowed(current.url, USER_AGENT) === false) {
      state.pending.shift();
      pendingUrls.delete(current.url);
      state.blockedCount += 1;
      state.visited.push({ url: current.url, depth: current.depth, status: 'robots_disallowed', observedAt: new Date().toISOString() });
      visitedUrls.add(current.url);
      atomicWriteJson(statePath, state, fsImpl);
      continue;
    }
    try {
      if (processed > 0) await crawlJitter({ minMs: 250, maxMs: 750, random: dependencies.random, sleep: dependencies.sleep });
      const html = await fetchPage(current.url, {
        fetchImpl,
        circuitBreaker: breaker,
        timeoutMs,
        random: dependencies.random,
        sleep: dependencies.sleep
      });
      const parsed = await extract('page-links', { html, url: current.url, signal: dependencies.signal });
      const contentSha256 = isValidContentHash(parsed.contentSha256) ? parsed.contentSha256 : null;
      if (!contentSha256) throw new OnboardingSpiderError('Parser returned invalid content hash', 'INVALID_CONTENT_HASH', { haltSpider: true });
      const page = {
        url: current.url,
        depth: current.depth,
        status: 'visited',
        observedAt: dependencies.now ? dependencies.now() : new Date().toISOString(),
        contentSha256,
        engineVersion: parsed.engineVersion || parsed.engine
      };
      state.visited.push(page);
      visitedUrls.add(current.url);
      processed += 1;
      for (const rawLink of Array.isArray(parsed.links) ? parsed.links : []) {
        const checked = inspectCrawlUrl(source, rawLink?.href, { baseUrl: current.url, origin });
        if (!checked.isValid) continue;
        const candidate = candidateFromLink(source, page, { href: checked.url, text: rawLink.text, document: rawLink.document });
        if (candidate) {
          const key = `${candidate.type}:${candidate.url}`;
          if (!candidateKeys.has(key)) {
            if (state.candidates.length >= MAX_CANDIDATES) state.truncated = true;
            else {
              candidateKeys.add(key);
              state.candidates.push(candidate);
            }
          }
        }
        const pathname = new URL(checked.url).pathname;
        if (!candidate && current.depth < maxDepth && !DOCUMENT_PATH.test(pathname) && !BINARY_PATH.test(pathname) && !visitedUrls.has(checked.url) && !pendingUrls.has(checked.url)) {
          if (state.pending.length >= MAX_FRONTIER) state.truncated = true;
          else {
            state.pending.push({ url: checked.url, depth: current.depth + 1 });
            pendingUrls.add(checked.url);
          }
        }
      }
      state.pending.shift();
      pendingUrls.delete(current.url);
      state.halted = null;
      atomicWriteJson(statePath, state, fsImpl);
    } catch (error) {
      state.complete = false;
      state.halted = {
        code: error.code || 'PAGE_FAILED',
        message: String(error.message || error).slice(0, 500),
        url: current.url
      };
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
  crawlOnboardingSource,
  inspectCrawlUrl,
  scopeFor,
  isValidContentHash,
  resolveCrawlTimeoutMs,
  OnboardingSpiderError,
  VERSION,
  USER_AGENT,
  MAX_PAGE_BUDGET,
  MAX_DEPTH,
  MAX_TIMEOUT_MS,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_DEPTH,
  MAX_FRONTIER,
  MAX_CANDIDATES
};
