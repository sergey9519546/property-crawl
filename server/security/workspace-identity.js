'use strict';

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

requireWorkspaceIdentity.isAuthorized = isWorkspaceAuthorized;

module.exports = { requireWorkspaceIdentity, isWorkspaceAuthorized };
