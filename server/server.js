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

const PORT = process.env.PORT || 3000;
const rateLimiter = new MemoryRateLimiter({ windowMs: 60000, maxRequests: 120 });
const apiLimiter = rateLimiter.middleware();

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

const server = http.createServer(async (req, res) => {
  decorateResponse(res);

  // Security Headers (Helmet equivalents)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Rate limiter check for API routes
  if (url.pathname.startsWith('/api/')) {
    await new Promise((next) => apiLimiter(req, res, next));
    if (res.writableEnded) return;

    await parseJsonBody(req);

    // API Routes Routing
    if (url.pathname.startsWith('/api/listings')) return handleListings(req, res);
    if (url.pathname === '/api/parse') return handleParse(req, res);
    if (url.pathname === '/api/enrich') return handleEnrich(req, res);
    if (url.pathname === '/api/alerts') return handleAlerts(req, res);
    if (url.pathname === '/api/export') return handleExport(req, res);
    if (url.pathname === '/api/sources') {
      const sources = await db.getSources();
      return res.json(sources);
    }
    if (url.pathname === '/api/health') {
      return res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
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
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[Server] PROPERTY_CRAWL production server listening on http://localhost:${PORT}`);
  });
}

module.exports = server;
