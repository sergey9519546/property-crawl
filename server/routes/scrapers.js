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

      if (action === 'prune') {
        const database = resolveDatabase();
        if (!database || !database.isPg || !database.pool) {
          return res.status(503).json({ error: 'Prune requires an active PostgreSQL database connection' });
        }
        try {
          const { classifyListing } = require('../db/listing-lifecycle');
          const limit = Math.min(5000, Math.max(1, Number(body.limit ?? url.searchParams.get('limit')) || 5000));
          const { rows } = await database.pool.query(
            `SELECT id, source_key, lifecycle_status, status, sale_date, source_observed_at, raw_notice FROM listings`
          );
          const now = Date.now();
          const concludedIds = [];
          for (const row of rows) {
            if (classifyListing(row, now).concluded) {
              concludedIds.push(row.id);
              if (concludedIds.length >= limit) break;
            }
          }
          let concludedDeleted = 0;
          if (concludedIds.length > 0) {
            const client = await database.pool.connect();
            try {
              await client.query('BEGIN');
              for (let i = 0; i < concludedIds.length; i += 500) {
                const batch = concludedIds.slice(i, i + 500);
                const delRes = await client.query('DELETE FROM listings WHERE id = ANY($1::text[])', [batch]);
                concludedDeleted += delRes.rowCount || 0;
              }
              await client.query('COMMIT');
            } catch (txErr) {
              try { await client.query('ROLLBACK'); } catch (_) {}
              throw txErr;
            } finally {
              client.release();
            }
          }
          const stalePurged = typeof database.purgeStaleListings === 'function'
            ? await database.purgeStaleListings()
            : { deleted: 0, observationsDeleted: 0 };
          const countRes = await database.pool.query('SELECT count(*)::int AS n FROM listings');
          const remainingTotal = Number(countRes.rows[0]?.n || 0);
          return res.json({
            status: 'completed',
            action: 'prune',
            report: { scanned: rows.length, concludedDeleted, stalePurged, remainingTotal },
          });
        } catch (err) {
          return res.status(err?.status || 500).json({ error: err?.message || 'Prune operation failed' });
        }
      }

      if (action === 'next-slice') {
        const SLICE_PRIORITY = ['servicelink', 'hud', 'sheriff', 'civilview', 'gsa', 'usda', 'treasury', 'irs'];
        const database = resolveDatabase();
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
              'SELECT source_key, cursor FROM discovery_checkpoints WHERE source_key = ANY($1::text[])',
              [SLICE_PRIORITY]
            );
            const activeCheckpoints = new Map();
            for (const row of cpRes.rows || []) {
              const cur = row.cursor;
              const hasActive = typeof cur === 'string'
                ? cur.trim() !== ''
                : Boolean(cur && typeof cur === 'object' && (
                    (typeof cur.continuationToken === 'string' && cur.continuationToken.trim() !== '') ||
                    (typeof cur.nextCursor === 'string' && cur.nextCursor.trim() !== '') ||
                    (Array.isArray(cur.completedStates) && Object.keys(cur).length > 0)
                  ));
              if (hasActive) activeCheckpoints.set(row.source_key, cur);
            }
            const resumed = SLICE_PRIORITY.find((key) => activeCheckpoints.has(key));
            if (resumed) {
              chosenSource = resumed;
              reason = 'active_continuation_cursor';
            } else {
              const obsRes = await database.pool.query(
                'SELECT source_key, MAX(source_observed_at) AS latest_at FROM listings WHERE source_key = ANY($1::text[]) GROUP BY source_key',
                [SLICE_PRIORITY]
              );
              const latestBySource = new Map((obsRes.rows || []).map((r) => [r.source_key, r.latest_at ? Date.parse(r.latest_at) : 0]));
              const missing = SLICE_PRIORITY.find((key) => !latestBySource.has(key));
              if (missing) {
                chosenSource = missing;
                reason = 'missing_from_inventory';
              } else {
                chosenSource = SLICE_PRIORITY.reduce((oldest, key) => {
                  const oldestMs = latestBySource.get(oldest) ?? Infinity;
                  const candidateMs = latestBySource.get(key) ?? Infinity;
                  return candidateMs < oldestMs ? key : oldest;
                }, SLICE_PRIORITY[0]);
                reason = 'oldest_observation';
              }
            }
          } catch (_) {
            chosenSource = SLICE_PRIORITY[0];
            reason = 'fallback_priority';
          }
        }
        try {
          const sliceTimeoutRaw = Number(body.timeoutMs ?? url.searchParams.get('timeoutMs'));
          const scraperTimeoutMs = Number.isFinite(sliceTimeoutRaw) && sliceTimeoutRaw > 0
            ? Math.min(Math.floor(sliceTimeoutRaw), 120_000)
            : 26_000;
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
