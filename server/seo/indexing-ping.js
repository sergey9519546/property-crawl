'use strict';

/**
 * server/seo/indexing-ping.js
 *
 * Automated search engine indexing notification via the IndexNow protocol.
 * - Submits URLs in batches up to 10,000 to IndexNow API (Bing, Yandex, Seznam, etc.)
 * - Deprecates retired Google/Bing GET sitemap ping endpoints in favor of IndexNow
 *   (retired endpoints require explicit opt-in via allowDeprecatedEndpoints: true)
 * - Refuses the synthetic 'default_test_key' fallback in NODE_ENV=production
 * - Supports dryRun mode for testing and CLI dry-runs
 */

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const DEFAULT_TEST_KEY = 'default_test_key';
const MAX_URLS_PER_CHUNK = 10000;
const DEFAULT_HOST = 'perfectproperty.org';
const DEFAULT_SITEMAP_URL = 'https://perfectproperty.org/sitemap.xml';
const DEFAULT_FETCH_TIMEOUT_MS = 15000;

function resolveDefaultHost(env = process.env) {
  const origin = env.PUBLIC_APP_ORIGIN || env.NEXT_PUBLIC_APP_URL || '';
  if (origin && typeof origin === 'string') {
    return origin.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
  return DEFAULT_HOST;
}

function resolveDefaultSitemapUrl(env = process.env) {
  const host = resolveDefaultHost(env);
  return `https://${host}/sitemap.xml`;
}

// Active ping targets: Google & Bing retired unauthenticated sitemap GET pings.
const SITEMAP_PING_ENDPOINTS = Object.freeze({
  indexnow: INDEXNOW_ENDPOINT,
});

const DEPRECATED_SITEMAP_PING_ENDPOINTS = Object.freeze({
  google: 'https://www.google.com/ping?sitemap=',
  bing: 'https://www.bing.com/ping?sitemap=',
});

/**
 * Submits an array of URLs to the IndexNow protocol endpoint in chunks of up to 10,000.
 *
 * @param {Object} options
 * @param {string} [options.host] - Domain host (e.g. "perfectproperty.org")
 * @param {string} [options.key] - IndexNow API key (required in production; non-production defaults to default_test_key)
 * @param {string} [options.keyLocation] - URL of public key text verification file
 * @param {string[]} options.urls - List of URLs to index
 * @param {boolean} [options.dryRun=false] - Whether to simulate submissions without sending HTTP requests
 * @param {Function} [options.fetchFn=globalThis.fetch] - Custom fetch implementation
 * @param {Object} [options.env=process.env] - Environment override
 * @param {number} [options.timeoutMs=15000] - Request timeout in ms
 * @returns {Promise<{ success: boolean, submittedCount: number, dryRun: boolean, batches: Array, errors: Array }>}
 */
async function submitIndexNowUrls(options = {}) {
  const env = options.env || process.env;
  const {
    host = resolveDefaultHost(env),
    urls = [],
    dryRun = false,
    fetchFn = globalThis.fetch,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  } = options;

  const nodeEnv = String(env.NODE_ENV ?? process.env.NODE_ENV ?? '').trim().toLowerCase();
  const explicitOrEnvKey = options.key !== undefined ? options.key : env.INDEXNOW_KEY;
  const trimmedKey = explicitOrEnvKey == null ? '' : String(explicitOrEnvKey).trim();
  const isProduction = nodeEnv === 'production';

  if (isProduction && (!trimmedKey || trimmedKey === DEFAULT_TEST_KEY)) {
    return {
      success: false,
      submittedCount: 0,
      dryRun: Boolean(dryRun),
      batches: [],
      errors: [
        {
          code: 'INDEXNOW_KEY_REQUIRED',
          message: 'INDEXNOW_KEY is required in production; refusing default_test_key fallback',
        },
      ],
    };
  }

  const key = trimmedKey || DEFAULT_TEST_KEY;
  const keyLocation = options.keyLocation || `https://${host}/${key}.txt`;

  const validUrls = Array.isArray(urls)
    ? urls.filter((u) => typeof u === 'string' && u.trim().length > 0)
    : [];

  if (validUrls.length === 0) {
    return {
      success: true,
      submittedCount: 0,
      dryRun: Boolean(dryRun),
      batches: [],
      errors: [],
    };
  }

  const batches = [];
  const errors = [];

  // Chunk URLs into slices of MAX_URLS_PER_CHUNK
  for (let i = 0; i < validUrls.length; i += MAX_URLS_PER_CHUNK) {
    const chunk = validUrls.slice(i, i + MAX_URLS_PER_CHUNK);
    const batchNumber = Math.floor(i / MAX_URLS_PER_CHUNK) + 1;

    const payload = {
      host,
      key,
      keyLocation,
      urlList: chunk,
    };

    if (dryRun) {
      batches.push({
        batch: batchNumber,
        count: chunk.length,
        status: 200,
        dryRun: true,
        endpoint: INDEXNOW_ENDPOINT,
        payload,
      });
      continue;
    }

    try {
      const fetchInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
      };
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        fetchInit.signal = AbortSignal.timeout(timeoutMs);
      }
      const response = await fetchFn(INDEXNOW_ENDPOINT, fetchInit);

      // IndexNow returns 200 (OK) or 202 (Accepted)
      const ok = response.status === 200 || response.status === 202 || response.ok;
      batches.push({
        batch: batchNumber,
        count: chunk.length,
        status: response.status,
        ok,
        endpoint: INDEXNOW_ENDPOINT,
      });

      if (!ok) {
        errors.push({
          batch: batchNumber,
          status: response.status,
          message: `IndexNow returned status ${response.status}`,
        });
      }
    } catch (err) {
      errors.push({
        batch: batchNumber,
        message: err.message || 'Network error during IndexNow ping',
      });
    }
  }

  const allSuccessful = errors.length === 0;

  return {
    success: allSuccessful,
    submittedCount: validUrls.length,
    dryRun: Boolean(dryRun),
    batches,
    errors,
  };
}

