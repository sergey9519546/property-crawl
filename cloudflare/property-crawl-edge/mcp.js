// Spec-compliant zero-dependency MCP Streamable HTTP (JSON-RPC 2.0) edge handler
// Exposes deterministic, zero-fabrication underwriting & public-record tools over /mcp.

const DEFAULT_API_ORIGIN = 'https://property-crawl-api.vercel.app';
const SAFE_LISTING_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export const MCP_PROTOCOL_VERSION = '2025-03-26';
export const MCP_SERVER_INFO = Object.freeze({
  name: 'perfectproperty-mcp',
  version: '1.0.0',
});

export const MCP_TOOLS = Object.freeze([
  {
    name: 'underwrite_address',
    description:
      'Run deterministic, zero-fabrication distressed property underwriting for any US address or courthouse notice (HUD SAFMR 1.20x DSCR ceiling, county assessor conversion, statutory title risk, possession timeline, and verbatim notice citations).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['address', 'state'],
      properties: {
        address: { type: 'string', description: 'Street address of the subject property.' },
        state: { type: 'string', description: '2-letter US state or territory code (e.g. NJ, FL, OH, TX).' },
        city: { type: 'string', description: 'City or municipality name.' },
        zip: { type: 'string', description: '5-digit or ZIP+4 postal code for HUD SAFMR lookup.' },
        county: { type: 'string', description: 'County name for assessor ratio & statutory timeline rules.' },
        beds: { type: 'number', description: 'Bedroom count (0-4) for HUD SAFMR tier lookup.' },
        openingBid: { type: 'number', description: 'Published opening or upset bid in USD.' },
        judgment: { type: 'number', description: 'Court judgment debt in USD.' },
        assessed: { type: 'number', description: 'Published county assessed value in USD.' },
        saleDate: { type: 'string', description: 'Scheduled auction or sale date (YYYY-MM-DD).' },
        source: { type: 'string', description: 'Disposition or foreclosure type (e.g. civilview, sheriff, hud, irs, tax).' },
        noticeText: { type: 'string', description: 'Optional raw foreclosure or auction notice text for verbatim extraction.' },
      },
    },
  },
  {
    name: 'get_assessor_reading',
    description:
      'Retrieve live county GIS / statewide Cadastral assessor reading and statutory market-comparison figure for a catalog listing ID.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['listingId'],
      properties: {
        listingId: { type: 'string', description: 'Canonical listing identifier (e.g. CIV-NJ-2-2252250658).' },
      },
    },
  },
  {
    name: 'search_listings',
    description:
      'Query verified live distressed listings filtered by state, text search, source, or enrolled assessor corridor coverage.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: { type: 'string', description: 'Optional 2-letter US state filter.' },
        q: { type: 'string', description: 'Optional address, city, county, docket, or ZIP query.' },
        source: { type: 'string', description: 'Optional source filter (e.g. civilview, servicelink, hud, sheriff, gsa, usda, treasury).' },
        enrolledOnly: { type: 'boolean', description: 'Restrict to counties with live statutory assessor market-comparison coverage.' },
        sort: { type: 'string', description: 'Sort order (triage, date, bid-asc, score).' },
        limit: { type: 'number', description: 'Result page size (1-25, defaults to 10).' },
      },
    },
  },
  {
    name: 'get_listing_dossier',
    description:
      'Fetch the full evidence-backed listing payload, publisher provenance, catch summary, and document evidence for a listing ID.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['listingId'],
      properties: {
        listingId: { type: 'string', description: 'Canonical listing identifier.' },
      },
    },
  },
]);

function mcpHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id',
    ...extra,
  };
}

function rpcResult(id, result, status = 200) {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result }, { status, headers: mcpHeaders() });
}

function rpcError(id, code, message, status = 200) {
  return Response.json(
    { jsonrpc: '2.0', id: id ?? null, error: { code, message } },
    { status, headers: mcpHeaders() },
  );
}

async function fetchJsonUpstream(url, init, env) {
  const edgeSecret = String(env?.EDGE_SHARED_SECRET || '').trim();
  const headers = new Headers(init?.headers || {});
  headers.set('Accept', 'application/json');
  if (edgeSecret) headers.set('x-edge-secret', edgeSecret);

  const res = await fetch(url, {
    ...init,
    headers,
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(25_000) : undefined,
  });
  const text = await res.text().catch(() => '');
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, data: parsed };
}

