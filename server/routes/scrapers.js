const crypto = require('crypto');
const { telemetryInstance } = require('../scrapers/telemetry');
const scheduler = require('../scrapers/scheduler');

function headerValue(headers = {}, name) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function presentedRunToken(req) {
  const direct = headerValue(req.headers, 'x-scraper-token');
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const authorization = headerValue(req.headers, 'authorization');
  const match = typeof authorization === 'string'
    ? authorization.match(/^Bearer\s+(.+)$/i)
    : null;
  return match ? match[1].trim() : '';
}

function tokensMatch(presented, expected) {
  if (!presented || !expected) return false;
  const left = Buffer.from(String(presented));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function handleScrapers(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;

  if (method === 'GET' && (url.pathname === '/api/scrapers/health' || url.pathname === '/api/scrapers')) {
    const report = telemetryInstance.getHealthReport();
    return res.json(report);
  }

  if (method === 'POST' && (url.pathname === '/api/scrapers/run' || url.pathname === '/api/scrapers')) {
    const configuredToken = String(process.env.SCRAPER_ADMIN_TOKEN || '').trim();
    if (!configuredToken) {
      return res.status(503).json({
        error: 'On-demand scraper execution is disabled',
        requiredConfiguration: 'SCRAPER_ADMIN_TOKEN'
      });
    }
    if (!tokensMatch(presentedRunToken(req), configuredToken)) {
      return res.status(401).json({ error: 'Unauthorized scraper run request' });
    }

    const runPromise = scheduler.runAll();
    // If client requested non-blocking trigger
    if (req.headers && req.headers['x-async'] === 'true') {
      runPromise.catch(err => console.error('[Scrapers Route] Async run error:', err));
      return res.json({ status: 'triggered', message: 'Ingestion cycle running in background' });
    }
    const result = await runPromise;
    return res.json({ status: 'completed', result });
  }

  res.status(404).json({ error: 'Scraper endpoint not found' });
}

module.exports = handleScrapers;
module.exports.presentedRunToken = presentedRunToken;
module.exports.tokensMatch = tokensMatch;
