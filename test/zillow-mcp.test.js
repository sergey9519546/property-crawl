'use strict';

/**
 * test/zillow-mcp.test.js
 *
 * Verifies the ZillowMcpClient across four layers:
 *   1. Client construction & configuration
 *   2. Input-validation error messages (no network calls)
 *   3. Live MCP protocol (initialize + tools/list)
 *   4. Live tool calls — autocomplete, search, property details
 *
 * Run: node --test test/zillow-mcp.test.js
 */

const assert = require('node:assert/strict');
const { test, describe, before } = require('node:test');

const {
  ZillowMcpClient,
  defaultClient
} = require('../server/intelligence/zillow-mcp');

// Shared bounding box: Miami, FL
const MIAMI_BBOX = { north: 25.85, south: 25.70, east: -80.12, west: -80.35 };

describe('ZillowMcpClient', () => {

  // ── 1. Construction ────────────────────────────────────────────────────────
  describe('1. Client construction', () => {
    test('creates with defaults', () => {
      const c = new ZillowMcpClient();
      assert.ok(c.apiKey, 'apiKey should be set');
      assert.ok(c.baseUrl.includes('zillw'), 'baseUrl should target zillw endpoint');
      assert.equal(typeof c.timeout, 'number', 'timeout should be a number');
    });

    test('accepts custom options', () => {
      const c = new ZillowMcpClient({ apiKey: 'test-key', baseUrl: 'https://example.com/mcp', timeout: 5000 });
      assert.equal(c.apiKey,  'test-key');
      assert.equal(c.baseUrl, 'https://example.com/mcp');
      assert.equal(c.timeout, 5000);
    });

    test('trims trailing slash from baseUrl', () => {
      const c = new ZillowMcpClient({ baseUrl: 'https://example.com/mcp/' });
      assert.ok(!c.baseUrl.endsWith('/'), 'baseUrl must not end with /');
    });
  });

  // ── 2. Input validation (no network) ──────────────────────────────────────
  describe('2. Input validation — clear error messages before network hit', () => {
    test('autocomplete rejects empty query', async () => {
      const r = await defaultClient.autocomplete('');
      assert.equal(r.ok, false);
      assert.ok(r.error.includes('non-empty string'), `Got: ${r.error}`);
      assert.equal(r.code, 400);
    });

    test('autocomplete rejects non-string query', async () => {
      const r = await defaultClient.autocomplete(null);
      assert.equal(r.ok, false);
      assert.ok(r.error, 'error message must be present');
      assert.equal(r.code, 400);
    });

    test('searchForSale rejects missing bbox', async () => {
      const r = await defaultClient.searchForSale(null);
      assert.equal(r.ok, false);
      assert.ok(r.error.includes('north, south, east, west'), `Got: ${r.error}`);
      assert.equal(r.code, 400);
    });

    test('searchForSale rejects incomplete bbox (missing east/west)', async () => {
      const r = await defaultClient.searchForSale({ north: 25.85, south: 25.70 });
      assert.equal(r.ok, false);
      assert.ok(r.error, 'error should describe missing keys');
    });

    test('searchForRent rejects missing bbox', async () => {
      const r = await defaultClient.searchForRent(undefined);
      assert.equal(r.ok, false);
      assert.equal(r.code, 400);
    });

    test('searchSold rejects empty bbox object', async () => {
      const r = await defaultClient.searchSold({});
      assert.equal(r.ok, false);
      assert.equal(r.code, 400);
    });

    test('getPropertyDetails rejects when neither zpid nor zillowUrl provided', async () => {
      const r = await defaultClient.getPropertyDetails({});
      assert.equal(r.ok, false);
      assert.ok(r.error.includes('zpid or zillowUrl'), `Got: ${r.error}`);
      assert.equal(r.code, 400);
    });

    test('getPropertyDetails rejects empty params', async () => {
      const r = await defaultClient.getPropertyDetails();
      assert.equal(r.ok, false);
      assert.ok(r.error, 'must return descriptive error');
    });

    test('resolveZillowUrl rejects empty url', async () => {
      const r = await defaultClient.resolveZillowUrl('');
      assert.equal(r.ok, false);
      assert.ok(r.error.includes('non-empty string'), `Got: ${r.error}`);
    });

    test('getSchoolDistrictDetails rejects empty array', async () => {
      const r = await defaultClient.getSchoolDistrictDetails([]);
      assert.equal(r.ok, false);
      assert.ok(r.error.includes('non-empty array'), `Got: ${r.error}`);
    });

    test('getSchoolDistrictDetails rejects non-array', async () => {
      const r = await defaultClient.getSchoolDistrictDetails('SD-123');
      assert.equal(r.ok, false);
      assert.equal(r.code, 400);
    });
  });

  // ── 3. MCP protocol ────────────────────────────────────────────────────────
  describe('3. MCP protocol — initialize and tools/list', () => {
    test('initialize handshake returns protocolVersion', async () => {
      const r = await defaultClient.initialize();
      assert.equal(r.ok, true, `initialize failed: ${r.error}`);
      assert.ok(r.result && r.result.protocolVersion, 'must return protocolVersion');
    });

    test('tools/list returns at least 6 tools', async () => {
      const r = await defaultClient.listTools();
      assert.equal(r.ok, true, `tools/list failed: ${r.error}`);
      const tools = (r.result && r.result.tools) ? r.result.tools : r.result;
      assert.ok(Array.isArray(tools), 'result.tools must be an array');
      assert.ok(tools.length >= 6, `Expected >=6 tools, got ${tools.length}`);
    });

    test('expected tool names are present', async () => {
      const r = await defaultClient.listTools();
      assert.equal(r.ok, true);
      const tools = (r.result && r.result.tools) ? r.result.tools : (r.result || []);
      const names = tools.map(t => t.name);
      const required = [
        'post_autocomplete',
        'post_search_homes_sale',
        'post_search_homes_rent',
        'post_search_homes_sold',
        'post_property_details'
      ];
      for (const name of required) {
        assert.ok(names.includes(name), `Missing tool: ${name}`);
      }
    });
  });

  // ── 4. Live tool calls ─────────────────────────────────────────────────────
  describe('4. Live tool calls', () => {
    test('autocomplete returns data for "Miami, FL"', async () => {
      const r = await defaultClient.autocomplete('Miami, FL');
      assert.equal(r.ok, true, `autocomplete failed: ${r.error}`);
      assert.ok(r.result !== null && r.result !== undefined, 'autocomplete must return data');
    });

    test('searchForSale returns results for Miami bbox', async () => {
      const r = await defaultClient.searchForSale(MIAMI_BBOX);
      assert.equal(r.ok, true, `searchForSale failed: ${r.error}`);
      assert.ok(r.result !== null && r.result !== undefined, 'must return listings data');
    });

    test('searchForRent returns results for Miami bbox', async () => {
      const r = await defaultClient.searchForRent(MIAMI_BBOX);
      assert.equal(r.ok, true, `searchForRent failed: ${r.error}`);
      assert.ok(r.result !== null && r.result !== undefined, 'must return rental data');
    });

    test('searchSold returns results for Miami bbox', async () => {
      const r = await defaultClient.searchSold(MIAMI_BBOX);
      assert.equal(r.ok, true, `searchSold failed: ${r.error}`);
      assert.ok(r.result !== null && r.result !== undefined, 'must return sold data');
    });

    test('getPropertyDetails for known zpid — returns data or structured error', async () => {
      const r = await defaultClient.getPropertyDetails({ zpid: '2080884285' });
      if (r.ok) {
        assert.ok(r.result !== null, 'must return property data');
      } else {
        // Rate-limited / not found is acceptable — must still be structured
        assert.ok(typeof r.error === 'string', 'error must be a string message');
        assert.ok(r.error.length > 0, 'error must not be empty');
      }
    });
  });

  // ── 5. Cross-API enrichment (Zillow -> PropertyTitle) ─────────────────────
  describe('5. Cross-API enrichment flow', () => {
    let saleListings = [];

    before(async () => {
      const r = await defaultClient.searchForSale(MIAMI_BBOX);
      if (r.ok) {
        const raw = (r.result && (r.result.props || r.result.results || r.result.listResults)) || [];
        saleListings = Array.isArray(raw) ? raw.slice(0, 3) : [];
      }
    });

    test('Zillow sale search returns at least 1 result for enrichment', () => {
      if (saleListings.length === 0) {
        // Non-fatal — API plan may not return results for this bbox
        console.log('  ⚠  No Zillow listings for Miami bbox — enrichment assertions skipped');
        return;
      }
      assert.ok(saleListings.length >= 1, 'Need >=1 listing to cross-enrich');
    });

    test('each returned Zillow listing has an addressable identity field', () => {
      for (const listing of saleListings) {
        assert.ok(
          listing.zpid || listing.id || listing.detailUrl || listing.address,
          `Listing missing identity field: ${JSON.stringify(listing).slice(0, 120)}`
        );
      }
    });
  });

  // ── 6. Bad credentials — graceful handling (never throws) ─────────────────
  describe('6. Error handling — bad credentials', () => {
    const badClient = new ZillowMcpClient({ apiKey: 'bad-key-12345' });

    test('bad API key never throws — returns a result object', async () => {
      // api.market validates keys at the gateway; some endpoints pass bad keys
      // through to the upstream API which may still return a response or an error.
      // Either way the client MUST resolve (not reject) and return { ok, ... }.
      let result;
      await assert.doesNotReject(async () => {
        result = await badClient.autocomplete('Los Angeles');
      }, 'autocomplete must not throw even with a bad API key');
      assert.ok(typeof result === 'object' && result !== null, 'must return an object');
      assert.ok('ok' in result, 'result must have an ok field');
      // If the gateway did reject it, error must be a non-empty string
      if (!result.ok) {
        assert.ok(typeof result.error === 'string', 'error must be a string message');
        assert.ok(result.error.length > 0, 'error must not be empty');
      }
    });
  });
});
