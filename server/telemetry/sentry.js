'use strict';

const SDK_NAME = 'property-crawl.zero-dep';
const SDK_VERSION = '1.0.0';
const DEFAULT_TIMEOUT_MS = 2500;
const FILTERED = '[Filtered]';
const MAX_SCRUB_DEPTH = 8;

const SENSITIVE_KEY_RE =
  /(?:authorization|proxy-authorization|cookie|set-cookie|x-edge-secret|x-scraper-admin-token|x-operator-token|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token|x-vercel-oidc-token|password|passwd|secret|token|api[-_]?key|apikey|private[-_]?key|credential|email|database[-_]?url|connection[-_]?string)/i;

const URL_CREDENTIALS_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s:@]+)(?::([^/\s@]*))?@/g;
const QUERY_SECRET_RE =
  /([?&])(token|access_token|refresh_token|id_token|api[-_]?key|apikey|key|secret|password|passwd|pwd|pass|auth|authorization|cookie|sig|signature|x-api-key|x-edge-secret|x-scraper-admin-token|email)=([^&#\s]+)/gi;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const AUTH_SCHEME_RE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const KNOWN_TOKEN_RE =
  /\b(?:sk_(?:live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g;

function generateEventId() {
  if (typeof globalThis.crypto !== 'undefined') {
    if (typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID().replace(/-/g, '');
    }
    if (typeof globalThis.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

function resolveSentryDsn(env = process.env) {
  if (!env || typeof env !== 'object') return '';
  const raw = env.SENTRY_DSN;
  return typeof raw === 'string' ? raw.trim() : '';
}

function parseSentryDsn(rawDsn) {
  if (typeof rawDsn !== 'string') return null;
  const trimmed = rawDsn.trim();
  if (!trimmed) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  const publicKey = decodeURIComponent(url.username || '').trim();
  if (!publicKey) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const projectId = segments[segments.length - 1];
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) return null;

  const pathPrefix = segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : '';
  const canonicalDsn = `https://${encodeURIComponent(publicKey)}@${url.host}${pathPrefix}/${projectId}`;
  const envelopeUrl = `https://${url.host}${pathPrefix}/api/${projectId}/envelope/`;

  return {
    dsn: canonicalDsn,
    publicKey,
    host: url.host,
    pathPrefix,
    projectId,
    envelopeUrl,
  };
}

function scrubString(input) {
  return input
    .replace(URL_CREDENTIALS_RE, `$1${FILTERED}@`)
    .replace(QUERY_SECRET_RE, `$1$2=${FILTERED}`)
    .replace(EMAIL_RE, FILTERED)
    .replace(AUTH_SCHEME_RE, `$1 ${FILTERED}`)
    .replace(KNOWN_TOKEN_RE, FILTERED);
}

function isHeadersLike(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.forEach === 'function' &&
      typeof value.get === 'function' &&
      typeof value.has === 'function'
  );
}

function scrubSensitiveData(value, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : MAX_SCRUB_DEPTH;
  const sendDefaultPii = options.sendDefaultPii === true;
  const seen = new WeakSet();

  function walk(node, depth, keyHint) {
    if (keyHint && SENSITIVE_KEY_RE.test(keyHint)) {
      return FILTERED;
    }

    if (node === null || node === undefined) return node;
    if (typeof node === 'string') return scrubString(node);
    if (typeof node === 'number' || typeof node === 'boolean') return node;
    if (typeof node === 'bigint') return String(node);
    if (typeof node === 'symbol' || typeof node === 'function') return undefined;

    if (depth >= maxDepth) return '[Truncated]';

    if (node instanceof Date) {
      return Number.isNaN(node.getTime()) ? null : node.toISOString();
    }

    if (node instanceof Error) {
      return walk(
        {
          name: node.name || 'Error',
          message: node.message || '',
          ...(node.code !== undefined ? { code: node.code } : {}),
          ...(node.stack ? { stack: node.stack } : {}),
        },
        depth + 1,
        ''
      );
    }

    if (typeof node === 'object') {
      if (seen.has(node)) return '[Circular]';
      seen.add(node);

      try {
        if (Array.isArray(node)) {
          return node.map((item) => walk(item, depth + 1, ''));
        }

        const out = {};
        if (isHeadersLike(node)) {
          node.forEach((val, k) => {
            if (SENSITIVE_KEY_RE.test(k)) {
              out[k] = FILTERED;
            } else {
              out[k] = walk(val, depth + 1, k);
            }
          });
          return out;
        }

        for (const [k, v] of Object.entries(node)) {
          if (!sendDefaultPii && (k === 'cookies' || k === 'ip_address' || k === 'REMOTE_ADDR')) {
            continue;
          }
          if (SENSITIVE_KEY_RE.test(k)) {
            out[k] = FILTERED;
            continue;
          }
          const scrubbed = walk(v, depth + 1, k);
          if (scrubbed !== undefined) {
            out[k] = scrubbed;
          }
        }
        return out;
      } finally {
        seen.delete(node);
      }
    }

    return String(node);
  }

  return walk(value, 0, '');
}

function parseStackFrames(stack) {
  if (typeof stack !== 'string' || !stack.trim()) return [];
  const lines = stack.split('\n');
  const frames = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // V8 format: at fnName (file:line:col) or at file:line:col
    let match = line.match(/^at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (match) {
      const fn = match[1] ? match[1].trim() : '<anonymous>';
      const filename = scrubString(match[2].trim());
      frames.push({
        function: fn,
        filename,
        lineno: Number(match[3]),
        colno: Number(match[4]),
        in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
      });
      continue;
    }

    // Firefox / Safari format: fn@url:line:col
    match = line.match(/^(.*?)@(.+?):(\d+):(\d+)$/);
    if (match) {
      const fn = match[1] ? match[1].trim() : '<anonymous>';
      const filename = scrubString(match[2].trim());
      frames.push({
        function: fn,
        filename,
        lineno: Number(match[3]),
        colno: Number(match[4]),
        in_app: !filename.includes('node_modules'),
      });
    }
  }

  // Sentry expects frames ordered oldest -> newest (innermost frame last).
  return frames.reverse().slice(-50);
}

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      type: error.name || 'Error',
      value: error.message || String(error),
      stack: error.stack || '',
    };
  }
  if (error && typeof error === 'object') {
    return {
      type: typeof error.name === 'string' && error.name ? error.name : 'Error',
      value: typeof error.message === 'string' ? error.message : JSON.stringify(error),
      stack: typeof error.stack === 'string' ? error.stack : '',
    };
  }
  return {
    type: 'Error',
    value: typeof error === 'string' ? error : String(error),
    stack: '',
  };
}

function resolveEnvironment(options = {}) {
  if (typeof options.environment === 'string' && options.environment.trim()) {
    return options.environment.trim();
  }
  return process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production';
}

function resolveRelease(options = {}) {
  if (typeof options.release === 'string' && options.release.trim()) {
    return options.release.trim();
  }
  return (
    process.env.SENTRY_RELEASE ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.PROPERTY_RELEASE_SHA ||
    undefined
  );
}

function buildSentryEnvelope(eventOrError, dsnOrParsed, options = {}) {
  const parsed = typeof dsnOrParsed === 'string' ? parseSentryDsn(dsnOrParsed) : dsnOrParsed;
  if (!parsed || !parsed.envelopeUrl || !parsed.publicKey || !parsed.dsn) {
    return null;
  }

  const isPrebuiltEvent =
    Boolean(eventOrError) &&
    typeof eventOrError === 'object' &&
    !(eventOrError instanceof Error) &&
    (eventOrError.exception || eventOrError.event_id || eventOrError.message);

  let rawEvent;
  if (isPrebuiltEvent && !eventOrError.stack) {
    rawEvent = { ...eventOrError };
  } else {
    const normalized = normalizeError(eventOrError);
    const frames = parseStackFrames(normalized.stack);
    rawEvent = {
      exception: {
        values: [
          {
            type: normalized.type,
            value: normalized.value,
            mechanism: {
              type: options.mechanismType || 'generic',
              handled: options.handled !== false,
            },
            ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
          },
        ],
      },
    };
  }

  const eventId =
    typeof rawEvent.event_id === 'string' && /^[a-f0-9]{32}$/i.test(rawEvent.event_id)
      ? rawEvent.event_id.toLowerCase()
      : generateEventId();

  const environment = rawEvent.environment || resolveEnvironment(options);
  const release = rawEvent.release || resolveRelease(options);

  const eventPayload = scrubSensitiveData(
    {
      ...rawEvent,
      event_id: eventId,
      timestamp: rawEvent.timestamp || Date.now() / 1000,
      platform: rawEvent.platform || 'node',
      level: rawEvent.level || options.level || 'error',
      ...(environment ? { environment } : {}),
      ...(release ? { release } : {}),
      ...(options.tags || rawEvent.tags ? { tags: { ...(rawEvent.tags || {}), ...(options.tags || {}) } } : {}),
      ...(options.extra || rawEvent.extra ? { extra: { ...(rawEvent.extra || {}), ...(options.extra || {}) } } : {}),
      ...(options.request || rawEvent.request ? { request: options.request || rawEvent.request } : {}),
      sdk: { name: SDK_NAME, version: SDK_VERSION },
    },
    { sendDefaultPii: false }
  );

  // Strip user PII containers if a caller passed an explicit event object.
  if (eventPayload && typeof eventPayload === 'object' && eventPayload.user) {
    delete eventPayload.user.email;
    delete eventPayload.user.ip_address;
    delete eventPayload.user.username;
  }

  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    sent_at: new Date().toISOString(),
    dsn: parsed.dsn,
    sdk: { name: SDK_NAME, version: SDK_VERSION },
  });

  const payloadJson = JSON.stringify(eventPayload);
  const byteLength = new TextEncoder().encode(payloadJson).length;
  const itemHeader = JSON.stringify({
    type: 'event',
    content_type: 'application/json',
    length: byteLength,
  });

  return `${envelopeHeader}\n${itemHeader}\n${payloadJson}\n`;
}

