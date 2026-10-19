'use strict';

/**
 * Opt-in SPA XHR capture lane for REO portals (foolproof scrape P0).
 *
 * When SCRAPLING_SPA_XHR=1 and the source is in SCRAPLING_SPA_XHR_SOURCES,
 * DynamicFetcher captures JSON the SPA already fetches (capture_xhr pattern).
 * Fail-closed when Scrapling fetchers/browsers are missing — never invents
 * inventory and never CAPTCHA-bypasses.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATTERNS = {
  fannie: '*search-service*',
  freddie: '*propertysearch*',
  va: '*properties*',
};

function spaXhrEnabled(sourceKey, env = process.env) {
  const master = String(env.SCRAPLING_SPA_XHR || '').toLowerCase() === '1'
    || String(env.SCRAPLING_SPA_XHR || '').toLowerCase() === 'true';
  if (!master) return false;
  const allow = String(env.SCRAPLING_SPA_XHR_SOURCES || 'fannie,freddie,va')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes(String(sourceKey || '').toLowerCase());
}

function pythonRuntime(env = process.env) {
  if (env.SCRAPLING_PYTHON) return env.SCRAPLING_PYTHON;
  const root = path.resolve(__dirname, '..', '..');
  const win = path.join(root, '.cache', 'crawler-tools', 'venv', 'Scripts', 'python.exe');
  const nix = path.join(root, '.cache', 'crawler-tools', 'venv', 'bin', 'python');
  const candidate = process.platform === 'win32' ? win : nix;
  return fs.existsSync(candidate) ? candidate : null;
}

const { isPrivateOrLocalHost } = require('./scrapling-bridge');

const MAX_SPA_XHR_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_SPA_XHR_STDERR_BYTES = 64 * 1024;

function validateSpaXhrUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return 'SPA_XHR_INVALID_URL';
  }
  if (parsed.protocol !== 'https:') return 'SPA_XHR_HTTPS_REQUIRED';
  if (parsed.username || parsed.password) return 'SPA_XHR_CREDENTIALS_NOT_ALLOWED';
  const host = parsed.hostname.toLowerCase();
  if (
    host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.localhost')
    || isPrivateOrLocalHost(host)
  ) {
    return 'SPA_XHR_PRIVATE_HOST_REFUSED';
  }
  return null;
}

function captureSpaXhr(url, { sourceKey, pattern, timeoutMs = 20000, env = process.env } = {}) {
  const urlError = validateSpaXhrUrl(url);
  if (urlError) {
    return Promise.resolve({
      ok: false,
      error: urlError,
      sourceKey,
      url,
    });
  }
  const python = pythonRuntime(env);
  const script = path.resolve(__dirname, '..', '..', 'scripts', 'crawlers', 'scrapling_spa_xhr.py');
  if (!python || !fs.existsSync(script)) {
    return Promise.resolve({
      ok: false,
      error: 'SPA_XHR_RUNTIME_MISSING',
      notes: 'Install scrapling[fetchers] in the project venv; native parse remains default.',
    });
  }
  const xhrPattern = pattern || DEFAULT_PATTERNS[sourceKey] || '*api*';
  return new Promise((resolve) => {
    const child = spawn(python, [script, url, xhrPattern], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH || '',
        SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT || '',
        TEMP: process.env.TEMP || process.env.TMP || '',
        PYTHONIOENCODING: 'utf-8',
      },
    });
    let out = '', err = '', outBytes = 0, overflow = false;
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve({ ok: false, error: 'SPA_XHR_TIMEOUT', sourceKey, url });
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      const chunk = String(d);
      outBytes += Buffer.byteLength(chunk, 'utf8');
      if (outBytes > MAX_SPA_XHR_STDOUT_BYTES) {
        overflow = true;
        try { child.kill('SIGKILL'); } catch (_) {}
        return;
      }
      out += chunk;
    });
    child.stderr.on('data', (d) => {
      if (err.length < MAX_SPA_XHR_STDERR_BYTES) {
        err += String(d).slice(0, MAX_SPA_XHR_STDERR_BYTES - err.length);
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message, sourceKey, url });
    });
    child.on('close', () => {
      clearTimeout(timer);
      if (overflow) {
        resolve({ ok: false, error: 'SPA_XHR_OUTPUT_TOO_LARGE', sourceKey, url });
        return;
      }
      try {
        const parsed = JSON.parse(String(out).trim().split('\n').pop() || '{}');
        resolve({ ...parsed, sourceKey, url, pattern: xhrPattern });
      } catch {
        resolve({ ok: false, error: (err || 'protocol_error').slice(0, 300), sourceKey, url });
      }
    });
  });
}

/**
 * Map captured XHR items through a scraper's mapJsonItem when available.
 */
function mapCapturedItems(scraper, items, state) {
  const mapper = scraper && typeof scraper.mapJsonItem === 'function'
    ? (item) => scraper.mapJsonItem(item, state)
    : null;
  const listings = [];
  for (const item of items || []) {
    try {
      if (mapper) {
        const mapped = mapper(item);
        if (mapped) listings.push(mapped);
      } else if (item && typeof item === 'object' && item.address && (item.id || item.listingId || item.propertyId)) {
        listings.push(item);
      }
    } catch (_) {
      // skip unmappable item
    }
  }
  return listings;
}

module.exports = {
  DEFAULT_PATTERNS,
  spaXhrEnabled,
  pythonRuntime,
  captureSpaXhr,
  mapCapturedItems,
};
