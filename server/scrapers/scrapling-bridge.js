'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { findBotChallengeSignature } = require('./circuit-breaker');

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;
const PROFILES = new Set(['gsa-index', 'gsa-detail', 'page-links', 'table-extract', 'hud-cards', 'treasury-detail', 'irs-detail']);

/**
 * Returns true when a hostname or IP literal refers to a private, loopback,
 * link-local, or otherwise non-public address (SSRF guard).
 */
function isPrivateOrLocalHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '0') return true;
  // IPv4 checks
  if (net.isIPv4(h)) {
    const parts = h.split('.').map(Number);
    if (parts[0] === 10) return true;                         // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true;    // 192.168.0.0/16
    if (parts[0] === 127) return true;                        // 127.0.0.0/8
    if (parts[0] === 169 && parts[1] === 254) return true;    // 169.254.0.0/16 (link-local)
    if (parts[0] === 0) return true;                          // 0.0.0.0/8
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // 100.64.0.0/10 (CGNAT)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;  // 192.0.0.0/24
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true; // 198.18.0.0/15
  }
  // IPv6 checks for unique-local and link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 unique-local
  if (h.startsWith('fe80')) return true;                     // fe80::/10 link-local
  return false;
}

class ScraplingBridgeError extends Error {
  constructor(message, code, options = {}) {
    super(message);
    this.name = 'ScraplingBridgeError';
    this.code = code;
    this.haltScraper = Boolean(options.haltScraper);
  }
}

