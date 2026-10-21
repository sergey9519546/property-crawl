'use strict';

/**
 * Zyte API extraction & Scrapy Cloud integration.
 * Spec: C:\Users\serge\.gemini\config\skills\zyte-scrapy\SKILL.md
 * Project ID defaults to 870105.
 *
 * Rules:
 * - Gated on ZYTE_API_KEY (server secret).
 * - Never log or return ZYTE_API_KEY or the Basic auth header.
 * - Enforce SSRF protection on every target URL before network dispatch.
 */

const DEFAULT_PROJECT_ID = '870105';
const ZYTE_EXTRACT_API_URL = 'https://api.zyte.com/v1/extract';
const SCRAPY_CLOUD_API_URL = 'https://app.zyte.com/api';

function zyteConfigured(env = process.env) {
  return Boolean(String(env.ZYTE_API_KEY || '').trim());
}

function getBasicAuthHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey.trim()}:`).toString('base64')}`;
}

/**
 * Validate URL strictly against SSRF attacks.
 * Rejects non-HTTPS, credentials, loopback, link-local, private subnets.
 */
function validatePublicHttpsUrl(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { valid: false, error: 'INVALID_URL' };
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return { valid: false, error: 'UNSAFE_PROTOCOL_OR_CREDENTIALS' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isPrivate =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host === '169.254.169.254' ||
    host.endsWith('.internal');

  if (isPrivate) {
    return { valid: false, error: 'SSRF_BLOCKED_HOST' };
  }

  return { valid: true, parsed };
}

/**
 * Server-side fallback fetcher via Zyte API extraction.
 *
 * @param {string} url Target URL to fetch
 * @param {object} [opts]
 * @param {boolean} [opts.browser=false] If true, renders dynamic JS via headless browser
 * @param {number} [opts.timeoutMs=15000] Request timeout
 * @param {object} [opts.env=process.env] Environment variables
 * @param {typeof fetch} [opts.fetchImpl=fetch] Fetch implementation
 */
async function zyteFetch(url, { browser = false, timeoutMs = 15000, env = process.env, fetchImpl = fetch } = {}) {
  const apiKey = String(env.ZYTE_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'ZYTE_NOT_CONFIGURED', status: 503 };
  }

  const urlCheck = validatePublicHttpsUrl(url);
  if (!urlCheck.valid) {
    return { ok: false, error: urlCheck.error, status: 400 };
  }

  const requestBody = {
    url,
    ...(browser ? { browserHtml: true } : { httpResponseBody: true }),
  };

  try {
    const response = await fetchImpl(ZYTE_EXTRACT_API_URL, {
      method: 'POST',
      headers: {
        Authorization: getBasicAuthHeader(apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return { ok: false, error: `ZYTE_HTTP_${response.status}`, status: response.status };
    }

    const data = await response.json().catch(() => ({}));

    let html = '';
    if (browser && typeof data.browserHtml === 'string') {
      html = data.browserHtml;
    } else if (typeof data.httpResponseBody === 'string') {
      html = Buffer.from(data.httpResponseBody, 'base64').toString('utf8');
    }

    return {
      ok: true,
      status: 200,
      html,
      browser: Boolean(browser),
      url,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || 'ZYTE_NETWORK_ERROR'), status: 502 };
  }
}

/**
 * fetch()-compatible wrapper around zyteFetch.
 */
async function zyteFetchLike(url, opts = {}) {
  const result = await zyteFetch(url, opts);
  return {
    ok: result.ok,
    status: result.status,
    url,
    text: async () => result.html || '',
    json: async () => JSON.parse(result.html || '{}'),
  };
}

/**
 * Lists the last jobs from Scrapy Cloud for project.
 */
async function scrapyCloudListJobs({
  projectId,
  count = 15,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 10000,
} = {}) {
  const apiKey = String(env.ZYTE_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'ZYTE_NOT_CONFIGURED', status: 503, jobs: [] };
  }

  const proj = String(projectId || env.ZYTE_PROJECT_ID || DEFAULT_PROJECT_ID).trim();
  const url = `${SCRAPY_CLOUD_API_URL}/jobs/list.json?project=${encodeURIComponent(proj)}&count=${encodeURIComponent(count)}`;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: getBasicAuthHeader(apiKey),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return { ok: false, error: `SCRAPY_CLOUD_HTTP_${response.status}`, status: response.status, jobs: [] };
    }

    const data = await response.json().catch(() => ({}));
    return { ok: true, status: 200, jobs: Array.isArray(data.jobs) ? data.jobs : [], total: data.total || 0 };
  } catch (err) {
    return { ok: false, error: String(err?.message || 'SCRAPY_CLOUD_ERROR'), status: 502, jobs: [] };
  }
}

/**
 * Schedules a Scrapy Cloud spider run with recipe configuration.
 */
async function scheduleZyteJob({
  spider,
  recipe,
  projectId,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 10000,
} = {}) {
  const apiKey = String(env.ZYTE_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'ZYTE_NOT_CONFIGURED', status: 503 };
  }

  if (!spider || typeof spider !== 'string') {
    return { ok: false, error: 'MISSING_SPIDER_NAME', status: 400 };
  }

  const proj = String(projectId || env.ZYTE_PROJECT_ID || DEFAULT_PROJECT_ID).trim();
  const formParams = new URLSearchParams({
    project: proj,
    spider: spider.trim(),
  });

  if (recipe && typeof recipe === 'string') {
    formParams.set('job_settings', JSON.stringify({ LOVABLE_RECIPE: recipe.trim() }));
  }

  try {
    const response = await fetchImpl(`${SCRAPY_CLOUD_API_URL}/run.json`, {
      method: 'POST',
      headers: {
        Authorization: getBasicAuthHeader(apiKey),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formParams.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return { ok: false, error: `SCRAPY_CLOUD_HTTP_${response.status}`, status: response.status };
    }

    const data = await response.json().catch(() => ({}));
    return { ok: true, status: 200, jobId: data.jobid || null, prevJobId: data.prevjobid || null };
  } catch (err) {
    return { ok: false, error: String(err?.message || 'SCRAPY_CLOUD_ERROR'), status: 502 };
  }
}

module.exports = {
  DEFAULT_PROJECT_ID,
  ZYTE_EXTRACT_API_URL,
  SCRAPY_CLOUD_API_URL,
  zyteConfigured,
  validatePublicHttpsUrl,
  zyteFetch,
  zyteFetchLike,
  scrapyCloudListJobs,
  scheduleZyteJob,
};
