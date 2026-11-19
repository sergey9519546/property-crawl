const CACHEABLE_PATHS = new Set([
  '/api/coverage',
  '/api/sources',
  '/api/auction-calendar',
  '/api/neighborhoods',
  '/api/property-image/providers',
]);
const NO_STORE_PREFIXES = [
  '/api/property-image',
  '/api/workspace',
  '/api/document-review',
  '/api/scrapers',
  '/api/hunts',
  '/api/watchlist',
  '/api/alerts',
  '/api/saved-searches',
  '/api/account',
  '/api/health',
];
const STANDARD_UPSTREAM_TIMEOUT_MS = 30_000;
const HEAVY_UPSTREAM_TIMEOUT_MS = 180_000;

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  return Response.json(payload, { status, headers });
}

function sanitizeKey(raw) {
  try {
    const decoded = decodeURIComponent(raw).replace(/^\/+/, '');
    if (!decoded || decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) return null;
    return decoded;
  } catch {
    return null;
  }
}

function buildUpstreamHeaders(request, env) {
  const headers = new Headers(request.headers);
  const existingXff = (headers.get('x-forwarded-for') || '').trim();
  const cfIp = (headers.get('cf-connecting-ip') || '').trim();
  if (!existingXff && cfIp) headers.set('x-forwarded-for', cfIp);
  if (cfIp) {
    headers.set('x-pp-client-ip', cfIp);
  } else {
    headers.delete('x-pp-client-ip');
    const firstXff = existingXff.split(',').map((ip) => ip.trim()).find(Boolean);
    if (firstXff) headers.set('x-pp-client-ip', firstXff);
  }
  const edgeSecret = String(env?.EDGE_SHARED_SECRET || '').trim();
  if (edgeSecret) headers.set('x-edge-secret', edgeSecret);
  headers.delete('host');
  return headers;
}

function getUpstreamTimeoutMs(pathname, method) {
  const isHeavy =
    (method === 'POST' && (pathname.startsWith('/api/scrapers') || pathname.startsWith('/api/sources/'))) ||
    pathname.startsWith('/api/neighborhoods') ||
    pathname.startsWith('/api/auction-calendar') ||
    pathname.startsWith('/api/source-network') ||
    pathname.startsWith('/api/export');
  return isHeavy ? HEAVY_UPSTREAM_TIMEOUT_MS : STANDARD_UPSTREAM_TIMEOUT_MS;
}

function safeWaitUntil(ctx, promise, event, path) {
  ctx.waitUntil(
    Promise.resolve(promise).catch((err) => {
      console.error(JSON.stringify({
        event,
        path,
        error: err instanceof Error ? err.message : String(err),
      }));
    })
  );
}

function buildProxyResponse(upstreamRes, method, headers, ctx, path) {
  const isNullBodyStatus = upstreamRes.status === 204 || upstreamRes.status === 205 || upstreamRes.status === 304;
  const dropBody = method === 'HEAD' || isNullBodyStatus;
  if (dropBody && upstreamRes.body) {
    safeWaitUntil(ctx, upstreamRes.body.cancel(), 'upstream_body_cancel_failed', path);
  }
  return new Response(dropBody ? null : upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers,
  });
}

function isTimeoutError(err) {
  if (!err || typeof err !== 'object') return false;
  return err.name === 'TimeoutError' || err.name === 'AbortError';
}