async function captureException(error, options = {}) {
  try {
    const rawDsn = options.dsn !== undefined ? options.dsn : resolveSentryDsn();
    const parsed = parseSentryDsn(rawDsn);
    if (!parsed) {
      return { sent: false, eventId: null, reason: 'invalid_or_missing_dsn' };
    }

    const fetchImpl = options.fetch || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      return { sent: false, eventId: null, reason: 'fetch_unavailable' };
    }

    const envelope = buildSentryEnvelope(error, parsed, options);
    if (!envelope) {
      return { sent: false, eventId: null, reason: 'envelope_build_failed' };
    }

    const firstNewline = envelope.indexOf('\n');
    const header = JSON.parse(envelope.slice(0, firstNewline));
    const eventId = header.event_id;

    const timeoutMs =
      Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;

    const authHeader = [
      'Sentry sentry_version=7',
      `sentry_client=${SDK_NAME}/${SDK_VERSION}`,
      `sentry_key=${parsed.publicKey}`,
      `sentry_timestamp=${Math.floor(Date.now() / 1000)}`,
    ].join(', ');

    const response = await fetchImpl(parsed.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': authHeader,
      },
      body: envelope,
      ...(signal ? { signal } : {}),
    });

    if (!response || response.ok === false) {
      return {
        sent: false,
        eventId,
        status: response ? response.status : 0,
        reason: 'http_error',
      };
    }

    return {
      sent: true,
      eventId,
      status: response.status,
    };
  } catch {
    return { sent: false, eventId: null, reason: 'network_error' };
  }
}

module.exports = {
  SDK_NAME,
  SDK_VERSION,
  resolveSentryDsn,
  parseSentryDsn,
  scrubSensitiveData,
  buildSentryEnvelope,
  captureException,
};
