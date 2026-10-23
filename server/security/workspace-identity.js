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

// A paid member's account id. The Next app verifies the member session and
// entitlement, then forwards it with the operator token; without that token
// the header is never trusted.
const ACCOUNT_HEADER = /^acct_[a-f0-9]{24}$/;
function memberAccountId(req) {
  const value = req.headers && req.headers['x-pp-account'];
  return typeof value === 'string' && ACCOUNT_HEADER.test(value) ? value : null;
}

// Operator-only surfaces. Identity comes from server configuration, never from
// x-user-id, query parameters, or an untrusted request body. A member-scoped
// request is refused so the shared operator token cannot widen a member's reach.
function requireWorkspaceIdentity(req, res, env = process.env) {
  if (req.headers && req.headers['x-pp-account']) {
    res.status(403).json({ error: 'This workspace tool is for the operator account only' });
    return null;
  }
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
    const account = memberAccountId(req);
    return account ? `account:${account}` : `workspace:${String(env.PROPERTY_WORKSPACE_ID || 'operator').slice(0, 100)}`;
  }
  const existing = watchlistDeviceIdFromCookie(req);
  if (existing) return `device:${existing}`;
  const id = `dev_${crypto.randomBytes(24).toString('base64url')}`;
  res.setHeader('Set-Cookie', `pp_watchlist=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  return `device:${id}`;
}

// Per-user surfaces (saved searches, portfolio, price drops): the operator
// workspace, or the paid member the Next app forwarded.
function requireUserIdentity(req, res, env = process.env) {
  const account = memberAccountId(req);
  if (req.headers && req.headers['x-pp-account'] && !account) {
    res.status(400).json({ error: 'Invalid member account' });
    return null;
  }
  const credential = resolveCredential(env);
  if (!credential) {
    res.status(503).json({ error: 'Private workspace access is not configured' });
    return null;
  }
  if (!tokensMatch(presentedRunToken(req), credential)) {
    res.status(401).json({ error: 'Sign in to continue' });
    return null;
  }
  return account ? `account:${account}` : `workspace:${String(env.PROPERTY_WORKSPACE_ID || 'operator').slice(0, 100)}`;
}

requireWorkspaceIdentity.isAuthorized = isWorkspaceAuthorized;

module.exports = {
  memberAccountId,
  requireUserIdentity,
  requireWorkspaceIdentity,
  isWorkspaceAuthorized,
  resolveWatchlistIdentity,
  watchlistDeviceIdFromCookie,
};
