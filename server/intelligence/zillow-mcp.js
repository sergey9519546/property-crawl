'use strict';

/**
 * ZillowMcpClient — thin JSON-RPC 2.0 wrapper around the api.market
 * "veer-hanuman-1/zillw-us-real-state-listings" Streamable HTTP MCP server.
 *
 * The server accepts standard MCP POST requests with Content-Type: application/json
 * and returns JSON-RPC 2.0 responses (no SSE required for tool/call).
 *
 * Supported tools (confirmed via tools/list):
 *   post_autocomplete          – location query autocomplete
 *   post_resolve_zillow_url    – canonical Zillow URL resolver
 *   post_search_homes_sale     – homes for sale by bounding box
 *   post_search_homes_rent     – rentals by bounding box
 *   post_search_homes_sold     – recently sold homes by bounding box
 *   post_property_details      – full property details by zpid or Zillow URL
 *   get_school_district_details – school district info by IDs
 */

const https = require('https');

const DEFAULT_BASE_URL = 'https://prod.api.market/api/mcp/veer-hanuman-1/zillw-us-real-state-listings';
const DEFAULT_API_KEY  = 'cmjgtcjea0001jr04c5ckyyk0';
const DEFAULT_TIMEOUT  = 15000;

let _idCounter = 100;
function nextId() { return ++_idCounter; }