function validateListingId(raw) {
  const value = String(raw || '').trim();
  if (!SAFE_LISTING_ID_RE.test(value)) return null;
  return value;
}

async function executeMcpTool(name, args, env) {
  const apiOrigin = String(env?.API_ORIGIN || env?.ORIGIN_URL || DEFAULT_API_ORIGIN).replace(/\/+$/, '');
  const input = args && typeof args === 'object' ? args : {};

  if (name === 'underwrite_address') {
    const address = String(input.address || '').trim();
    const state = String(input.state || '').trim();
    if (!address || !state) {
      return { invalidParams: 'underwrite_address requires non-empty address and state strings.' };
    }
    return fetchJsonUpstream(
      `${apiOrigin}/api/underwrite`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      env,
    );
  }

  if (name === 'get_assessor_reading') {
    const listingId = validateListingId(input.listingId);
    if (!listingId) {
      return { invalidParams: 'get_assessor_reading requires a valid listingId.' };
    }
    return fetchJsonUpstream(
      `${apiOrigin}/api/listings/${encodeURIComponent(listingId)}/assessor`,
      { method: 'GET' },
      env,
    );
  }

  if (name === 'get_listing_dossier') {
    const listingId = validateListingId(input.listingId);
    if (!listingId) {
      return { invalidParams: 'get_listing_dossier requires a valid listingId.' };
    }
    return fetchJsonUpstream(
      `${apiOrigin}/api/listings/${encodeURIComponent(listingId)}`,
      { method: 'GET' },
      env,
    );
  }

  if (name === 'search_listings') {
    const params = new URLSearchParams();
    if (typeof input.state === 'string' && input.state.trim()) params.set('state', input.state.trim().toUpperCase().slice(0, 16));
    if (typeof input.q === 'string' && input.q.trim()) params.set('q', input.q.trim().slice(0, 200));
    if (typeof input.source === 'string' && input.source.trim()) params.set('source', input.source.trim().slice(0, 64));
    if (input.enrolledOnly === true) params.set('enrolledOnly', 'true');
    if (typeof input.sort === 'string' && input.sort.trim()) params.set('sort', input.sort.trim().slice(0, 16));
    const limitNum = Number(input.limit);
    const boundedLimit = Number.isFinite(limitNum) ? Math.max(1, Math.min(25, Math.round(limitNum))) : 10;
    params.set('limit', String(boundedLimit));
    return fetchJsonUpstream(`${apiOrigin}/api/listings?${params.toString()}`, { method: 'GET' }, env);
  }

  return { unknownTool: true };
}

export async function handleMcpRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: mcpHeaders() });
  }

  if (request.method === 'GET') {
    return Response.json(
      {
        ...MCP_SERVER_INFO,
        protocolVersion: MCP_PROTOCOL_VERSION,
        transport: 'streamable-http',
        tools: MCP_TOOLS,
      },
      { status: 200, headers: mcpHeaders() },
    );
  }

  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: mcpHeaders({ Allow: 'GET, POST, OPTIONS' }) },
    );
  }

  let msg;
  try {
    msg = await request.json();
  } catch {
    return rpcError(null, -32700, 'Parse error: invalid JSON', 400);
  }

  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
    return rpcError(msg?.id ?? null, -32600, 'Invalid Request', 400);
  }

  const { id, method, params } = msg;

  if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
    return new Response(null, { status: 202, headers: mcpHeaders() });
  }

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: MCP_SERVER_INFO,
    });
  }

  if (method === 'ping') {
    return rpcResult(id, {});
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: MCP_TOOLS });
  }

  if (method === 'tools/call') {
    const toolName = String(params?.name || '').trim();
    const args = params?.arguments;
    if (!toolName) {
      return rpcError(id, -32602, 'Invalid params: tool name required', 200);
    }

    try {
      const outcome = await executeMcpTool(toolName, args, env);
      if (outcome.unknownTool) {
        return rpcError(id, -32601, `Unknown tool: ${toolName}`, 200);
      }
      if (outcome.invalidParams) {
        return rpcError(id, -32602, outcome.invalidParams, 200);
      }
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(outcome.data) }],
        structuredContent: outcome.data,
        isError: !outcome.ok,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      });
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`, 200);
}