/**
 * Submits a sitemap notification via IndexNow (default) or explicitly opted-in legacy endpoints.
 * Retired Google and Bing sitemap ping URLs are skipped by default unless
 * `allowDeprecatedEndpoints: true` (or `ALLOW_DEPRECATED_SITEMAP_PING=1`) is explicitly set.
 *
 * @param {Object} options
 * @param {string} [options.sitemapUrl] - Canonical URL of sitemap
 * @param {string[]} [options.engines=['indexnow']] - Notification targets ('indexnow'; deprecated: 'google', 'bing')
 * @param {boolean} [options.allowDeprecatedEndpoints=false] - Explicitly opt into retired Google/Bing ping URLs
 * @param {boolean} [options.dryRun=false] - Whether to simulate without network requests
 * @param {Function} [options.fetchFn=globalThis.fetch] - Custom fetch implementation
 * @param {Object} [options.env=process.env] - Environment override
 * @param {number} [options.timeoutMs=15000] - Request timeout in ms
 * @returns {Promise<{ success: boolean, results: Array, errors: Array }>}
 */
async function pingSitemap(options = {}) {
  const env = options.env || process.env;
  const {
    sitemapUrl = resolveDefaultSitemapUrl(env),
    engines = ['indexnow'],
    allowDeprecatedEndpoints = Boolean(env.ALLOW_DEPRECATED_SITEMAP_PING === '1'),
    dryRun = false,
    fetchFn = globalThis.fetch,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  } = options;

  const results = [];
  const errors = [];

  for (const engine of engines) {
    const engineKey = String(engine || '').trim().toLowerCase();

    if (engineKey === 'indexnow') {
      let host = options.host;
      if (!host) {
        try {
          host = new URL(sitemapUrl).host;
        } catch (_) {
          host = resolveDefaultHost(env);
        }
      }
      const res = await submitIndexNowUrls({
        host,
        key: options.key,
        keyLocation: options.keyLocation,
        urls: [sitemapUrl],
        dryRun,
        fetchFn,
        env,
        timeoutMs,
      });
      const firstBatch = res.batches[0] || null;
      results.push({
        engine: 'indexnow',
        url: INDEXNOW_ENDPOINT,
        deprecated: false,
        ...(dryRun ? { dryRun: true } : {}),
        success: res.success,
        status: firstBatch ? firstBatch.status : (res.success ? 200 : 400),
      });
      for (const err of res.errors) {
        errors.push({ engine: 'indexnow', ...err });
      }
      continue;
    }

    const deprecatedEndpoint = DEPRECATED_SITEMAP_PING_ENDPOINTS[engineKey];
    if (deprecatedEndpoint) {
      if (!allowDeprecatedEndpoints) {
        const message = `Deprecated sitemap ping endpoint retired for ${engineKey}; use IndexNow instead`;
        results.push({
          engine: engineKey,
          url: null,
          deprecated: true,
          skipped: true,
          ...(dryRun ? { dryRun: true } : {}),
          success: false,
          status: 410,
          message,
        });
        errors.push({
          engine: engineKey,
          deprecated: true,
          message,
        });
        continue;
      }

      const targetUrl = `${deprecatedEndpoint}${encodeURIComponent(sitemapUrl)}`;
      if (dryRun) {
        results.push({
          engine: engineKey,
          url: targetUrl,
          deprecated: true,
          dryRun: true,
          success: true,
          status: 200,
        });
        continue;
      }

      try {
        const fetchInit = { method: 'GET' };
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
          fetchInit.signal = AbortSignal.timeout(timeoutMs);
        }
        const response = await fetchFn(targetUrl, fetchInit);
        const ok = response.ok || response.status === 200;
        results.push({
          engine: engineKey,
          url: targetUrl,
          deprecated: true,
          success: ok,
          status: response.status,
        });
        if (!ok) {
          errors.push({
            engine: engineKey,
            status: response.status,
            message: `Ping failed with HTTP ${response.status}`,
          });
        }
      } catch (err) {
        errors.push({
          engine: engineKey,
          message: err.message || 'Network error during sitemap ping',
        });
      }
      continue;
    }

    errors.push({
      engine,
      message: `Unsupported search engine ping target: ${engine}`,
    });
  }

  return {
    success: errors.length === 0,
    results,
    errors,
  };
}

module.exports = {
  INDEXNOW_ENDPOINT,
  DEFAULT_TEST_KEY,
  MAX_URLS_PER_CHUNK,
  DEFAULT_HOST,
  DEFAULT_SITEMAP_URL,
  resolveDefaultHost,
  resolveDefaultSitemapUrl,
  SITEMAP_PING_ENDPOINTS,
  DEPRECATED_SITEMAP_PING_ENDPOINTS,
  submitIndexNowUrls,
  pingSitemap,
};
