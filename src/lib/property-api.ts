// Server-only transport to the canonical Node API. Never consult a second
// in-memory snapshot for mutations or listing-backed enrichment.
const MAX_BYTES = 2 * 1024 * 1024;
const API_PATH = /^\/api\/(?:listings(?:\/[^/]+)?|enrich|export|verify-docket|parcel-boundary|property-image|property-intelligence|property-signals|hunts(?:\/[A-Za-z0-9_-]+(?:\/(?:evaluate|events))?)?|parse|health(?:\/ready)?|sources|source-network(?:\/(?:intake|review|run|jobs(?:\/job_[a-f0-9]{24})?))?|workspace(?:\/[A-Za-z0-9_-]+)*|scrapers(?:\/(?:health|run))?|alerts(?:\/[^/]+)?)$/;

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function boundedBody(stream: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { void reader.cancel().catch(() => {}); throw new Error("body_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function proxyPropertyApi(request: Request, dependencies: {
  fetchImpl?: typeof fetch; apiUrl?: string; operatorToken?: string;
} = {}) {
  const url = new URL(request.url);
  if (!API_PATH.test(url.pathname)) return jsonError(404, "Unknown API route");
  if (request.url.length > 8192) return jsonError(414, "Request URL too long");
  const origin = request.headers.get("origin");
  const configuredOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim());
  if (origin && origin !== url.origin && !configuredOrigins.includes(origin)) return jsonError(403, "Cross-origin request denied");
  if (request.headers.get("sec-fetch-site") === "cross-site" && !origin) return jsonError(403, "Cross-origin request denied");
  const headers = new Headers({ Accept: "application/json" });
  for (const name of ["content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (dependencies.operatorToken) headers.set("Authorization", `Bearer ${dependencies.operatorToken}`);
  else {
    const authorization = request.headers.get("authorization");
    if (authorization) headers.set("Authorization", authorization);
  }
  let body: Uint8Array | undefined;
  if (url.pathname.startsWith("/api/scrapers")) {
    for (const name of ["x-scraper-token", "x-async"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    if (Number(request.headers.get("content-length")) > MAX_BYTES) return jsonError(413, "Request body too large");
    try { body = await boundedBody(request.body, MAX_BYTES); }
    catch { return jsonError(413, "Request body too large"); }
  }
  try {
    const base = dependencies.apiUrl || process.env.PROPERTY_API_URL || "http://localhost:3000";
    const upstream = await (dependencies.fetchImpl || fetch)(`${base.replace(/\/$/, "")}${url.pathname}${url.search}`, {
      method: request.method, headers, body: body as BodyInit | undefined,
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-type", "content-disposition", "retry-after", "allow", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "referrer-policy", "cross-origin-resource-policy", "x-property-image-provider", "x-property-image-attribution", "x-property-image-distance-meters", "x-property-image-heading", "x-property-image-capture-date"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    if (origin) { responseHeaders.set("Access-Control-Allow-Origin", origin); responseHeaders.set("Vary", "Origin"); }
    // Export responses are bounded by record count at the API and may exceed
    // normal JSON page size. Stream the download without buffering it in Next.
    if (upstream.ok && (request.method === "GET" || url.pathname === "/api/export")) {
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    }
    const responseBody = upstream.status === 204 ? null : await boundedBody(upstream.body, 8 * 1024 * 1024);
    return new Response(responseBody as BodyInit | null, { status: upstream.status, headers: responseHeaders });
  } catch { return jsonError(503, "Property data service is unavailable. No substitute records were returned."); }
}
