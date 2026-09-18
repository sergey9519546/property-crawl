// server/routes/enrichment.js
//
// HTTP surface for the P3-3 enrichment gateway:
//   GET  /api/enrichment/:parcelKey
//        Read-only aggregate view: every listing that shares the parcelKey,
//        annotated with cross-source matches, bake-off, and per-source
//        confidence ranking.
//   POST /api/enrichment/:parcelKey/refresh
//        Re-runs the registered enrichment scrapers, persists new evidence,
//        and returns the updated aggregate view. Body: optional
//        { sources: ['courtlistener', ...] } to scope the refresh.
//   GET  /api/enrichment
//        Lists the registered enrichment adapters (no auth required, no
//        side effects). Useful for operator dashboards.
//
// Auth: GET is public; POST requires SCRAPER_ADMIN_TOKEN because the refresh
// triggers outbound requests to live enrichment adapters.

const { presentedRunToken, tokensMatch } = require('./scrapers');
const {
  aggregateByParcelKey,
  refreshByParcelKey,
  ENRICHMENT_SCRAPERS,
  validateParcelKey
} = require('../intelligence/enrichment-gateway');

function createEnrichmentHandler(dependencies = {}) {
  const database = dependencies.database || require('../db/client');
  const env = dependencies.env || process.env;

  return async function handleEnrichment(req, res) {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET' && url.pathname === '/api/enrichment') {
      return res.json({
        adapters: ENRICHMENT_SCRAPERS.map((entry) => ({ source: entry.source })),
        schema: 'property-crawl.enrichment-gateway/v1'
      });
    }

    const match = url.pathname.match(/^\/api\/enrichment\/([^/]+)(?:\/(refresh))?$/);
    if (!match) return undefined; // not for us; let the next handler try.
    const parcelKeyRaw = decodeURIComponent(match[1]);
    const isRefresh = match[2] === 'refresh' && req.method === 'POST';

    let parcelKey;
    try { parcelKey = validateParcelKey(parcelKeyRaw); }
    catch (error) { return res.status(400).json({ error: error.message, provenance: 'enrichment-gateway' }); }

    try {
      if (isRefresh) {
        const { resolveOperatorToken } = require('../security/operator-token');
        const configuredToken = resolveOperatorToken(env);
        if (!configuredToken) return res.status(503).json({ error: 'Enrichment refresh needs SCRAPER_ADMIN_TOKEN on the API server. Read-only view remains available.' });
        if (!tokensMatch(presentedRunToken(req), configuredToken)) return res.status(401).json({ error: 'Enrichment operator credential required' });
        const body = req.body || {};
        const requestedSources = Array.isArray(body.sources) ? body.sources.map((s) => String(s).toLowerCase()) : null;
        const scrapers = requestedSources
          ? ENRICHMENT_SCRAPERS.filter((entry) => requestedSources.includes(entry.source))
          : ENRICHMENT_SCRAPERS;
        if (requestedSources && !scrapers.length) {
          return res.status(400).json({ error: 'No enrichment adapters matched the requested sources', requested: requestedSources });
        }
        const refresh = await refreshByParcelKey(parcelKey, { database, scrapers, env });
        return res.json(refresh);
      }
      if (req.method === 'GET') {
        const view = await aggregateByParcelKey(parcelKey, { database });
        if (!view.found) return res.status(404).json({ error: 'No listings share this parcelKey', parcelKey, view });
        return res.json(view);
      }
      return res.status(405).json({ error: 'Method not allowed on this enrichment endpoint' });
    } catch (error) {
      console.error('[Enrichment Gateway]', error.message);
      return res.status(503).json({ error: 'Enrichment gateway could not complete the request', reason: error.message });
    }
  };
}

module.exports = createEnrichmentHandler;
module.exports.createEnrichmentHandler = createEnrichmentHandler;
