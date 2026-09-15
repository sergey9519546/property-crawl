// server/discovery/onboarding-pass.js
//
// Scheduled onboarding pass for catalog entries that are marked
// DISCOVERY_ONLY or SCOPE_LIMITED. For each eligible source we crawl its
// discoveryUrl via crawlOnboardingSource (server/crawlers/onboarding-spider.js),
// persist the resulting candidate list under .cache/crawler-tools/onboarding/<source>.json,
// and emit a run report. Candidates are URL-shaped (page-links + document
// classification from the spider) and become raw input for the existing
// source-intake route when an operator is ready to publish them.
//
// Safety:
//   - Only public, https, host-allowed sources are crawled.
//   - Per-source crawl is wrapped in executeWithRetry + circuit breaker via
//     the spider's own fetch + a separate per-source try/catch so one bad
//     publisher cannot stop the whole pass.
//   - One failed crawl surfaces as `outcome: 'skipped'` in the per-source
//     record; the next pass retries from scratch (the atomicWriteJson
//     overwrite is fine - the cache is treated as best-effort, not source
//     of truth).
//   - Robots.txt is honored via the spider's robots factory.
//   - No state mutation of SOURCE_CATALOG, scheduler, or live cache.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  crawlOnboardingSource,
  inspectCrawlUrl,
  VERSION,
  USER_AGENT
} = require('../crawlers/onboarding-spider');
const { SOURCE_CATALOG } = require('../sources/catalog');

const DEFAULT_CACHE_ROOT = path.resolve(__dirname, '..', '..', '.cache', 'crawler-tools', 'onboarding');
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_MAX_DEPTH = 1;

