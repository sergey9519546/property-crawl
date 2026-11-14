const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db/client');
const { createApiRatePolicy } = require('./security/api-rate-policy');
const handleListings = require('./routes/listings');
const handleParse = require('./routes/parse');
const handleEnrich = require('./routes/enrich');
const handleAlerts = require('./routes/alerts');
const handleExport = require('./routes/export');
const handleScrapers = require('./routes/scrapers');
const handleVerifyDocket = require('./routes/verify-docket');
const handleParcelBoundary = require('./routes/parcel-boundary');
const handlePropertyImage = require('./routes/property-image');
const handlePropertyImageProviders = require('./routes/property-image-providers').createProviderStatusHandler({
  circuits: {
    'google-geocoding': handlePropertyImage.defaultService ? handlePropertyImage.defaultService.geocodingCircuit : null,
    'google-streetview': handlePropertyImage.defaultService ? handlePropertyImage.defaultService.circuit : null
  },
  cache: handlePropertyImage.defaultService ? handlePropertyImage.defaultService.panoramaxCache : null
});
const handleSourceNetwork = require('./routes/source-network');
const handlePropertyIntelligence = require('./routes/property-intelligence');
const handlePropertySignals = require('./routes/property-signals');
const handleHunts = require('./routes/hunts');
const handleAccounts = require('./routes/accounts');
const handleWorkspace = require('./routes/workspace');
const handleDocumentReview = require('./routes/document-review');
const handleCoverage = require('./routes/coverage');
const handleEnrichmentGateway = require('./routes/enrichment').createEnrichmentHandler();
const handleWatchlistComps = require('./routes/watchlist-comps').createWatchlistCompsHandler();
const handleNeighborhoods = require('./routes/neighborhoods').createNeighborhoodsHandler();
const handleAuctionCalendar = require('./routes/auction-calendar').createAuctionCalendarHandler();
const savedSearchesHandlers = require('./routes/saved-searches').createSavedSearchesHandler({ database: db });
const handlePortfolioDashboard = require('./routes/portfolio-dashboard').createPortfolioDashboardHandler();
const handlePropertyComparison = require('./routes/property-comparison').createPropertyComparisonHandler();
const handlePriceDrop = require('./routes/price-drop').createPriceDropHandler();
const { handleDecisionPacket } = require('./routes/decision-packet');
const handleFederalHazards = require('./routes/federal-hazards');
const scheduler = require('./scrapers/scheduler');
const { discoveryReadiness, probeDiscoveryDatabase } = require('./discovery-readiness');

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;
const configuredApiLimit = Number(process.env.PROPERTY_API_RATE_LIMIT);
const apiLimiter = createApiRatePolicy({
  windowMs: 60000,
  maxRequests: Number.isInteger(configuredApiLimit) && configuredApiLimit >= 1 && configuredApiLimit <= 10000 ? configuredApiLimit : 120,
});

let lastHealthCache = { timestamp: 0, freshness: null, observationStore: null };
const HEALTH_CACHE_TTL_MS = 120000;

/** Each source's declared refresh cadence, keyed by the adapter key records carry. */
function sourceCadences() {
  try {
    const { SOURCE_CATALOG, servesListings } = require('./sources/catalog');
    const catalog = SOURCE_CATALOG || [];
    const cadences = {};
    for (const source of catalog) {
      const key = source.adapterKey || source.id;
      if (typeof servesListings === 'function' && !servesListings(key)) {
        continue;
      }
      const hours = source.workflow && source.workflow.cadenceHours;
      if (key && Number.isFinite(Number(hours)) && Number(hours) > 0) {
        cadences[key] = Number(hours);
      }
    }
    return cadences;
  } catch {
    // No catalog, no per-source cadences: the caller falls back to the flat
    // window rather than inventing cadences.
    return {};
  }
}

