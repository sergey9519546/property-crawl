'use strict';

const os = require('node:os');
const path = require('node:path');

const CLIENT_IP_HEADER_RE = /^[0-9a-fA-F:.,\s]+$/;
const CLIENT_IP_TOKEN_RE = /^[0-9a-fA-F:.]+$/;
const MAX_CLIENT_IP_HEADER_LEN = 64;

/**
 * Configure writable /tmp cache paths and disable in-process cron before
 * importing server/server.js inside read-only serverless runtimes (Vercel).
 */
function configureServerlessEnv(env = process.env) {
  const isServerless = Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.SERVERLESS);
  if (!isServerless) return false;

  if (!env.SCRAPER_BACKGROUND_ENABLED) env.SCRAPER_BACKGROUND_ENABLED = '0';

  const cacheRoot = path.join(os.tmpdir(), 'property-crawl-cache');
  const defaults = {
    PROPERTY_LIVE_CACHE_PATH: path.join(cacheRoot, 'live-listings.json'),
    PROPERTY_WORKSPACE_STORE_PATH: path.join(cacheRoot, 'workspace-store.json'),
    PROPERTY_MEDIA_CACHE_PATH: path.join(cacheRoot, 'property-media.json'),
    PROPERTY_DOCUMENT_REVIEW_STORE_PATH: path.join(cacheRoot, 'document-review-store.json'),
    PROPERTY_HUNTS_PATH: path.join(cacheRoot, 'saved-hunts.json'),
    PROPERTY_RESEARCH_PATH: path.join(cacheRoot, 'research-workspaces.json'),
    PROPERTY_ACCOUNTS_PATH: path.join(cacheRoot, 'accounts.json'),
    PROPERTY_EMAIL_NOTICE_PATH: path.join(cacheRoot, 'email-notices.json'),
    PROPERTY_EVIDENCE_DIR: path.join(cacheRoot, 'discovery-snapshots'),
    PROPERTY_EVIDENCE_LEDGER_PATH: path.join(cacheRoot, 'evidence-ledger.json'),
    PROPERTY_SOURCE_INTAKE_PATH: path.join(cacheRoot, 'source-intake.json'),
    SCRAPER_TELEMETRY_PATH: path.join(cacheRoot, 'scraper-telemetry.json'),
    SERVICELINK_CHECKPOINT_PATH: path.join(cacheRoot, 'servicelink-checkpoint.json'),
    PROPERTY_VAULT_DIR: path.join(cacheRoot, 'vault'),
    PROPERTY_COLLECTION_JOBS_PATH: path.join(cacheRoot, 'collection-jobs.json'),
    ONBOARDING_CACHE_ROOT: path.join(cacheRoot, 'crawler-tools', 'onboarding'),
    ONBOARDING_CRAWL_CACHE_ROOT: path.join(cacheRoot, 'crawler-tools', 'crawls'),
    PROPERTY_EXPORT_DIR: path.join(cacheRoot, 'discovery-exports'),
    PROPERTY_MAIL_OUTBOX_DIR: path.join(cacheRoot, 'mail-outbox'),
    PROPERTY_SELECTOR_CACHE_DIR: path.join(cacheRoot, 'scrapling-selectors'),
    PROPERTY_ASSESSOR_CACHE_PATH: path.join(cacheRoot, 'assessor-roll.json'),
    PROPERTY_HAZARD_CACHE_DIR: path.join(cacheRoot, 'hazards'),
    PROPERTY_GEOCODER_CACHE_PATH: path.join(cacheRoot, 'geocoding-cache.json'),
    PROPERTY_COLLECTOR_SNAPSHOT_DIR: path.join(cacheRoot, 'collector-snapshots'),
    PROPERTY_TRIGGER_WEIGHTS_PATH: path.join(cacheRoot, 'trigger-weights.json'),
    SCRAPER_TIMEOUT_MS: '45000',
    DISCOVERY_STORAGE_PATH: os.tmpdir(),
    DISCOVERY_MIN_FREE_BYTES: String(64 * 1024 * 1024),
    PROPERTY_IMAGE_CENSUS_GEOCODER_FALLBACK: '1',
    PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK: '1',
    PROPERTY_IMAGE_GOOGLE_MAPILLARY_FALLBACK: '1',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!env[key]) env[key] = value;
  }
  return true;
}

