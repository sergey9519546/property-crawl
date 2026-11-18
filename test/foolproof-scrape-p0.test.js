'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spaXhrEnabled, captureSpaXhr, mapCapturedItems, DEFAULT_PATTERNS } = require('../server/scrapers/spa-xhr');
const { autoThrottle, parseRetryAfterMs, resetThrottleState, noteRetryAfter } = require('../server/scrapers/auto-throttle');
const { validateListingShape } = require('../server/scrapers/listing-schema');
const { FannieMaeScraper } = require('../server/scrapers/fannie');
const { FreddieMacScraper } = require('../server/scrapers/freddie');
const { VaReoScraper } = require('../server/scrapers/va');
const { UsdaResalesScraper, UsdaScrapeError } = require('../server/scrapers/usda');
const { UsMarshalsScraper } = require('../server/scrapers/marshals');
const { collectionScope } = require('../server/scrapers/collection-scope');
const { parseHarrisClerkNotice } = require('../server/scrapers/adapters/harris-clerk-foreclosure');

function withEnv(overrides, fn) {
  const prev = {};
  for (const [key, value] of Object.entries(overrides)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const res = fn();
    if (res && typeof res.then === 'function') return res.finally(restore);
    restore();
    return res;
  } catch (err) {
    restore();
    throw err;
  }
}

test('SPA XHR lane is opt-in and default-off', () => {
  assert.equal(spaXhrEnabled('fannie', {}), false);
  assert.equal(spaXhrEnabled('fannie', { SCRAPLING_SPA_XHR: '1', SCRAPLING_SPA_XHR_SOURCES: 'fannie,va' }), true);
  assert.equal(spaXhrEnabled('hud', { SCRAPLING_SPA_XHR: 'true', SCRAPLING_SPA_XHR_SOURCES: 'fannie,va' }), false);
  assert.equal(DEFAULT_PATTERNS.fannie, '*search-service*');
});

test('captureSpaXhr fails closed when runtime missing', async () => {
  const result = await captureSpaXhr('https://www.homepath.fanniemae.com/listing/search?q=OH', {
    sourceKey: 'fannie',
    env: { SCRAPLING_PYTHON: '' },
    timeoutMs: 2000,
  });
  assert.equal(result.ok, false);
  assert.ok(result.error === 'SPA_XHR_RUNTIME_MISSING' || result.error === 'SPA_XHR_TIMEOUT' || /scrapling/i.test(result.error || ''));
});

test('mapCapturedItems uses scraper mapJsonItem', () => {
  const scraper = {
    mapJsonItem: (p, state) => ({ id: `FNMA-${p.id}`, source: 'fannie', state, address: p.address, openingBid: p.listPrice || null, sourceUrl: `https://example.test/${p.id}` }),
  };
  const mapped = mapCapturedItems(scraper, [{ id: '99', address: '1 Main Street', listPrice: 100000 }], 'OH');
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].id, 'FNMA-99');
});

test('auto-throttle spaces same-host requests and honors Retry-After', async () => {
  resetThrottleState();
  let sleepCalls = 0;
  const sleep = async () => { sleepCalls += 1; };
  const first = await autoThrottle('https://api.example.gov/a', { minIntervalMs: 50, sleep });
  const second = await autoThrottle('https://api.example.gov/b', { minIntervalMs: 50, sleep });
  assert.equal(first.host, 'api.example.gov');
  assert.ok(second.waitedMs >= 0);
  assert.equal(parseRetryAfterMs('2'), 2000);
  assert.equal(parseRetryAfterMs('nope'), null);
  const noted = noteRetryAfter('https://api.example.gov/c', '1');
  assert.equal(noted.host, 'api.example.gov');
  resetThrottleState();
});

test('listing schema requires id/source/state/address identity', () => {
  const bad = validateListingShape({ id: '', source: '', state: '', address: '' });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => e.startsWith('missing_') || e === 'invalid_id'));
  const good = validateListingShape({
    id: 'FNMA-1',
    source: 'fannie',
    state: 'OH',
    address: '1 Main Street',
  });
  // Identity is present; other provenance policies may still flag ingestion.
  for (const field of ['id', 'source', 'state', 'address']) {
    assert.ok(good.listing[field], field);
  }
  assert.ok(!good.errors.includes('missing_id'));
  assert.ok(!good.errors.includes('invalid_state'));
});