let healthProbeInFlight = null;
async function refreshHealthDiagnostics(options = {}) {
  const force = Boolean(options && options.force);
  if (healthProbeInFlight) return healthProbeInFlight;
  if (!force && lastHealthCache.timestamp > 0 && (db._activeBgDbTasks || 0) >= (db._maxBgDbConcurrency || 1)) {
    return lastHealthCache;
  }
  const runProbe = async () => {
    const freshnessRes = (typeof db.inventoryFreshness === 'function')
      ? await Promise.race([
          db.inventoryFreshness(Date.now(), { cadences: sourceCadences() }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('freshness_probe_timeout')), 10000)),
        ]).catch(error => ({ error: String(error && error.message ? error.message : error).slice(0, 160) }))
      : null;

    const obsRes = await Promise.race([
      (() => {
        const { observationStoreStats } = require('./db/observations-persistence');
        return observationStoreStats(db.pool);
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('stats_probe_timeout')), 10000)),
    ]).catch(error => ({ store: 'postgres', error: String(error && error.message ? error.message : error).slice(0, 160) }));

    return { freshnessRes, obsRes };
  };
  healthProbeInFlight = (async () => {
    try {
      const { freshnessRes, obsRes } = (!force && typeof db.runBackgroundDbTask === 'function')
        ? await db.runBackgroundDbTask(runProbe, { yieldToWeb: true, maxWebWaitMs: 3000 })
        : await runProbe();
      const now = Date.now();
      const freshnessIsError = Boolean(freshnessRes && freshnessRes.error);
      const obsIsError = Boolean(obsRes && obsRes.error);

      const nextFreshness = (!freshnessIsError || !lastHealthCache.freshness || lastHealthCache.freshness.error)
        ? freshnessRes
        : lastHealthCache.freshness;

      const nextObs = (!obsIsError || !lastHealthCache.observationStore || lastHealthCache.observationStore.error)
        ? obsRes
        : lastHealthCache.observationStore;

      lastHealthCache = { timestamp: now, freshness: nextFreshness, observationStore: nextObs };
      return lastHealthCache;
    } finally {
      healthProbeInFlight = null;
    }
  })();
  return healthProbeInFlight;
}

function configuredCorsOrigins(env = process.env) {
  return new Set(String(env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean));
}

function isCorsOriginAllowed(origin, req, env = process.env) {
  if (!origin) return true;
  const allowed = configuredCorsOrigins(env);
  // PUBLIC_APP_ORIGIN is the explicit public UI origin. Never derive the
  // allowlist from the request Host header (client-influenced / rebinding).
  const publicApp = String(env.PUBLIC_APP_ORIGIN || '').trim();
  if (publicApp) allowed.add(publicApp);
  return allowed.has(origin);
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    let settled = false;
    const done = (nextBody) => {
      if (settled) return;
      settled = true;
      req.body = nextBody;
      resolve();
    };
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) { // 2MB max
        req.socket.destroy();
        done({}); // don't hang the await after destroying the socket
      }
    });
    req.on('end', () => {
      try {
        done(body ? JSON.parse(body) : {});
      } catch (_) {
        done({});
      }
    });
    // If the underlying socket dies mid-request (client abort, reset),
    // 'end' never fires — resolve instead of leaking the pending await.
    req.on('close', () => done({}));
    req.on('error', () => done({}));
  });
}

