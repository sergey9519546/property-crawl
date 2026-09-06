'use strict';

const { presentedRunToken, tokensMatch } = require('../routes/scrapers');

// One private operator workspace today. Identity comes from server configuration,
// never from x-user-id, query parameters, or an untrusted request body.
function requireWorkspaceIdentity(req, res, env = process.env) {
  const credential = String(env.SCRAPER_ADMIN_TOKEN || '').trim();
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

module.exports = { requireWorkspaceIdentity };