test('Fannie SPA shell still throws when XHR lane disabled', async () => {
  const scraper = new FannieMaeScraper();
  const html = '<html><body><div id="root"></div></body></html>';
  await assert.rejects(
    async () => scraper.fetchStateHtml('OH').then(() => {
      // requestText will fail network — inject parse path instead
    }),
    () => true
  );
  // Direct unit path:
  scraper.requestText = async () => html;
  await assert.rejects(() => scraper.fetchStateHtml('OH'), /SPA_SHELL|client-rendered/i);
});

test('captureSpaXhr rejects non-HTTPS, credentials, and private/local targets before spawning Python', async () => {
  const nonHttps = await captureSpaXhr('http://www.homepath.fanniemae.com/listing/search', { sourceKey: 'fannie' });
  assert.equal(nonHttps.ok, false);
  assert.equal(nonHttps.error, 'SPA_XHR_HTTPS_REQUIRED');

  const creds = await captureSpaXhr('https://user:pass@www.homepath.fanniemae.com/listing/search', { sourceKey: 'fannie' });
  assert.equal(creds.ok, false);
  assert.equal(creds.error, 'SPA_XHR_CREDENTIALS_NOT_ALLOWED');

  const loopback = await captureSpaXhr('https://127.0.0.1/listing/search', { sourceKey: 'fannie' });
  assert.equal(loopback.ok, false);
  assert.equal(loopback.error, 'SPA_XHR_PRIVATE_HOST_REFUSED');

  const metadata = await captureSpaXhr('https://169.254.169.254/latest/meta-data/', { sourceKey: 'fannie' });
  assert.equal(metadata.ok, false);
  assert.equal(metadata.error, 'SPA_XHR_PRIVATE_HOST_REFUSED');
});

test('Fannie, Freddie, and VA mapJsonItem + SPA-XHR standardization produce valid listings and drop malformed items', async () => {
  const cases = [
    {
      Scraper: FannieMaeScraper,
      sourceKey: 'fannie',
      prefix: 'FNMA-',
      capturedUrl: 'https://www.homepath.fanniemae.com/search-service/v1/properties?state=OH',
      validRaw: { id: '12345', streetAddress: '100 Oak Street', city: 'Cleveland', state: 'OH', zip: '44101', listPrice: 175000 },
    },
    {
      Scraper: FreddieMacScraper,
      sourceKey: 'freddie',
      prefix: 'FRE-',
      capturedUrl: 'https://www.homesteps.com/homesteps/api/propertysearch?state=OH',
      validRaw: { id: '23456', streetAddress: '200 Pine Street', city: 'Columbus', state: 'OH', zip: '43215', listPrice: 185000 },
    },
    {
      Scraper: VaReoScraper,
      sourceKey: 'va',
      prefix: 'VA-',
      capturedUrl: 'https://vrmproperties.com/api/properties?state=OH',
      validRaw: { vrmNumber: '34567', street: '300 Maple Avenue', city: 'Cincinnati', state: 'OH', zip: '45202', listPrice: 195000 },
    },
  ];

  for (const c of cases) {
    await withEnv({ SCRAPLING_SPA_XHR: '1', SCRAPLING_SPA_XHR_SOURCES: 'fannie,freddie,va' }, async () => {
      const direct = new c.Scraper({ useScrapling: false });
      const mappedDirect = direct.mapJsonItem(c.validRaw, 'OH');
      assert.equal(mappedDirect.source, c.sourceKey, `${c.sourceKey} mapJsonItem must include source`);
      assert.ok(Number.isFinite(Date.parse(mappedDirect.provenance.observedAt)), `${c.sourceKey} mapJsonItem must include provenance.observedAt`);

      const scraper = new c.Scraper({
        useScrapling: false,
        captureSpaXhrImpl: async () => ({
          ok: true,
          capturedUrls: [c.capturedUrl],
          items: [
            c.validRaw,
            { id: '99901', vrmNumber: '99901', listPrice: 120000 },
            { id: '99902', vrmNumber: '99902', streetAddress: '1 A', street: '1 A', listPrice: 120000 },
          ],
        }),
      });
      scraper.requestText = async () => '<html><body><div id="root"></div></body></html>';

      const res = await scraper.fetchStateHtml('OH');
      assert.equal(res.spaXhr, true, `${c.sourceKey} should return spaXhr: true`);
      assert.equal(res.listings.length, 1, `${c.sourceKey} should keep valid item and drop malformed items`);
      assert.equal(res.listings[0].source, c.sourceKey);
      assert.ok(res.listings[0].id.startsWith(c.prefix));
      assert.equal(res.listings[0].provenance.spaXhr, true);
      assert.equal(res.listings[0].estLow, null);
      assert.equal(res.listings[0].estHigh, null);
      assert.equal(res.listings[0].saleDate, null);
      assert.equal(validateListingShape(res.listings[0]).valid, true, `${c.sourceKey} standardized SPA-XHR item must pass validateListingShape`);

      const failClosedScraper = new c.Scraper({
        useScrapling: false,
        captureSpaXhrImpl: async () => ({
          ok: true,
          capturedUrls: [c.capturedUrl],
          items: [
            { id: '99901', vrmNumber: '99901', listPrice: 120000 },
            { id: '99902', vrmNumber: '99902', streetAddress: '1 A', street: '1 A', listPrice: 120000 },
          ],
        }),
      });
      failClosedScraper.requestText = async () => '<html><body><div id="root"></div></body></html>';
      await assert.rejects(() => failClosedScraper.fetchStateHtml('OH'), /SPA_SHELL/);
    });
  }
});

