export const SDK_NAME = "property-crawl.zero-dep";
export const SDK_VERSION = "1.0.0";
const DEFAULT_TIMEOUT_MS = 2500;
const FILTERED = "[Filtered]";
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

export interface ParsedSentryDsn {
  dsn: string;
  publicKey: string;
  host: string;
  pathPrefix: string;
  projectId: string;
  envelopeUrl: string;
}

export interface ScrubOptions {
  maxDepth?: number;
  sendDefaultPii?: boolean;
}

export interface SentryRequestContext {
  url?: string;
  method?: string;
  headers?: Record<string, unknown> | Headers;
  query_string?: string;
}

export interface CaptureOptions {
  dsn?: string;
  fetch?: typeof fetch;
  tags?: Record<string, string | number | boolean>;
  extra?: Record<string, unknown>;
  request?: SentryRequestContext;
  level?: "fatal" | "error" | "warning" | "info" | "debug";
  environment?: string;
  release?: string;
  timeoutMs?: number;
  handled?: boolean;
  mechanismType?: string;
}

export interface CaptureResult {
  sent: boolean;
  eventId: string | null;
  status?: number;
  reason?: string;
}

function generateEventId(): string {
  if (typeof globalThis.crypto !== "undefined") {
    if (typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID().replace(/-/g, "");
    }
    if (typeof globalThis.crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  }
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

export function resolveSentryDsn(): string {
  if (typeof process === "undefined" || !process.env) return "";
  // Direct property access is required so Next.js inlines NEXT_PUBLIC_* into browser bundles.
  const publicDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (typeof publicDsn === "string" && publicDsn.trim()) {
    return publicDsn.trim();
  }
  const serverDsn = process.env.SENTRY_DSN;
  if (typeof serverDsn === "string" && serverDsn.trim()) {
    return serverDsn.trim();
  }
  return "";
}

export function parseSentryDsn(rawDsn: unknown): ParsedSentryDsn | null {
  if (typeof rawDsn !== "string") return null;
  const trimmed = rawDsn.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (!url.hostname) return null;

  const publicKey = decodeURIComponent(url.username || "").trim();
  if (!publicKey) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const projectId = segments[segments.length - 1];
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) return null;

  const pathPrefix = segments.length > 1 ? `/${segments.slice(0, -1).join("/")}` : "";
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

function scrubString(input: string): string {
  return input
    .replace(URL_CREDENTIALS_RE, `$1${FILTERED}@`)
    .replace(QUERY_SECRET_RE, `$1$2=${FILTERED}`)
    .replace(EMAIL_RE, FILTERED)
    .replace(AUTH_SCHEME_RE, `$1 ${FILTERED}`)
    .replace(KNOWN_TOKEN_RE, FILTERED);
}

interface HeadersLike {
  forEach: (cb: (value: string, key: string) => void) => void;
  get: (key: string) => string | null;
  has: (key: string) => boolean;
}

function isHeadersLike(value: unknown): value is HeadersLike {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HeadersLike>;
  return (
    typeof candidate.forEach === "function" &&
    typeof candidate.get === "function" &&
    typeof candidate.has === "function"
  );
}

export function scrubSensitiveData<T = unknown>(value: T, options: ScrubOptions = {}): T {
  const maxDepth =
    typeof options.maxDepth === "number" && Number.isInteger(options.maxDepth)
      ? options.maxDepth
      : MAX_SCRUB_DEPTH;
  const sendDefaultPii = options.sendDefaultPii === true;
  const seen = new WeakSet<object>();

  function walk(node: unknown, depth: number, keyHint: string): unknown {
    if (keyHint && SENSITIVE_KEY_RE.test(keyHint)) {
      return FILTERED;
    }

    if (node === null || node === undefined) return node;
    if (typeof node === "string") return scrubString(node);
    if (typeof node === "number" || typeof node === "boolean") return node;
    if (typeof node === "bigint") return String(node);
    if (typeof node === "symbol" || typeof node === "function") return undefined;

    if (depth >= maxDepth) return "[Truncated]";

    if (node instanceof Date) {
      return Number.isNaN(node.getTime()) ? null : node.toISOString();
    }

    if (node instanceof Error) {
      const errRecord = node as Error & { code?: unknown };
      return walk(
        {
          name: node.name || "Error",
          message: node.message || "",
          ...(errRecord.code !== undefined ? { code: errRecord.code } : {}),
          ...(node.stack ? { stack: node.stack } : {}),
        },
        depth + 1,
        ""
      );
    }

    if (typeof node === "object") {
      if (seen.has(node)) return "[Circular]";
      seen.add(node);

      try {
        if (Array.isArray(node)) {
          return node.map((item) => walk(item, depth + 1, ""));
        }

        const out: Record<string, unknown> = {};
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

        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (!sendDefaultPii && (k === "cookies" || k === "ip_address" || k === "REMOTE_ADDR")) {
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

  return walk(value, 0, "") as T;
}

interface StackFrame {
  function: string;
  filename: string;
  lineno: number;
  colno: number;
  in_app: boolean;
}

function parseStackFrames(stack: string): StackFrame[] {
  if (typeof stack !== "string" || !stack.trim()) return [];
  const lines = stack.split("\n");
  const frames: StackFrame[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let match = line.match(/^at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (match) {
      const fn = match[1] ? match[1].trim() : "<anonymous>";
      const filename = scrubString(match[2].trim());
      frames.push({
        function: fn,
        filename,
        lineno: Number(match[3]),
        colno: Number(match[4]),
        in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
      });
      continue;
    }

    match = line.match(/^(.*?)@(.+?):(\d+):(\d+)$/);
    if (match) {
      const fn = match[1] ? match[1].trim() : "<anonymous>";
      const filename = scrubString(match[2].trim());
      frames.push({
        function: fn,
        filename,
        lineno: Number(match[3]),
        colno: Number(match[4]),
        in_app: !filename.includes("node_modules"),
      });
    }
  }

  return frames.reverse().slice(-50);
}

function normalizeError(error: unknown): { type: string; value: string; stack: string } {
  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      value: error.message || String(error),
      stack: error.stack || "",
    };
  }
  if (error && typeof error === "object") {
    const errObj = error as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      type: typeof errObj.name === "string" && errObj.name ? errObj.name : "Error",
      value: typeof errObj.message === "string" ? errObj.message : JSON.stringify(error),
      stack: typeof errObj.stack === "string" ? errObj.stack : "",
    };
  }
  return {
    type: "Error",
    value: typeof error === "string" ? error : String(error),
    stack: "",
  };
}

function resolveEnvironment(options: CaptureOptions = {}): string {
  if (typeof options.environment === "string" && options.environment.trim()) {
    return options.environment.trim();
  }
  if (typeof process !== "undefined" && process.env) {
    return process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production";
  }
  return "production";
}

function resolveRelease(options: CaptureOptions = {}): string | undefined {
  if (typeof options.release === "string" && options.release.trim()) {
    return options.release.trim();
  }
  if (typeof process !== "undefined" && process.env) {
    return (
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      process.env.SENTRY_RELEASE ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.PROPERTY_RELEASE_SHA ||
      undefined
    );
  }
  return undefined;
}

export function buildSentryEnvelope(
  eventOrError: unknown,
  dsnOrParsed: string | ParsedSentryDsn | null | undefined,
  options: CaptureOptions = {}
): string | null {
  const parsed = typeof dsnOrParsed === "string" ? parseSentryDsn(dsnOrParsed) : dsnOrParsed;
  if (!parsed || !parsed.envelopeUrl || !parsed.publicKey || !parsed.dsn) {
    return null;
  }

  const candidate =
    eventOrError && typeof eventOrError === "object" && !(eventOrError instanceof Error)
      ? (eventOrError as Record<string, unknown>)
      : null;
  const isPrebuiltEvent = Boolean(
    candidate && (candidate.exception || candidate.event_id || candidate.message) && !candidate.stack
  );

  let rawEvent: Record<string, unknown>;
  if (isPrebuiltEvent && candidate) {
    rawEvent = { ...candidate };
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
              type: options.mechanismType || "generic",
              handled: options.handled !== false,
            },
            ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
          },
        ],
      },
    };
  }

  const eventId =
    typeof rawEvent.event_id === "string" && /^[a-f0-9]{32}$/i.test(rawEvent.event_id)
      ? rawEvent.event_id.toLowerCase()
      : generateEventId();

  const environment =
    typeof rawEvent.environment === "string" ? rawEvent.environment : resolveEnvironment(options);
  const release = typeof rawEvent.release === "string" ? rawEvent.release : resolveRelease(options);

  const rawTags =
    rawEvent.tags && typeof rawEvent.tags === "object" ? (rawEvent.tags as Record<string, unknown>) : undefined;
  const rawExtra =
    rawEvent.extra && typeof rawEvent.extra === "object" ? (rawEvent.extra as Record<string, unknown>) : undefined;

  const eventPayload = scrubSensitiveData<Record<string, unknown>>(
    {
      ...rawEvent,
      event_id: eventId,
      timestamp: typeof rawEvent.timestamp === "number" ? rawEvent.timestamp : Date.now() / 1000,
      platform: typeof rawEvent.platform === "string" ? rawEvent.platform : "javascript",
      level: typeof rawEvent.level === "string" ? rawEvent.level : options.level || "error",
      ...(environment ? { environment } : {}),
      ...(release ? { release } : {}),
      ...(options.tags || rawTags ? { tags: { ...(rawTags || {}), ...(options.tags || {}) } } : {}),
      ...(options.extra || rawExtra ? { extra: { ...(rawExtra || {}), ...(options.extra || {}) } } : {}),
      ...(options.request || rawEvent.request ? { request: options.request || rawEvent.request } : {}),
      sdk: { name: SDK_NAME, version: SDK_VERSION },
    },
    { sendDefaultPii: false }
  );

  if (eventPayload && typeof eventPayload === "object" && eventPayload.user && typeof eventPayload.user === "object") {
    const userObj = eventPayload.user as Record<string, unknown>;
    delete userObj.email;
    delete userObj.ip_address;
    delete userObj.username;
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
    type: "event",
    content_type: "application/json",
    length: byteLength,
  });

  return `${envelopeHeader}\n${itemHeader}\n${payloadJson}\n`;
}

