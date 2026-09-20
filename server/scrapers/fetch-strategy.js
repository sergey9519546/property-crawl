'use strict';

/**
 * Tiered fetch strategy for foolproof collection (HN/GitHub research mapping).
 *
 * Tier 0: existing Node fetchText/fetchJson (native publisher JSON preferred)
 * Tier 1: optional Scrapling Fetcher impersonation (operator env)
 * Tier 2: fail-closed — never invent inventory; callers mark observation_error
 *
 * CAPTCHA/WAF is never bypassed here. Challenge pages trip the circuit breaker.
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const TIER_ORDER = ['native', 'scrapling-http', 'fail-closed'];

function pythonRuntime() {
  if (process.env.SCRAPLING_PYTHON) return process.env.SCRAPLING_PYTHON;
  const root = path.resolve(__dirname, '..', '..');
  const win = path.join(root, '.cache', 'crawler-tools', 'venv', 'Scripts', 'python.exe');
  const nix = path.join(root, '.cache', 'crawler-tools', 'venv', 'bin', 'python');
  const candidate = process.platform === 'win32' ? win : nix;
  return fs.existsSync(candidate) ? candidate : null;
}

function impersonationEnabled(sourceKey, env = process.env) {
  const allow = String(env.SCRAPLING_FETCH_SOURCES || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes(String(sourceKey || '').toLowerCase());
}

/**
 * Optional Scrapling HTTP impersonated fetch (tier 1).
 * Requires scrapling[fetchers] installed; refuses without runtime.
 * SSRF: same credential-free HTTPS + private/loopback rejection as scrapling-bridge.
 */
async function scraplingHttpGet(url, { timeoutMs = 8000 } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch {
    return { ok: false, tier: 'scrapling-http', error: 'SCRAPLING_INVALID_URL' };
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return { ok: false, tier: 'scrapling-http', error: 'SCRAPLING_INVALID_URL' };
  }
  try {
    const { isPrivateOrLocalHost } = require('./scrapling-bridge');
    if (typeof isPrivateOrLocalHost === 'function' && isPrivateOrLocalHost(parsed.hostname)) {
      return { ok: false, tier: 'scrapling-http', error: 'SCRAPLING_INVALID_URL' };
    }
  } catch (_) { /* bridge export optional; fall through to local check */ }
  // Local SSRF guard even if the bridge helper is unavailable.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isPrivate = host === 'localhost' || host.endsWith('.localhost')
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    || host === '0.0.0.0' || host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')
    || host === '169.254.169.254' || host.endsWith('.internal');
  if (isPrivate) {
    return { ok: false, tier: 'scrapling-http', error: 'SCRAPLING_INVALID_URL' };
  }
  const python = pythonRuntime();
  if (!python) {
    return { ok: false, tier: 'scrapling-http', error: 'SCRAPLING_RUNTIME_MISSING' };
  }
  const script = `
import json,sys
from urllib.parse import urlparse
url=sys.argv[1]
try:
    from scrapling.fetchers import Fetcher
    page=Fetcher.get(url, timeout=8)
    body=getattr(page,'body',None) or getattr(page,'html',None) or ''
    if hasattr(body,'decode'):
        body=body.decode('utf-8','replace')
    print(json.dumps({'ok':True,'url':url,'status':getattr(page,'status',None),'length':len(body),'html':body[:2_000_000]}))
except Exception as exc:
    print(json.dumps({'ok':False,'error':str(exc)[:300]}))
`;
  return new Promise((resolve) => {
    const child = spawn(python, ['-c', script, url], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH || '',
        SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT || '',
        PYTHONIOENCODING: 'utf-8',
      },
    });
    let out = '', err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve({ ok: false, tier: 'scrapling-http', error: 'timeout' });
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, tier: 'scrapling-http', error: e.message });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out.trim().split('\n').pop() || '{}');
        resolve({ ...parsed, tier: 'scrapling-http' });
      } catch {
        resolve({ ok: false, tier: 'scrapling-http', error: (err || 'protocol').slice(0, 300) });
      }
    });
  });
}

/**
 * Waterfall: native fetch first; optional Scrapling HTTP; else fail-closed.
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} opts.sourceKey
 * @param {(url:string, opts?:object)=>Promise<string>} opts.nativeFetch
 */
async function waterfallFetch({ url, sourceKey, nativeFetch, timeoutMs = 8000, env = process.env }) {
  const attempts = [];
  if (typeof nativeFetch === 'function') {
    try {
      const html = await nativeFetch(url);
      const text = html == null ? '' : String(html);
      if (text.trim()) {
        attempts.push({ tier: 'native', ok: true, bytes: text.length });
        return { ok: true, tier: 'native', html, attempts, sourceKey, url };
      }
      // Empty/null body is not success — continue the waterfall fail-closed.
      attempts.push({ tier: 'native', ok: false, error: 'empty_body' });
    } catch (error) {
      attempts.push({ tier: 'native', ok: false, error: String(error?.message || error).slice(0, 200) });
    }
  }
  if (impersonationEnabled(sourceKey, env)) {
    const result = await scraplingHttpGet(url, { timeoutMs });
    attempts.push({ tier: 'scrapling-http', ok: Boolean(result.ok), error: result.error || null });
    if (result.ok && result.html) {
      return { ok: true, tier: 'scrapling-http', html: result.html, attempts, sourceKey, url };
    }
  }
  return {
    ok: false,
    tier: 'fail-closed',
    attempts,
    sourceKey,
    url,
    error: 'FETCH_WATERFALL_EXHAUSTED',
    notes: 'No tier returned HTML. Do not invent inventory; record observation_error.',
  };
}

module.exports = {
  TIER_ORDER,
  pythonRuntime,
  impersonationEnabled,
  scraplingHttpGet,
  waterfallFetch,
};