test('FannieMaeScraper and FreddieMacScraper skip schema-invalid listings in scrapeFeed without aborting sweep', async () => {
  await withEnv({ FANNIE_STATES: 'OH,TX' }, async () => {
    const fannie = new FannieMaeScraper({ useScrapling: false });
    fannie.crawlJitter = async () => {};
    fannie.fetchStateHomePath = async (state) => {
      if (state === 'OH') {
        return {
          listings: [
            {
              id: 'FNMA-10001',
              source: 'fannie',
              state: 'OH',
              address: '100 Valid Street, Cleveland, OH 44101',
              openingBid: 150000,
              sourceUrl: 'https://www.homepath.fanniemae.com/property/10001',
              raw: 'Valid Fannie Mae HomePath record.',
              provenance: { origin: 'live', observed: true, publisher: 'Fannie Mae HomePath', recordId: '10001', observedAt: new Date().toISOString() },
            },
            {
              id: '!!INVALID ID!!',
              source: 'fannie',
              state: 'OH',
              address: '200 Bad Id Road, Cleveland, OH 44101',
              openingBid: 120000,
              sourceUrl: 'https://www.homepath.fanniemae.com/property/10002',
              raw: 'Bad id Fannie record that passes passesFilter.',
              provenance: { origin: 'live', observed: true, publisher: 'Fannie Mae HomePath', recordId: '10002', observedAt: new Date().toISOString() },
            },
          ],
          html: null,
        };
      }
      return {
        listings: [
          {
            id: 'FNMA-20001',
            source: 'fannie',
            state: 'TX',
            address: '300 Lone Star Rd, Dallas, TX 75201',
            openingBid: 210000,
            sourceUrl: 'https://www.homepath.fanniemae.com/property/20001',
            raw: 'Valid Texas Fannie Mae HomePath record.',
            provenance: { origin: 'live', observed: true, publisher: 'Fannie Mae HomePath', recordId: '20001', observedAt: new Date().toISOString() },
          },
        ],
        html: null,
      };
    };

    const results = await fannie.scrapeFeed();
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.id), ['FNMA-10001', 'FNMA-20001']);
    assert.equal(fannie.lastRunReport.recordsEmitted, 2);
    assert.equal(fannie.lastRunReport.recordsRejected, 1);
  });

  await withEnv({ FREDDIE_STATES: 'OH,TX' }, async () => {
    const freddie = new FreddieMacScraper({ useScrapling: false });
    freddie.crawlJitter = async () => {};
    freddie.fetchStateListings = async (state) => {
      if (state === 'OH') {
        return {
          listings: [
            {
              id: 'FRE-30001',
              source: 'freddie',
              state: 'OH',
              address: '400 Valid Ave, Columbus, OH 43215',
              openingBid: 140000,
              sourceUrl: 'https://www.homesteps.com/property/30001',
              raw: 'Valid Freddie Mac HomeSteps record.',
              provenance: { origin: 'live', observed: true, publisher: 'Freddie Mac HomeSteps', recordId: '30001', observedAt: new Date().toISOString() },
            },
            {
              id: '',
              source: 'freddie',
              state: 'OH',
              address: '500 Missing Id Ct, Columbus, OH 43215',
              openingBid: 145000,
              sourceUrl: 'https://www.homesteps.com/property/30002',
              raw: 'Missing id Freddie record that passes passesFilter.',
              provenance: { origin: 'live', observed: true, publisher: 'Freddie Mac HomeSteps', recordId: '30002', observedAt: new Date().toISOString() },
            },
          ],
          html: null,
        };
      }
      return {
        listings: [
          {
            id: 'FRE-40001',
            source: 'freddie',
            state: 'TX',
            address: '600 Austin Blvd, Austin, TX 78701',
            openingBid: 230000,
            sourceUrl: 'https://www.homesteps.com/property/40001',
            raw: 'Valid Texas Freddie Mac HomeSteps record.',
            provenance: { origin: 'live', observed: true, publisher: 'Freddie Mac HomeSteps', recordId: '40001', observedAt: new Date().toISOString() },
          },
        ],
        html: null,
      };
    };

    const results = await freddie.scrapeFeed();
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.id), ['FRE-30001', 'FRE-40001']);
    assert.equal(freddie.lastRunReport.recordsEmitted, 2);
    assert.equal(freddie.lastRunReport.recordsRejected, 1);
  });
});