function isScraplingEnabled(sourceKey, env = process.env) {
  const wanted = String(env.SCRAPLING_SOURCES || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  return wanted.includes(String(sourceKey || '').trim().toLowerCase());
}

function defaultPython(env = process.env) {
  if (env.SCRAPLING_PYTHON) return env.SCRAPLING_PYTHON;
  const root = path.resolve(__dirname, '..', '..');
  const candidates = process.platform === 'win32'
    ? [path.join(root, '.cache', 'crawler-tools', 'venv', 'Scripts', 'python.exe')]
    : [path.join(root, '.cache', 'crawler-tools', 'venv', 'bin', 'python')];
  return candidates.find(fs.existsSync) || null;
}

function getScraplingRuntimeStatus(python = defaultPython()) {
  if (!python) return { available: false, code: 'SCRAPLING_RUNTIME_MISSING', python: null };
  try {
    const stat = fs.statSync(python);
    if (!stat.isFile()) return { available: false, code: 'SCRAPLING_RUNTIME_INVALID', python };
    return { available: true, code: null, python: path.resolve(python) };
  } catch {
    return { available: false, code: 'SCRAPLING_RUNTIME_MISSING', python };
  }
}

function rejectInvalidInput(profile, html, url) {
  if (!PROFILES.has(profile)) throw new ScraplingBridgeError(`Unknown Scrapling profile: ${profile}`, 'SCRAPLING_UNKNOWN_PROFILE');
  if (typeof html !== 'string' || !html.trim()) throw new ScraplingBridgeError('Scrapling input HTML is empty', 'SCRAPLING_EMPTY_INPUT', { haltScraper: true });
  if (Buffer.byteLength(html) > MAX_INPUT_BYTES) throw new ScraplingBridgeError('Scrapling input exceeds 4 MB', 'SCRAPLING_INPUT_TOO_LARGE');
  const challenge = findBotChallengeSignature(html);
  if (challenge) throw new ScraplingBridgeError(`Upstream bot challenge detected before parsing (${challenge})`, 'UPSTREAM_BOT_CHALLENGE', { haltScraper: true });
  let parsed;
  try { parsed = new URL(url); } catch { throw new ScraplingBridgeError('Scrapling source URL is invalid', 'SCRAPLING_INVALID_URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new ScraplingBridgeError('Scrapling source URL must be credential-free HTTPS', 'SCRAPLING_INVALID_URL');
  if (isPrivateOrLocalHost(parsed.hostname)) throw new ScraplingBridgeError('Scrapling source URL must not target private or loopback addresses', 'SCRAPLING_INVALID_URL');
}

function validResponse(result, profile, url, expectedHash) {
  if (!result || result.version !== 1 || result.profile !== profile || result.sourceUrl !== url || result.engine !== 'scrapling' || result.engineVersion !== '0.4.15' || result.contentSha256 !== expectedHash) return false;
  if (profile === 'gsa-index') return Array.isArray(result.items) && result.items.every(item => item && /^\d+$/.test(item.propertyId) && typeof item.url === 'string' && (() => { try { const u=new URL(item.url); return u.protocol==='https:'&&!u.username&&!u.password; } catch { return false; } })() && (item.currentBid === null || (Number.isSafeInteger(item.currentBid) && item.currentBid >= 0)));
  if (profile === 'gsa-detail') return result.property && typeof result.property === 'object' && !Array.isArray(result.property) && ['address','city','state','zipcode'].every(key => result.property[key] === null || typeof result.property[key] === 'string');
  if (profile === 'table-extract') return Array.isArray(result.headers) && result.headers.every(h => typeof h === 'string') && Array.isArray(result.rows) && result.rows.every(row => Array.isArray(row) && row.every(cell => typeof cell === 'string'));
  return Array.isArray(result.links) && result.links.every(link => link && typeof link.href === 'string' && (link.text === null || typeof link.text === 'string') && typeof link.document === 'boolean' && (() => { try { const u=new URL(link.href); return u.protocol==='https:'&&!u.username&&!u.password; } catch { return false; } })());
}

function validateScriptPath(scriptPath) {
  if (!scriptPath || typeof scriptPath !== 'string') throw new ScraplingBridgeError('Scrapling script path is missing', 'SCRAPLING_SCRIPT_NOT_FOUND');
  const resolved = path.resolve(scriptPath);
  // Prevent path traversal: reject paths containing '..' segments after resolution
  // and paths that escape their original base directory.
  if (scriptPath.includes('..')) throw new ScraplingBridgeError('Scrapling script path must not contain path traversal sequences', 'SCRAPLING_SCRIPT_NOT_FOUND');
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new ScraplingBridgeError('Scrapling script path is not a regular file', 'SCRAPLING_SCRIPT_NOT_FOUND');
  } catch (err) {
    if (err instanceof ScraplingBridgeError) throw err;
    throw new ScraplingBridgeError('Scrapling script not found', 'SCRAPLING_SCRIPT_NOT_FOUND');
  }
  return resolved;
}

async function extractWithScrapling(profile, { html, url, signal, timeoutMs = DEFAULT_TIMEOUT_MS, python = defaultPython(), scriptPath } = {}) {
  rejectInvalidInput(profile, html, url);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) throw new ScraplingBridgeError('Scrapling timeout must be between 1 and 5000 ms', 'SCRAPLING_INVALID_TIMEOUT');
  const runtime = getScraplingRuntimeStatus(python);
  if (!runtime.available) return Promise.reject(new ScraplingBridgeError('Scrapling Python runtime was not found or is not a regular file', runtime.code));
  python = runtime.python;
  const script = validateScriptPath(scriptPath || path.resolve(__dirname, '..', '..', 'scripts', 'crawlers', 'scrapling_extract.py'));
  const request = JSON.stringify({ version: 1, profile, url, html });

  return new Promise((resolve, reject) => {
    let settled = false, stdoutBytes = 0, stderrBytes = 0;
    const stdout = [], stderr = [];
    const childEnv = Object.fromEntries(['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP'].filter(key => process.env[key] !== undefined).map(key => [key,process.env[key]]));
    childEnv.PYTHONIOENCODING = 'utf-8'; childEnv.PYTHONUTF8 = '1';
    const child = spawn(python, [script], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const kill = () => { if (!child.killed) child.kill('SIGKILL'); };
    const abort = () => { kill(); finish(new ScraplingBridgeError('Scrapling extraction aborted', 'SCRAPLING_ABORTED')); };
    const timer = setTimeout(() => { kill(); finish(new ScraplingBridgeError('Scrapling extraction timed out', 'SCRAPLING_TIMEOUT')); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();

    child.once('error', error => finish(new ScraplingBridgeError(`Unable to start Scrapling parser: ${error.message}`, 'SCRAPLING_SPAWN_FAILED')));
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) { kill(); finish(new ScraplingBridgeError('Scrapling output exceeds 2 MB', 'SCRAPLING_OUTPUT_TOO_LARGE')); return; }
      stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 64 * 1024) stderr.push(chunk);
    });
    child.once('close', code => {
      if (settled) return;
      if (code !== 0) return finish(new ScraplingBridgeError(`Scrapling parser failed with exit code ${code}`, 'SCRAPLING_PROCESS_FAILED'));
      let result;
      try { result = JSON.parse(Buffer.concat(stdout).toString('utf8')); }
      catch { return finish(new ScraplingBridgeError('Scrapling parser returned malformed JSON', 'SCRAPLING_PROTOCOL_ERROR')); }
      const expectedHash = crypto.createHash('sha256').update(html, 'utf8').digest('hex');
      if (!validResponse(result, profile, url, expectedHash)) {
        return finish(new ScraplingBridgeError('Scrapling parser returned an invalid protocol response', 'SCRAPLING_PROTOCOL_ERROR'));
      }
      finish(null, result);
    });
    child.stdin.once('error', () => { kill(); finish(new ScraplingBridgeError('Unable to send HTML to Scrapling parser', 'SCRAPLING_STDIN_FAILED')); });
    child.stdin.end(request);
  });
}

module.exports = { extractWithScrapling, isScraplingEnabled, ScraplingBridgeError, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, PROFILES, isPrivateOrLocalHost, defaultPython, getScraplingRuntimeStatus };