function decorateResponse(res) {
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.send = (body) => {
    res.end(body);
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

async function handleRequest(req, res) {
  decorateResponse(res);

  // Security Headers (modern Helmet-style)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; frame-src https:;");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');

  const requestOrigin = req.headers.origin;
  const corsAllowed = isCorsOriginAllowed(requestOrigin, req);
  if (requestOrigin && corsAllowed) res.setHeader('Access-Control-Allow-Origin', requestOrigin);

  if (req.method === 'OPTIONS') {
    return corsAllowed
      ? res.status(204).send('')
      : res.status(403).json({ error: 'Cross-origin request denied' });
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Rate limiter check for API routes
  if (url.pathname.startsWith('/api/')) {
    if (!corsAllowed) return res.status(403).json({ error: 'Cross-origin request denied' });
    // Rejected requests end synchronously without calling next(). Do not leave
    // an unresolved Promise/handler behind on every throttled request.
    let allowed = false;
    apiLimiter(req, res, () => { allowed = true; });
    if (!allowed) return;

    await parseJsonBody(req);

    const isHealthPing = url.pathname === '/api/health' || url.pathname === '/api/scrapers/health';
    const webQueryTracked = !isHealthPing && typeof db.enterWebQuery === 'function';
    const routeStartedAt = Date.now();
    if (webQueryTracked) db.enterWebQuery();
    try {
      if (url.pathname === '/api/health/ready') {
        try {
          const readiness = await discoveryReadiness({ databaseProbe: () => probeDiscoveryDatabase(db.pool) });
          return res.status(readiness.ready ? 200 : 503).json(readiness);
        } catch (err) {
          console.warn('[api/health/ready] failed:', err?.message || err);
          return res.status(503).json({ ready: false, error: err?.message || 'Readiness check failed' });
        }
      }
      if (process.env.DISCOVERY_MODE === 'advanced' && !db.isPg && url.pathname !== '/api/health') {
        return res.status(503).json({ error: 'Advanced discovery requires PostgreSQL. No demo inventory was substituted.' });
      }

      // API Routes Routing
      if (url.pathname === '/api/listings/compare') {
        return await handlePropertyComparison(req, res, url);
      }
      const packetMatch = url.pathname.match(/^\/api\/listings\/(.+?)\/(?:packet|decision-packet)$/);
      if (packetMatch) {
        return await handleDecisionPacket(req, res, url);
      }
      if (url.pathname.startsWith('/api/listings')) return await handleListings(req, res);
      if (url.pathname === '/api/parse') return await handleParse(req, res);
      if (url.pathname === '/api/enrich') return await handleEnrich(req, res);
      if (url.pathname === '/api/alerts') return await handleAlerts(req, res);
      if (url.pathname === '/api/export') return await handleExport(req, res);
      if (url.pathname === '/api/verify-docket') return await handleVerifyDocket(req, res);
      if (url.pathname === '/api/parcel-boundary') return await handleParcelBoundary(req, res);
      if (url.pathname === '/api/federal-hazards') return await handleFederalHazards(req, res);
      if (url.pathname === '/api/property-image') return await handlePropertyImage(req, res);
      if (url.pathname === '/api/property-image/providers') return await handlePropertyImageProviders(req, res);
      if (url.pathname === '/api/property-intelligence') return await handlePropertyIntelligence(req, res);
      if (url.pathname === '/api/property-signals') return await handlePropertySignals(req, res);
      if (url.pathname.startsWith('/api/accounts/')) return await handleAccounts(req, res, url);
      if (url.pathname === '/api/hunts' || url.pathname.startsWith('/api/hunts/')) return await handleHunts(req, res, url);
      if (url.pathname === '/api/workspace' || url.pathname.startsWith('/api/workspace/')) return await handleWorkspace(req, res, url);
      if (url.pathname === '/api/document-review' || url.pathname.startsWith('/api/document-review/')) return await handleDocumentReview(req, res, { database: db });
      if (url.pathname === '/api/source-network' || url.pathname.startsWith('/api/source-network/')) return await handleSourceNetwork(req, res);
      if (url.pathname.startsWith('/api/scrapers')) return await handleScrapers(req, res);
      if (url.pathname === '/api/sources') {
        try {
          const sources = await db.getSources();
          return res.json(sources);
        } catch (err) {
          console.warn('[api/sources] failed:', err?.message || err);
          return res.status(503).json({ error: err?.message || 'Sources unavailable' });
        }
      }
      if (url.pathname.startsWith('/api/sources/')) return await handleSourceNetwork(req, res);
      if (url.pathname === '/api/coverage') {
        return await handleCoverage(req, res);
      }
      if (url.pathname === '/api/enrichment' || url.pathname.startsWith('/api/enrichment/')) {
        return await handleEnrichmentGateway(req, res);
      }
      if (url.pathname.startsWith('/api/watchlist/')) {
        return await handleWatchlistComps(req, res, url);
      }
      if (url.pathname === '/api/neighborhoods' || url.pathname.startsWith('/api/neighborhoods/')) {
        return await handleNeighborhoods(req, res, url);
      }
      if (url.pathname === '/api/auction-calendar' || url.pathname.startsWith('/api/auction-calendar/')) {
        return await handleAuctionCalendar(req, res, url);
      }
      if (url.pathname === '/api/saved-searches' || url.pathname.startsWith('/api/saved-searches/')) {
        return await savedSearchesHandlers.handleSavedSearches(req, res, url);
      }
      if (url.pathname === '/api/alerts/matches' || url.pathname.startsWith('/api/alerts/matches/')) {
        return await savedSearchesHandlers.handleAlertMatches(req, res, url);
      }
      if (url.pathname === '/api/portfolio/dashboard' || url.pathname.startsWith('/api/portfolio/')) {
        return await handlePortfolioDashboard(req, res, url);
      }
      if (url.pathname === '/api/price-drops') {
        return await handlePriceDrop(req, res, url);
      }
    } finally {
      if (webQueryTracked) db.leaveWebQuery();
      const routeElapsedMs = Date.now() - routeStartedAt;
      if (routeElapsedMs > 2000) {
        console.warn('[api] slow route:', req.method, url.pathname, `${routeElapsedMs}ms`);
      }
    }
    if (url.pathname === '/api/health') {
      const { defaultStorePath } = require('./intelligence/document-review-store');
      const unavailableReason = db.inventoryUnavailableReason();
      // Freshness and observation store facts are secondary diagnostics, not preconditions.
      // Freshness and observation store facts are secondary diagnostics, not preconditions.
      // Cache with stale-while-revalidate so health checks respond in <1ms without DB lock contention or WAN delay.
      const now = Date.now();
      const hasFreshness = Boolean(lastHealthCache.freshness && !lastHealthCache.freshness.error);
      const isFresh = (now - lastHealthCache.timestamp < HEALTH_CACHE_TTL_MS);
      let freshness = null;
      let observationStore = null;

      if (url.searchParams.get('refresh') === '1') {
        await refreshHealthDiagnostics({ force: true });
        freshness = lastHealthCache.freshness;
        observationStore = lastHealthCache.observationStore;
      } else {
        if (!lastHealthCache.timestamp || !isFresh) {
          refreshHealthDiagnostics().catch(() => {});
        }
        freshness = lastHealthCache.freshness;
        observationStore = lastHealthCache.observationStore;
      }
      return res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        release: { commit: /^[a-f0-9]{40}$/i.test(process.env.RENDER_GIT_COMMIT || process.env.PROPERTY_RELEASE_SHA || '')
          ? (process.env.RENDER_GIT_COMMIT || process.env.PROPERTY_RELEASE_SHA) : null },
        // Honest runtime mode — a Pool object is not a connection.
        dataMode: db.dataMode(),
        snapshotEvidence: require('./scrapers/discovery-snapshots').evidenceStoreHealth(),
        postgresConfigured: Boolean(process.env.DATABASE_URL),
        postgresReachable: db.postgresReachable === true,
        ...(db.databaseCapabilities
          ? {
              databaseFunctional: db.databaseCapabilities.functional === true,
              ...(db.databaseCapabilities.missing && db.databaseCapabilities.missing.length
                ? { databaseMissing: db.databaseCapabilities.missing }
                : {}),
            }
          : {}),
        ...(db.postgresEngine ? { postgresEngine: db.postgresEngine } : {}),
        ...(db.postgresError ? { postgresError: db.postgresError } : {}),
        // Why this process is or is not collecting. DISCOVERY_MODE=advanced
        // turns the in-process scraper off even when SCRAPER_BACKGROUND_ENABLED=1.
        // running plus startedAt distinguishes that switch from a cycle still
        // inside the first collectors. No secrets.
        collection: scheduler.collectionRuntimeStatus(scheduler, process.env),
        // The one thing a caller needs when dataMode is 'unavailable': why.
        // 'ok' above describes the process, not the inventory, and the two must
        // not be read as the same claim.
        ...(unavailableReason ? { inventoryUnavailableReason: unavailableReason } : {}),
        // In demo mode the inventory IS the seed. A seed that failed leaves a
        // healthy server serving zero listings, so say so here rather than only
        // in the boot log. Undefined in Postgres mode, where it does not apply.
        ...(typeof db.seeded === 'boolean' ? { seeded: db.seeded } : {}),
        ...(db.seedError ? { seedError: db.seedError } : {}),
        // Same argument, one level down: an unreadable store reads as an empty
        // one. Both stores move the unreadable file aside on a failed load so a
        // later write cannot destroy it, and both say so here.
        ...(db.workspaceStoreError ? { workspaceStoreError: db.workspaceStoreError } : {}),
        ...(db.workspaceStoreQuarantined ? { workspaceStoreQuarantinedTo: db.workspaceStoreQuarantined } : {}),
        ...(db._workspaceStoreWriteBlocked ? { workspaceStoreWritesBlocked: true } : {}),
        ...(() => {
          // The module-scope name is handleDocumentReview; `docReview` is a
          // const declared much further down, inside the test-reset hook, and
          // referencing it here threw a ReferenceError that surfaced as a 503
          // from /api/health. Caught by test/api-rate-http.test.js.
          const reviewRoute = handleDocumentReview;
          const store = reviewRoute && reviewRoute._getStore ? reviewRoute._getStore() : null;
          if (!store || !store.loadError) return {};
          return {
            documentReviewStoreError: store.loadError,
            ...(store.quarantined ? { documentReviewStoreQuarantinedTo: store.quarantined } : {}),
            ...(store.writesBlocked ? { documentReviewStoreWritesBlocked: true } : {}),
          };
        })(),
        documentReviewStore: db.isPg ? 'postgres' : (defaultStorePath(process.env) ? 'file' : 'none'),
        documentReviewStorePath: db.isPg ? null : (defaultStorePath(process.env) || null),
        // How old the newest observation is. A database full of rows is not the
        // same claim as an inventory somebody checked today, and the difference
        // is exactly what a buyer is relying on when they read "active".
        ...(freshness ? { inventoryFreshness: freshness } : {}),
        // The observation store's Postgres facts. A failed read still reports
        // the store with its error rather than vanishing from the payload.
        ...(observationStore ? { observationStore } : {}),
        ...(process.env.WORKSPACE_BOOT_ID ? { workspaceBootId: process.env.WORKSPACE_BOOT_ID } : {}),
      });
    }

    return res.status(404).json({ error: 'API endpoint not found' });
  }

  // Static File Serving
  // On Windows, URL pathnames keep backslashes intact (the URL spec does not
  // treat "\" as a separator), so "/..\..\..." would resolve outside the
  // project root via path.join. Normalise separators, then refuse anything
  // that escapes the web root.
  const webRoot = path.join(__dirname, '..');
  const rawPath = (url.pathname === '/' ? '/index.html' : url.pathname).replace(/\\/g, '/');
  // The legacy UI may serve public assets, never workspace code, environment
  // files, credentials, logs, or database snapshots.
  const publicFiles = new Set(['/index.html', '/app.js', '/data.js', '/manifest.json', '/icon.svg', '/sw.js', '/styles.css']);
  const publicAsset = /^\/(?:icons|vendor|public)\/(?!.*(?:^|\/)\.)(?:[A-Za-z0-9_./-])+\.(?:png|jpe?g|gif|webp|svg|ico|js|css|woff2?|ttf)$/i.test(rawPath);
  if (!publicFiles.has(rawPath) && !publicAsset) return res.status(404).send('Not Found');
  let filePath = path.resolve(webRoot, '.' + rawPath);
  // Use path.relative() to detect traversal — it works correctly on
  // case-insensitive Windows NTFS and handles all separator variants.
  const rel = path.relative(webRoot, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    filePath = path.join(webRoot, 'index.html');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(webRoot, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return res.status(404).send('Not Found');
    }
    res.setHeader('Content-Type', contentType);
    res.send(data);
  });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error('[API] Request failed:', error.code || error.name);
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Property data service is unavailable. Existing evidence was preserved.' }));
    } else res.end();
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