/**
 * Propagate the validated end-user client IP from `x-pp-client-ip` into
 * `x-forwarded-for` when `TRUSTED_PROXY_COUNT > 0`, ensuring downstream
 * rate limiters (`forwarded[forwarded.length - trustedProxyCount]`) resolve
 * the original client IP even when Vercel ingress overwrites `x-forwarded-for`
 * with the single upstream proxy/egress IP.
 */
function applyForwardedClientIp(req, env = process.env) {
  const parsedProxyCount = Number(env?.TRUSTED_PROXY_COUNT);
  const trustedProxyCount = Number.isFinite(parsedProxyCount) && parsedProxyCount > 0
    ? Math.floor(parsedProxyCount)
    : 0;
  if (trustedProxyCount <= 0) return false;
  if (!req || !req.headers || typeof req.headers !== 'object') return false;

  const rawHeader = req.headers['x-pp-client-ip'];
  const raw = (Array.isArray(rawHeader) ? String(rawHeader[0] || '') : String(rawHeader || '')).trim();
  if (!raw || raw.length > MAX_CLIENT_IP_HEADER_LEN || !CLIENT_IP_HEADER_RE.test(raw)) {
    return false;
  }

  const clientIp = raw
    .split(',')
    .map((part) => part.trim())
    .find(Boolean);
  if (!clientIp || clientIp.length > MAX_CLIENT_IP_HEADER_LEN || !CLIENT_IP_TOKEN_RE.test(clientIp)) {
    return false;
  }

  const existingRaw = req.headers['x-forwarded-for'];
  const existingParts = (Array.isArray(existingRaw) ? existingRaw.join(',') : String(existingRaw || ''))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  // Preserve the rightmost (trustedProxyCount - 1) proxy hops so that
  // idx = forwarded.length - trustedProxyCount resolves directly to clientIp.
  const preservedProxyHops = trustedProxyCount > 1
    ? existingParts.slice(-(trustedProxyCount - 1))
    : [];
  req.headers['x-forwarded-for'] = [clientIp, ...preservedProxyHops].join(', ');
  return true;
}

function createServerlessDispatcher({ server, db, env } = {}) {
  let verifyPromise = null;
  const requestListener = server.listeners('request')[0];

  async function ensureDbReady() {
    if (!db || typeof db.verifyConnection !== 'function') return false;
    if (db.postgresReachable && db.isPg) return true;
    if (!verifyPromise) {
      verifyPromise = Promise.resolve()
        .then(() => db.verifyConnection())
        .then((connected) => {
          if (!connected) {
            verifyPromise = null;
          } else if (typeof server._wireStoresAfterVerify === 'function') {
            server._wireStoresAfterVerify(db);
          }
          return connected;
        })
        .catch((err) => {
          verifyPromise = null;
          throw err;
        });
    }
    return verifyPromise;
  }

  return async function handleServerlessRequest(req, res) {
    applyForwardedClientIp(req, env || process.env);
    try {
      await ensureDbReady();
    } catch (err) {
      console.warn('[Serverless] Database verification attempt failed:', err?.message || err);
    }
    if (typeof requestListener === 'function') {
      return requestListener(req, res);
    }
    server.emit('request', req, res);
  };
}

let cachedHandler = null;
function getHandler() {
  if (!cachedHandler) {
    configureServerlessEnv(process.env);
    const server = require('./server');
    const db = require('./db/client');
    cachedHandler = createServerlessDispatcher({ server, db });
  }
  return cachedHandler;
}

module.exports = async function vercelHandler(req, res) {
  return getHandler()(req, res);
};

module.exports.configureServerlessEnv = configureServerlessEnv;
module.exports.applyForwardedClientIp = applyForwardedClientIp;
module.exports.createServerlessDispatcher = createServerlessDispatcher;