export async function captureException(error: unknown, options: CaptureOptions = {}): Promise<CaptureResult> {
  try {
    const rawDsn = options.dsn !== undefined ? options.dsn : resolveSentryDsn();
    const parsed = parseSentryDsn(rawDsn);
    if (!parsed) {
      return { sent: false, eventId: null, reason: "invalid_or_missing_dsn" };
    }

    const fetchImpl = options.fetch || globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      return { sent: false, eventId: null, reason: "fetch_unavailable" };
    }

    const envelope = buildSentryEnvelope(error, parsed, options);
    if (!envelope) {
      return { sent: false, eventId: null, reason: "envelope_build_failed" };
    }

    const firstNewline = envelope.indexOf("\n");
    const header = JSON.parse(envelope.slice(0, firstNewline)) as { event_id: string };
    const eventId = header.event_id;

    const timeoutMs =
      typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : undefined;

    const authHeader = [
      "Sentry sentry_version=7",
      `sentry_client=${SDK_NAME}/${SDK_VERSION}`,
      `sentry_key=${parsed.publicKey}`,
      `sentry_timestamp=${Math.floor(Date.now() / 1000)}`,
    ].join(", ");

    const response = await fetchImpl(parsed.envelopeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": authHeader,
      },
      body: envelope,
      ...(typeof window !== "undefined" ? { keepalive: true } : {}),
      ...(signal ? { signal } : {}),
    });

    if (!response || response.ok === false) {
      return {
        sent: false,
        eventId,
        status: response ? response.status : 0,
        reason: "http_error",
      };
    }

    return {
      sent: true,
      eventId,
      status: response.status,
    };
  } catch {
    return { sent: false, eventId: null, reason: "network_error" };
  }
}