/**
 * Bring up the embedded PostgreSQL engine when it is asked for.
 *
 * `PROPERTY_DB=embedded` (or a bare `PROPERTY_PG_DATA_DIR`) starts a real
 * PostgreSQL engine in-process against a directory on disk. It exists because
 * `.env.local` names postgres://localhost:5432 and nothing listens there on
 * this machine, and the alternative used to be serving seeded in-memory
 * inventory - which is not inventory.
 *
 * Off Render it wins over DATABASE_URL only when asked for explicitly, and says
 * so in the log when it does. An unset PROPERTY_DB with a set DATABASE_URL
 * always uses the external server. On Render, DATABASE_URL wins even if
 * PROPERTY_DB=embedded is also set: the live inventory is external Postgres,
 * and a blueprint that sets PROPERTY_DB must not hide it. A DATABASE_URL that
 * is set but unreachable is reported as an outage, never quietly replaced.
 */
async function attachEmbeddedDatabaseIfRequested() {
  const { resolveDatabaseTarget, databaseTargetReason } = require('./db/database-target');
  const target = resolveDatabaseTarget(process.env);
  const reason = databaseTargetReason(process.env);
  if (reason) console.log(`[Server] ${reason}`);
  if (target !== 'embedded') return null;

  const { startEmbeddedPostgres } = require('./db/pglite-pool');
  const started = await startEmbeddedPostgres({ log: console.log });
  const { migrate } = require('../scripts/discovery-migrate');
  await migrate(started.pool);
  db.attachPostgres(started.pool, started.engine);
  console.log('[Server] discovery migrations applied to the embedded database');
  return started;
}

