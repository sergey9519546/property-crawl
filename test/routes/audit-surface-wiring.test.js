'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('compare proxy route: static /api/listings/compare handler delegates to proxyPropertyApi', () => {
  const src = read('src/app/api/listings/compare/route.ts');
  assert.match(src, /export const dynamic = ["']force-dynamic["']/);
  assert.match(src, /export const GET =/);
  assert.match(src, /proxyPropertyApi\(request\)/);
});

test('social proof: derives active source badges from /api/health without dropping disclaimer', () => {
  const src = read('src/components/site/social-proof.tsx');
  assert.match(src, /(?:fetch\(["']\/api\/health["']|fetchHealthSnapshot\()/);
  if (/fetchHealthSnapshot/.test(src)) {
    assert.match(read('src/lib/health-client.ts'), /fetch\(["']\/api\/health["']/);
  }
  assert.match(src, /inventoryFreshness\?\.bySource/);
  assert.match(src, /\.filter\(\(item\) => item\.count > 0\)/);
  assert.match(src, /SOURCE_TAXONOMY\[key\]\?\.label \|\| key/);
  assert.match(src, /not endorsements/i);
});

test('workspace settings: surfaces /api/health/ready and /api/scrapers/health diagnostics', () => {
  const src = read('src/app/workspace/settings/settings-view.tsx');
  assert.match(src, /(?:fetch\(["']\/api\/health["']|fetchHealthSnapshot\()/);
  if (/fetchHealthSnapshot/.test(src)) {
    assert.match(read('src/lib/health-client.ts'), /fetch\(["']\/api\/health["']/);
  }
  assert.match(src, /fetch\(["']\/api\/health\/ready["']/);
  assert.match(src, /fetch\(["']\/api\/scrapers\/health["']/);
  assert.match(src, /Persistence &amp; Discovery Readiness/);
  assert.match(src, /Scraper Fleet &amp; Drift Health/);
  assert.match(src, /scraperStatusCode === 401 && !session\.authenticated/);
  assert.match(src, /Unlock to view diagnostics/);
});

test('deal discovery map: accepts national coordinates, falls back beyond Cleveland, and keeps lazy MapLibre', () => {
  const src = read('src/components/site/deal-discovery-map.tsx');
  assert.match(src, /function isUsCoord\(lat: number, lng: number\): boolean/);
  assert.match(src, /lat >= 15 && lat <= 72 && lng >= -180 && lng <= -64/);
  assert.match(src, /fetch\(["']\/api\/listings\?limit=40&sort=score["']/);
  assert.match(src, /isClevelandWindow/);
  assert.match(src, /import\(["']maplibre-gl["']\)/);
  assert.doesNotMatch(src, /["']Published listing["']/);
});

test('interactive terminal: exposes occupancy and dynamic property types plus honest error copy', () => {
  const src = read('src/components/terminal/interactive-terminal.tsx');
  assert.match(src, /const availablePropertyTypes = collectFilterOptions\(/);
  assert.match(src, /const availableOccupancies = collectFilterOptions\(/);
  assert.match(src, /aria-label="Occupancy filter"/);
  assert.match(src, /key: "occupancy", value: e\.target\.value/);
  assert.match(src, /aria-label="Remove occupancy filter"/);
  assert.match(src, /Data API unavailable — no unverified records substituted/);
  assert.match(src, /No inventory loaded/);
  assert.match(src, /Last loaded inventory retained/);
  assert.doesNotMatch(src, /listings\.length \|\| 2000/);
});

test('discovery workbench: calendar subtitle accurately describes dated and undated buckets', () => {
  const src = read('src/components/listings/discovery-workbench.tsx');
  assert.match(src, /Dated sales are ordered chronologically; undated records are grouped below\./);
  assert.doesNotMatch(src, /Only sales with a published date appear here\./);
});

test('ci workflow: PostGIS E2E job applies numbered migrations via npm run discovery:migrate', () => {
  const yml = read('.github/workflows/ci.yml');
  assert.match(yml, /npm run discovery:migrate/);
  assert.doesNotMatch(yml, /psql .*server\/db\/schema\.sql/);
});

test('seo routes and county-inventory paginate safely and fail closed on unknown states', async () => {
  const sitemapSrc = read('src/app/sitemap.ts');
  assert.doesNotMatch(sitemapSrc, /['"]\/foreclosure['"]/);
  assert.doesNotMatch(sitemapSrc, /['"]\/sheriff-sales['"]/);
  assert.match(sitemapSrc, /offset=\$\{offset\}/);

  const statePageSrc = read('src/app/states/[state]/page.tsx');
  assert.match(statePageSrc, /VALID_STATE_CODES/);
  assert.match(statePageSrc, /if \(!state\)[\s\S]*?notFound\(\)/);
  assert.match(statePageSrc, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);

  const countyPageSrc = read('src/app/states/[state]/[county]/page.tsx');
  assert.match(countyPageSrc, /const loadCountyData = cache\(/);
  assert.match(countyPageSrc, /if \(!state\)[\s\S]*?notFound\(\)/);
  assert.doesNotMatch(countyPageSrc, /North Carolina law/);
  assert.match(countyPageSrc, /\$\{STATE_NAMES\[state\] \|\| state\} law/);

  const exportPageSrc = read('src/app/research/[id]/export/page.tsx');
  assert.match(exportPageSrc, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  assert.match(exportPageSrc, /AbortSignal\.timeout\(12_000\)/);
  assert.match(exportPageSrc, /notFound\(\)/);

  const { loadCountyInventory } = require('../../src/lib/county-inventory');
  const pagesCalled = [];
  const rows = await loadCountyInventory({
    stateCode: 'OH',
    county: 'cuyahoga',
    apiUrl: 'http://127.0.0.1:3000',
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      const offset = Number(parsed.searchParams.get('offset') || '0');
      const limit = Number(parsed.searchParams.get('limit') || '250');
      pagesCalled.push({ offset, limit });
      const batchSize = offset === 0 ? limit : 60;
      const listings = Array.from({ length: batchSize }, (_, i) => ({
        id: offset === 0 ? `OH-${i}` : `OH-${i === 0 ? 0 : offset + i}`,
        state: 'OH',
        county: 'Cuyahoga',
      }));
      return new Response(JSON.stringify({ total: 310, listings }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(pagesCalled.length, 2);
  assert.deepEqual(pagesCalled, [
    { offset: 0, limit: 250 },
    { offset: 250, limit: 250 },
  ]);
  assert.equal(rows.length, 309, 'Deduplicates overlapping ID across pages while collecting >250 rows');
});

test('3d parcel visualizer and intelligence surface preserve zero-fabrication controls and interactive UX', () => {
  const parcelSrc = read('src/components/terminal/parcel-3d-visualizer.tsx');
  assert.match(parcelSrc, /inspectParcelBoundaryInputs/);
  assert.match(parcelSrc, /3D Isometric/);
  assert.match(parcelSrc, /2D Top-Down/);
  assert.match(parcelSrc, /aria-label="Parcel rotation azimuth"/);
  assert.match(parcelSrc, /metadata\?\.topography/);
  assert.match(parcelSrc, /NOT_A_SURVEY/);

  const intelSrc = read('src/components/listings/property-intelligence.tsx');
  assert.match(intelSrc, /showAllSignals/);
  assert.match(intelSrc, /showAllFactors/);
  assert.match(intelSrc, /federalHazards:\s*hazards/);

  const enrichmentSrc = read('src/components/listings/enrichment-view.tsx');
  assert.match(enrichmentSrc, /fetchEnrichmentAdapters/);
  assert.match(enrichmentSrc, /selectedSources/);

  const packetViewSrc = read('src/components/research/decision-packet-view.tsx');
  assert.match(packetViewSrc, /scenario-checksum-divergence/);
  assert.match(packetViewSrc, /\/api\/listings\/\$\{encodeURIComponent\(p\.id\)\}\/packet\?format=\$\{format\}/);
});

test('underwriting simulator, binder sync, workbench filters, and storyteller carry full scenario fidelity', () => {
  const simSrc = read('src/components/terminal/bidding-simulator.tsx');
  assert.match(simSrc, /updateHomestead/);
  assert.match(simSrc, /aria-label="Modeled DSCR LTV percentage"/);
  assert.match(simSrc, /aria-label="Modeled DSCR interest rate percentage"/);
  assert.match(simSrc, /aria-label="Modeled DSCR monthly insurance assumption"/);
  assert.match(simSrc, /aria-label="Assumed redemption probability percent"/);
  assert.match(simSrc, /handleSignedPacketExport\(["']json["']\)/);
  assert.match(simSrc, /reverseScenario\.maxPurchasePrice - openingBid/);

  const checklistSrc = read('src/components/terminal/due-diligence-checklist.tsx');
  assert.match(checklistSrc, /setWaterfallLienType\] = useState<[\s\S]*?>\(detectedForeclosingType\)/);
  assert.match(checklistSrc, /syncBinderToCase/);
  assert.match(checklistSrc, /\/api\/workspace\/cases/);

  const gapSrc = read('src/components/evidence/gap-ledger.tsx');
  assert.match(gapSrc, /\/api\/workspace\/cases/);

  const terminalSrc = read('src/components/terminal/interactive-terminal.tsx');
  assert.match(terminalSrc, /syncTotal \|\| syncCount \|\| listings\.length/);

  const storytellerSrc = read('src/components/site/storyteller.tsx');
  assert.match(storytellerSrc, /Find matching deals in Workbench/);
  assert.match(storytellerSrc, /params\.set\("maxBid"/);
});

test('portfolio drops filter activeDrops only, surface historyUnavailable, watchlist sends credentials, and release gate builds NFT manifests', () => {
  const portfolioSrc = read('src/components/portfolio/portfolio-view.tsx');
  assert.match(portfolioSrc, /const activeDrops = priceDrops\.filter\(\(d\) => d\.dropped\)/);
  assert.match(portfolioSrc, /activeDrops\.length === 0/);
  assert.match(portfolioSrc, /activeDrops\.map/);
  assert.match(portfolioSrc, /setHistoryUnavailable\(Boolean\(dropsData\.historyUnavailable\)\)/);
  assert.match(portfolioSrc, /Historical bid snapshots are temporarily unavailable/);
  assert.match(portfolioSrc, /dealAddressById\.get\(d\.listingId\)/);

  const watchlistSrc = read('src/components/terminal/watchlist-modal.tsx');
  assert.match(watchlistSrc, /\/api\/portfolio\/dashboard\?upcomingWindowDays=60&upcomingLimit=5[\s\S]*?credentials:\s*"same-origin"/);

  const releaseGateSrc = read('scripts/release-gate.js');
  assert.match(releaseGateSrc, /ensure-nft-manifests\.js/);
});

test('email_notice origin has live/observed parity across presentation, signals, dossier, cases, hunts, and documents', () => {
  const os = require('node:os');
  const { presentListing } = require('../../server/routes/listings');
  const { evaluateOpportunitySignals } = require('../../server/intelligence/signals');
  const { buildPropertyDossier } = require('../../server/intelligence/dossier');
  const { createCase } = require('../../server/intelligence/research-cases');
  const { evaluateListing } = require('../../server/intelligence/hunts');
  const { buildDocumentEvidence } = require('../../server/intelligence/document-evidence');

  const emailListing = {
    id: 'audit-email-1',
    source: 'civilview',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=1',
    state: 'NJ',
    county: 'Bergen',
    address: '100 Main St',
    propType: 'Single Family',
    openingBid: 100000,
    status: 'upcoming',
    saleDate: '2026-12-01',
    raw: 'Notice of sheriff sale 100 Main St',
    provenance: {
      observed: true,
      origin: 'email_notice',
      publisher: 'civilview',
      recordId: 'audit-email-1',
      capturedAt: '2026-10-20T12:00:00Z',
      observedAt: '2026-10-20T12:00:00Z',
      sourceRecordUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=1',
      sourceFacts: {
        parcelId: '123-456',
        documents: [{ title: 'Notice', url: 'https://salesweb.civilview.com/doc.pdf' }],
      },
    },
    media: {
      documents: [{ title: 'Notice', url: 'https://salesweb.civilview.com/doc.pdf' }],
    },
  };
  const seedControl = {
    ...emailListing,
    provenance: { ...emailListing.provenance, origin: 'seed' },
  };

  assert.equal(presentListing(emailListing).provenance.origin, 'email_notice');
  assert.notEqual(presentListing(emailListing).sourceFreshness.status, 'unknown');
  assert.equal(presentListing(seedControl).sourceFreshness.status, 'unknown');

  assert.ok(evaluateOpportunitySignals(emailListing).summary.supported > 0);
  assert.equal(evaluateOpportunitySignals(seedControl).summary.supported, 0);

  const dossier = buildPropertyDossier(emailListing);
  assert.ok(dossier.summary.publisherFacts > 0);
  assert.equal(buildPropertyDossier(seedControl).summary.publisherFacts, 0);

  const docEvidence = buildDocumentEvidence(emailListing);
  assert.equal(docEvidence.status, 'observed');
  assert.equal(docEvidence.count, 1);
  assert.equal(buildDocumentEvidence(seedControl).status, 'unknown');

  const huntMatch = evaluateListing(emailListing, {
    id: 'hunt-audit-email',
    criteria: { discoveryFilters: { state: 'NJ' }, rules: [] },
  });
  assert.equal(huntMatch.status, 'match');
  const seedHunt = evaluateListing(seedControl, {
    id: 'hunt-audit-seed',
    criteria: { discoveryFilters: { state: 'NJ' }, rules: [] },
  });
  assert.equal(seedHunt.status, 'unknown');
  assert.ok(seedHunt.validationErrors.includes('non_live_origin'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-email-case-'));
  const caseFile = path.join(tmpDir, 'cases.json');
  try {
    const created = createCase(
      {
        listing: emailListing,
        dossier,
        origin: { type: 'manual' },
      },
      { filePath: caseFile }
    );
    assert.equal(created.created, true);
    const persisted = JSON.parse(fs.readFileSync(caseFile, 'utf8')).cases[0];
    assert.equal(persisted.listingSnapshot?.provenance?.origin, 'email_notice');
    assert.throws(
      () => createCase({ listing: seedControl, dossier: buildPropertyDossier(seedControl), origin: { type: 'manual' } }, { filePath: caseFile }),
      /validated live publisher evidence/i
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildDecisionPacket applies statutory tax-sale redemption defaults while preserving OH window and explicit zero', () => {
  const { buildDecisionPacket } = require('../../server/export/decision-packet');

  const txTax = buildDecisionPacket({
    id: 'pkt-tx-tax',
    state: 'TX',
    source: 'sheriff',
    distressType: 'tax_sale',
    openingBid: 100000,
  });
  assert.equal(txTax.underwriting.statutoryDeadlinesAndCarry.stateRedemptionDays, 180);

  const txHomestead = buildDecisionPacket(
    {
      id: 'pkt-tx-hs',
      state: 'TX',
      source: 'sheriff',
      distressType: 'tax_sale',
      openingBid: 100000,
    },
    { isHomestead: true }
  );
  assert.equal(txHomestead.underwriting.statutoryDeadlinesAndCarry.stateRedemptionDays, 730);

  const ohSheriff = buildDecisionPacket({
    id: 'pkt-oh-sheriff',
    state: 'OH',
    source: 'sheriff',
    openingBid: 100000,
  });
  assert.equal(ohSheriff.underwriting.statutoryDeadlinesAndCarry.objectionOrConfirmationDays, 30);
  assert.equal(ohSheriff.underwriting.statutoryDeadlinesAndCarry.stateRedemptionDays, 0);

  const explicitZero = buildDecisionPacket({
    id: 'pkt-tx-zero',
    state: 'TX',
    source: 'sheriff',
    distressType: 'tax_sale',
    redemptionDays: 0,
    openingBid: 100000,
  });
  assert.equal(explicitZero.underwriting.statutoryDeadlinesAndCarry.stateRedemptionDays, 0);
});

test('tax-sale and derived-redemption parity holds across BiddingSimulator, packet routes, and DecisionPacketView', () => {
  const { isTaxSaleContext, publishedRedemptionDays } = require('../../src/lib/underwriting.ts');

  assert.equal(publishedRedemptionDays({ redemptionDays: 365, provenance: { derivedFields: { redemption: true } } }), null);
  assert.equal(publishedRedemptionDays({ redemptionDays: 0 }), 0);
  assert.equal(isTaxSaleContext({ auctionProgram: 'tax_deed' }), true);
  assert.equal(isTaxSaleContext({ auctionProgram: 'tax_deed', isTaxSale: false }), false);
  assert.equal(isTaxSaleContext({ notes: 'Buyer pays property tax proration at closing.' }), false);
  assert.equal(isTaxSaleContext({ notes: 'Delinquent tax deed auction under O.C.G.A.' }), true);

  const simSrc = read('src/components/terminal/bidding-simulator.tsx');
  assert.match(simSrc, /publishedRedemptionDays\(listing\)/);
  assert.doesNotMatch(simSrc, /listing\.redemptionDays\s*>\s*0/);
  assert.match(simSrc, /isTaxSale:\s*isTaxCandidate/);
  assert.match(simSrc, /&isTaxSale=\$\{encodeURIComponent\(String\(isTaxSale\)\)\}/);

  const packetViewSrc = read('src/components/research/decision-packet-view.tsx');
  assert.match(packetViewSrc, /auctionProgram:\s*packet\?\.property\?\.auctionProgram/);
  assert.match(packetViewSrc, /typeof packet\?\.property\?\.isTaxSale === 'boolean'/);

  const nextPacketRouteSrc = read('src/app/api/listings/[id]/packet/route.ts');
  assert.match(nextPacketRouteSrc, /url\.searchParams\.get\("isTaxSale"\)/);
  assert.match(nextPacketRouteSrc, /typeof payload\.isTaxSale === "string"/);
});
