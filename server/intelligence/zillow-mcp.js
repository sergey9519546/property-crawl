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
          // Strip SSE framing: "data: {...}\n\n"
          const lines = body.split('\n');
          const dataLine = lines.find(l => l.startsWith('data:'));
          const stripped = dataLine ? dataLine.slice(5).trim() : body.trim();

          let parsed;
          try { parsed = JSON.parse(stripped); }
          catch { parsed = { raw: body, parseError: true }; }

          // JSON-RPC protocol error
          if (parsed.error) {
            return resolve({
              ok: false, id,
              error: parsed.error.message || JSON.stringify(parsed.error),
              code:  parsed.error.code,
              data:  parsed
            });
          }

          if (parsed.result !== undefined) {
            const result = parsed.result;

            // MCP isError flag — tool call was rejected by the server
            if (result.isError === true) {
              const text = Array.isArray(result.content) && result.content[0]
                ? result.content[0].text : JSON.stringify(result);
              return resolve({ ok: false, id, error: text, code: 422, data: result });
            }

            // Unwrap tool call content array → first text item
            let content = result;
            if (Array.isArray(result.content)) {
              const textItem = result.content.find(c => c.type === 'text');
              if (textItem) {
                try { content = JSON.parse(textItem.text); }
                catch { content = textItem.text; }
              }
            }

            // Upstream REST API returned success:true but data.error:true (rate limit, bad field, etc.)
            if (content && typeof content === 'object' && content.data && content.data.error === true) {
              return resolve({
                ok: false, id,
                error: content.data.message || 'Upstream API error',
                code:  422,
                data:  content
              });
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
  //
  // All post_* tools wrap arguments under { body: { ... } }.
  // Bounding-box coords use snake_case: north_latitude, south_latitude, etc.
  // get_school_district_details uses { query: { school_district_ids: "id,..." } }.

  /**
   * Autocomplete a location query (city, neighborhood, zip, address).
   * @param {string} query - e.g. "Miami, FL"
   * @param {"FOR_SALE"|"FOR_RENT"} [context]
   */
  async autocomplete(query, context = 'FOR_SALE') {
    if (!query || typeof query !== 'string') {
      return { ok: false, error: 'query must be a non-empty string', code: 400 };
    }
    // Flat args confirmed working — no body wrapper needed for autocomplete
    return this._callTool('post_autocomplete', { query, user_search_context: context });
  }

  /**
   * Search homes for sale within a lat/lng bounding box.
   * @param {{ north, south, east, west }} bbox
   * @param {object} [options] - page, page_size, etc.
   */
  async searchForSale(bbox, options = {}) {
    if (!bbox || bbox.north == null || bbox.south == null || bbox.east == null || bbox.west == null) {
      return { ok: false, error: 'bbox must include north, south, east, west', code: 400 };
    }
    return this._callTool('post_search_homes_sale', {
      body: { north_latitude: bbox.north, south_latitude: bbox.south,
               east_longitude: bbox.east, west_longitude: bbox.west, ...options }
    });
  }

  /** Search homes for rent within a lat/lng bounding box. */
  async searchForRent(bbox, options = {}) {
    if (!bbox || bbox.north == null || bbox.south == null || bbox.east == null || bbox.west == null) {
      return { ok: false, error: 'bbox must include north, south, east, west', code: 400 };
    }
    return this._callTool('post_search_homes_rent', {
      body: { north_latitude: bbox.north, south_latitude: bbox.south,
               east_longitude: bbox.east, west_longitude: bbox.west, ...options }
    });
  }

  /** Search recently sold homes within a lat/lng bounding box. */
  async searchSold(bbox, options = {}) {
    if (!bbox || bbox.north == null || bbox.south == null || bbox.east == null || bbox.west == null) {
      return { ok: false, error: 'bbox must include north, south, east, west', code: 400 };
    }
    return this._callTool('post_search_homes_sold', {
      body: { north_latitude: bbox.north, south_latitude: bbox.south,
               east_longitude: bbox.east, west_longitude: bbox.west, ...options }
    });
  }

  /**
   * Get full property details.
   * Pass a canonical Zillow URL or a zpid (will be converted to URL form).
   */
  async getPropertyDetails({ zpid, zillowUrl } = {}) {
    if (!zpid && !zillowUrl) {
      return { ok: false, error: 'Either zpid or zillowUrl is required', code: 400 };
    }
    const url = zillowUrl || `https://www.zillow.com/homedetails/${zpid}_zpid/`;
    return this._callTool('post_property_details', { body: { zillow_url: url } });
  }

  /**
   * Resolve a Zillow search URL to canonical form.
   * Tool name on server: post_resolve_url
   */
  async resolveZillowUrl(url) {
    if (!url || typeof url !== 'string') {
      return { ok: false, error: 'url must be a non-empty string', code: 400 };
    }
    return this._callTool('post_resolve_url', { body: { url } });
  }

  /**
   * Get school district details.
   * @param {string[]} schoolDistrictIds - e.g. ['10427']
   */
  async getSchoolDistrictDetails(schoolDistrictIds) {
    if (!Array.isArray(schoolDistrictIds) || schoolDistrictIds.length === 0) {
      return { ok: false, error: 'schoolDistrictIds must be a non-empty array', code: 400 };
    }
    return this._callTool('get_school_district_details', {
      query: { school_district_ids: schoolDistrictIds.join(',') }
    });
  }

  /** Zestimate deep dive for a property. */
  async getZestimate({ zpid, zillowUrl } = {}) {
    if (!zpid && !zillowUrl) {
      return { ok: false, error: 'Either zpid or zillowUrl is required', code: 400 };
    }
    const url = zillowUrl || `https://www.zillow.com/homedetails/${zpid}_zpid/`;
    return this._callTool('post_zestimate_deep_dive', { body: { zillow_url: url } });
  }

  /** Walk / transit / bike score. */
  async getWalkScore({ zpid, zillowUrl } = {}) {
    if (!zpid && !zillowUrl) {
      return { ok: false, error: 'Either zpid or zillowUrl is required', code: 400 };
    }
    const url = zillowUrl || `https://www.zillow.com/homedetails/${zpid}_zpid/`;
    return this._callTool('post_walk_transit_bike_score', { body: { zillow_url: url } });
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