async function startServer() {
  await attachEmbeddedDatabaseIfRequested();

  const refreshDbCapabilities = async (timeoutMs = 5000) => {
    if (db.postgresReachable !== true || !db.pool) return;
    if (typeof db.hasAcceleratedDiscovery === 'function') {
      await Promise.race([
        db.hasAcceleratedDiscovery({ forceRefresh: true }).catch(() => false),
        new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
      ]);
    }
    try {
      const { probeDatabaseCapabilities } = require('./db/database-capabilities');
      const probed = await Promise.race([
        probeDatabaseCapabilities(db.pool),
        new Promise((_, reject) => setTimeout(() => reject(new Error('capability_probe_timeout')), timeoutMs).unref()),
      ]);
      db.databaseCapabilities = probed;
      if (db.databaseCapabilities.functional) {
        console.log(`[DB] DATABASE_URL is fully functional (${db.databaseCapabilities.version}, PostGIS ${db.databaseCapabilities.postgisVersion})`);
      } else {
        console.warn(`[DB] DATABASE_URL is connected but not fully functional: ${db.databaseCapabilities.missing.join(', ')}`);
      }
    } catch (probeErr) {
      db.databaseCapabilities = {
        functional: false,
        missing: [String(probeErr && probeErr.message ? probeErr.message : probeErr).slice(0, 200)],
        version: null,
        postgisVersion: null,
      };
      console.warn('[DB] DATABASE_URL capability probe deferred:', db.databaseCapabilities.missing[0]);
    }
  };

  let migrationDeferred = false;
  const initializePostgresRuntime = async () => {
    if (typeof db.verifyConnection !== 'function') return false;
    const connected = await db.verifyConnection();
    if (!connected) return false;
    if (db.isPg && db.pool && (process.env.AUTO_MIGRATE === '1' || process.env.DISCOVERY_MIGRATE === '1')) {
      try {
        const { migrate } = require('../scripts/discovery-migrate');
        await migrate(db.pool, { statementTimeoutMs: 45000 });
        migrationDeferred = false;
        console.log('[Server] discovery migrations verified and applied to database');
      } catch (migErr) {
        migrationDeferred = true;
        console.warn('[Server] auto-migration warning (will retry after cutover):', migErr.message);
      }
    }
    await refreshDbCapabilities(15000);
    wireStoresAfterVerify(db);
    return true;
  };

  await initializePostgresRuntime();

  // Ensure stores stay wired when starting without Postgres verified yet.
  if (!db.isPg) {
    wireStoresAfterVerify(db);
  }

  server.listen(PORT, () => {
    console.log(`[Server] PROPERTY_CRAWL production server listening on http://localhost:${PORT}`);
    console.log(`[Server] dataMode=${db.dataMode()} postgresReachable=${db.postgresReachable === true}\n`);
    const reason = db.inventoryUnavailableReason();
    if (reason) console.log(`[Server] NO INVENTORY WILL BE SERVED - ${reason}\n`);
    let bootMaintenancePromise = Promise.resolve();
    const transientPgBootFailure = !db.isPg
      && Boolean((db.env && db.env.DATABASE_URL) || process.env.DATABASE_URL)
      && /timeout|terminat|reset|too many|authentication did not complete/i.test(db.postgresError || '');
    if (process.env.NODE_ENV !== 'test' && (db.isPg || transientPgBootFailure)) {
      if (db.isPg) refreshHealthDiagnostics().catch(() => {});
      bootMaintenancePromise = new Promise((resolve) => {
        setTimeout(async () => {
          try {
            if (!db.isPg && transientPgBootFailure && typeof db.init === 'function') {
              const backoffMs = [0, 15000, 25000];
              for (let i = 0; i < backoffMs.length; i += 1) {
                if (backoffMs[i] > 0) await new Promise((r) => setTimeout(r, backoffMs[i]));
                console.log(`[Server] Retrying transient PostgreSQL connection post-cutover (attempt ${i + 1}/${backoffMs.length})...`);
                db.init();
                if (await initializePostgresRuntime()) {
                  refreshHealthDiagnostics().catch(() => {});
                  break;
                }
              }
            }
            if (db.isPg && migrationDeferred && db.pool && (process.env.AUTO_MIGRATE === '1' || process.env.DISCOVERY_MIGRATE === '1')) {
              try {
                const { migrate } = require('../scripts/discovery-migrate');
                await migrate(db.pool, { statementTimeoutMs: 45000 });
                migrationDeferred = false;
                console.log('[Server] deferred discovery migrations applied post-cutover');
              } catch (retryMigErr) {
                console.warn('[Server] deferred auto-migration warning:', retryMigErr && retryMigErr.message ? retryMigErr.message : retryMigErr);
              }
            }
            if (db.isPg) {
              await refreshDbCapabilities(15000);
            }
            if (db.isPg && typeof db.purgeStaleListings === 'function') {
              const res = await db.purgeStaleListings({ batchSize: 200, maxBatches: 40, batchPauseMs: 25, maxDurationMs: 15000 });
              console.log(
                `[Server] Boot inventory purge removed ${res?.deleted || 0} stale/archive listings, ${res?.observationsDeleted || 0} stale observations, and ${res?.snapshotsDeleted || 0} stale snapshots.`,
              );
              refreshHealthDiagnostics().catch(() => {});
            }
          } catch (err) {
            console.warn('[Server] Boot maintenance warning:', err && err.message ? err.message : err);
          } finally {
            resolve();
          }
        }, 20000).unref();
      });
    }
    if (!scheduler.shouldAllowRealScrapers(process.env)) {
      console.log('[Server] Background scrapers disabled for this test/offline environment.');
      return;
    }
    if (!scheduler.backgroundCollectionEnabled(process.env)) {
      console.log('[Server] Manual source collection enabled; background collection is disabled.');
      return;
    }

    // The two-process host defers expensive collection until after UI boot.
    const rawBootDelay = process.env.SCRAPER_BOOT_DELAY_MS;
    const configuredBootDelay = rawBootDelay != null && rawBootDelay !== '' ? Number(rawBootDelay) : NaN;
    const bootDelay = Number.isFinite(configuredBootDelay) && configuredBootDelay >= 0 ? Math.min(configuredBootDelay,300000) : 5000;
    if (process.env.RENDER === 'true' && !process.env.SCRAPER_CONCURRENCY && scheduler.concurrency > 2) {
      scheduler.concurrency = 2;
    }
    const MAX_CONTINUATIONS_PER_CYCLE = 2;
    const runCycleWithMaintenance = async () => {
      await scheduler.runAll();
      if (db.isPg && typeof db.purgeStaleListings === 'function') {
        try {
          const res = await db.purgeStaleListings({ batchSize: 200, maxBatches: 30, batchPauseMs: 25, maxDurationMs: 12000 });
          if ((res?.deleted || 0) > 0 || (res?.observationsDeleted || 0) > 0) {
            console.log(`[Server] Post-cycle purge removed ${res?.deleted || 0} stale listings and ${res?.observationsDeleted || 0} stale observations.`);
          }
          refreshHealthDiagnostics().catch(() => {});
        } catch (purgeErr) {
          console.warn('[Server] Post-cycle purge warning:', purgeErr && purgeErr.message ? purgeErr.message : purgeErr);
        }
      }
      scheduleContinuation();
    };
    const CONTINUATION_DELAY_MS = 120000;
    let continuationsThisCycle = 0;
    const scheduleContinuation = () => {
      if (continuationsThisCycle >= MAX_CONTINUATIONS_PER_CYCLE) return;
      const due = scheduler.dueScrapers(scheduler.listingServingScrapers);
      const hasPartial = due.some((s) => {
        const last = scheduler.sourceLastRun.get(s.sourceKey);
        return last && (last.partial || (last.failed && (last.retries || 0) < 3));
      });
      if (hasPartial && !scheduler.isRunning) {
        continuationsThisCycle += 1;
        console.log(`[Server] Partial or retryable scraper sweeps require continuation (${continuationsThisCycle}/${MAX_CONTINUATIONS_PER_CYCLE}). Scheduling follow-up pass in ${Math.round(CONTINUATION_DELAY_MS / 1000)}s...`);
        setTimeout(() => {
          if (!scheduler.isRunning) {
            runCycleWithMaintenance().catch((err) => console.error('[Server] Continuation sweep error:', err));
          }
        }, CONTINUATION_DELAY_MS).unref();
      }
    };
    setTimeout(() => {
      Promise.race([
        bootMaintenancePromise,
        new Promise((resolve) => setTimeout(resolve, 180000).unref()),
      ])
        .catch(() => {})
        .then(() => runCycleWithMaintenance())
        .catch(err => console.error('[Server] Scheduler failed on boot:', err));
    }, bootDelay);

    // Recurring automated ingestion (default every 6 hours)
    const scrapeIntervalHours = scheduler.parseScrapeIntervalHours(process.env.SCRAPE_INTERVAL_HOURS);
    const intervalMs = scrapeIntervalHours * 60 * 60 * 1000;
    setInterval(() => {
      console.log(`[Server] Triggering scheduled ${scrapeIntervalHours}h ingestion cycle...`);
      continuationsThisCycle = 0;
      runCycleWithMaintenance().catch(err => console.error('[Server] Scheduled scrape failed:', err));
    }, intervalMs);
  });
}