// Resolved per-call so tests and operators can override the cache root via
// options.cacheRoot, options.env.ONBOARDING_CACHE_ROOT, or the
// ONBOARDING_CACHE_ROOT process env var without restarting the process.
function resolveCacheRoot(options = {}) {
  if (options.cacheRoot) return path.resolve(options.cacheRoot);
  if (options.env && options.env.ONBOARDING_CACHE_ROOT) return path.resolve(options.env.ONBOARDING_CACHE_ROOT);
  if (process.env.ONBOARDING_CACHE_ROOT) return path.resolve(process.env.ONBOARDING_CACHE_ROOT);
  return DEFAULT_CACHE_ROOT;
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function atomicWriteJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function defaultMaxPages(env = process.env) {
  const raw = env.ONBOARDING_MAX_PAGES;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : DEFAULT_MAX_PAGES;
}

function defaultMaxDepth(env = process.env) {
  const raw = env.ONBOARDING_MAX_DEPTH;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : DEFAULT_MAX_DEPTH;
}

function defaultTimeoutMs(env = process.env) {
  const raw = env.ONBOARDING_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1_000 && n <= 120_000 ? n : DEFAULT_TIMEOUT_MS;
}

function isEligible(entry, env = process.env) {
  if (!entry || !entry.id) return false;
  const status = entry.status || 'DISCOVERY_ONLY';
  if (status !== 'DISCOVERY_ONLY' && status !== 'SCOPE_LIMITED') return false;
  if (entry.access !== 'public') return false;
  if (!entry.discoveryUrl || typeof entry.discoveryUrl !== 'string') return false;
  return true;
}

function classifyCrawlError(error) {
  const message = (error && error.message) || String(error || 'unknown');
  if (error && error.code) return { stage: 'crawl', code: error.code, message };
  if (/robots/i.test(message)) return { stage: 'robots', code: 'ROBOTS_DISALLOWED', message };
  if (/timeout/i.test(message)) return { stage: 'timeout', code: 'CRAWL_TIMEOUT', message };
  return { stage: 'crawl', code: 'CRAWL_FAILED', message };
}

// Resolve which spider source key (i.e. SOURCE_HOSTS key) to use for this
// catalog entry. The catalog `id` is the human-readable slug; the spider uses
// the SOURCE_HOSTS key (usually the `adapterKey`, falling back to `id`)
// when validating the start URL hostname. Returns null when neither
// resolves to a registered host set.
function resolveSpiderSourceKey(entry) {
  const candidates = [entry && entry.adapterKey, entry && entry.id].filter(Boolean);
  for (const candidate of candidates) {
    const inspection = inspectCrawlUrl(candidate, entry && entry.discoveryUrl);
    if (inspection.isValid) return candidate;
  }
  return null;
}

async function runOnboardingSource(entry, options = {}) {
  // Try adapterKey first (the SOURCE_HOSTS key), then fall back to the
  // catalog id. The spider's inspectCrawlUrl rejects unknown sources, so
  // we resolve to a valid key before invoking it.
  const spiderKey = resolveSpiderSourceKey(entry);
  if (!spiderKey) {
    return { sourceId: entry.id, outcome: 'skipped', reason: 'unsupported_source', crawledAt: new Date().toISOString() };
  }

  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl;
  const dependencies = options.dependencies || {};
  const resolvedCacheRoot = resolveCacheRoot(options);
  const spiderCacheRoot = path.join(resolvedCacheRoot, entry.id);
  const sleptAt = Date.now();

  // The spider reads its dependency-injection blob (fetchImpl,
  // extractWithScrapling, robots, cacheRoot, circuitBreaker, fs, etc.)
  // from the SECOND arg as a flat object, and input parameters
  // (source/url/maxPages/maxDepth/timeoutMs) from the FIRST. We flatten
  // options.dependencies so caller-provided stubs (extractWithScrapling
  // in tests, scrapling-bridge in production) land at the right level.
  const crawl = await crawlOnboardingSource(
    {
      source: spiderKey,
      url: entry.discoveryUrl,
      maxPages,
      maxDepth,
      timeoutMs
    },
    {
      fetchImpl,
      robots: options.robots || null,
      cacheRoot: spiderCacheRoot,
      ...dependencies
    }
  ).catch((error) => ({ error }));

  if (crawl && crawl.error) {
    const detail = classifyCrawlError(crawl.error);
    return {
      sourceId: entry.id,
      spiderKey,
      outcome: 'failed',
      detail,
      candidatesCount: 0,
      documentsCount: 0,
      crawledAt: new Date(sleptAt).toISOString(),
      durationMs: Date.now() - sleptAt
    };
  }

  const candidates = Array.isArray(crawl.candidates) ? crawl.candidates : [];
  const documents = candidates.filter((c) => c && c.document);
  const persisted = {
    sourceId: entry.id,
    spiderKey,
    label: entry.label,
    discoveryUrl: entry.discoveryUrl,
    crawledAt: new Date(sleptAt).toISOString(),
    durationMs: Date.now() - sleptAt,
    pagesProcessed: crawl.pagesProcessed || 0,
    robots: crawl.robots && crawl.robots.source ? crawl.robots.source : null,
    candidates,
    summary: {
      candidatesCount: candidates.length,
      documentsCount: documents.length
    }
  };

  if (options.persist !== false) {
    const file = path.join(spiderCacheRoot, 'latest.json');
    try {
      atomicWriteJson(file, persisted);
      persisted.cacheFile = file;
    } catch (error) {
      persisted.cacheError = error.message;
    }
  }

  return {
    sourceId: entry.id,
    spiderKey,
    outcome: candidates.length ? 'success' : 'empty',
    candidatesCount: candidates.length,
    documentsCount: documents.length,
    pagesProcessed: crawl.pagesProcessed || 0,
    crawledAt: persisted.crawledAt,
    durationMs: persisted.durationMs,
    cacheFile: persisted.cacheFile || null,
    cacheError: persisted.cacheError || null,
    robots: persisted.robots
  };
}

async function runOnboardingPass(options = {}) {
  const sources = options.sources || null;
  const elapsed = Date.now();
  const catalog = options.catalog || SOURCE_CATALOG;
  const env = options.env || process.env;
  const maxPages = options.maxPages ?? defaultMaxPages(env);
  const maxDepth = options.maxDepth ?? defaultMaxDepth(env);
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs(env);
  const fetchImpl = options.fetchImpl;
  const persist = options.persist !== false;
  const runId = `onboarding-${new Date(elapsed).toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
  const includeAll = !Array.isArray(sources) || !sources.length;
  const targetIds = includeAll ? null : new Set(sources);

  const targets = catalog
    .filter(isEligible)
    .filter((entry) => includeAll || targetIds.has(entry.id))
    .map((entry) => ({ entry, maxPages, maxDepth, timeoutMs, fetchImpl, dependencies: options.dependencies, persist }));

  const records = [];
  for (const target of targets) {
    let record;
    try {
      record = await runOnboardingSource(target.entry, target);
    } catch (error) {
      record = {
        sourceId: target.entry.id,
        outcome: 'failed',
        detail: classifyCrawlError(error),
        candidatesCount: 0,
        documentsCount: 0,
        crawledAt: new Date().toISOString()
      };
    }
    records.push(record);
  }

  const summary = {
    runId,
    startedAt: new Date(elapsed).toISOString(),
    durationMs: Date.now() - elapsed,
    spiderVersion: VERSION,
    userAgent: USER_AGENT,
    totalTargets: targets.length,
    success: records.filter((r) => r.outcome === 'success').length,
    empty: records.filter((r) => r.outcome === 'empty').length,
    failed: records.filter((r) => r.outcome === 'failed').length,
    skipped: records.filter((r) => r.outcome === 'skipped').length,
    candidatesCount: records.reduce((acc, r) => acc + (r.candidatesCount || 0), 0),
    documentsCount: records.reduce((acc, r) => acc + (r.documentsCount || 0), 0),
    records
  };

  if (persist) {
    const manifestCacheRoot = resolveCacheRoot(options);
    const manifest = path.join(manifestCacheRoot, 'latest-pass.json');
    try {
      atomicWriteJson(manifest, summary);
      summary.manifestFile = manifest;
    } catch (error) {
      summary.manifestError = error.message;
    }
  }

  return summary;
}

function listCachedSources(options = {}) {
  const cacheRoot = resolveCacheRoot(options);
  if (!fs.existsSync(cacheRoot)) return [];
  const entries = fs.readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(cacheRoot, entry.name, 'latest.json');
      if (!fs.existsSync(file)) return null;
      try {
        return { sourceId: entry.name, cacheFile: file, summary: JSON.parse(fs.readFileSync(file, 'utf8')) };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
  return entries;
}

module.exports = {
  runOnboardingPass,
  runOnboardingSource,
  isEligible,
  classifyCrawlError,
  listCachedSources,
  resolveCacheRoot,
  DEFAULT_CACHE_ROOT,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_TIMEOUT_MS
};