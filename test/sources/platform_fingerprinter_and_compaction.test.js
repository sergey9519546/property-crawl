'use strict';

/**
 * test/sources/platform_fingerprinter_and_compaction.test.js
 *
 * Comprehensive Unit Test Suite for Track 10:
 * 1. Platform Fingerprinter & Classifier (server/sources/platform-fingerprinter.js)
 *    - URL classification across all 9 vendor platforms
 *    - HTML docket/page fingerprinting across all 9 vendor platforms
 *    - Composite adapter identification (identifyAdapterForSource)
 *    - Negative / edge-case handling without false positives
 * 2. Cache Compaction Engine (server/discovery/cache-compaction.js)
 *    - Atomic writes & integrity validation
 *    - TTL-based eviction for stale cache entries
 *    - Null / empty object pruning
 *    - Preservation of valid data structures (Objects and Arrays)
 *    - Missing file and malformed JSON resilience
 *    - Directory-wide full compaction aggregation
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  SUPPORTED_PLATFORMS,
  classifySourceUrl,
  fingerprintPlatformHtml,
  identifyAdapterForSource
} = require('../../server/sources/platform-fingerprinter');

const {
  DEFAULT_KNOWN_CACHE_FILES,
  extractEntryTimestamp,
  compactCacheFile,
  runFullCacheCompaction
} = require('../../server/discovery/cache-compaction');

// ============================================================================
// PART 1: PLATFORM FINGERPRINTER & CLASSIFIER TESTS
// ============================================================================

test('SUPPORTED_PLATFORMS defines all 9 canonical vendor platforms with required metadata', () => {
  assert.equal(SUPPORTED_PLATFORMS.length, 9);

  const expectedPlatforms = [
    'civilview',
    'realauction',
    'bid4assets',
    'servicelink',
    'acclaimweb',
    'texas_tax_sale',
    'cook_recorder',
    'miami_clerk',
    'gsa_surplus'
  ];

  const platformIds = SUPPORTED_PLATFORMS.map((p) => p.id);
  for (const expected of expectedPlatforms) {
    assert.ok(platformIds.includes(expected), `Missing expected platform id: ${expected}`);
  }

  for (const p of SUPPORTED_PLATFORMS) {
    assert.ok(p.id, 'platform must have id');
    assert.ok(p.name, 'platform must have name');
    assert.ok(p.category, 'platform must have category');
    assert.ok(p.adapterModule, 'platform must specify adapterModule');
    assert.equal(typeof p.supportsDirectApi, 'boolean', 'supportsDirectApi must be boolean');
    assert.equal(typeof p.requiresRobotsCheck, 'boolean', 'requiresRobotsCheck must be boolean');
    assert.ok(Array.isArray(p.primaryDomains) && p.primaryDomains.length > 0, 'must have primaryDomains');
  }

  const gsa = SUPPORTED_PLATFORMS.find((p) => p.id === 'gsa_surplus');
  assert.equal(gsa.supportsDirectApi, true);
  assert.equal(gsa.adapterModule, 'server/scrapers/adapters/gsa-api.js');

  const miami = SUPPORTED_PLATFORMS.find((p) => p.id === 'miami_clerk');
  assert.equal(miami.adapterModule, 'server/scrapers/adapters/miami-dade-clerk.js');
});

test('classifySourceUrl: accurately classifies URLs for all 9 vendor platforms', () => {
  // 1. CivilView
  const cv1 = classifySourceUrl('https://salesweb.civilview.com/Sales/SalesSearch?countyId=1');
  assert.equal(cv1.platform, 'civilview');
  assert.equal(cv1.confidence, 'HIGH');
  const cv2 = classifySourceUrl('https://portal.co.ocean.nj.us/CivilView/Search');
  assert.equal(cv2.platform, 'civilview');
  assert.equal(cv2.confidence, 'HIGH');

  // 2. RealAuction
  const ra1 = classifySourceUrl('https://broward.realforeclose.com/index.cfm');
  assert.equal(ra1.platform, 'realauction');
  assert.equal(ra1.confidence, 'HIGH');
  const ra2 = classifySourceUrl('https://orange.realtaxdeed.com/index.cfm');
  assert.equal(ra2.platform, 'realauction');
  assert.equal(ra2.confidence, 'HIGH');
  const ra3 = classifySourceUrl('https://cuyahoga.realauction.com/');
  assert.equal(ra3.platform, 'realauction');
  assert.equal(ra3.confidence, 'HIGH');

  // 3. Bid4Assets
  const b4a1 = classifySourceUrl('https://www.bid4assets.com/v5/auction/1089241');
  assert.equal(b4a1.platform, 'bid4assets');
  assert.equal(b4a1.confidence, 'HIGH');
  const b4a2 = classifySourceUrl('https://bid4assets.com/storefront/county');
  assert.equal(b4a2.platform, 'bid4assets');
  assert.equal(b4a2.confidence, 'HIGH');

  // 4. ServiceLink
  const sl1 = classifySourceUrl('https://www.servicelinkauction.com/property/12345');
  assert.equal(sl1.platform, 'servicelink');
  assert.equal(sl1.confidence, 'HIGH');
  const sl2 = classifySourceUrl('https://auction.com/reo/67890');
  assert.equal(sl2.platform, 'servicelink');
  assert.equal(sl2.confidence, 'HIGH');

  // 5. AcclaimWeb
  const aw1 = classifySourceUrl('https://acclaimweb.com/search');
  assert.equal(aw1.platform, 'acclaimweb');
  assert.equal(aw1.confidence, 'HIGH');
  const aw2 = classifySourceUrl('https://acclaim.governmax.com/DirectSearch/SearchCriteria.aspx');
  assert.equal(aw2.platform, 'acclaimweb');
  assert.equal(aw2.confidence, 'HIGH');

  // 6. Texas Delinquent Tax Sale
  const tx1 = classifySourceUrl('https://www.linebarger.com/property-sales/');
  assert.equal(tx1.platform, 'texas_tax_sale');
  assert.equal(tx1.confidence, 'HIGH');
  const tx2 = classifySourceUrl('https://mvbalaw.com/tax-sales/');
  assert.equal(tx2.platform, 'texas_tax_sale');
  assert.equal(tx2.confidence, 'HIGH');
  const tx3 = classifySourceUrl('https://pbfcm.com/tax-sales/');
  assert.equal(tx3.platform, 'texas_tax_sale');
  assert.equal(tx3.confidence, 'HIGH');
  const tx4 = classifySourceUrl('https://lgbs.com/upcoming-sales');
  assert.equal(tx4.platform, 'texas_tax_sale');
  assert.equal(tx4.confidence, 'HIGH');

  // 7. Cook County Recorder
  const cook1 = classifySourceUrl('https://cookrecorder.com/search/');
  assert.equal(cook1.platform, 'cook_recorder');
  assert.equal(cook1.confidence, 'HIGH');
  const cook2 = classifySourceUrl('https://cookcountyclerkil.gov/recordings/lispendens');
  assert.equal(cook2.platform, 'cook_recorder');
  assert.equal(cook2.confidence, 'HIGH');

  // 8. Miami-Dade Clerk (Prioritized over generic RealAuction)
  const miami1 = classifySourceUrl('https://miamidade.realforeclose.com/index.cfm');
  assert.equal(miami1.platform, 'miami_clerk');
  assert.equal(miami1.confidence, 'HIGH');
  const miami2 = classifySourceUrl('https://onlineservices.miamidadeclerk.gov/officialrecords/');
  assert.equal(miami2.platform, 'miami_clerk');
  assert.equal(miami2.confidence, 'HIGH');

  // 9. GSA Surplus
  const gsa1 = classifySourceUrl('https://realestatesales.gov/gsaauctions/aucwelc/');
  assert.equal(gsa1.platform, 'gsa_surplus');
  assert.equal(gsa1.confidence, 'HIGH');
  const gsa2 = classifySourceUrl('https://api.gsa.gov/assets/gsaauctions/v1?api_key=DEMO_KEY');
  assert.equal(gsa2.platform, 'gsa_surplus');
  assert.equal(gsa2.confidence, 'HIGH');
});

test('classifySourceUrl: handles invalid URLs and unknown domains without false positives', () => {
  assert.equal(classifySourceUrl('').confidence, 'UNKNOWN');
  assert.equal(classifySourceUrl(null).confidence, 'UNKNOWN');
  assert.equal(classifySourceUrl('not a valid url').confidence, 'UNKNOWN');

  const unknown1 = classifySourceUrl('https://example.com/listings');
  assert.equal(unknown1.platform, 'unknown');
  assert.equal(unknown1.confidence, 'UNKNOWN');

  const unknown2 = classifySourceUrl('https://www.zillow.com/homedetails/123-Main-St');
  assert.equal(unknown2.platform, 'unknown');
  assert.equal(unknown2.confidence, 'UNKNOWN');
});

test('fingerprintPlatformHtml: detects vendor signatures across all 9 platforms', () => {
  // 1. CivilView HTML
  const cvHtml = `
    <html>
      <body>
        <div class="header">SalesWeb CivilView Sheriff Sales System</div>
        <table>
          <tr><th>Sheriff #</th><th>Plaintiff vs Defendant</th><th>Sale Date</th></tr>
          <tr><td>F-240012</td><td>Wells Fargo vs Smith</td><td>10/28/2026</td></tr>
        </table>
      </body>
    </html>
  `;
  const cvResult = fingerprintPlatformHtml(cvHtml);
  assert.equal(cvResult.platform, 'civilview');
  assert.equal(cvResult.confidence, 'HIGH');
  assert.ok(cvResult.matchedSignatures.length >= 2);

  // 2. RealAuction HTML
  const raHtml = `
    <div class="AUCTION_ITEM" id="item_101">
      <div class="AUCTION_STATS">
        <span class="label">Bids Placed:</span> 4
      </div>
      <footer>Powered by RealAuction.com realforeclose engine</footer>
    </div>
  `;
  const raResult = fingerprintPlatformHtml(raHtml);
  assert.equal(raResult.platform, 'realauction');
  assert.equal(raResult.confidence, 'HIGH');

  // 3. Bid4Assets HTML
  const b4aHtml = `
    <div>
      <h1>Bid4Assets California County Tax Sale</h1>
      <span class="asset-meta">AssetId: 984021</span>
      <a href="/v5/auction/984021">Bid Now</a>
    </div>
  `;
  const b4aResult = fingerprintPlatformHtml(b4aHtml);
  assert.equal(b4aResult.platform, 'bid4assets');
  assert.equal(b4aResult.confidence, 'HIGH');

  // 4. ServiceLink HTML
  const slHtml = `
    <div>
      <title>ServiceLink Auction - Verified Foreclosure & REO</title>
      <h2>Premier Property Auction Portal</h2>
    </div>
  `;
  const slResult = fingerprintPlatformHtml(slHtml);
  assert.equal(slResult.platform, 'servicelink');
  assert.equal(slResult.confidence, 'HIGH');

  // 5. AcclaimWeb HTML
  const awHtml = `
    <html>
      <head><title>GovernMax - AcclaimWeb Document Search</title></head>
      <body>
        <form action="DirectSearch" id="SearchCriteria">
        </form>
      </body>
    </html>
  `;
  const awResult = fingerprintPlatformHtml(awHtml);
  assert.equal(awResult.platform, 'acclaimweb');
  assert.equal(awResult.confidence, 'HIGH');

  // 6. Texas Delinquent Tax Sale HTML
  const txHtml = `
    <div>
      <h1>Notice of Tax Resale</h1>
      <p>Pursuant to Section 34.05 of the Texas Property Tax Code.</p>
      <p>Cause No: TX-2024-00412. Handled by Linebarger Goggan Blair & Sampson LLP.</p>
    </div>
  `;
  const txResult = fingerprintPlatformHtml(txHtml);
  assert.equal(txResult.platform, 'texas_tax_sale');
  assert.equal(txResult.confidence, 'HIGH');

  // 7. Cook County Recorder HTML
  const cookHtml = `
    <div>
      <h2>Cook County Clerk - Recorder of Deeds</h2>
      <div class="parcel">PIN: 17-10-305-012-0000</div>
      <p>Lis Pendens Foreclosure filing recorded.</p>
    </div>
  `;
  const cookResult = fingerprintPlatformHtml(cookHtml);
  assert.equal(cookResult.platform, 'cook_recorder');
  assert.equal(cookResult.confidence, 'HIGH');

  // 8. Miami-Dade Clerk HTML
  const miamiHtml = `
    <div>
      <h1>Miami-Dade County Clerk of Courts</h1>
      <div class="field">Folio: 01-3112-024-1180</div>
      <div class="notice">Foreclosure RealTaxDeed Auction Docket</div>
    </div>
  `;
  const miamiResult = fingerprintPlatformHtml(miamiHtml);
  assert.equal(miamiResult.platform, 'miami_clerk');
  assert.equal(miamiResult.confidence, 'HIGH');

  // 9. GSA Surplus HTML
  const gsaHtml = `
    <div>
      <h2>GSA Auctions - Federal Surplus Real Estate</h2>
      <p>Official portal of the U.S. General Services Administration</p>
      <span>Real Property Utilization and Disposal</span>
    </div>
  `;
  const gsaResult = fingerprintPlatformHtml(gsaHtml);
  assert.equal(gsaResult.platform, 'gsa_surplus');
  assert.equal(gsaResult.confidence, 'HIGH');
});

test('fingerprintPlatformHtml: returns UNKNOWN for empty or unrelated HTML without false positives', () => {
  assert.equal(fingerprintPlatformHtml('').confidence, 'UNKNOWN');
  assert.equal(fingerprintPlatformHtml(null).confidence, 'UNKNOWN');
  assert.equal(fingerprintPlatformHtml('   ').confidence, 'UNKNOWN');

  const genericHtml = `
    <html>
      <head><title>My Cooking Blog</title></head>
      <body>
        <h1>Chocolate Cake Recipe</h1>
        <p>Preheat oven to 350 degrees and mix flour with sugar.</p>
      </body>
    </html>
  `;
  const res = fingerprintPlatformHtml(genericHtml);
  assert.equal(res.platform, 'unknown');
  assert.equal(res.confidence, 'UNKNOWN');
  assert.equal(res.matchedSignatures.length, 0);
});

test('identifyAdapterForSource: correctly resolves adapter modules and metadata', () => {
  // GSA API endpoint
  const gsaResolved = identifyAdapterForSource('https://api.gsa.gov/assets/gsaauctions/v1');
  assert.equal(gsaResolved.platform, 'gsa_surplus');
  assert.equal(gsaResolved.confidence, 'HIGH');
  assert.equal(gsaResolved.adapterModule, 'server/scrapers/adapters/gsa-api.js');
  assert.equal(gsaResolved.supportsDirectApi, true);

  // CivilView
  const cvResolved = identifyAdapterForSource('https://salesweb.civilview.com/Sales/SalesSearch?countyId=4');
  assert.equal(cvResolved.platform, 'civilview');
  assert.equal(cvResolved.confidence, 'HIGH');
  assert.equal(cvResolved.adapterModule, 'server/scrapers/adapters/civilview.js');
  assert.equal(cvResolved.supportsDirectApi, false);

  // Unknown URL, but identified via HTML
  const fallbackHtml = '<div class="AUCTION_ITEM">RealAuction.com Foreclosure Auction</div>';
  const htmlIdentified = identifyAdapterForSource('https://portal.co.example.org/sheriff', fallbackHtml);
  assert.equal(htmlIdentified.platform, 'realauction');
  assert.equal(htmlIdentified.confidence, 'HIGH');
  assert.equal(htmlIdentified.adapterModule, 'server/scrapers/adapters/realauction.js');

  // Unrecognized source
  const unknownSource = identifyAdapterForSource('https://example.com/unknown', '<div>Generic page</div>');
  assert.equal(unknownSource.platform, 'unknown');
  assert.equal(unknownSource.confidence, 'UNKNOWN');
  assert.equal(unknownSource.adapterModule, null);
});

// ============================================================================
// PART 2: CACHE COMPACTION ENGINE TESTS
// ============================================================================

test('extractEntryTimestamp: correctly extracts timestamps from diverse cache payload shapes', () => {
  const t1 = extractEntryTimestamp({ observedAt: '2026-11-01T12:00:00.000Z' });
  assert.equal(t1, new Date('2026-11-01T12:00:00.000Z').getTime());

  const t2 = extractEntryTimestamp({ cachedAt: 1789200000000 });
  assert.equal(t2, 1789200000000);

  const t3 = extractEntryTimestamp({ timestamp: '2026-10-15T08:30:00Z' });
  assert.equal(t3, new Date('2026-10-15T08:30:00Z').getTime());

  const t4 = extractEntryTimestamp(1789100000000);
  assert.equal(t4, 1789100000000);

  const t5 = extractEntryTimestamp('2026-09-01T00:00:00Z');
  assert.equal(t5, new Date('2026-09-01T00:00:00Z').getTime());

  assert.equal(extractEntryTimestamp(null), null);
  assert.equal(extractEntryTimestamp({}), null);
  assert.equal(extractEntryTimestamp({ noDateKey: 'foo' }), null);
});

test('compactCacheFile: evicts stale entries by TTL and removes null/empty keys', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-compact-test-'));
  const testFile = path.join(tmpDir, 'test-flood-cache.json');

  const refTime = new Date('2026-11-02T12:00:00Z').getTime();
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days TTL

  const cacheData = {
    // Fresh entry (3 days old) -> keep
    fresh_key: {
      observedAt: new Date(refTime - 3 * 24 * 60 * 60 * 1000).toISOString(),
      zone: 'AE',
      risk: 'high'
    },
    // Stale entry (10 days old) -> evict
    stale_key: {
      observedAt: new Date(refTime - 10 * 24 * 60 * 60 * 1000).toISOString(),
      zone: 'X',
      risk: 'low'
    },
    // Null value -> prune
    null_key: null,
    // Empty object -> prune
    empty_key: {},
    // Another fresh entry with numeric cachedAt -> keep
    numeric_fresh_key: {
      cachedAt: refTime - 1 * 24 * 60 * 60 * 1000,
      elevation: 45
    }
  };

  fs.writeFileSync(testFile, JSON.stringify(cacheData, null, 2), 'utf8');

  const result = compactCacheFile(testFile, {
    maxAgeMs,
    referenceTime: refTime,
    pruneNulls: true,
    pruneEmptyObjects: true
  });

  assert.equal(result.status, 'compacted');
  assert.equal(result.entriesRemoved, 3); // stale_key, null_key, empty_key
  assert.equal(result.entriesRetained, 2); // fresh_key, numeric_fresh_key
  assert.ok(result.compactedBytes < result.originalBytes);

  // Read back and verify persisted state
  const updated = JSON.parse(fs.readFileSync(testFile, 'utf8'));
  assert.ok(updated.fresh_key);
  assert.ok(updated.numeric_fresh_key);
  assert.equal(updated.stale_key, undefined);
  assert.equal(updated.null_key, undefined);
  assert.equal(updated.empty_key, undefined);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('compactCacheFile: atomic write integrity and dryRun mode', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-compact-atomic-'));
  const testFile = path.join(tmpDir, 'atomic-cache.json');

  const initialData = {
    keep1: { observedAt: '2026-11-01T00:00:00Z', val: 1 },
    bad: null
  };
  fs.writeFileSync(testFile, JSON.stringify(initialData, null, 2), 'utf8');

  // Test dryRun: calculates stats without modifying disk
  const dryResult = compactCacheFile(testFile, { dryRun: true });
  assert.equal(dryResult.status, 'dry_run');
  assert.equal(dryResult.entriesRemoved, 1);
  assert.equal(dryResult.entriesRetained, 1);

  // Verify file on disk was NOT touched during dryRun
  const unedited = JSON.parse(fs.readFileSync(testFile, 'utf8'));
  assert.equal(unedited.bad, null);

  // Test real compaction: atomic replace
  const liveResult = compactCacheFile(testFile, { dryRun: false });
  assert.equal(liveResult.status, 'compacted');

  const compacted = JSON.parse(fs.readFileSync(testFile, 'utf8'));
  assert.equal(compacted.bad, undefined);
  assert.equal(compacted.keep1.val, 1);

  // Verify no orphaned .tmp files remain in directory
  const filesInDir = fs.readdirSync(tmpDir);
  assert.equal(filesInDir.filter((f) => f.endsWith('.tmp')).length, 0);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('compactCacheFile: handles array-based JSON caches', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-compact-array-'));
  const testFile = path.join(tmpDir, 'array-cache.json');

  const refTime = new Date('2026-11-02T12:00:00Z').getTime();
  const maxAgeMs = 5 * 24 * 60 * 60 * 1000;

  const arrayData = [
    { id: 1, observedAt: new Date(refTime - 1 * 24 * 60 * 60 * 1000).toISOString() }, // Keep
    null, // Prune
    {}, // Prune empty object
    { id: 2, observedAt: new Date(refTime - 10 * 24 * 60 * 60 * 1000).toISOString() }, // Evict stale
    { id: 3, observedAt: new Date(refTime - 2 * 24 * 60 * 60 * 1000).toISOString() } // Keep
  ];

  fs.writeFileSync(testFile, JSON.stringify(arrayData, null, 2), 'utf8');

  const result = compactCacheFile(testFile, {
    maxAgeMs,
    referenceTime: refTime
  });

  assert.equal(result.status, 'compacted');
  assert.equal(result.entriesRemoved, 3);
  assert.equal(result.entriesRetained, 2);

  const updated = JSON.parse(fs.readFileSync(testFile, 'utf8'));
  assert.equal(updated.length, 2);
  assert.equal(updated[0].id, 1);
  assert.equal(updated[1].id, 3);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('compactCacheFile: resilience against missing files and malformed JSON', () => {
  // Missing file
  const missing = compactCacheFile('C:/non/existent/path/does_not_exist.json');
  assert.equal(missing.status, 'missing_file');
  assert.equal(missing.entriesRemoved, 0);

  // Malformed JSON
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-compact-corrupt-'));
  const corruptFile = path.join(tmpDir, 'corrupt.json');
  fs.writeFileSync(corruptFile, '{"broken": [ unclosed json', 'utf8');

  const parseErr = compactCacheFile(corruptFile);
  assert.equal(parseErr.status, 'parse_error');
  assert.ok(parseErr.error);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('runFullCacheCompaction: aggregates compaction across cache directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-compact-dir-'));

  const f1 = path.join(tmpDir, 'fema-flood-cache.json');
  const f2 = path.join(tmpDir, 'epa-hazard-cache.json');
  const f3 = path.join(tmpDir, 'usgs-terrain-cache.json');

  const refTime = new Date('2026-11-02T12:00:00Z').getTime();
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;

  fs.writeFileSync(
    f1,
    JSON.stringify(
      {
        k1: { observedAt: new Date(refTime - 2 * 24 * 60 * 60 * 1000).toISOString() },
        k2: null
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    f2,
    JSON.stringify(
      {
        e1: { observedAt: new Date(refTime - 12 * 24 * 60 * 60 * 1000).toISOString() }, // Stale
        e2: { observedAt: new Date(refTime - 1 * 24 * 60 * 60 * 1000).toISOString() }
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    f3,
    JSON.stringify(
      {
        t1: { elevation: 120 }
      },
      null,
      2
    )
  );

  const summary = runFullCacheCompaction(tmpDir, {
    maxAgeMs,
    referenceTime: refTime,
    targetFiles: ['fema-flood-cache.json', 'epa-hazard-cache.json', 'usgs-terrain-cache.json']
  });

  assert.equal(summary.filesProcessed, 3);
  assert.equal(summary.totalEntriesRemoved, 2); // k2 (null) in f1, e1 (stale) in f2
  assert.equal(summary.totalEntriesRetained, 3); // k1 in f1, e2 in f2, t1 in f3
  assert.ok(summary.bytesSaved > 0);
  assert.equal(summary.fileSummaries.length, 3);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
