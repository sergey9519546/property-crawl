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

const net = require('node:net');

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
 * Returns true if a dotted-quad IPv4 string falls within private, loopback,
 * link-local, CGNAT, multicast, broadcast, or reserved IETF ranges.
 */
function isNonPublicIpv4(ip) {
  if (!net.isIPv4(ip)) return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0) return true;                                  // 0.0.0.0/8
  if (a === 10) return true;                                 // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true;         // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true;                                // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true;                   // 169.254.0.0/16 (link-local / IMDS)
  if (a === 172 && b >= 16 && b <= 31) return true;          // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true;          // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true;          // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 168) return true;                   // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true;      // 198.18.0.0/15 (benchmarking)
  if (a === 198 && b === 51 && c === 100) return true;       // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true;        // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true;                                 // 224.0.0.0/4 multicast & 240.0.0.0/4 reserved
  return false;
}

/**
 * Extracts an embedded IPv4 address from an IPv6 literal (e.g. ::ffff:127.0.0.1,
 * ::ffff:7f00:1, 0:0:0:0:0:ffff:a9fe:a9fe, or ::127.0.0.1), or returns null.
 */
function extractEmbeddedIpv4FromIpv6(host) {
  const mappedDotted = host.match(/^(?:::ffff:|(?:0+:){5}ffff:|::|(?:0+:){6})(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedDotted) {
    return mappedDotted[1];
  }
  const mappedHex = host.match(/^(?:::ffff:|(?:0+:){5}ffff:|::|(?:0+:){6})([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isBlockedSsrfHost(rawHostname) {
  const host = String(rawHostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa') ||
    host === '0.0.0.0' ||
    host === '0'
  ) {
    return true;
  }

  if (net.isIPv4(host)) {
    return isNonPublicIpv4(host);
  }

  // IPv6 unspecified (::) and loopback (::1) in canonical or expanded forms
  if (
    host === '::' ||
    host === '::1' ||
    /^0+(?::0+)*$/.test(host) ||
    /^0+(?::0+)*:0*1$/.test(host)
  ) {
    return true;
  }

  // IPv6 link-local (fe80::/10), site-local (fec0::/10), unique-local (fc00::/7),
  // multicast (ff00::/8), documentation (2001:db8::/32), NAT64 (64:ff9b::/96)
  if (
    host.startsWith('fe80:') ||
    /^fe[89ab][0-9a-f]:/.test(host) ||
    /^fe[c-f][0-9a-f]:/.test(host) ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('ff') ||
    host.startsWith('2001:db8:') ||
    host.startsWith('64:ff9b:')
  ) {
    return true;
  }

  // IPv6-mapped IPv4 literals (dotted-quad or normalized hex pairs)
  const embeddedIpv4 = extractEmbeddedIpv4FromIpv6(host);
  if (embeddedIpv4 !== null) {
    return isNonPublicIpv4(embeddedIpv4);
  }
  if (host.startsWith('::ffff:') || /^(?:0+:){5}ffff:/.test(host)) {
    return true;
  }

  return false;
}

/**
 * Validate URL strictly against SSRF attacks.
 * Rejects non-HTTPS, credentials, loopback, link-local, private subnets,
 * and IPv6-mapped IPv4 loopback/private/link-local literals.
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

  if (isBlockedSsrfHost(parsed.hostname)) {
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
