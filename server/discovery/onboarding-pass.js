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
// Outcomes:
//   - skipped: no spider key accepts discoveryUrl (unsupported_source).
//   - failed: the crawl threw, or the spider returned halted. One source
//     cannot stop the rest of the pass. A halt that already found candidates
//     writes those URLs to latest.json. A halt with none does not overwrite
//     a previous cache.
//   - blocked: the crawl was not halted, found no candidates, and robots
//     disallowed at least one URL. blockedCount is copied onto the record.
//     latest.json is not written, so a block cannot look like a finished
//     empty crawl or clobber a previous cache.
//   - empty: the crawl finished without a halt or robots block and found
//     no candidates.
//   - success: the crawl finished and found at least one candidate.
//     blockedCount is included when some URLs were robots-disallowed.
//
// Safety:
//   - Only public, https, host-allowed sources are crawled.
//   - The spider honors robots.txt and retries a page fetch once.
//   - Cache files are best-effort, not source of truth.
//   - No state mutation of SOURCE_CATALOG, scheduler, or live cache.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  crawlOnboardingSource,
  inspectCrawlUrl,
  resolveCrawlTimeoutMs,
  VERSION,
  USER_AGENT,
  MAX_PAGE_BUDGET,
  MAX_DEPTH
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

// Env values are strings. parseInt quirks ('12abc' → 12, '1e2' → 1, ' 7 ' → 7)
// stay. Missing or non-numeric values fall back to the pass default. Numeric
// values clamp to the same floor/ceiling the spider uses, instead of snapping
// back to the default (51 pages → 50, not 3; 999ms → 1000, not 30000).
function parseEnvInt(raw) {
  if (raw == null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : null;
}

function defaultMaxPages(env = process.env) {
  const n = parseEnvInt(env.ONBOARDING_MAX_PAGES);
  if (n == null) return DEFAULT_MAX_PAGES;
  return Math.min(MAX_PAGE_BUDGET, Math.max(1, n));
}

function defaultMaxDepth(env = process.env) {
  const n = parseEnvInt(env.ONBOARDING_MAX_DEPTH);
  if (n == null) return DEFAULT_MAX_DEPTH;
  return Math.min(MAX_DEPTH, Math.max(0, n));
}

function defaultTimeoutMs(env = process.env) {
  const n = parseEnvInt(env.ONBOARDING_TIMEOUT_MS);
  if (n == null) return DEFAULT_TIMEOUT_MS;
  return resolveCrawlTimeoutMs(n);
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

function isDocumentCandidate(candidate) {
  if (!candidate) return false;
  if (candidate.document) return true;
  return candidate.type === 'document';
}

function haltedDetail(halted) {
  return classifyCrawlError({
    message: (halted && halted.message) || 'crawl halted',
    code: (halted && halted.code) || 'PAGE_FAILED'
  });
}

function candidateLists(crawl) {
  const candidates = Array.isArray(crawl && crawl.candidates) ? crawl.candidates : [];
  return {
    candidates,
    documents: candidates.filter(isDocumentCandidate),
    blockedCount: (crawl && crawl.blockedCount) || 0
  };
}

function observationPayload(entry, spiderKey, sleptAt, crawl, extra = {}) {
  const { candidates, documents, blockedCount } = candidateLists(crawl);
  return {
    sourceId: entry.id,
    spiderKey,
    label: entry.label,
    discoveryUrl: entry.discoveryUrl,
    crawledAt: new Date(sleptAt).toISOString(),
    durationMs: Date.now() - sleptAt,
    pagesProcessed: crawl.pagesProcessed || 0,
    blockedCount,
    nextAction: crawl.nextAction || null,
    robots: crawl.robots && crawl.robots.source ? crawl.robots.source : null,
    candidates,
    summary: {
      candidatesCount: candidates.length,
      documentsCount: documents.length,
      blockedCount
    },
    ...extra
  };
}

function writeLatest(cacheRoot, payload) {
  const file = path.join(cacheRoot, 'latest.json');
  try {
    atomicWriteJson(file, payload);
    return { cacheFile: file };
  } catch (error) {
    return { cacheError: error.message };
  }
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

// Stubs (extractWithScrapling, sleep, fs) come from dependencies. Pass-level
// fetch, robots, and cache win so a stub cannot send the checkpoint to a
// different directory than latest.json, or replace the robots decision.
function spiderCallOptions(options, spiderCacheRoot) {
  const dependencies = options.dependencies || {};
  return {
    ...dependencies,
    fetchImpl: options.fetchImpl || dependencies.fetchImpl,
    robots: options.robots || dependencies.robots || null,
    cacheRoot: spiderCacheRoot
  };
}

function resolveSourceBudget(options = {}) {
  const env = options.env || process.env;
  return {
    maxPages: options.maxPages ?? defaultMaxPages(env),
    maxDepth: options.maxDepth ?? defaultMaxDepth(env),
    timeoutMs: options.timeoutMs ?? defaultTimeoutMs(env)
  };
}

async function runOnboardingSource(entry, options = {}) {
  // Try adapterKey first (the SOURCE_HOSTS key), then fall back to the
  // catalog id. The spider's inspectCrawlUrl rejects unknown sources, so
  // we resolve to a valid key before invoking it.
  const spiderKey = resolveSpiderSourceKey(entry);
  if (!spiderKey) {
    return { sourceId: entry.id, outcome: 'skipped', reason: 'unsupported_source', crawledAt: new Date().toISOString() };
  }

  // Direct callers honor the same ONBOARDING_* clamps as the pass. An
  // explicit option still wins, so the pass can pass its already-clamped
  // numbers without a second read of process.env.
  const { maxPages, maxDepth, timeoutMs } = resolveSourceBudget(options);
  const resolvedCacheRoot = resolveCacheRoot(options);
  const spiderCacheRoot = path.join(resolvedCacheRoot, entry.id);
  const sleptAt = Date.now();

  // The spider reads its dependency-injection blob (fetchImpl,
  // extractWithScrapling, robots, cacheRoot, circuitBreaker, fs, etc.)
  // from the SECOND arg as a flat object, and input parameters
  // (source/url/maxPages/maxDepth/timeoutMs) from the FIRST.
  const crawl = await crawlOnboardingSource(
    {
      source: spiderKey,
      url: entry.discoveryUrl,
      maxPages,
      maxDepth,
      timeoutMs
    },
    spiderCallOptions(options, spiderCacheRoot)
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
      blockedCount: 0,
      crawledAt: new Date(sleptAt).toISOString(),
      durationMs: Date.now() - sleptAt
    };
  }

  const { candidates, documents, blockedCount } = candidateLists(crawl);
  const base = {
    sourceId: entry.id,
    spiderKey,
    candidatesCount: candidates.length,
    documentsCount: documents.length,
    pagesProcessed: crawl.pagesProcessed || 0,
    blockedCount,
    crawledAt: new Date(sleptAt).toISOString(),
    durationMs: Date.now() - sleptAt
  };
  if (crawl.nextAction) base.nextAction = crawl.nextAction;

  // A page failure is caught inside the spider and returned as halted.
  // That is a failed crawl, not an empty source. Keep URLs already found.
  if (crawl && crawl.halted) {
    const record = {
      ...base,
      outcome: 'failed',
      detail: haltedDetail(crawl.halted)
    };
    if (candidates.length > 0 && options.persist !== false) {
      const written = writeLatest(spiderCacheRoot, observationPayload(entry, spiderKey, sleptAt, crawl, {
        outcome: 'failed',
        halted: crawl.halted
      }));
      if (written.cacheFile) record.cacheFile = written.cacheFile;
      if (written.cacheError) record.cacheError = written.cacheError;
    }
    return record;
  }

  // A robots block with nothing found is not a finished empty crawl.
  if (blockedCount > 0 && candidates.length === 0) {
    return {
      ...base,
      outcome: 'blocked',
      reason: 'robots_disallowed',
      detail: {
        stage: 'robots',
        code: 'ROBOTS_DISALLOWED',
        message: 'robots.txt disallowed one or more URLs'
      }
    };
  }

  const persisted = observationPayload(entry, spiderKey, sleptAt, crawl, {
    outcome: candidates.length ? 'success' : 'empty'
  });

  if (options.persist !== false) {
    const written = writeLatest(spiderCacheRoot, persisted);
    if (written.cacheFile) persisted.cacheFile = written.cacheFile;
    if (written.cacheError) persisted.cacheError = written.cacheError;
  }

  return {
    ...base,
    outcome: candidates.length ? 'success' : 'empty',
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
    .map((entry) => ({ entry, maxPages, maxDepth, timeoutMs, fetchImpl, dependencies: options.dependencies, persist, robots: options.robots, cacheRoot: options.cacheRoot, env: options.env }));

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
        blockedCount: 0,
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
    blocked: records.filter((r) => r.outcome === 'blocked').length,
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
  defaultMaxPages,
  defaultMaxDepth,
  defaultTimeoutMs,
  DEFAULT_CACHE_ROOT,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_TIMEOUT_MS
};