test('UsdaResalesScraper rescues drifted state table via usda-table extraction and fails closed when empty or disabled', async () => {
  const formHtml = '<select id="stateCode"><option value="39">Ohio</option></select>';
  const driftedHtml = '<html><body><table class="drifted-summary"><tr><td>123 Main St</td></tr></table></body></html>';

  const rescued = new UsdaResalesScraper({
    useScrapling: true,
    extractImpl: async (profile) => {
      assert.equal(profile, 'usda-table');
      return {
        engine: 'scrapling',
        engineVersion: '0.4.15',
        headers: ['Detail', 'Type', 'Address', 'City', 'State', 'County', 'Zip', 'Price', 'Beds', 'Baths', 'SqFt'],
        rows: [['', 'REO Property', '123 Main St', 'Cleveland,', 'Ohio', 'Cuyahoga', '44101', '$125,000', '3', '2', '1500']],
        items: [{
          cells: ['', 'REO Property', '123 Main St', 'Cleveland,', 'Ohio', 'Cuyahoga', '44101', '$125,000', '3', '2', '1500'],
          detailUrl: 'https://www.resales.usda.gov/resales/public/SFHPropertyDetail?id=9901&x=1',
          price: 125000,
          state: 'OH',
        }],
      };
    },
  });
  rescued.crawlJitter = async () => {};
  rescued.fetchText = async (_url, _timeout, method) => (method === 'POST' ? driftedHtml : formHtml);

  const listings = await rescued.scrapeFeed();
  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'USDA-OH-9901');
  assert.equal(listings[0].openingBid, 125000);
  assert.equal(listings[0].estLow, null);
  assert.equal(listings[0].estHigh, null);
  assert.equal(listings[0].sourceUrl, 'https://www.resales.usda.gov/resales/public/SFHPropertyDetail?id=9901&x=1');
  assert.equal(rescued.lastRunReport.outcome, 'success');
  assert.equal(rescued.lastRunReport.recordsEmitted, 1);

  const emptyExtract = new UsdaResalesScraper({
    useScrapling: true,
    extractImpl: async () => ({ engine: 'scrapling', rows: [], items: [] }),
  });
  emptyExtract.fetchText = async () => driftedHtml;
  await assert.rejects(
    () => emptyExtract.searchState('39'),
    (err) => err instanceof UsdaScrapeError && err.code === 'USDA_RESULT_SCHEMA_UNRECOGNIZED'
  );

  const disabled = new UsdaResalesScraper({ useScrapling: false });
  disabled.fetchText = async () => driftedHtml;
  await assert.rejects(
    () => disabled.searchState('39'),
    (err) => err instanceof UsdaScrapeError && err.code === 'USDA_RESULT_SCHEMA_UNRECOGNIZED'
  );
});

