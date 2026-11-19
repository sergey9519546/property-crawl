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
  const resolveDatabase = () => dependencies.database || activeScheduler?.database || require('../db/client');

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

      if (action === 'migrate') {
        const database = resolveDatabase();
        if (!database || !database.isPg || !database.pool) {
          return res.status(503).json({ error: 'Migrate requires an active PostgreSQL database connection' });
        }
        let directPool = null;
        try {
          const { migrate, openConfiguredPool } = require('../../scripts/discovery-migrate');
          const targetPool = process.env.DATABASE_DIRECT_URL
            ? (directPool = await openConfiguredPool(process.env))
            : database.pool;
          await migrate(targetPool, { statementTimeoutMs: 45_000 });
          const migRes = await targetPool.query(
            'SELECT name, applied_at FROM discovery_schema_migrations ORDER BY name DESC LIMIT 5'
          );
          const countRes = await targetPool.query('SELECT count(*)::int AS n FROM discovery_schema_migrations');
          return res.json({
            status: 'completed',
            action: 'migrate',
            report: {
              appliedCount: Number(countRes.rows[0]?.n || 0),
              latest: migRes.rows || [],
            },
          });
        } catch (err) {
          return res.status(err?.status || 500).json({ error: err?.message || 'Migrate operation failed' });
        } finally {
          if (directPool) await directPool.end().catch(() => {});
        }
      }

      if (action === 'prune') {
        const database = resolveDatabase();
        if (!database || !database.isPg || !database.pool) {
          return res.status(503).json({ error: 'Prune requires an active PostgreSQL database connection' });
        }
        try {
          const limit = Math.min(5000, Math.max(1, Number(body.limit ?? url.searchParams.get('limit')) || 5000));
          let concludedDeleted = 0;
          const delRes = await database.pool.query(
            `DELETE FROM listings
              WHERE id IN (
                SELECT id FROM listings
                 WHERE discovery_terminal IS TRUE
                    OR LOWER(COALESCE(lifecycle_status, '')) IN ('sold', 'closed', 'ended', 'completed', 'cancelled', 'retired', 'withdrawn')
                    OR LOWER(COALESCE(status, '')) IN ('sold', 'closed', 'ended', 'completed', 'cancelled', 'retired', 'withdrawn')
                 LIMIT $1
              )`,
            [limit],
          );
          concludedDeleted = delRes.rowCount || 0;
          const stalePurged = typeof database.purgeStaleListings === 'function'
            ? await database.purgeStaleListings()
            : { deleted: 0, observationsDeleted: 0 };
          const crossDedupe = typeof database.reconcileCrossSourceDuplicates === 'function'
            ? await database.reconcileCrossSourceDuplicates().catch(() => ({ superseded: 0, cleared: 0 }))
            : null;
          const mvRefreshed = typeof database.refreshNeighborhoodStatsMaterializedView === 'function'
            ? await database.refreshNeighborhoodStatsMaterializedView({ concurrent: true }).catch(() => false)
            : false;
          const countRes = await database.pool.query('SELECT count(*)::int AS n FROM listings');
          const remainingTotal = Number(countRes.rows[0]?.n || 0);
          return res.json({
            status: 'completed',
            action: 'prune',
            report: { concludedDeleted, stalePurged, crossDedupe, mvRefreshed, remainingTotal },
          });
        } catch (err) {
          return res.status(err?.status || 500).json({ error: err?.message || 'Prune operation failed' });
        }
      }

      if (action === 'next-slice') {
        const SLICE_PRIORITY = ['servicelink', 'hud', 'sheriff', 'civilview', 'gsa', 'usda', 'treasury', 'irs'];
        const database = resolveDatabase();
        const sliceLastRunAt = createScrapersHandler._sliceLastRunAt || (createScrapersHandler._sliceLastRunAt = new Map());
        let chosenSource = SLICE_PRIORITY[0];
        let reason = 'default_priority';
        const explicitReqSources = Array.isArray(body.sources) && body.sources.length > 0
          ? body.sources
          : (Array.isArray(body.sourceIds) && body.sourceIds.length > 0 ? body.sourceIds : (body.sourceId ? [body.sourceId] : null));
        if (explicitReqSources && explicitReqSources[0]) {
          chosenSource = String(explicitReqSources[0]).trim();
          reason = 'explicit_override';
        } else if (database?.isPg && database?.pool) {
          try {
            const cpRes = await database.pool.query(
              'SELECT source_key, cursor, updated_at FROM discovery_checkpoints WHERE source_key = ANY($1::text[])',
              [SLICE_PRIORITY]
            );
            const activeCheckpoints = new Map();
            const cpUpdatedBySource = new Map();
            const isNonZeroToken = (val) => typeof val === 'string' && val.trim() !== '' && val.trim() !== '0';
            for (const row of cpRes.rows || []) {
              const cur = row.cursor;
              if (row.updated_at) cpUpdatedBySource.set(row.source_key, Date.parse(row.updated_at) || 0);
              const hasActive = typeof cur === 'string'
                ? isNonZeroToken(cur)
                : Boolean(cur && typeof cur === 'object' && (
                    isNonZeroToken(cur.continuationToken) ||
                    isNonZeroToken(cur.nextCursor) ||
                    (Array.isArray(cur.completedStates) && cur.completedStates.length > 0)
                  ));
              if (hasActive) activeCheckpoints.set(row.source_key, cur);
            }
            const obsRes = await database.pool.query(
              'SELECT source_key, MAX(source_observed_at) AS latest_at FROM listings WHERE source_key = ANY($1::text[]) GROUP BY source_key',
              [SLICE_PRIORITY]
            );
            const latestBySource = new Map((obsRes.rows || []).map((r) => [r.source_key, r.latest_at ? Date.parse(r.latest_at) : 0]));
            const resumed = SLICE_PRIORITY.find((key) => activeCheckpoints.has(key));
            const activityMs = (key) => Math.max(latestBySource.get(key) || 0, cpUpdatedBySource.get(key) || 0, sliceLastRunAt.get(key) || 0);
            const starving = latestBySource.size > 0
              ? SLICE_PRIORITY.reduce((oldest, key) => (activityMs(key) < activityMs(oldest) ? key : oldest), SLICE_PRIORITY[0])
              : null;
            if (resumed && (!starving || (activityMs(resumed) - activityMs(starving)) <= 15 * 60_000)) {
              chosenSource = resumed;
              reason = 'active_continuation_cursor';
            } else {
              const missing = SLICE_PRIORITY.find((key) => !latestBySource.has(key) && !activeCheckpoints.has(key));
              if (missing && latestBySource.size > 0) {
                chosenSource = missing;
                reason = 'missing_from_inventory';
              } else {
                chosenSource = starving || SLICE_PRIORITY.reduce((oldest, key) => (activityMs(key) < activityMs(oldest) ? key : oldest), SLICE_PRIORITY[0]);
                reason = 'oldest_observation';
              }
            }
          } catch (_) {
            chosenSource = SLICE_PRIORITY[0];
            reason = 'fallback_priority';
          }
        }
        try {
          sliceLastRunAt.set(chosenSource, Date.now());
          const sliceTimeoutRaw = Number(body.timeoutMs ?? url.searchParams.get('timeoutMs'));
          const scraperTimeoutMs = Number.isFinite(sliceTimeoutRaw) && sliceTimeoutRaw > 0
            ? Math.min(Math.floor(sliceTimeoutRaw), 120_000)
            : 15_000;
          const result = await activeScheduler.runAll({
            sourceIds: [chosenSource],
            slice: true,
            scraperTimeoutMs,
            enableAssessorHarvest: false,
            enableAssessorBackfill: false,
            trigger: 'cron_next_slice',
          });
          return res.json({ status: 'completed', action: 'next-slice', source: chosenSource, reason, result });
        } catch (err) {
          return res.status(err?.status || 500).json({ error: err?.message || 'Next-slice run failed' });
        }
      }

      const querySources = url.searchParams.get('sources') || url.searchParams.get('sourceIds') || url.searchParams.get('sourceId');
      const sourceIds = (Array.isArray(body.sources) && body.sources.length > 0)
        ? body.sources
        : ((Array.isArray(body.sourceIds) && body.sourceIds.length > 0)
            ? body.sourceIds
            : (body.sourceId ? [body.sourceId] : (querySources ? querySources.split(',').map(s => s.trim()).filter(Boolean) : undefined)));
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

      const isSlice = body.slice === true || url.searchParams.get('slice') === 'true';
      const runOptions = {
        ...(sourceIds ? { sourceIds } : {}),
        ...(wave ? { wave } : {}),
        ...(allowNetwork !== undefined ? { allowNetwork } : {}),
        ...(scraperTimeoutMs !== undefined ? { scraperTimeoutMs } : {}),
        ...(isSlice ? { slice: true } : {}),
        trigger
      };

      const hasExplicitOptions = Boolean(sourceIds || wave || allowNetwork !== undefined || scraperTimeoutMs !== undefined || isSlice);
      let runPromise;
      try {
        if (hasExplicitOptions && typeof activeScheduler.validateRunOptions === 'function') activeScheduler.validateRunOptions(runOptions);
        runPromise = hasExplicitOptions ? activeScheduler.runAll(runOptions) : activeScheduler.runAll();
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      // If client requested non-blocking trigger
      if (req.headers && req.headers['x-async'] === 'true' && !(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SERVERLESS)) {
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
