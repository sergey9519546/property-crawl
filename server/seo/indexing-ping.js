'use strict';

/**
 * server/seo/indexing-ping.js
 *
 * Automated search engine indexing ping & IndexNow batch protocol integration.
 * - Submits URLs in batches up to 10,000 to IndexNow API (Bing, Yandex, Seznam, etc.)
 * - Submits sitemap ping notifications to Google and Bing
 * - Supports dryRun mode for testing and CLI dry-runs
 */

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS_PER_CHUNK = 10000;
const DEFAULT_HOST = 'perfectproperty.org';
const DEFAULT_SITEMAP_URL = 'https://perfectproperty.org/sitemap.xml';

const SITEMAP_PING_ENDPOINTS = Object.freeze({
  google: 'https://www.google.com/ping?sitemap=',
  bing: 'https://www.bing.com/ping?sitemap=',
});

/**
 * Submits an array of URLs to the IndexNow protocol endpoint in chunks of up to 10,000.
 *
 * @param {Object} options
 * @param {string} [options.host] - Domain host (e.g. "perfectproperty.org")
 * @param {string} [options.key] - IndexNow API key (defaults to process.env.INDEXNOW_KEY or "default_test_key")
 * @param {string} [options.keyLocation] - URL of public key text verification file
 * @param {string[]} options.urls - List of URLs to index
 * @param {boolean} [options.dryRun=false] - Whether to simulate submissions without sending HTTP requests
 * @param {Function} [options.fetchFn=globalThis.fetch] - Custom fetch implementation
 * @returns {Promise<{ success: boolean, submittedCount: number, dryRun: boolean, batches: Array, errors: Array }>}
 */
async function submitIndexNowUrls(options = {}) {
  const {
    host = DEFAULT_HOST,
    key = process.env.INDEXNOW_KEY || 'default_test_key',
    urls = [],
    dryRun = false,
    fetchFn = globalThis.fetch,
  } = options;

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
      const response = await fetchFn(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
      });

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
 * Sends a sitemap ping to supported search engines.
 *
 * @param {Object} options
 * @param {string} [options.sitemapUrl] - Canonical URL of sitemap
 * @param {string[]} [options.engines] - Array of search engine keys ('google', 'bing')
 * @param {boolean} [options.dryRun=false] - Whether to simulate without network requests
 * @param {Function} [options.fetchFn=globalThis.fetch] - Custom fetch implementation
 * @returns {Promise<{ success: boolean, results: Array, errors: Array }>}
 */
async function pingSitemap(options = {}) {
  const {
    sitemapUrl = DEFAULT_SITEMAP_URL,
    engines = ['google', 'bing'],
    dryRun = false,
    fetchFn = globalThis.fetch,
  } = options;

  const results = [];
  const errors = [];

  for (const engine of engines) {
    const baseEndpoint = SITEMAP_PING_ENDPOINTS[engine.toLowerCase()];
    if (!baseEndpoint) {
      errors.push({
        engine,
        message: `Unsupported search engine ping target: ${engine}`,
      });
      continue;
    }

    const targetUrl = `${baseEndpoint}${encodeURIComponent(sitemapUrl)}`;

    if (dryRun) {
      results.push({
        engine,
        url: targetUrl,
        dryRun: true,
        success: true,
        status: 200,
      });
      continue;
    }

    try {
      const response = await fetchFn(targetUrl, {
        method: 'GET',
      });

      const ok = response.ok || response.status === 200;
      results.push({
        engine,
        url: targetUrl,
        success: ok,
        status: response.status,
      });

      if (!ok) {
        errors.push({
          engine,
          status: response.status,
          message: `Ping failed with HTTP ${response.status}`,
        });
      }
    } catch (err) {
      errors.push({
        engine,
        message: err.message || 'Network error during sitemap ping',
      });
    }
  }

  return {
    success: errors.length === 0,
    results,
    errors,
  };
}

module.exports = {
  INDEXNOW_ENDPOINT,
  MAX_URLS_PER_CHUNK,
  DEFAULT_HOST,
  DEFAULT_SITEMAP_URL,
  SITEMAP_PING_ENDPOINTS,
  submitIndexNowUrls,
  pingSitemap,
};