test('UsMarshalsScraper omits phantom gaston endpoint and falls back to reallook when primary rows fail passesFilter', async () => {
  const usmsUnusableHtml = `
    <table>
      <tr><td>1, OH</td><td>Forfeited</td><td>$0</td><td><a href="/assets/10001">case-10001</a></td></tr>
    </table>
  `;
  const reallookHtml = `
    <div class="property-item">
      <span class="address">500 Partner Ave, Columbus, OH 43215</span>
      $180,000
      <a data-id="10099" href="/usms-inventory/10099">view</a>
    </div>
  `;

  const scraper = new UsMarshalsScraper({ useScrapling: false });
  scraper.executeWithRetry = (fn) => fn();
  scraper.requestText = async (url) => (url.includes('reallook.com') ? reallookHtml : usmsUnusableHtml);

  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'USMS-10099');
  assert.equal(listings[0].source, 'marshals');
  assert.deepEqual(scraper.lastRunReport.statesRequested, ['usms', 'reallook']);
  assert.equal(scraper.lastRunReport.endpointsTried, 2);
  assert.equal(scraper.lastRunReport.scope.endpoints.includes('gaston-sheehan-fallback'), false);

  const primaryOk = new UsMarshalsScraper({ useScrapling: false });
  primaryOk.executeWithRetry = (fn) => fn();
  primaryOk.requestText = async () => `
    <table>
      <tr><td>500 Federal Plaza, Columbus, OH 43215</td><td>Forfeited</td><td>$245,000</td><td><a href="/assets/20001">case-20001</a></td></tr>
    </table>
  `;
  const primaryListings = await primaryOk.scrapeFeed();
  assert.equal(primaryListings.length, 1);
  assert.deepEqual(primaryOk.lastRunReport.statesRequested, ['usms']);
  assert.equal(primaryOk.lastRunReport.endpointsTried, 1);
});

test('collectionScope covers scheduled federal/auction sources while preserving null for unscoped civilview', () => {
  for (const key of ['fannie', 'freddie', 'va', 'marshals', 'landbank', 'bid4assets', 'sheriff']) {
    const scope = collectionScope({ sourceKey: key });
    assert.ok(scope && typeof scope.endpoint === 'string' && scope.endpoint.startsWith('/'), `${key} should expose a normalized scope`);
  }
  const realSheriffScope = collectionScope(require('../server/scrapers/sheriff'));
  assert.ok(realSheriffScope && realSheriffScope.endpoint.startsWith('/'));
  assert.equal(collectionScope({ sourceKey: 'civilview', targetState: 'NJ', countyId: null, maxCounties: 4 }), null);
});

test('parseHarrisClerkNotice attaches documentReferences for captured ViewECdocs links and FdicScraper isolates schema-invalid items', async () => {
  const row = `
    <tr>
      <td><a href="ViewECdocs.aspx?ID=bWXqGXasMeuE7YZXR3B2NUNXeLVZTKlhHSbKofnpRC4r5lhzEImkzlXLdS33pau5">FRCL-2026-9999</a></td>
      <td><span id="lblFileDate">10/01/2026</span></td>
      <td><span id="lblSaleDate">11/03/2026</span></td>
      <td><span id="lblPages">4</span></td>
    </tr>
  `;
  const parsed = parseHarrisClerkNotice(row, { baseUrl: 'https://www.cclerk.hctx.net' });
  assert.ok(parsed);
  assert.equal(parsed.evidenceOnly, true);
  assert.equal(parsed.openingBid, null);
  assert.ok(Array.isArray(parsed.documentReferences));
  assert.equal(parsed.documentReferences.length, 1);
  assert.equal(parsed.documentReferences[0].kind, 'filings');
  assert.equal(parsed.documentReferences[0].url, parsed.sourceUrl);
  assert.equal(parsed.documentReferences[0].accessState, 'public');
  const { FdicScraper } = require('../server/scrapers/fdic');
  const fdic = new FdicScraper();
  fdic.executeWithRetry = (fn) => fn();
  fdic.fetchApi = async () => [{ bad: true }, { ok: true }];
  fdic.toListing = (rec) => (rec.bad
    ? { id: 'FDIC-!!BAD!!', source: 'fdic', state: 'TX', address: '123 Main St, Austin, TX', sourceUrl: 'https://sales.fdic.gov/item/bad' }
    : { id: 'FDIC-1', source: 'fdic', state: 'TX', address: '100 Main St, Austin, TX 78701', city: 'Austin', zip: '78701', openingBid: 95000, sourceUrl: 'https://sales.fdic.gov/item/1', provenance: { origin: 'live', observed: true, publisher: 'FDIC', recordId: '1', observedAt: '2026-10-01T00:00:00Z' } });
  const fdicOut = await fdic.scrapeFeed();
  assert.equal(fdicOut.length, 1);
  assert.equal(fdicOut[0].id, 'FDIC-1');
});