class ZillowMcpClient {
  constructor(options = {}) {
    this.apiKey  = options.apiKey  || process.env.ZILLOW_MCP_API_KEY || process.env.API_MARKET_KEY || DEFAULT_API_KEY;
    this.baseUrl = (options.baseUrl || process.env.ZILLOW_MCP_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
  }

  // ─── Transport ────────────────────────────────────────────────────────────

  /**
   * Send a raw JSON-RPC 2.0 request to the MCP endpoint.
   * Returns { ok, id, result?, error? }
   */
  async _rpc(method, params = {}) {
    const id      = nextId();
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    const url = new URL(this.baseUrl);
    const headers = {
      'Content-Type':    'application/json',
      'Accept':          'application/json, text/event-stream',
      'x-api-market-key': this.apiKey,
      'Content-Length':  Buffer.byteLength(payload)
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, { method: 'POST', headers, timeout: this.timeout }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          // Strip SSE framing if the server returns "data: {...}\n\n"
          const stripped = body
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim())
            .join('') || body.trim();

          let parsed;
          try { parsed = JSON.parse(stripped); }
          catch { parsed = { raw: body, parseError: true }; }

          if (parsed.error) {
            return resolve({
              ok: false,
              id,
              error: parsed.error.message || JSON.stringify(parsed.error),
              code:  parsed.error.code,
              data:  parsed
            });
          }

          if (parsed.result !== undefined) {
            // Unwrap tool call content array → first text item
            const result = parsed.result;
            let content = result;
            if (Array.isArray(result?.content)) {
              const textItem = result.content.find(c => c.type === 'text');
              if (textItem) {
                try { content = JSON.parse(textItem.text); }
                catch { content = textItem.text; }
              }
            }
            return resolve({ ok: true, id, result: content, raw: parsed });
          }

          // HTTP-level error
          if (res.statusCode >= 400) {
            return resolve({
              ok: false,
              id,
              error: `HTTP ${res.statusCode}: ${body.slice(0, 200)}`,
              code:  res.statusCode,
              data:  parsed
            });
          }

          resolve({ ok: true, id, result: parsed, raw: parsed });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`ZillowMcp request timeout after ${this.timeout}ms`));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  /** Call a named MCP tool with arguments. */
  async _callTool(toolName, args = {}) {
    return this._rpc('tools/call', { name: toolName, arguments: args });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** Initialize the MCP session and return server capabilities. */
  async initialize() {
    return this._rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'property-crawl', version: '1.0' }
    });
  }

  /** List all available tools exposed by this MCP server. */
  async listTools() {
    return this._rpc('tools/list');
  }

  // ─── Search tools ─────────────────────────────────────────────────────────

  /**
   * Autocomplete a location query (city, neighborhood, zip, address).
   * @param {string} query - e.g. "Miami, FL"
   * @returns {Promise<{ok,result?,error?}>}
   */
  async autocomplete(query) {
    if (!query || typeof query !== 'string') {
      return { ok: false, error: 'query must be a non-empty string', code: 400 };
    }
    return this._callTool('post_autocomplete', { query });
  }

  /**
   * Search homes for sale within a lat/lng bounding box.
   * @param {{ north, south, east, west }} bbox
   * @param {object} [options] - Optional filters: minPrice, maxPrice, beds, baths, etc.
   */
  async searchForSale(bbox, options = {}) {
    if (!bbox || !bbox.north || !bbox.south || !bbox.east || !bbox.west) {
      return { ok: false, error: 'bbox must include north, south, east, west', code: 400 };
    }
    return this._callTool('post_search_homes_sale', {
      north: bbox.north,
      south: bbox.south,
      east:  bbox.east,
      west:  bbox.west,
      ...options
    });
  }

  /**
   * Search homes for rent within a lat/lng bounding box.
   */
  async searchForRent(bbox, options = {}) {
    if (!bbox || !bbox.north || !bbox.south || !bbox.east || !bbox.west) {
      return { ok: false, error: 'bbox must include north, south, east, west', code: 400 };
    }
    return this._callTool('post_search_homes_rent', {
      north: bbox.north,
      south: bbox.south,
      east:  bbox.east,
      west:  bbox.west,
      ...options
    });
  }

  /**
   * Search recently sold homes within a lat/lng bounding box.
   */
  async searchSold(bbox, options = {}) {
    if (!bbox || !bbox.north || !bbox.south || !bbox.east || !bbox.west) {
      return { ok: false, error: 'bbox must include north, south, east, west', code: 400 };
    }
    return this._callTool('post_search_homes_sold', {
      north: bbox.north,
      south: bbox.south,
      east:  bbox.east,
      west:  bbox.west,
      ...options
    });
  }

  /**
   * Get full property details by Zillow Property ID (zpid) or canonical Zillow URL.
   * At least one of zpid or zillowUrl must be provided.
   */
  async getPropertyDetails({ zpid, zillowUrl } = {}) {
    if (!zpid && !zillowUrl) {
      return { ok: false, error: 'Either zpid or zillowUrl is required', code: 400 };
    }
    const args = {};
    if (zpid) args.zpid = String(zpid);
    if (zillowUrl) args.zillow_url = zillowUrl;
    return this._callTool('post_property_details', args);
  }

  /**
   * Resolve a Zillow search URL to canonical form.
   */
  async resolveZillowUrl(url) {
    if (!url || typeof url !== 'string') {
      return { ok: false, error: 'url must be a non-empty string', code: 400 };
    }
    return this._callTool('post_resolve_zillow_url', { url });
  }

  /**
   * Get school district details by district IDs.
   * @param {string[]} schoolDistrictIds
   */
  async getSchoolDistrictDetails(schoolDistrictIds) {
    if (!Array.isArray(schoolDistrictIds) || schoolDistrictIds.length === 0) {
      return { ok: false, error: 'schoolDistrictIds must be a non-empty array', code: 400 };
    }
    return this._callTool('get_school_district_details', {
      school_district_ids: schoolDistrictIds
    });
  }

  // ─── Convenience helpers ──────────────────────────────────────────────────

  /**
   * Search for sale listings in a named city by resolving a Zillow URL first.
   * @param {string} citySlug - e.g. "miami_fl" (Zillow city slug format)
   * @param {object} bbox - bounding box coordinates
   */
  async searchCityForSale(bbox, options = {}) {
    return this.searchForSale(bbox, options);
  }
}

const defaultClient = new ZillowMcpClient();

module.exports = {
  ZillowMcpClient,
  defaultClient,
  autocomplete:          (query)          => defaultClient.autocomplete(query),
  searchForSale:         (bbox, opts)     => defaultClient.searchForSale(bbox, opts),
  searchForRent:         (bbox, opts)     => defaultClient.searchForRent(bbox, opts),
  searchSold:            (bbox, opts)     => defaultClient.searchSold(bbox, opts),
  getPropertyDetails:    (params)         => defaultClient.getPropertyDetails(params),
  resolveZillowUrl:      (url)            => defaultClient.resolveZillowUrl(url),
  getSchoolDistrictDetails: (ids)         => defaultClient.getSchoolDistrictDetails(ids),
  listTools:             ()               => defaultClient.listTools()
};
