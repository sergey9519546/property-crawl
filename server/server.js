const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db/client');
const MemoryRateLimiter = require('./security/rate_limiter');
const handleListings = require('./routes/listings');
const handleParse = require('./routes/parse');
const handleEnrich = require('./routes/enrich');
const handleAlerts = require('./routes/alerts');
const handleExport = require('./routes/export');
const handleScrapers = require('./routes/scrapers');
const handleVerifyDocket = require('./routes/verify-docket');
const handleParcelBoundary = require('./routes/parcel-boundary');
const handlePropertyImage = require('./routes/property-image');
const handleSourceNetwork = require('./routes/source-network');
const handlePropertyIntelligence = require('./routes/property-intelligence');
const handlePropertySignals = require('./routes/property-signals');
const handleHunts = require('./routes/hunts');
const handleWorkspace = require('./routes/workspace');
const scheduler = require('./scrapers/scheduler');
const { discoveryReadiness } = require('./discovery-readiness');

const PORT = process.env.PORT || 3000;
const configuredApiLimit = Number(process.env.PROPERTY_API_RATE_LIMIT);
const rateLimiter = new MemoryRateLimiter({
  windowMs: 60000,
  maxRequests: Number.isInteger(configuredApiLimit) && configuredApiLimit >= 1 && configuredApiLimit <= 10000 ? configuredApiLimit : 120,
});
const apiLimiter = rateLimiter.middleware();

function configuredCorsOrigins(env = process.env) {
  return new Set(String(env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean));
}

function isCorsOriginAllowed(origin, req, env = process.env) {
  if (!origin) return true;
  const allowed = configuredCorsOrigins(env);
  try {
    const requestOrigin = `http://${req.headers.host || 'localhost'}`;
    return origin === requestOrigin || allowed.has(origin);
  } catch (_) {
    return false;
  }
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

  // Security Headers (Helmet equivalents)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
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

    if (url.pathname === '/api/health/ready') {
      const readiness = await discoveryReadiness({ databaseProbe: async () => {
        if (!db.pool) throw new Error('PostgreSQL is not configured');
        await db.pool.query('SELECT 1 FROM discovery_source_runs LIMIT 1');
        await db.pool.query('SELECT 1 FROM discovery_atlas_sources LIMIT 1');
      } });
      return res.status(readiness.ready ? 200 : 503).json(readiness);
    }
    if (process.env.DISCOVERY_MODE === 'advanced' && !db.pool && url.pathname !== '/api/health') {
      return res.status(503).json({ error: 'Advanced discovery requires PostgreSQL. No demo inventory was substituted.' });
    }

    // API Routes Routing
    if (url.pathname.startsWith('/api/listings')) return handleListings(req, res);
    if (url.pathname === '/api/parse') return handleParse(req, res);
    if (url.pathname === '/api/enrich') return handleEnrich(req, res);
    if (url.pathname === '/api/alerts') return handleAlerts(req, res);
    if (url.pathname === '/api/export') return handleExport(req, res);
    if (url.pathname === '/api/verify-docket') return handleVerifyDocket(req, res);
    if (url.pathname === '/api/parcel-boundary') return handleParcelBoundary(req, res);
    if (url.pathname === '/api/property-image') return handlePropertyImage(req, res);
    if (url.pathname === '/api/property-intelligence') return handlePropertyIntelligence(req, res);
    if (url.pathname === '/api/signals' || url.pathname === '/api/property-signals') return handlePropertySignals(req, res);
    if (url.pathname === '/api/hunts' || url.pathname.startsWith('/api/hunts/')) return handleHunts(req, res, url);
    if (url.pathname === '/api/workspace' || url.pathname.startsWith('/api/workspace/')) return handleWorkspace(req, res, url);
    if (url.pathname === '/api/source-network' || url.pathname.startsWith('/api/source-network/')) return handleSourceNetwork(req, res);
    if (url.pathname.startsWith('/api/scrapers')) return handleScrapers(req, res);
    if (url.pathname === '/api/sources') {
      const sources = await db.getSources();
      return res.json(sources);
    }
    if (url.pathname === '/api/health') {
      return res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
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

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[Server] PROPERTY_CRAWL production server listening on http://localhost:${PORT}\n`);
    if (!scheduler.shouldAllowRealScrapers(process.env)) {
      console.log('[Server] Background scrapers disabled for this test/offline environment.');
      return;
    }
    if (process.env.SCRAPER_BACKGROUND_ENABLED !== '1' || process.env.DISCOVERY_MODE === 'advanced') {
      console.log('[Server] Manual source collection enabled; background collection is disabled.');
      return;
    }

    // Boot real data scrapers after initial server banner prints
    setTimeout(() => {
      scheduler.runAll().catch(err => console.error('[Server] Scheduler failed on boot:', err));
    }, 500);

    // Recurring automated ingestion (default every 6 hours)
    const scrapeIntervalHours = scheduler.parseScrapeIntervalHours(process.env.SCRAPE_INTERVAL_HOURS);
    const intervalMs = scrapeIntervalHours * 60 * 60 * 1000;
    setInterval(() => {
      console.log(`[Server] Triggering scheduled ${scrapeIntervalHours}h ingestion cycle...`);
      scheduler.runAll().catch(err => console.error('[Server] Scheduled scrape failed:', err));
    }, intervalMs);
  });
}

module.exports = server;
module.exports.configuredCorsOrigins = configuredCorsOrigins;
module.exports.isCorsOriginAllowed = isCorsOriginAllowed;