function etagMatchesHeader(ifNoneMatch, obj) {
  if (!ifNoneMatch) return false;
  const trimmed = ifNoneMatch.trim();
  if (trimmed === '*') return true;
  const candidates = trimmed.split(',').map((tag) => tag.trim().replace(/^W\//, ''));
  const httpEtag = (obj.httpEtag || '').replace(/^W\//, '');
  const rawEtag = obj.etag ? '"' + obj.etag + '"' : '';
  return candidates.includes(httpEtag) || (rawEtag && candidates.includes(rawEtag));
}

async function fetchUpstream(upstreamUrl, init, pathname, method) {
  const timeoutMs = getUpstreamTimeoutMs(pathname, method);
  try {
    return {
      ok: true,
      response: await fetch(upstreamUrl.toString(), {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      }),
    };
  } catch (err) {
    const timedOut = isTimeoutError(err);
    console.error(JSON.stringify({
      event: timedOut ? 'upstream_timeout' : 'upstream_fetch_failed',
      method,
      path: pathname,
      timeoutMs,
      error: err instanceof Error ? err.message : String(err),
    }));
    return {
      ok: false,
      response: jsonResponse(
        { error: timedOut ? 'Gateway timeout' : 'Bad gateway' },
        timedOut ? 504 : 502
      ),
    };
  }
}

export default {
  async fetch(request, env, ctx) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return jsonResponse({ error: 'Bad request URL' }, 400);
    }

    try {
      if (url.pathname === '/health' || url.pathname === '/') {
        return jsonResponse({
          ok: true,
          service: 'property-crawl-edge',
          vaultBound: Boolean(env.VAULT),
          originConfigured: Boolean(env.ORIGIN_URL),
        });
      }

      if (url.pathname.startsWith('/vault/public/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return jsonResponse({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' });
        }
        if (!env.VAULT) {
          return jsonResponse({ error: 'Vault R2 binding unavailable' }, 503);
        }
        const key = sanitizeKey(url.pathname.slice('/vault/public/'.length));
        if (!key) {
          return jsonResponse({ error: 'Forbidden key' }, 403);
        }
        const vaultKey = 'public/' + key;

        if (request.method === 'HEAD') {
          const obj = await env.VAULT.head(vaultKey);
          if (!obj) {
            return jsonResponse({ error: 'Not found' }, 404);
          }
          const headers = new Headers();
          obj.writeHttpMetadata(headers);
          headers.set('etag', obj.httpEtag);
          headers.set('accept-ranges', 'bytes');
          headers.set('content-length', String(obj.size));
          headers.set('cache-control', 'public, max-age=300, s-maxage=3600');
          headers.set('x-content-type-options', 'nosniff');
          if (etagMatchesHeader(request.headers.get('if-none-match'), obj)) {
            return new Response(null, { status: 304, headers });
          }
          return new Response(null, { status: 200, headers });
        }

        const obj = await env.VAULT.get(vaultKey, {
          onlyIf: request.headers,
          range: request.headers,
        });
        if (!obj) {
          return jsonResponse({ error: 'Not found' }, 404);
        }
        const headers = new Headers();
        obj.writeHttpMetadata(headers);
        headers.set('etag', obj.httpEtag);
        headers.set('accept-ranges', 'bytes');
        headers.set('cache-control', 'public, max-age=300, s-maxage=3600');
        headers.set('x-content-type-options', 'nosniff');

        if (!('body' in obj)) {
          const isConditionalNotModified =
            (request.headers.has('if-none-match') || request.headers.has('if-modified-since')) &&
            !request.headers.has('if-match') &&
            !request.headers.has('if-unmodified-since');
          return new Response(null, { status: isConditionalNotModified ? 304 : 412, headers });
        }

        let status = 200;
        if (request.headers.has('range') && obj.range && obj.size > 0) {
          const offset = typeof obj.range.offset === 'number'
            ? obj.range.offset
            : (typeof obj.range.suffix === 'number' ? Math.max(0, obj.size - obj.range.suffix) : 0);
          const length = typeof obj.range.length === 'number'
            ? obj.range.length
            : (obj.size - offset);
          if (length > 0 && offset < obj.size) {
            const end = Math.min(obj.size - 1, offset + length - 1);
            headers.set('content-range', `bytes ${offset}-${end}/${obj.size}`);
            headers.set('content-length', String(end - offset + 1));
            status = 206;
          } else {
            headers.set('content-length', String(obj.size));
          }
        } else {
          headers.set('content-length', String(obj.size));
        }

        return new Response(obj.body, { status, headers });
      }

      if (url.pathname.startsWith('/vault/')) {
        return jsonResponse({ error: 'Private vault keys are not publicly readable' }, 403);
      }

      if (url.pathname.startsWith('/api/')) {
        if (!env.ORIGIN_URL) {
          return jsonResponse({ error: 'Origin backend URL not configured' }, 503);
        }

        let upstreamUrl;
        try {
          upstreamUrl = new URL(url.pathname + url.search, env.ORIGIN_URL);
        } catch (err) {
          console.error(JSON.stringify({
            event: 'invalid_origin_url',
            path: url.pathname,
            error: err instanceof Error ? err.message : String(err),
          }));
          return jsonResponse({ error: 'Origin backend URL invalid' }, 503);
        }

        const isRead = request.method === 'GET' || request.method === 'HEAD';
        const isWebSocket = (request.headers.get('upgrade') || '').toLowerCase() === 'websocket';
        const isCacheablePath = CACHEABLE_PATHS.has(url.pathname);
        const isNoStorePath = !isCacheablePath && NO_STORE_PREFIXES.some((p) => url.pathname.startsWith(p));
        const reqCacheControl = (request.headers.get('cache-control') || '').toLowerCase();
        const bypassCache = !isRead || isWebSocket || request.headers.has('authorization') || isNoStorePath || /\bno-(?:store|cache)\b/.test(reqCacheControl);

        if (!bypassCache && isCacheablePath) {
          const cache = caches.default;
          const cacheKey = new Request(url.toString(), { method: 'GET' });
          const cached = await cache.match(cacheKey);
          if (cached) {
            const hitHeaders = new Headers(cached.headers);
            hitHeaders.delete('set-cookie');
            hitHeaders.set('X-Edge-Cache', 'HIT');
            return buildProxyResponse(cached, request.method, hitHeaders, ctx, url.pathname);
          }

          const upstreamResult = await fetchUpstream(
            upstreamUrl,
            {
              method: 'GET',
              headers: buildUpstreamHeaders(request, env),
            },
            url.pathname,
            request.method
          );
          if (!upstreamResult.ok) {
            return upstreamResult.response;
          }

          const upstreamRes = upstreamResult.response;
          const vary = (upstreamRes.headers.get('vary') || '').trim();
          const cacheEligible = upstreamRes.status === 200 && !vary.split(',').some((v) => { const token = v.trim().toLowerCase(); return token === '*' || token === 'origin'; });
          if (cacheEligible) {
            const cloned = new Response(upstreamRes.body, upstreamRes);
            cloned.headers.delete('set-cookie');
            cloned.headers.delete('pragma');
            cloned.headers.delete('expires');
            cloned.headers.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
            cloned.headers.set('X-Edge-Cache', 'MISS');
            if (request.method === 'HEAD') {
              safeWaitUntil(ctx, cache.put(cacheKey, cloned), 'edge_cache_put_failed', url.pathname);
              return new Response(null, { status: cloned.status, statusText: cloned.statusText, headers: cloned.headers });
            }
            safeWaitUntil(ctx, cache.put(cacheKey, cloned.clone()), 'edge_cache_put_failed', url.pathname);
            return cloned;
          }

          return buildProxyResponse(
            upstreamRes,
            request.method,
            new Headers(upstreamRes.headers),
            ctx,
            url.pathname
          );
        }

        const upstreamResult = await fetchUpstream(
          upstreamUrl,
          {
            method: request.method,
            headers: buildUpstreamHeaders(request, env),
            body: isRead ? undefined : request.body,
          },
          url.pathname,
          request.method
        );
        if (!upstreamResult.ok) {
          return upstreamResult.response;
        }

        const upstreamRes = upstreamResult.response;
        const outHeaders = new Headers(upstreamRes.headers);
        if (!isCacheablePath && url.pathname.startsWith('/api/property-image')) {
          outHeaders.set('Cache-Control', 'no-store, max-age=0');
        }
        return buildProxyResponse(upstreamRes, request.method, outHeaders, ctx, url.pathname);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(JSON.stringify({
        event: 'edge_unhandled_error',
        method: request.method,
        path: url.pathname,
        error: err instanceof Error ? err.message : String(err),
      }));
      return jsonResponse({ error: 'Internal edge error' }, 500);
    }
  },
  async scheduled(controller, env, ctx) {
    const token = String(env?.SCRAPER_ADMIN_TOKEN || env?.PROPERTY_OPERATOR_SECRET || '').trim();
    if (!token) {
      console.warn(JSON.stringify({ event: 'edge_cron_skipped', reason: 'missing_scraper_admin_token', cron: controller?.cron || null }));
      return;
    }
    const apiOrigin = String(env?.API_ORIGIN || 'https://property-crawl-api.vercel.app').replace(/\/+$/, '');
    const action = controller?.cron === '17 */6 * * *' ? 'prune' : 'next-slice';
    const task = fetch(`${apiOrigin}/api/scrapers/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ action }),
    })
      .then(async (res) => {
        const text = await res.text().catch(() => '');
        console.log(JSON.stringify({ event: 'edge_cron_complete', action, status: res.status, ok: res.ok, body: text.slice(0, 300) }));
      })
      .catch((err) => {
        console.error(JSON.stringify({ event: 'edge_cron_error', action, error: err instanceof Error ? err.message : String(err) }));
      });
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(task);
    } else {
      await task;
    }
  },
};
