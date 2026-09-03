/**
 * next-adapter.js
 *
 * Bridges v1's Express-like `(req, res)` handlers to Next.js App Router's
 * `(request) => Response` route shape. Each v1 handler was written against
 * the simple server in `server/server.js` which decorated `res` with
 * `.status()`, `.json()`, `.send()`. This adapter provides the same
 * surface and captures the output into a single `Response` the framework
 * can serve.
 *
 * Design note: the adapter is intentionally NOT composed by wrapping
 * (withSecurityHeaders(adapt(handler))) — that breaks because the inner
 * adapt() returns its own Response, leaving the outer's mockRes with an
 * empty body. Instead, callers pass `options.headers` / `options.cors` to
 * a single `adapt()` call so the headers and the body share one mockRes.
 *
 * Usage in src/app/api/<name>/route.ts:
 *
 *   import { adapt } from '@/lib/next-adapter';
 *   import handleListings from '@/lib/server-routes/listings';
 *   export const GET = adapt(handleListings, { securityHeaders: true });
 *   export const POST = GET;
 */

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
const REQUEST_LINE_MAX = 8 * 1024;            // 8 KB

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Conservative default-src; tighten once a real frontend talks to this.
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
});

class MockResponse {
  constructor() {
    this.statusCode = 200;
    this.headers = new Map();
    this._body = null;
    this._ended = false;
    this.writableEnded = false;
  }

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  getHeader(name) {
    return this.headers.get(name.toLowerCase());
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  json(data) {
    if (this._ended) return this;
    this._ended = true;
    this.writableEnded = true;
    this._body = JSON.stringify(data);
    this.setHeader('Content-Type', 'application/json');
    return this;
  }

  send(body) {
    if (this._ended) return this;
    this._ended = true;
    this.writableEnded = true;
    this._body = body == null ? '' : String(body);
    if (!this.getHeader('Content-Type')) {
      this.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    return this;
  }

  end(body) {
    return this.send(body);
  }
}

async function buildMockReq(request) {
  const url = new URL(request.url);
  let body = {};
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const contentType = (request.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const text = await request.text();
      if (text.length > MAX_JSON_BODY_BYTES) {
        const err = new Error('Request body exceeds 2 MB limit');
        err.statusCode = 413;
        throw err;
      }
      if (text) {
        try { body = JSON.parse(text); } catch (_) { body = {}; }
      }
    }
  }
  return {
    method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
    body
  };
}

function buildResponse(mockRes) {
  const headers = new Headers();
  for (const [k, v] of mockRes.headers.entries()) {
    headers.set(k, v);
  }
  return new Response(mockRes._body == null ? '' : mockRes._body, {
    status: mockRes.statusCode,
    headers
  });
}

/**
 * Convert a v1 handler `(req, res) => Promise|void` into a Next.js route
 * function `(request) => Promise<Response>`. All options are applied
 * in a single mockRes so headers + body stay consistent.
 *
 * @param {Function} handler - v1-style handler
 * @param {Object} [options]
 * @param {boolean} [options.securityHeaders] - apply the standard security headers
 * @param {boolean} [options.cors] - apply permissive CORS (dev preview only)
 */
export function adapt(handler, options = {}) {
  return async function route(request) {
    if (request.url && request.url.length > REQUEST_LINE_MAX) {
      return new Response(
        JSON.stringify({ error: 'Request URL too long', maxBytes: REQUEST_LINE_MAX }),
        { status: 414, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const mockRes = new MockResponse();

    if (options.securityHeaders) {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) mockRes.setHeader(k, v);
    }
    if (options.cors) {
      mockRes.setHeader('Access-Control-Allow-Origin', '*');
      mockRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      mockRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, Authorization');
    }

    let mockReq;
    try {
      mockReq = await buildMockReq(request);
    } catch (err) {
      const status = err.statusCode || 400;
      return new Response(
        JSON.stringify({ error: err.message || 'Bad request' }),
        { status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (mockReq.method === 'OPTIONS') {
      return new Response('', { status: 204, headers: Object.fromEntries(mockRes.headers) });
    }

    try {
      await handler(mockReq, mockRes);
    } catch (err) {
      if (!mockRes._ended) {
        mockRes.status(500).json({ error: 'Internal server error', message: err && err.message });
      }
    }
    return buildResponse(mockRes);
  };
}
