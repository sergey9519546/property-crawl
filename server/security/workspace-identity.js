'use strict';

const crypto = require('crypto');
const { presentedRunToken, tokensMatch } = require('../routes/scrapers');

function resolveCredential(env = process.env) {
  const { resolveOperatorToken } = require('./operator-token');
  return resolveOperatorToken(env);
}

/** True when the request presents the configured operator credential. */
function isWorkspaceAuthorized(req, env = process.env) {
  const credential = resolveCredential(env);
  return Boolean(credential) && tokensMatch(presentedRunToken(req), credential);
}

// One private operator workspace today. Identity comes from server configuration,
// never from x-user-id, query parameters, or an untrusted request body.
function requireWorkspaceIdentity(req, res, env = process.env) {
  const credential = resolveCredential(env);
  if (!credential) {
    res.status(503).json({ error: 'Private workspace access is not configured' });
    return null;
  }
  if (!tokensMatch(presentedRunToken(req), credential)) {
    res.status(401).json({ error: 'Unlock the private workspace to continue' });
    return null;
  }
  return `workspace:${String(env.PROPERTY_WORKSPACE_ID || 'operator').slice(0, 100)}`;
}

function watchlistDeviceIdFromCookie(req) {
  const header = String(req.headers && req.headers.cookie ? req.headers.cookie : '');
  const match = header.match(/(?:^|;\s*)pp_watchlist=([A-Za-z0-9_-]{16,128})/);
  return match ? match[1] : null;
}

// Watchlist identity is device-scoped by default (an HttpOnly cookie issued by
// the server, never a client-supplied id) and workspace-scoped when the operator
// is unlocked. A presented-but-invalid operator token always fails closed.
function resolveWatchlistIdentity(req, res, env = process.env) {
  const credential = resolveCredential(env);
  const presented = presentedRunToken(req);
  if (credential && presented) {
    if (!tokensMatch(presented, credential)) {
      res.status(401).json({ error: 'Unlock the private workspace to continue' });
      return null;
    }
    return `workspace:${String(env.PROPERTY_WORKSPACE_ID || 'operator').slice(0, 100)}`;
  }
  const existing = watchlistDeviceIdFromCookie(req);
  if (existing) return `device:${existing}`;
  const id = `dev_${crypto.randomBytes(24).toString('base64url')}`;
  res.setHeader('Set-Cookie', `pp_watchlist=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  return `device:${id}`;
}

requireWorkspaceIdentity.isAuthorized = isWorkspaceAuthorized;

module.exports = {
  requireWorkspaceIdentity,
  isWorkspaceAuthorized,
  resolveWatchlistIdentity,
  watchlistDeviceIdFromCookie,
};
