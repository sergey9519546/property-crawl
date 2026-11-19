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
  // Hash both sides so length differences cannot early-return before
  // timingSafeEqual (same approach as workspace-session.ts).
  const left = crypto.createHash('sha256').update(String(presented)).digest();
  const right = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(left, right);
}

function createScrapersHandler(dependencies = {}) {
  const repairFn = dependencies.repairLiveEnrichment || ((opts) => require('../enrichment/repair-live-enrichment').repairLiveEnrichment(opts));
  const env = dependencies.env || process.env;
  const activeScheduler = dependencies.scheduler || scheduler;
  const activeTelemetry = dependencies.telemetry || telemetryInstance;

  return async function handleScrapers(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const method = req.method;

    if (method === 'GET' && (url.pathname === '/api/scrapers/health' || url.pathname === '/api/scrapers')) {
      const report = activeTelemetry.getHealthReport();
      return res.json(report);
    }

    if (method === 'POST' && (url.pathname === '/api/scrapers/run' || url.pathname === '/api/scrapers')) {
      const { resolveOperatorToken } = require('../security/operator-token');
      const configuredToken = resolveOperatorToken(env);
      if (!configuredToken) {
        return res.status(503).json({
          error: 'On-demand scraper execution is disabled',
          requiredConfiguration: 'SCRAPER_ADMIN_TOKEN'
        });
      }
      if (!tokensMatch(presentedRunToken(req), configuredToken)) {
        return res.status(401).json({ error: 'Unauthorized scraper run request' });
      }

      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const action = String(body.action || url.searchParams.get('action') || '').trim();
      if (action === 'repair-enrichment') {
        try {
          const rawNjLimit = body.njLimit ?? url.searchParams.get('njLimit');
          const rawGeocodeLimit = body.geocodeLimit ?? url.searchParams.get('geocodeLimit');
          const rawMaxDurationMs = body.maxDurationMs ?? url.searchParams.get('maxDurationMs');
          const njLimit = rawNjLimit != null && rawNjLimit !== '' ? Number(rawNjLimit) : NaN;
          const geocodeLimit = rawGeocodeLimit != null && rawGeocodeLimit !== '' ? Number(rawGeocodeLimit) : NaN;
          const maxDurationMs = rawMaxDurationMs != null && rawMaxDurationMs !== '' ? Number(rawMaxDurationMs) : NaN;
          const dryRun = body.dryRun === true || url.searchParams.get('dryRun') === 'true';
          const repairReport = await repairFn({
            ...(Number.isFinite(njLimit) && njLimit > 0 ? { njLimit } : {}),
            ...(Number.isFinite(geocodeLimit) && geocodeLimit > 0 ? { geocodeLimit } : {}),
            ...(Number.isFinite(maxDurationMs) && maxDurationMs >= 0 ? { maxDurationMs } : {}),
            dryRun,
          });
          return res.json({ status: 'completed', action: 'repair-enrichment', report: repairReport });
        } catch (err) {
          return res.status(err?.status || 500).json({ error: err?.message || 'Live enrichment repair failed' });
        }
      }

      const querySources = url.searchParams.get('sources') || url.searchParams.get('sourceIds') || url.searchParams.get('sourceId');
      const sourceIds = (Array.isArray(body.sourceIds) && body.sourceIds.length > 0)
        ? body.sourceIds
        : (body.sourceId ? [body.sourceId] : (querySources ? querySources.split(',').map(s => s.trim()).filter(Boolean) : undefined));
      const wave = body.wave || url.searchParams.get('wave') || undefined;
      const allowNetwork = body.allowNetwork !== undefined
        ? Boolean(body.allowNetwork)
        : (url.searchParams.get('allowNetwork') !== null ? url.searchParams.get('allowNetwork') === 'true' : undefined);
      const trigger = body.trigger || url.searchParams.get('trigger') || 'api_on_demand';
      const rawTimeoutMs = body.timeoutMs ?? url.searchParams.get('timeoutMs');
      const parsedTimeoutMs = rawTimeoutMs != null && rawTimeoutMs !== '' ? Number(rawTimeoutMs) : NaN;
      const scraperTimeoutMs = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0
        ? Math.min(Math.floor(parsedTimeoutMs), 120_000)
        : undefined;

      const runOptions = {
        ...(sourceIds ? { sourceIds } : {}),
        ...(wave ? { wave } : {}),
        ...(allowNetwork !== undefined ? { allowNetwork } : {}),
        ...(scraperTimeoutMs !== undefined ? { scraperTimeoutMs } : {}),
        trigger
      };

      const hasExplicitOptions = Boolean(sourceIds || wave || allowNetwork !== undefined || scraperTimeoutMs !== undefined);
      let runPromise;
      try {
        if (hasExplicitOptions && typeof activeScheduler.validateRunOptions === 'function') activeScheduler.validateRunOptions(runOptions);
        runPromise = hasExplicitOptions ? activeScheduler.runAll(runOptions) : activeScheduler.runAll();
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      // If client requested non-blocking trigger
      if (req.headers && req.headers['x-async'] === 'true') {
        runPromise.catch(err => console.error('[Scrapers Route] Async run error:', err));
        return res.json({ status: 'triggered', message: 'Ingestion cycle running in background', options: runOptions });
      }

      try {
        const result = await runPromise;
        return res.json({ status: 'completed', result });
      } catch (err) {
        const status = err.message === 'Choose registered live source collectors' ? 400 : 500;
        return res.status(status).json({ error: err.message });
      }
    }

    res.status(404).json({ error: 'Scraper endpoint not found' });
  };
}

const handleScrapers = createScrapersHandler();
module.exports = handleScrapers;
module.exports.createScrapersHandler = createScrapersHandler;
module.exports.presentedRunToken = presentedRunToken;
module.exports.tokensMatch = tokensMatch;
