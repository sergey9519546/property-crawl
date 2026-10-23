'use strict';

// Account API for the Next app only: every call needs the operator token, and
// a member-scoped request (x-pp-account) is refused here.

const db = require('../db/client');
const { presentedRunToken, tokensMatch } = require('./scrapers');
const { AccountError, accountServiceFor } = require('../accounts/store');

function createAccountsHandler(dependencies = {}) {
  const env = dependencies.env || process.env;
  const service = () => dependencies.service || accountServiceFor(dependencies.database || db);

  return async function handleAccounts(req, res, urlInput) {
    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    const { resolveOperatorToken } = require('../security/operator-token');
    const token = resolveOperatorToken(env);
    if (!token) return res.status(503).json({ error: 'Accounts need SCRAPER_ADMIN_TOKEN on the API server.' });
    if (!tokensMatch(presentedRunToken(req), token) || req.headers['x-pp-account']) {
      return res.status(401).json({ error: 'Operator credential required' });
    }
    const body = req.body || {};
    try {
      const accounts = service();
      if (req.method === 'POST' && url.pathname === '/api/accounts/login-token') {
        return res.status(201).json(await accounts.issueLoginToken(body.email));
      }
      if (req.method === 'POST' && url.pathname === '/api/accounts/consume') {
        return res.json({ account: await accounts.consumeLoginToken(body.token) });
      }
      if (req.method === 'POST' && url.pathname === '/api/accounts/subscription') {
        return res.json({ account: await accounts.applySubscription(body) });
      }
      const match = url.pathname.match(/^\/api\/accounts\/(acct_[a-f0-9]{24})(\/customer)?$/);
      if (match && req.method === 'GET' && !match[2]) {
        const account = await accounts.get(match[1]);
        return account ? res.json({ account }) : res.status(404).json({ error: 'Account not found' });
      }
      if (match && req.method === 'POST' && match[2]) {
        const account = await accounts.linkCustomer(match[1], body.customerId);
        return account ? res.json({ account }) : res.status(404).json({ error: 'Account not found' });
      }
      return res.status(404).json({ error: 'Account endpoint not found' });
    } catch (error) {
      if (error instanceof AccountError) return res.status(error.status).json({ error: error.message, code: error.code });
      console.error('[Accounts] request failed:', error.message);
      return res.status(503).json({ error: 'Account store unavailable' });
    }
  };
}

const handleAccounts = createAccountsHandler();
handleAccounts.createAccountsHandler = createAccountsHandler;
module.exports = handleAccounts;
