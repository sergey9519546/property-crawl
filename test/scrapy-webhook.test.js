const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  verifyScrapySignature,
  validateScrapyPayload,
  gateScrapyItemForIngestion,
  ingestScrapyItems,
  SUPPORTED_RECIPES,
  MAX_ITEMS_PER_BATCH,
} = require('../server/ingest/scrapy-webhook');

function signPayload(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function buildValidCivilviewItem(overrides = {}) {
  const id = overrides.id || 'CIV-NJ-007-1001';
  const propertyId = overrides.propertyId || '1001001';
  return {
    id,
    source: 'civilview',
    state: 'NJ',
    county: 'Essex',
    city: 'Newark',
    address: '125 Market St, Newark, NJ 07102',
    openingBid: 145000,
    saleDate: '2026-11-18',
    sourceUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${propertyId}`,
    sourceObservedAt: '2026-10-25T12:00:00.000Z',
    raw: 'SHERIFF SALE NOTICE Essex County Docket F-001001-25 125 Market St Newark NJ 07102',
    provenance: {
      observed: true,
      origin: 'live',
      recordKind: 'source_record',
      publisher: 'CivilView Essex County Sheriff',
      recordId: propertyId,
      observedAt: '2026-10-25T12:00:00.000Z',
    },
    ...overrides,
  };
}

test('verifyScrapySignature: fails closed when secret is unset', () => {
  const result = verifyScrapySignature('{"test":1}', 'some-sig', '');
  assert.equal(result.valid, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /not configured/);
});

test('verifyScrapySignature: rejects missing or invalid format signatures', () => {
  const secret = 'test-secret-key-12345';

  // Missing header
  const missing = verifyScrapySignature('{"test":1}', null, secret);
  assert.equal(missing.valid, false);
  assert.equal(missing.status, 401);

  // Invalid hex format (not 64 hex chars)
  const malformed = verifyScrapySignature('{"test":1}', 'not-a-valid-hex-signature', secret);
  assert.equal(malformed.valid, false);
  assert.equal(malformed.status, 401);
  assert.match(malformed.error, /format/);
});

test('verifyScrapySignature: rejects forged signature with constant-time comparison', () => {
  const secret = 'test-secret-key-12345';
  const fakeSig = crypto.randomBytes(32).toString('hex');
  const result = verifyScrapySignature('{"recipe":"foreclosure","items":[]}', fakeSig, secret);
  assert.equal(result.valid, false);
  assert.equal(result.status, 401);
  assert.equal(result.error, 'Invalid signature');
});

test('verifyScrapySignature: accepts valid HMAC-SHA256 signature', () => {
  const secret = 'production-grade-scrapy-secret-67890';
  const body = JSON.stringify({ recipe: 'foreclosure', items: [{ id: 'FC-101', county: 'Harris' }] });
  const validSig = signPayload(body, secret);

  const result = verifyScrapySignature(body, validSig, secret);
  assert.equal(result.valid, true);
});

test('validateScrapyPayload: enforces recipe schema, items array, and MAX_ITEMS_PER_BATCH (500)', () => {
  // Non-object
  assert.equal(validateScrapyPayload(null).valid, false);
  assert.equal(validateScrapyPayload('string').valid, false);
  assert.equal(validateScrapyPayload([]).valid, false);

  // Unsupported recipe
  const badRecipe = validateScrapyPayload({ recipe: 'invalid_recipe', items: [] });
  assert.equal(badRecipe.valid, false);
  assert.match(badRecipe.error, /Unsupported recipe/);

  // Missing or non-array items
  const nonArrayItems = validateScrapyPayload({ recipe: 'foreclosure', items: 'not-an-array' });
  assert.equal(nonArrayItems.valid, false);
  assert.match(nonArrayItems.error, /must be an array/);

  // Valid for all supported recipes
  for (const recipe of SUPPORTED_RECIPES) {
    const valid = validateScrapyPayload({ recipe, items: [{ recordId: 1 }] });
    assert.equal(valid.valid, true);
    assert.equal(valid.recipe, recipe);
    assert.equal(valid.items.length, 1);
  }

  // Batch cap: exactly 500 items is valid
  assert.equal(MAX_ITEMS_PER_BATCH, 500);
  const atCap = validateScrapyPayload({
    recipe: 'foreclosure',
    items: new Array(500).fill({ id: 'FC-1' }),
  });
  assert.equal(atCap.valid, true);
  assert.equal(atCap.items.length, 500);

  // Batch cap: 501 items is rejected with 400 error message
  const overCap = validateScrapyPayload({
    recipe: 'foreclosure',
    items: new Array(501).fill({ id: 'FC-1' }),
  });
  assert.equal(overCap.valid, false);
  assert.match(overCap.error, /Batch exceeds maximum allowed items \(500\)/);
});

test('gateScrapyItemForIngestion: blocks DISCOVERY_ONLY and invalid items while admitting valid serving records', () => {
  const validItem = buildValidCivilviewItem();
  const allowed = gateScrapyItemForIngestion(validItem);
  assert.equal(allowed.isValid, true);
  assert.equal(allowed.listing.id, 'CIV-NJ-007-1001');
  assert.equal(allowed.listing.provenance.origin, 'live');
  assert.equal(allowed.listing.provenance.recordKind, 'source_record');

  // DISCOVERY_ONLY catalog source (courtlistener) must be blocked by servesListings
  const discoveryOnlyItem = buildValidCivilviewItem({
    id: 'CL-DOCKET-9991',
    source: 'courtlistener',
    sourceUrl: 'https://www.courtlistener.com/docket/123456/test-case/',
  });
  const blockedDiscovery = gateScrapyItemForIngestion(discoveryOnlyItem);
  assert.equal(blockedDiscovery.isValid, false);
  assert.ok(blockedDiscovery.errors.includes('source_not_serving_listings'));

  // Uncataloged source must be blocked
  const unknownSourceItem = buildValidCivilviewItem({
    id: 'UNK-1001',
    source: 'not-a-catalog-source',
  });
  const blockedUnknown = gateScrapyItemForIngestion(unknownSourceItem);
  assert.equal(blockedUnknown.isValid, false);
  assert.ok(blockedUnknown.errors.includes('source_not_serving_listings'));

  // Fixture / non-observed provenance must be blocked by validateListingForIngestion
  const fixtureItem = buildValidCivilviewItem({
    id: 'CIV-NJ-007-FIXTURE',
    provenance: {
      observed: false,
      fixture: true,
      origin: 'fixture',
      publisher: 'Fixture',
      recordId: '999',
      observedAt: '2026-10-25T12:00:00.000Z',
    },
  });
  const blockedFixture = gateScrapyItemForIngestion(fixtureItem);
  assert.equal(blockedFixture.isValid, false);
  assert.ok(blockedFixture.errors.includes('fixture_record_not_ingestible'));
});

test('gateScrapyItemForIngestion: rejects candidate items with trailing dots in sourceUrl', () => {
  // Single trailing dot in hostname
  const singleDot = buildValidCivilviewItem({
    id: 'CIV-NJ-007-DOT1',
    sourceUrl: 'https://salesweb.civilview.com./Sales/SaleDetails?PropertyId=1001',
  });
  const res1 = gateScrapyItemForIngestion(singleDot);
  assert.equal(res1.isValid, false);
  assert.ok(res1.errors.includes('source_host_mismatch') || res1.errors.includes('unsupported_source_policy'));

  // Multiple trailing dots in hostname
  const multiDot = buildValidCivilviewItem({
    id: 'CIV-NJ-007-DOT2',
    sourceUrl: 'https://salesweb.civilview.com../Sales/SaleDetails?PropertyId=1001',
  });
  const res2 = gateScrapyItemForIngestion(multiDot);
  assert.equal(res2.isValid, false);
  assert.ok(res2.errors.includes('source_host_mismatch') || res2.errors.includes('unsupported_source_policy'));
});

test('ingestScrapyItems: invokes db.createListing in memory mode (!isPostgres) when available', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapy-ingest-mem-test-'));
  const liveStorePath = path.join(tmpDir, 'live-listings.json');

  try {
    const valid = buildValidCivilviewItem({ id: 'CIV-NJ-007-MEM-1', propertyId: '3001001' });
    const persistedToMemory = [];
    const mockMemDb = {
      isPg: false,
      dataMode: () => 'memory',
      createListing: async (listing) => {
        persistedToMemory.push(listing);
      },
    };

    const quietLogger = { warn: () => {}, error: () => {} };
    const result = await ingestScrapyItems([valid], {
      db: mockMemDb,
      isPostgres: false,
      liveStorePath,
      logger: quietLogger,
    });

    assert.equal(result.isPostgres, false);
    assert.equal(result.accepted, 1);
    assert.equal(persistedToMemory.length, 1);
    assert.equal(persistedToMemory[0].id, 'CIV-NJ-007-MEM-1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ingestScrapyItems: enforces servesListings + validateListingForIngestion before Postgres createListing and reports accurate Postgres accounting', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapy-ingest-pg-test-'));
  const liveStorePath = path.join(tmpDir, 'live-listings.json');

  try {
    const valid1 = buildValidCivilviewItem({ id: 'CIV-NJ-007-2001', propertyId: '2001001' });
    const valid2 = buildValidCivilviewItem({ id: 'CIV-NJ-007-2002', propertyId: '2002002' });
    const discoveryOnly = buildValidCivilviewItem({
      id: 'CL-DOCKET-2003',
      source: 'courtlistener',
      sourceUrl: 'https://www.courtlistener.com/docket/2003003/foreclosure/',
    });
    const invalidSchema = buildValidCivilviewItem({
      id: 'CIV-NJ-007-2004',
      address: 'short',
      sourceUrl: 'https://example.com/not-civilview',
    });

    const persistedToPostgres = [];
    const mockPgDb = {
      isPg: true,
      postgresReachable: true,
      dataMode: () => 'postgres',
      createListing: async (listing) => {
        if (listing.id === 'CIV-NJ-007-2002') {
          throw new Error('simulated postgres constraint failure');
        }
        persistedToPostgres.push(listing);
      },
    };

    const quietLogger = { warn: () => {}, error: () => {} };
    const result = await ingestScrapyItems(
      [valid1, valid2, discoveryOnly, invalidSchema],
      {
        db: mockPgDb,
        liveStorePath,
        logger: quietLogger,
      }
    );

    // Only valid1 and valid2 were allowed to attempt db.createListing; discoveryOnly and invalidSchema were blocked at gate
    assert.equal(persistedToPostgres.length, 1);
    assert.equal(persistedToPostgres[0].id, 'CIV-NJ-007-2001');

    // Even though mergeLiveRecords accepted both valid1 and valid2 into file cache (liveAccepted = 2),
    // Postgres mode must report accepted = pgAccepted (1) and rejected = gateRejected (2) + pgFailed (1) = 3.
    assert.equal(result.isPostgres, true);
    assert.equal(result.received, 4);
    assert.equal(result.liveAccepted, 2);
    assert.equal(result.postgresAccepted, 1);
    assert.equal(result.postgresRejected, 2);
    assert.equal(result.postgresFailed, 1);
    assert.equal(result.accepted, 1);
    assert.equal(result.rejected, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scrapy webhook route handler declares GET and POST with HMAC verification, batch size cap, and non-200 on postgres failures', () => {
  const routePath = path.join(__dirname, '../src/app/api/public/scrapy-ingest/route.ts');
  assert.ok(fs.existsSync(routePath), 'scrapy-ingest route.ts must exist');

  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /export async function GET/);
  assert.match(source, /export async function POST/);
  assert.match(source, /verifyScrapySignature/);
  assert.match(source, /validateScrapyPayload/);
  assert.match(source, /ingestScrapyItems/);
  assert.match(source, /servesListings/);
  assert.match(source, /validateListingForIngestion/);
  assert.match(source, /x-signature/);
  assert.match(source, /verifyConnection/);
  assert.match(source, /dataMode\(\) === "postgres"/);
  assert.match(source, /MAX_ITEMS_PER_BATCH/);
  assert.match(source, /Batch exceeds maximum allowed items \(500\)/);
  assert.match(source, /hasPostgresFailures\s*\?\s*207\s*:\s*200/);
  assert.doesNotMatch(source, /issueWorkspaceSession|SCRAPER_ADMIN_TOKEN/);
});
