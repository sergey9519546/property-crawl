const crypto = require('crypto');
const { telemetryInstance } = require('../scrapers/telemetry');
const scheduler = require('../scrapers/scheduler');

function headerValue(headers = {}, name) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function presentedRunToken(req) {
  const adminToken = headerValue(req.headers, 'x-scraper-admin-token');
  if (typeof adminToken === 'string' && adminToken.trim()) return adminToken.trim();
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
      const baseReport = activeTelemetry.getHealthReport() || {};
      const details = { ...(baseReport.details || {}) };
      const database = resolveDatabase();
      const { resolveOperatorToken } = require('../security/operator-token');
      const configuredToken = resolveOperatorToken(env);
      const isAuthorized = Boolean(configuredToken && tokensMatch(presentedRunToken(req), configuredToken));

      const knownScrapers = Array.isArray(activeScheduler?.realScrapers)
        ? activeScheduler.realScrapers
        : (Array.isArray(activeScheduler?.scrapers) ? activeScheduler.scrapers : []);
      const nameToKey = new Map();
      const keyToName = new Map();
      for (const s of knownScrapers) {
        if (s?.sourceKey && s?.name) {
          nameToKey.set(s.name, s.sourceKey);
          keyToName.set(s.sourceKey, s.name);
        }
      }
      let catalogEntries = [];
      let listingSourceAdmissionFn = null;
      try {
        const catalog = require('../sources/catalog');
        if (Array.isArray(catalog.SOURCE_CATALOG)) {
          catalogEntries = catalog.SOURCE_CATALOG;
          for (const entry of catalogEntries) {
            const k = entry?.adapterKey || entry?.id;
            const label = entry?.name || entry?.label;
            if (k && label && !keyToName.has(k)) {
              keyToName.set(k, label);
            }
          }
        }
        if (typeof catalog.listingSourceAdmission === 'function') {
          listingSourceAdmissionFn = catalog.listingSourceAdmission;
        }
      } catch {
        // Optional catalog metadata
      }

      const blockedCatalogKeys = new Set();
      const retiredCatalogKeys = new Set();
      for (const entry of catalogEntries) {
        if (!entry) continue;
        if (entry.status === 'INCONCLUSIVE_BLOCKED') {
          if (entry.adapterKey) blockedCatalogKeys.add(String(entry.adapterKey).trim().toLowerCase());
          if (entry.id) blockedCatalogKeys.add(String(entry.id).trim().toLowerCase());
        } else if (entry.status === 'RETIRED') {
          if (entry.adapterKey) retiredCatalogKeys.add(String(entry.adapterKey).trim().toLowerCase());
          if (entry.id) retiredCatalogKeys.add(String(entry.id).trim().toLowerCase());
        }
      }

      const classifyDisposition = (sourceKey) => {
        const normKey = String(sourceKey || '').trim().toLowerCase();
        const isPolicyBlocked = blockedCatalogKeys.has(normKey);
        const isRetired = retiredCatalogKeys.has(normKey);
        const admission = listingSourceAdmissionFn
          ? listingSourceAdmissionFn(normKey)
          : { serves: !isPolicyBlocked && !isRetired, reason: null };
        const isDiscoveryOnly = admission.reason === 'DISCOVERY_ONLY';
        const isListingServing = Boolean(admission.serves) && !isPolicyBlocked && !isRetired;
        return { isPolicyBlocked, isDiscoveryOnly, isRetired, isListingServing };
      };

      const hasChallengeSignal = (state, dbError) => Boolean(
        state?.lastErrorCode === 'UPSTREAM_BOT_CHALLENGE'
        || /bot\s*challenge|turnstile|captcha|waf|cloudflare/i.test(state?.circuitBreakerReason || '')
        || /bot\s*challenge|turnstile|captcha|waf|cloudflare/i.test(dbError || state?.lastError || '')
      );

      const nonServingFallbackStatus = (disp) => (
        disp.isDiscoveryOnly ? 'discovery_only' : (disp.isRetired ? 'retired' : 'non_serving')
      );

      const toIso = (val) => {
        if (!val) return null;
        const ts = Date.parse(String(val));
        return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
      };

      const scrapersMap = new Map();
      for (const [name, state] of Object.entries(details)) {
        const mappedKey = nameToKey.get(name) || String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const disp = classifyDisposition(mappedKey);
        const challengeGated = disp.isPolicyBlocked || hasChallengeSignal(state, null);
        let memStatus;
        if (challengeGated) {
          memStatus = 'challenge_gated';
        } else if (!disp.isListingServing && (state?.circuitBreakerTripped || Number(state?.consecutiveFailures || 0) > 0)) {
          memStatus = nonServingFallbackStatus(disp);
        } else if (state?.circuitBreakerTripped) {
          memStatus = 'fault';
        } else if (Number(state?.consecutiveFailures || 0) > 0) {
          memStatus = 'error';
        } else if (Number(state?.runs || 0) > 0) {
          memStatus = 'healthy';
        } else {
          memStatus = 'idle';
        }
        const sanitized = {
          key: mappedKey,
          sourceKey: mappedKey,
          name,
          runs: Number(state?.runs || 0),
          lastRunAt: toIso(state?.lastRunAt),
          lastSuccessAt: toIso(state?.lastSuccessAt),
          lastNonEmptyAt: toIso(state?.lastNonEmptyAt),
          recordsIngested: Number(state?.lastAcceptedCount ?? state?.recordsIngested ?? 0),
          activeListings: Number(state?.activeListings || 0),
          status: memStatus,
          consecutiveFailures: (memStatus === 'challenge_gated' || !disp.isListingServing)
            ? 0
            : Number(state?.consecutiveFailures || 0),
          averageLatencyMs: Number(state?.averageLatencyMs || 0),
          driftDetected: Boolean(state?.driftDetected),
          driftAlarm: state?.driftAlarm || null,
          listingServing: disp.isListingServing,
          ...(isAuthorized && state?.lastError ? { lastError: state.lastError } : {}),
        };
        scrapersMap.set(mappedKey, sanitized);
      }

      let pgHydrated = false;
      if (database?.isPg && database?.pool && typeof database.pool.query === 'function') {
        const [runsRes, countsRes, telemetryRes] = await Promise.all([
          database.pool.query(
            `SELECT source_key, last_run_at, last_success_at, last_non_empty_at,
                    accepted_count, evidence_count, rejected_count, error, duration_ms, runs_count
               FROM source_observation_runs
              ORDER BY source_key`
          ).catch(() => null),
          database.pool.query(
            `SELECT source_key, COUNT(*)::int AS active_listings
               FROM listings
              WHERE discovery_is_live IS TRUE
              GROUP BY source_key`
          ).catch(() => null),
          database.pool.query(
            `SELECT cache_key, payload
               FROM durable_kv_cache
              WHERE namespace = 'scraper_telemetry'
                AND expires_at > NOW()`
          ).catch(() => null),
        ]);

        const telemetryBySource = new Map();
        if (Array.isArray(telemetryRes?.rows)) {
          for (const row of telemetryRes.rows) {
            if (row?.cache_key && row?.payload && typeof row.payload === 'object') {
              telemetryBySource.set(row.cache_key, row.payload);
            }
          }
        }

        const activeCountMap = new Map();
        if (Array.isArray(countsRes?.rows)) {
          if (countsRes.rows.length > 0) pgHydrated = true;
          for (const row of countsRes.rows) {
            if (row?.source_key) {
              activeCountMap.set(row.source_key, Number(row.active_listings || 0));
            }
          }
        }

        if (Array.isArray(runsRes?.rows) && runsRes.rows.length > 0) {
          pgHydrated = true;
          for (const row of runsRes.rows) {
            const key = row?.source_key;
            if (!key) continue;
            const disp = classifyDisposition(key);
            const existing = scrapersMap.get(key) || null;
            const dbRunIso = toIso(row.last_run_at);
            const dbSuccessIso = toIso(row.last_success_at);
            const dbNonEmptyIso = toIso(row.last_non_empty_at);
            const memRunMs = existing?.lastRunAt ? Date.parse(existing.lastRunAt) : 0;
            const dbRunMs = dbRunIso ? Date.parse(dbRunIso) : 0;
            const preferDb = !existing || Number(existing.runs || 0) === 0 || dbRunMs >= memRunMs;
            const hasDbError = Boolean(
              row.error && (!dbSuccessIso || (dbRunMs > Date.parse(dbSuccessIso)))
            );
            const displayName = existing?.name || keyToName.get(key) || key;
            let mergedStatus;
            if (disp.isPolicyBlocked) {
              mergedStatus = 'challenge_gated';
            } else if (existing?.status === 'fault' && disp.isListingServing) {
              mergedStatus = 'fault';
            } else if (preferDb) {
              if (hasDbError) {
                if (hasChallengeSignal(null, row.error)) mergedStatus = 'challenge_gated';
                else if (!disp.isListingServing) mergedStatus = nonServingFallbackStatus(disp);
                else mergedStatus = 'error';
              } else {
                mergedStatus = dbRunIso ? 'healthy' : 'idle';
              }
            } else {
              mergedStatus = existing.status;
            }
            const persistedTelemetry = telemetryBySource.get(key) || null;
            const merged = {
              key,
              sourceKey: key,
              name: displayName,
              runs: Math.max(Number(existing?.runs || 0), Number(row.runs_count || 0)),
              lastRunAt: preferDb ? dbRunIso : existing.lastRunAt,
              lastSuccessAt: dbSuccessIso || existing?.lastSuccessAt || null,
              lastNonEmptyAt: dbNonEmptyIso || existing?.lastNonEmptyAt || null,
              recordsIngested: preferDb
                ? Number(row.accepted_count || 0)
                : Number(existing?.recordsIngested ?? row.accepted_count ?? 0),
              activeListings: activeCountMap.get(key) ?? existing?.activeListings ?? 0,
              status: mergedStatus,
              consecutiveFailures: (mergedStatus === 'challenge_gated' || !disp.isListingServing)
                ? 0
                : Math.max(Number(existing?.consecutiveFailures || 0), hasDbError ? 1 : 0),
              averageLatencyMs: preferDb
                ? Number(row.duration_ms || existing?.averageLatencyMs || 0)
                : Number(existing?.averageLatencyMs || 0),
              driftDetected: Boolean(persistedTelemetry?.driftDetected ?? existing?.driftDetected),
              driftAlarm: persistedTelemetry?.driftAlarm ?? existing?.driftAlarm ?? null,
              listingServing: disp.isListingServing,
              ...(isAuthorized && (existing?.lastError || row.error)
                ? { lastError: existing?.lastError || row.error }
                : {}),
            };
            scrapersMap.set(key, merged);
            details[displayName] = {
              ...(details[displayName] || {}),
              ...merged,
            };
          }
        }

        for (const [key, activeListings] of activeCountMap.entries()) {
          if (!scrapersMap.has(key)) {
            const disp = classifyDisposition(key);
            const displayName = keyToName.get(key) || key;
            const entry = {
              key,
              sourceKey: key,
              name: displayName,
              runs: 0,
              lastRunAt: null,
              lastSuccessAt: null,
              lastNonEmptyAt: null,
              recordsIngested: 0,
              activeListings,
              status: disp.isPolicyBlocked ? 'challenge_gated' : 'idle',
              consecutiveFailures: 0,
              averageLatencyMs: 0,
              driftDetected: false,
              listingServing: disp.isListingServing,
            };
            scrapersMap.set(key, entry);
            details[displayName] = entry;
          } else {
            const existing = scrapersMap.get(key);
            existing.activeListings = activeListings;
          }
        }
      }

      const scrapers = Array.from(scrapersMap.values()).sort(
        (a, b) => (b.activeListings - a.activeListings) || String(a.key).localeCompare(String(b.key))
      );
      const totalScrapers = pgHydrated ? scrapers.length : Number(baseReport.totalScrapers ?? scrapers.length);
      const scrapersInFault = scrapers.filter(
        (s) => (s.status === 'fault' || s.status === 'error') && s.listingServing !== false
      ).length;
      const scrapersWithDrift = scrapers.filter(
        (s) => s.driftDetected && s.listingServing !== false
      ).length;
      const scrapersChallengeGated = (pgHydrated || scrapers.length > 0)
        ? scrapers.filter((s) => s.status === 'challenge_gated').length
        : Number(baseReport.scrapersChallengeGated || 0);
      const systemStatus = (scrapersInFault > 0 || scrapersWithDrift > 0)
        ? 'degraded'
        : (scrapersChallengeGated > 0
            ? 'nominal_gated'
            : (totalScrapers === 0 ? 'idle' : 'healthy'));

      return res.json({
        ...baseReport,
        systemStatus,
        totalScrapers,
        scrapersInFault,
        scrapersWithDrift,
        scrapersChallengeGated,
        telemetrySource: pgHydrated ? 'postgres+memory' : 'memory',
        scrapers,
        details,
      });
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
          const rawCatchLimit = body.catchLimit ?? url.searchParams.get('catchLimit');
          const rawMaxDurationMs = body.maxDurationMs ?? url.searchParams.get('maxDurationMs');
          const parseBoundedLimit = (raw) => {
            const n = raw != null && raw !== '' ? Number(raw) : NaN;
            return Number.isFinite(n) && n >= 1 ? Math.min(200, Math.floor(n)) : undefined;
          };
          const assessorLimit = parseBoundedLimit(body.assessorLimit ?? url.searchParams.get('assessorLimit'));
          const countyLimit = parseBoundedLimit(body.countyLimit ?? url.searchParams.get('countyLimit'));
          const safmrLimit = parseBoundedLimit(body.safmrLimit ?? url.searchParams.get('safmrLimit'));
          const spatialLimit = parseBoundedLimit(body.spatialLimit ?? url.searchParams.get('spatialLimit'));
          const rawTriageLimit = body.triageLimit ?? url.searchParams.get('triageLimit');
          const parsedTriageLimit = rawTriageLimit != null && rawTriageLimit !== '' ? Number(rawTriageLimit) : NaN;
          const triageLimit = Number.isFinite(parsedTriageLimit) && parsedTriageLimit >= 1
            ? Math.min(1000, Math.floor(parsedTriageLimit))
            : undefined;
          const njLimit = rawNjLimit != null && rawNjLimit !== '' ? Number(rawNjLimit) : NaN;
          const geocodeLimit = rawGeocodeLimit != null && rawGeocodeLimit !== '' ? Number(rawGeocodeLimit) : NaN;
          const catchLimit = rawCatchLimit != null && rawCatchLimit !== '' ? Number(rawCatchLimit) : NaN;
          const maxDurationMs = rawMaxDurationMs != null && rawMaxDurationMs !== '' ? Number(rawMaxDurationMs) : NaN;
          const dryRun = body.dryRun === true || url.searchParams.get('dryRun') === 'true';
          const repairReport = await repairFn({
            ...(Number.isFinite(njLimit) && njLimit > 0 ? { njLimit } : {}),
            ...(Number.isFinite(geocodeLimit) && geocodeLimit > 0 ? { geocodeLimit } : {}),
            ...(Number.isFinite(catchLimit) && catchLimit > 0 ? { catchLimit } : {}),
            ...(Number.isFinite(maxDurationMs) && maxDurationMs >= 0 ? { maxDurationMs } : {}),
            ...(assessorLimit !== undefined ? { assessorLimit } : {}),
            ...(countyLimit !== undefined ? { countyLimit } : {}),
            ...(safmrLimit !== undefined ? { safmrLimit } : {}),
            ...(spatialLimit !== undefined ? { spatialLimit } : {}),
            ...(triageLimit !== undefined ? { triageLimit } : {}),
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
          const pruneStart = Date.now();
          const limit = Math.min(5000, Math.max(1, Number(body.limit ?? url.searchParams.get('limit')) || 5000));
          const lifecycleRes = await database.pool.query(
            `UPDATE listings
                SET lifecycle_status = CASE
                  WHEN lifecycle_status ~* '^(?:status\\s*:\\s*)?cancel(?:l?ed)(?:$|[^a-z])' THEN 'Cancelled'
                  WHEN lifecycle_status ~* '^post\\s+bankruptcy\\s+sale\\s+date$'
                    OR lifecycle_status ~* '^status\\s*:\\s*cleared\\s+for\\s+auction'
                    OR lifecycle_status ~* '^rescheduled(?:$|[^a-z])'
                    OR lifecycle_status ~* '^scheduled(?:\\s*[-:]|\\s+for(?:$|[^a-z])|$)'
                    OR lifecycle_status ~* '^auction\\s+(?:begins|ends)\\s*:'
                    OR LOWER(BTRIM(COALESCE(lifecycle_status, ''))) IN ('scheduled', 'upcoming', 'scheduled sale', 'notice of sale')
                    OR (lifecycle_status IS NULL AND LOWER(BTRIM(COALESCE(status, ''))) = 'scheduled') THEN 'Scheduled'
                  WHEN lifecycle_status ~* 'adjourn|(?:^|[^a-z])adj(?:$|[^a-z])' THEN 'Adjourned'
                  WHEN lifecycle_status ~* 'bankr?upt?c' THEN 'Bankruptcy Stay'
                  WHEN lifecycle_status ~* '^status\\s*:\\s*active' OR LOWER(BTRIM(lifecycle_status)) = 'active' THEN 'Active'
                  WHEN LOWER(BTRIM(lifecycle_status)) = 'coming soon' THEN 'Coming Soon'
                  ELSE BTRIM(lifecycle_status)
                END
              WHERE COALESCE(lifecycle_status, '') NOT IN (
                'Active', 'Scheduled', 'Coming Soon', 'Adjourned', 'Cancelled', 'Bankruptcy Stay',
                'Sold', 'Withdrawn', 'Dismissed', 'Vacated', 'Redeemed', 'Postponed', 'Closed', 'Expired', 'Concluded', 'publicly_listed'
              )
                AND (
                  (lifecycle_status IS NOT NULL AND (
                    lifecycle_status ~* '^(?:status\\s*:\\s*cancel|post\\s+bankruptcy\\s+sale\\s+date$|status\\s*:\\s*cleared\\s+for\\s+auction|rescheduled|scheduled\\s*[-:]|scheduled\\s+for|auction\\s+(?:begins|ends)\\s*:|status\\s*:\\s*active)'
                    OR lifecycle_status ~* 'adjourn|(?:^|[^a-z])adj(?:$|[^a-z])|bankr?upt?c'
                    OR LOWER(BTRIM(lifecycle_status)) IN ('scheduled', 'upcoming', 'scheduled sale', 'notice of sale', 'active', 'coming soon', 'cancelled', 'canceled')
                  ))
                  OR (lifecycle_status IS NULL AND LOWER(BTRIM(COALESCE(status, ''))) = 'scheduled')
                )`
          ).catch(() => ({ rowCount: 0 }));
          const lifecycleNormalized = Number(lifecycleRes?.rowCount || 0);
          let concludedDeleted = 0;
          const delRes = await database.pool.query(
            `DELETE FROM listings
              WHERE id IN (
                SELECT id FROM listings
                 WHERE discovery_terminal IS TRUE
                    OR LOWER(COALESCE(lifecycle_status, '')) IN ('sold', 'closed', 'ended', 'completed', 'cancelled', 'canceled', 'retired', 'withdrawn', 'redeemed', 'dismissed', 'settled', 'discontinued', 'vacated', 'writ expired', 'expired')
                    OR LOWER(COALESCE(status, '')) IN ('sold', 'closed', 'ended', 'completed', 'cancelled', 'canceled', 'retired', 'withdrawn', 'redeemed', 'dismissed', 'settled', 'discontinued', 'vacated', 'writ expired', 'expired')
                 LIMIT $1
              )`,
            [limit],
          );
          concludedDeleted = delRes.rowCount || 0;
          const statusRes = await database.pool.query(
            `UPDATE listings
                SET status = CASE
                      WHEN LOWER(COALESCE(lifecycle_status, '')) ~ 'bankr?upt?c|\\mstay(ed)?\\M|\\m(on[[:space:]]+)?hold\\M' THEN 'stayed'
                      WHEN LOWER(COALESCE(lifecycle_status, '')) ~ '\\madj(ourn(ed|ment)?|d)?\\M' THEN 'adjourned'
                      WHEN LOWER(COALESCE(lifecycle_status, '')) ~ 'postpon' THEN 'postponed'
                      WHEN LOWER(COALESCE(lifecycle_status, '')) LIKE 'auction begins%' THEN 'scheduled'
                      WHEN LOWER(COALESCE(lifecycle_status, '')) LIKE 'auction ends%' THEN 'active'
                      WHEN LOWER(TRIM(COALESCE(lifecycle_status, ''))) IN ('status: active', 'active', 'live', 'open', 'bidding', 'available') THEN 'active'
                      ELSE 'scheduled'
                    END
              WHERE LOWER(COALESCE(status, 'unknown')) = 'unknown'
                AND (
                  LOWER(COALESCE(lifecycle_status, '')) ~ 'bankr?upt?c|\\mstay(ed)?\\M|\\m(on[[:space:]]+)?hold\\M|\\madj(ourn(ed|ment)?|d)?\\M|postpon'
                  OR LOWER(COALESCE(lifecycle_status, '')) LIKE 'auction begins%'
                  OR LOWER(COALESCE(lifecycle_status, '')) LIKE 'auction ends%'
                  OR LOWER(TRIM(COALESCE(lifecycle_status, ''))) IN ('status: active', 'active', 'live', 'open', 'bidding', 'available')
                  OR (source_key = 'sheriff' AND sale_date IS NOT NULL AND sale_date >= CURRENT_DATE)
                )`,
          );
          const statusReconciled = Number(statusRes?.rowCount || 0);
          const gsaTypeCleanup = await database.pool.query(
            `UPDATE listings
                SET prop_type = CASE
                  WHEN LOWER(COALESCE(raw_notice, '') || ' ' || COALESCE(address, '')) ~ 'courthouse|federal building' THEN 'Courthouse'
                  WHEN LOWER(COALESCE(raw_notice, '') || ' ' || COALESCE(address, '')) ~ 'office|federal center' THEN 'Office'
                  ELSE NULL
                END
              WHERE prop_type IN ('[', ']', '""', 'null', 'Unknown')`
          ).catch(() => ({ rowCount: 0 }));
          const hudTypeFill = await database.pool.query(
            `UPDATE listings
                SET prop_type = 'Single Family'
              WHERE source_key = 'hud'
                AND (prop_type IS NULL OR TRIM(prop_type) = '' OR prop_type = 'Unknown')`
          ).catch(() => ({ rowCount: 0 }));
          const propTypesCleaned = Number(gsaTypeCleanup?.rowCount || 0) + Number(hudTypeFill?.rowCount || 0);
          const occupancyRes = await database.pool.query(
            `UPDATE listings
                SET occupancy = CASE
                  WHEN UPPER(BTRIM(occupancy)) IN ('UNKNOWN', 'N/A', 'NA', 'TBD', 'NONE', '') OR LOWER(BTRIM(occupancy)) = 'commericial property' THEN NULL
                  WHEN LOWER(occupancy) ~ '(^|[^a-z])owner[- ]?occupied($|[^a-z])' THEN 'Owner-Occupied'
                  WHEN UPPER(BTRIM(occupancy)) IN ('TENANT', 'RENTER') OR LOWER(occupancy) ~ '(^|[^a-z])(tenant[- ]?occupied|renter[- ]?occupied|rental|leased)($|[^a-z])' THEN 'Tenant-Occupied'
                  WHEN LOWER(occupancy) ~ '(^|[^a-z])(unoccupied|vacant)($|[^a-z])' THEN 'Vacant'
                  WHEN LOWER(occupancy) ~ '(^|[^a-z])occupied($|[^a-z])' THEN 'Occupied'
                  ELSE occupancy
                END
              WHERE occupancy IS NOT NULL
                AND occupancy NOT IN ('Owner-Occupied', 'Tenant-Occupied', 'Vacant', 'Occupied')
                AND (
                  UPPER(BTRIM(occupancy)) IN ('UNKNOWN', 'N/A', 'NA', 'TBD', 'NONE', '', 'TENANT', 'RENTER')
                  OR LOWER(BTRIM(occupancy)) = 'commericial property'
                  OR LOWER(occupancy) ~ '(^|[^a-z])(owner[- ]?occupied|tenant[- ]?occupied|renter[- ]?occupied|unoccupied|vacant|occupied)($|[^a-z])'
                )`
          ).catch(() => ({ rowCount: 0 }));
          const occupancyNormalized = Number(occupancyRes?.rowCount || 0);
          const ohCityRes = await database.pool.query(
            `UPDATE listings
                SET city = BTRIM((regexp_match(address, '^[^,]+,\\s*([A-Za-z][A-Za-z .''-]+?),\\s*(?:OH\\s+)?\\d{5}'))[1])
              WHERE state = 'OH'
                AND (city IS NULL OR BTRIM(city) = '')
                AND address ~ '^[^,]+,\\s*[A-Za-z][A-Za-z .''-]+?,\\s*(?:OH\\s+)?\\d{5}'`
          ).catch(() => ({ rowCount: 0 }));
          const ohCitiesBackfilled = Number(ohCityRes?.rowCount || 0);
          const stalePurged = typeof database.purgeStaleListings === 'function'
            ? await database.purgeStaleListings({ batchSize: 50, maxDurationMs: 12_000, skipVacuum: true })
            : { deleted: 0, observationsDeleted: 0 };
          const crossDedupe = (typeof database.reconcileCrossSourceDuplicates === 'function' && (Date.now() - pruneStart) < 25_000)
            ? await database.reconcileCrossSourceDuplicates().catch(() => ({ superseded: 0, cleared: 0 }))
            : null;
          const mvRefreshed = (typeof database.refreshNeighborhoodStatsMaterializedView === 'function' && (Date.now() - pruneStart) < 35_000)
            ? await database.refreshNeighborhoodStatsMaterializedView({ concurrent: true }).catch(() => false)
            : false;
          const countRes = await database.pool.query('SELECT count(*)::int AS n FROM listings');
          const remainingTotal = Number(countRes.rows[0]?.n || 0);
          return res.json({
            status: 'completed',
            action: 'prune',
            report: {
              concludedDeleted,
              statusReconciled,
              propTypesCleaned,
              occupancyNormalized,
              lifecycleNormalized,
              ohCitiesBackfilled,
              stalePurged,
              crossDedupe,
              mvRefreshed,
              remainingTotal,
            },
          });
        } catch (err) {
          return res.status(err?.status || 500).json({ error: err?.message || 'Prune operation failed' });
        }
      }

      if (action === 'compact-observations') {
        const database = resolveDatabase();
        if (!database || !database.isPg || !database.pool) {
          return res.status(503).json({ error: 'Observation compaction requires an active PostgreSQL database connection' });
        }
        try {
          const pruneExpired = body.pruneExpired === true
            || url.searchParams.get('pruneExpired') === 'true'
            || url.searchParams.get('pruneExpired') === '1';
          let expiredPurged = null;
          if (pruneExpired && typeof database.purgeStaleListings === 'function') {
            expiredPurged = await database.purgeStaleListings({ batchSize: 50, maxBatches: 40, maxDurationMs: 25_000 });
          }
          const { compactPgObservations } = require('../db/observations-persistence');
          const vacuumFull = body.vacuumFull === true
            || url.searchParams.get('vacuumFull') === 'true'
            || url.searchParams.get('vacuumFull') === '1';
          const slimPayloads = body.slimPayloads !== false
            && url.searchParams.get('slimPayloads') !== 'false';
          const report = await compactPgObservations(database.pool, {
            apply: body.dryRun !== true && url.searchParams.get('dryRun') !== 'true',
            vacuum: true,
            vacuumFull,
            slimPayloads,
            source: body.source || url.searchParams.get('source') || null,
          });
          return res.json({
            status: 'completed',
            action: 'compact-observations',
            report: expiredPurged ? { ...report, expiredPurged } : report,
          });
        } catch (err) {
          return res.status(err?.status || 500).json({ error: err?.message || 'Observation compaction failed' });
        }
      }

      if (action === 'second-look') {
        const database = resolveDatabase();
        try {
          const { listCases, getCase } = require('../intelligence/research-cases');
          const researchStore = require('../intelligence/research-store');
          const { applySecondLookReconsideration, applySecondLookReconsiderationPg } = require('../intelligence/second-look');
          const targetId = body.caseId ? String(body.caseId).trim() : null;
          const usePgCases = Boolean(database?.isPg && database?.pool?.query);
          let allEntries = [];
          if (usePgCases) {
            allEntries = await researchStore.listAllCasesByStatePg(database, 'pass', { targetId });
          } else if (targetId) {
            const c = getCase(targetId)?.case || getCase(targetId);
            if (c) allEntries = [{ ownerId: 'operator', case: c }];
          } else {
            let offset = 0;
            let total = Infinity;
            while (offset < total) {
              const page = listCases({ limit: 200, offset, state: 'pass' });
              const items = Array.isArray(page?.items) ? page.items : [];
              total = Number.isFinite(Number(page?.total)) ? Number(page.total) : items.length;
              for (const item of items) allEntries.push({ ownerId: 'operator', case: item });
              if (items.length === 0) break;
              offset += items.length;
            }
          }
          const results = [];
          let triggered = 0;
          let errors = 0;
          for (const entry of allEntries) {
            const c = entry.case;
            try {
              const freshListing = c.listingId && database && typeof database.getListingById === 'function'
                ? await database.getListingById(c.listingId)
                : (body.listing || null);
              if (!freshListing) continue;
              const outcome = usePgCases
                ? await applySecondLookReconsiderationPg(database, entry.ownerId, c.id, freshListing)
                : applySecondLookReconsideration(c.id, freshListing);
              if (outcome?.triggered) triggered++;
              results.push({ caseId: c.id, ownerId: entry.ownerId, triggered: Boolean(outcome?.triggered) });
            } catch (err) {
              errors++;
              results.push({ caseId: c.id, error: err?.message || 'reconsideration_failed' });
            }
          }
          return res.json({
            status: 'completed',
            action: 'second-look',
            report: { scanned: allEntries.length, triggered, errors, results },
          });
        } catch (err) {
          return res.status(err?.status || 500).json({ error: err?.message || 'Second-look reconsideration failed' });
        }
      }

      if (action === 'dispatch-digests') {
        const database = resolveDatabase();
        try {
          const { runAllHuntDigests } = require('../delivery/alert-digest');
          const { scanAllListings } = require('../db/listings-scan');
          const listings = (database && typeof database.getListings === 'function') ? (await scanAllListings(database)).pool : [];
          const report = await runAllHuntDigests({
            listings,
            options: {
              database,
              durableStore: dependencies.durableStore,
              filePath: dependencies.filePath,
              env,
              recipientEmail: body.recipientEmail || env.OPERATOR_EMAIL || null,
              forceDispatch: Boolean(body.forceDispatch),
            },
          });
          return res.json({ status: 'completed', action: 'dispatch-digests', report });
        } catch (err) {
          return res.status(err?.status || 500).json({ error: err?.message || 'Digest dispatch failed' });
        }
      }

      if (action === 'email-ingest') {
        try {
          const { EmailNoticesPipeline } = require('../sources/email-notices');
          const pipeline = dependencies.emailNoticesPipeline || new EmailNoticesPipeline({
            db: resolveDatabase(),
            env,
          });
          let report;
          if (Array.isArray(body.messages)) {
            report = await pipeline.ingestMessages(body.messages);
          } else if (
            typeof body.raw === 'string' ||
            typeof body.rawMime === 'string' ||
            typeof body.mime === 'string' ||
            typeof body.body === 'string' ||
            typeof body.text === 'string' ||
            (body.email && (typeof body.email === 'string' || typeof body.email === 'object'))
          ) {
            report = await pipeline.ingestRawEmail(body.email || body);
          } else {
            report = await pipeline.ingest();
          }
          return res.json({ status: 'completed', action: 'email-ingest', report });
        } catch (err) {
          const status = err?.code === 'IMAP_CREDENTIALS_UNSET' ? 503 : (err?.status || 500);
          return res.status(status).json({
            error: err?.message || 'Email ingestion failed',
            ...(err?.code ? { code: err.code } : {}),
          });
        }
      }

      if (action === 'next-slice') {
        const SLICE_PRIORITY = ['servicelink', 'hud', 'sheriff', 'civilview', 'gsa', 'usda', 'treasury', 'irs', 'trustee'];
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
              `SELECT source_key,
                      MAX(source_observed_at) AS latest_at,
                      MIN(source_observed_at) FILTER (
                        WHERE discovery_terminal IS NOT TRUE
                          AND NOT (COALESCE(provenance, '{}'::jsonb) ? 'publisherAbsence')
                      ) AS oldest_active_at
                 FROM listings
                WHERE source_key = ANY($1::text[])
                GROUP BY source_key`,
              [SLICE_PRIORITY]
            );
            const latestBySource = new Map();
            const oldestActiveBySource = new Map();
            for (const r of obsRes.rows || []) {
              if (!r || !r.source_key) continue;
              latestBySource.set(r.source_key, r.latest_at ? Date.parse(r.latest_at) || 0 : 0);
              if (r.oldest_active_at) {
                const oldestMs = Date.parse(r.oldest_active_at) || 0;
                if (oldestMs > 0) oldestActiveBySource.set(r.source_key, oldestMs);
              }
            }
            let runRows = [];
            try {
              const runsRes = await database.pool.query(
                'SELECT source_key, last_run_at, last_success_at, accepted_count, error FROM source_observation_runs WHERE source_key = ANY($1::text[])',
                [SLICE_PRIORITY]
              );
              runRows = runsRes?.rows || [];
            } catch (_) {
              runRows = [];
            }
            const runAtBySource = new Map();
            const lastSuccessBySource = new Map();
            const acceptedBySource = new Map();
            const errorBySource = new Map();
            for (const row of runRows) {
              if (!row || !row.source_key) continue;
              const runMs = row.last_run_at ? Date.parse(row.last_run_at) || 0 : 0;
              const successMs = row.last_success_at ? Date.parse(row.last_success_at) || 0 : 0;
              runAtBySource.set(row.source_key, runMs);
              if (successMs > 0) lastSuccessBySource.set(row.source_key, successMs);
              acceptedBySource.set(row.source_key, Number(row.accepted_count) || 0);
              if (row.error && (!successMs || runMs > successMs)) {
                errorBySource.set(row.source_key, String(row.error));
              }
            }
            const { SOURCE_CATALOG } = require('../sources/catalog');
            const cadenceHoursByKey = new Map();
            for (const entry of SOURCE_CATALOG || []) {
              const key = entry?.adapterKey || entry?.id;
              const hours = Number(entry?.workflow?.cadenceHours);
              if (key && !cadenceHoursByKey.has(key) && Number.isFinite(hours) && hours > 0) {
                cadenceHoursByKey.set(key, hours);
              }
            }
            const cadenceHours = (key) => cadenceHoursByKey.get(key) || (key === 'servicelink' ? 6 : 12);
            try {
              const attemptRes = await database.pool.query(
                `SELECT cache_key, payload
                   FROM durable_kv_cache
                  WHERE namespace = $1
                    AND expires_at > NOW()`,
                ['scraper_slice_attempt']
              );
              for (const row of attemptRes?.rows || []) {
                if (!row || !row.cache_key) continue;
                const durableAt = Number(row.payload?.at) || 0;
                if (durableAt > 0) {
                  sliceLastRunAt.set(row.cache_key, Math.max(sliceLastRunAt.get(row.cache_key) || 0, durableAt));
                }
              }
            } catch (_) {
              // Non-fatal: durable slice attempt cache is fail-soft.
            }
            const nowMs = Date.now();
            const attemptMs = (key) => Math.max(
              runAtBySource.get(key) || 0,
              cpUpdatedBySource.get(key) || 0,
              sliceLastRunAt.get(key) || 0
            );
            const activityMs = (key) => Math.max(
              latestBySource.get(key) || 0,
              attemptMs(key)
            );
            const effectiveFreshnessMs = (key) => {
              const base = activityMs(key);
              if (base <= 0) return 0;
              const lastAttempt = attemptMs(key);
              // Respect a 1h retry cooldown after an attempt so an errored or
              // partially stale source cannot starve healthy sources every tick.
              if (lastAttempt > 0 && (nowMs - lastAttempt) < 3_600_000) {
                return base;
              }
              const oldestActive = oldestActiveBySource.get(key) || 0;
              const staleRows = oldestActive > 0 && (nowMs - oldestActive) >= cadenceHours(key) * 3_600_000;
              const hasError = errorBySource.has(key);
              if (!staleRows && !hasError) return base;
              const candidates = [
                staleRows ? oldestActive : 0,
                hasError ? (lastSuccessBySource.get(key) || latestBySource.get(key) || 0) : 0,
              ].filter((t) => t > 0);
              return candidates.length > 0 ? Math.min(...candidates) : base;
            };
            const isRecentZeroYieldTrustee = (key) => {
              if (latestBySource.has(key)) return false;
              const lastRun = runAtBySource.get(key) || sliceLastRunAt.get(key) || 0;
              if (lastRun <= 0) return false;
              const accepted = acceptedBySource.get(key) || 0;
              return accepted === 0 && (nowMs - lastRun) < cadenceHours(key) * 3_600_000;
            };
            const stalenessRatio = (key) => {
              const last = effectiveFreshnessMs(key);
              if (last <= 0) return Number.POSITIVE_INFINITY;
              return (nowMs - last) / (cadenceHours(key) * 3_600_000);
            };
            const pickMostOverdue = () => {
              const hasActiveWithRows = Array.from(latestBySource.keys()).some((k) => {
                const ageMs = nowMs - activityMs(k);
                return ageMs >= 3_600_000;
              });
              const eligible = hasActiveWithRows
                ? SLICE_PRIORITY.filter((key) => !isRecentZeroYieldTrustee(key))
                : SLICE_PRIORITY;
              const poolKeys = eligible.length > 0 ? eligible : SLICE_PRIORITY;
              return poolKeys.reduce((best, key) => {
                const bestRatio = stalenessRatio(best);
                const keyRatio = stalenessRatio(key);
                if (keyRatio !== bestRatio) return keyRatio > bestRatio ? key : best;
                return effectiveFreshnessMs(key) < effectiveFreshnessMs(best) ? key : best;
              }, poolKeys[0]);
            };
            const resumed = SLICE_PRIORITY.find((key) => activeCheckpoints.has(key));
            const starving = latestBySource.size > 0
              ? SLICE_PRIORITY
                  .filter((key) => !isRecentZeroYieldTrustee(key))
                  .reduce((oldest, key) => (!oldest || effectiveFreshnessMs(key) < effectiveFreshnessMs(oldest) ? key : oldest), null)
              : null;
            const starvingOverdue = Boolean(starving && (activityMs(starving) === 0 || (stalenessRatio(starving) >= 0.75 && (activityMs(resumed) - effectiveFreshnessMs(starving)) > 15 * 60_000)));
            if (resumed && !starvingOverdue) {
              chosenSource = resumed;
              reason = 'active_continuation_cursor';
            } else {
              const missing = SLICE_PRIORITY.find((key) => !latestBySource.has(key) && !activeCheckpoints.has(key) && activityMs(key) === 0);
              if (missing && latestBySource.size > 0) {
                chosenSource = missing;
                reason = 'missing_from_inventory';
              } else {
                chosenSource = pickMostOverdue();
                reason = 'oldest_observation';
              }
            }
          } catch (_) {
            chosenSource = SLICE_PRIORITY[0];
            reason = 'fallback_priority';
          }
        }
        try {
          const attemptAt = Date.now();
          sliceLastRunAt.set(chosenSource, attemptAt);
          if (database?.isPg && database?.pool) {
            try {
              const { setDurableCache } = require('../enrichment/durable-cache');
              await setDurableCache('scraper_slice_attempt', chosenSource, { at: attemptAt, reason }, { db: database, ttlMs: 2 * 3600 * 1000 });
            } catch (_) {
              // Non-fatal: durable slice attempt persistence is fail-soft.
            }
          }
          const sliceTimeoutRaw = Number(body.timeoutMs ?? url.searchParams.get('timeoutMs'));
          const scraperTimeoutMs = Number.isFinite(sliceTimeoutRaw) && sliceTimeoutRaw > 0
            ? Math.min(Math.floor(sliceTimeoutRaw), 120_000)
            : 25_000;
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

      if (action === 'ai-prewarm') {
        const database = resolveDatabase();
        if (!database || (typeof database.getListings !== 'function' && typeof database.listListings !== 'function')) {
          return res.status(503).json({ error: 'AI prewarm requires an active listing store' });
        }
        try {
          const {
            buildEvidenceSummary,
            generateAiNarrative,
            readCachedNarrative,
          } = require('./enrich');
          const { CostRecord, CostTracker, recordSpendPg, isOverBudgetDurable } = require('../ai/cost_tracker');
          const spendPool = database?.isPg && database?.pool?.query ? database.pool : null;

          const rawLimit = Number(body.limit ?? url.searchParams.get('limit') ?? 10);
          const limit = Math.min(20, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 10));
          const rawMaxDur = Number(body.maxDurationMs ?? url.searchParams.get('maxDurationMs') ?? 38_000);
          const maxDurationMs = Math.min(48_000, Math.max(5_000, Number.isFinite(rawMaxDur) && rawMaxDur > 0 ? Math.floor(rawMaxDur) : 38_000));
          const freeOnly = body.freeOnly === true || url.searchParams.get('freeOnly') === 'true';
          const effectiveEnv = freeOnly ? { ...env, AI_GATEWAY_FREE_ONLY: '1' } : env;
          const startedAt = Date.now();
          const rawOidc = headerValue(req.headers, 'x-vercel-oidc-token');
          const oidcToken = typeof rawOidc === 'string' && rawOidc.trim() ? rawOidc.trim() : null;

          let costTracker = dependencies.costTracker || new CostTracker({
            budgetLimitUsd: Number(effectiveEnv?.AI_BUDGET_LIMIT_USD) || 5.00,
          });

          const rawList = typeof database.listListings === 'function'
            ? await database.listListings({ limit: limit * 2, sort: 'triage' })
            : await database.getListings({ limit: limit * 2, sort: 'triage' });
          const rows = Array.isArray(rawList?.listings)
            ? rawList.listings
            : (Array.isArray(rawList) ? rawList : []);

          const terminalStatuses = new Set([
            'sold', 'closed', 'ended', 'completed', 'cancelled', 'canceled',
            'retired', 'withdrawn', 'redeemed', 'dismissed', 'vacated', 'expired',
          ]);
          const activeListings = rows.filter((row) => (
            row
            && row.discoveryTerminal !== true
            && !terminalStatuses.has(String(row.status || '').toLowerCase())
          ));

          let attempted = 0;
          let warmed = 0;
          let skippedCached = 0;
          let rejectedUngrounded = 0;
          let failed = 0;
          let totalCostUsd = 0;
          let stoppedEarly = false;
          let stopReason = null;
          const modelsUsedSet = new Set();

          for (const listing of activeListings) {
            if (attempted >= limit) break;
            if (await isOverBudgetDurable(spendPool, costTracker)) {
              stoppedEarly = true;
              stopReason = 'budget_exceeded';
              break;
            }
            if (Date.now() - startedAt >= maxDurationMs) {
              stoppedEarly = true;
              stopReason = 'time_budget';
              break;
            }
            const analysis = buildEvidenceSummary(listing);
            const cached = await readCachedNarrative(analysis, { db: database, env: effectiveEnv });
            if (cached?.narrative) {
              skippedCached += 1;
              continue;
            }

            attempted += 1;
            const remainingBudgetMs = Math.max(2_000, maxDurationMs - (Date.now() - startedAt));
            const resNarrative = await generateAiNarrative(listing, {
              env: effectiveEnv,
              db: database,
              fetchFn: dependencies.fetchFn || globalThis.fetch,
              oidcToken,
              costTracker,
              persistCache: true,
              signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
                ? AbortSignal.timeout(Math.min(10_000, remainingBudgetMs))
                : undefined,
            });
            if (resNarrative?.narrative) {
              warmed += 1;
              const callCost = Number(resNarrative.costUsd) || 0;
              totalCostUsd = Number((totalCostUsd + callCost).toFixed(6));
              if (resNarrative.model) modelsUsedSet.add(resNarrative.model);
              const spendRecord = new CostRecord({
                provider: resNarrative.provider || 'vercel_gateway',
                model: resNarrative.model || 'unknown',
                inputTokens: Number(resNarrative.inputTokens) || 0,
                outputTokens: Number(resNarrative.outputTokens) || 0,
                costUsd: callCost,
              });
              costTracker = costTracker.add(spendRecord);
              await recordSpendPg(spendPool, spendRecord, { route: 'ai-enrich-batch' });
            } else if (resNarrative?.reason === 'ungrounded_claim') {
              rejectedUngrounded += 1;
            } else {
              failed += 1;
            }
          }

          return res.json({
            ok: true,
            action: 'ai-prewarm',
            attempted,
            warmed,
            skippedCached,
            rejectedUngrounded,
            failed,
            totalCostUsd,
            modelsUsed: Array.from(modelsUsedSet),
            stoppedEarly,
            stopReason,
            freeOnly,
            elapsedMs: Date.now() - startedAt,
          });
        } catch (err) {
          return res.status(err?.status || 500).json({ error: err?.message || 'AI prewarm failed' });
        }
      }

      const querySources = url.searchParams.get('sources') || url.searchParams.get('sourceIds') || url.searchParams.get('sourceId') || url.searchParams.get('source');
      const singleSourceParam = body.sourceId || body.source || null;
      const sourceIds = (Array.isArray(body.sources) && body.sources.length > 0)
        ? body.sources
        : ((Array.isArray(body.sourceIds) && body.sourceIds.length > 0)
            ? body.sourceIds
            : (singleSourceParam ? [String(singleSourceParam).trim()] : (querySources ? querySources.split(',').map(s => s.trim()).filter(Boolean) : undefined)));
      if (action === 'run-source' && (!sourceIds || sourceIds.length === 0)) {
        return res.status(400).json({ error: 'source or sourceId is required for run-source' });
      }
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