if (require.main === module) {
  let shuttingDown = false;
  const gracefulShutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      try {
        if (typeof db.close === 'function') {
          await db.close();
          console.log('[Server] Database connections closed.');
        }
      } catch (err) {
        console.error('[Server] Error closing database:', err.message);
      }
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[Server] Shutdown deadline exceeded. Forcefully exiting.');
      process.exit(1);
    }, 5000).unref();
  };
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  startServer().catch((error) => {
    console.error('[Server] Startup failed:', error && error.message ? error.message : error);
    process.exit(1);
  });
}

/**
 * After verifyConnection has run, re-initialize stores that were created early
 * (in demo mode) so they pick up a real pg pool when DATABASE_URL is reachable.
 * This is the central "connect the database" point for operator surfaces.
 */
function wireStoresAfterVerify(database) {
  try {
    const docReview = require('./routes/document-review');
    if (typeof docReview._resetForTests === 'function' && database && database.pool) {
      // Re-create the store with the verified pool. Safe no-op in demo.
      docReview._resetForTests({ pool: database.pool, env: process.env });
    }
  } catch (e) {
    // Non-fatal; document review will stay on its current (file) store.
  }

  // Hunts durable path already inspects database.isPg + DISCOVERY_MODE at request time.
  // Saved-searches and alert matches use the database client passed at handler creation
  // (which has in-memory fallbacks that persist to workspace store when !isPg).
}

module.exports = server;
module.exports.configuredCorsOrigins = configuredCorsOrigins;
module.exports.isCorsOriginAllowed = isCorsOriginAllowed;
