'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
const {
  rankHuntMatch,
  sortHuntResults,
  termCoverage,
  tokenize,
} = require(path.join(root, 'server', 'intelligence', 'hunt-ranking.js'));
const { SCORE_BANDS, bandForScore, scoreBandLabel } = require(path.join(root, 'server', 'intelligence', 'score-bands.js'));

function observedListing(overrides = {}) {
  return {
    id: 'listing-1',
    address: '123 Main Street',
    city: 'Austin',
    county: 'Travis',
    state: 'TX',
    zip: '78701',
    source: 'hud',
    propType: 'single family',
    openingBid: 50000,
    estLow: 120000,
    estHigh: 140000,
    mid: 130000,
    dealScore: 72,
    equity: 80000,
    saleDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    hasDocuments: true,
    evidenceCompleteness: { known: 6, total: 8, missing: ['occupancy', 'sqft'] },
    sourceFreshness: { status: 'current', observedAt: new Date().toISOString(), ageHours: 2, cadenceHours: 24 },
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      recordId: 'HUD-1',
      publisher: 'hud',
      observedAt: new Date().toISOString(),
      sourceFacts: { documents: [{ id: 'doc-1' }] },
    },
    sourceUrl: 'https://example.test/hud/1',
    ...overrides,
  };
}

test('score bands expose Elite/Strong/Fair/Thin and triage labels', () => {
  assert.equal(SCORE_BANDS.length, 4);
  assert.equal(scoreBandLabel(77), 'Elite');
  assert.equal(scoreBandLabel(60), 'Strong');
  assert.equal(scoreBandLabel(40), 'Fair');
  assert.equal(scoreBandLabel(20), 'Thin');
  assert.equal(bandForScore(null), null);
  assert.equal(bandForScore(100), null);
});

test('term coverage ranks richer query overlap higher', () => {
  assert.deepEqual(tokenize('Sheriff Sale, TX!'), ['sheriff', 'sale', 'tx']);
  const full = termCoverage('austin travis', '123 main street austin travis county tx hud');
  const partial = termCoverage('dallas travis', '123 main street dallas tx hud');
  assert.equal(full.coverage, 1);
  assert.equal(partial.coverage, 0.5);
});

test('hunt match rank uses evidence-backed factors without inventing values', () => {
  const listing = observedListing();
  const hunt = {
    criteria: {
      discoveryFilters: {
        q: 'austin travis',
        state: 'TX',
        minScore: '55',
        maxBid: '80000',
      },
    },
  };
  const ranked = rankHuntMatch(listing, hunt, [{ status: 'match' }], { now: Date.now() });
  assert.ok(ranked.rank > 0 && ranked.rank <= 100);
  assert.ok(['high', 'medium', 'low'].includes(ranked.band));
  assert.equal(ranked.dealScoreBand, 'elite');
  assert.ok(ranked.note.includes('Not an appraisal'));
  const factorNames = ranked.factors.map((factor) => factor.factor);
  assert.ok(factorNames.includes('search_term_coverage'));
  assert.ok(factorNames.includes('research_quality'));
  assert.ok(factorNames.includes('deal_score_band'));
  assert.ok(factorNames.includes('sale_urgency'));

  const thinWeak = rankHuntMatch(
    observedListing({
      dealScore: 12,
      openingBid: 125000,
      equity: 5000,
      saleDate: '2001-01-01',
      hasDocuments: false,
      evidenceCompleteness: { known: 1, total: 8, missing: [] },
      sourceFreshness: { status: 'stale' },
      provenance: { origin: 'archive', observed: false },
    }),
    hunt,
    [{ status: 'match' }],
    { now: Date.now() },
  );
  assert.ok(thinWeak.rank < ranked.rank, 'thin evidence and weak deal band must rank lower');
});

test('sortHuntResults orders matches by rank then evidence states', () => {
  const sorted = sortHuntResults([
    { listingId: 'c', status: 'no_match', relevance: null },
    { listingId: 'a', status: 'match', relevance: { rank: 40 } },
    { listingId: 'b', status: 'match', relevance: { rank: 90 } },
    { listingId: 'd', status: 'unknown', relevance: null },
  ]);
  assert.deepEqual(
    sorted.map((item) => item.listingId),
    ['b', 'a', 'd', 'c'],
  );
});

test('terminal filter store no longer exports unused store factory', () => {
  const fs = require('node:fs');
  const storePath = path.join(root, 'src', 'lib', 'terminal-filter-store.ts');
  const content = fs.readFileSync(storePath, 'utf8');
  assert.ok(!content.includes('createTerminalFilterStore'), 'unused store factory must stay removed');
  assert.ok(content.includes('export function terminalFilterReducer'));
});

test('hunt evaluation attaches relevance and ranking note', () => {
  const hunts = require(path.join(root, 'server', 'intelligence', 'hunts.js'));
  const os = require('node:os');
  const fs = require('node:fs');
  const filePath = path.join(os.tmpdir(), `hunt-rank-${process.pid}-${Date.now()}.json`);
  const now = '2026-09-05T18:00:00.000Z';
  const observedAt = '2026-09-05T17:00:00.000Z';

  function validListing(overrides = {}) {
    const recordId = overrides.recordId || '2128964683';
    return {
      id: `CIV-NJ-${recordId}`,
      source: 'civilview',
      state: 'NJ',
      county: 'Bergen',
      city: 'Park Ridge',
      address: '19 West Park Avenue, Park Ridge, NJ 07656',
      propType: 'Single Family',
      status: 'scheduled',
      openingBid: 100000,
      saleDate: '2026-10-01',
      sqft: 1800,
      deposit: '$5,000 certified funds',
      raw: `Official CivilView source record for sheriff sale ${recordId}.`,
      sourceUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${recordId}`,
      sourceObservedAt: observedAt,
      provenance: {
        origin: 'live',
        observed: true,
        recordKind: 'source_record',
        publisher: 'CivilView',
        recordId,
        observedAt,
      },
      ...overrides,
    };
  }

  try {
    const created = hunts.createHunt(
      {
        name: 'NJ sheriff sales',
        enabled: true,
        criteria: {
          mode: 'all',
          rules: [
            { field: 'state', operator: 'eq', value: 'NJ' },
            { field: 'source', operator: 'eq', value: 'civilview' },
          ],
        },
      },
      { filePath, now },
    );
    const huntId = created?.value?.id || created?.id;
    assert.ok(huntId, `createHunt must return a hunt id, got ${JSON.stringify(created)}`);
    const huntEnvelope = hunts.getHunt(huntId, { filePath });
    const fullHunt = huntEnvelope.hunt || huntEnvelope;
    assert.equal(fullHunt.enabled, true);

    const matchListing = validListing({
      recordId: '2128964683',
      dealScore: 72,
      openingBid: 50000,
      saleDate: '2026-10-01',
    });
    const missListing = validListing({
      id: 'CIV-PA-999',
      recordId: '999000111',
      state: 'PA',
      address: '1 Market Street, Philadelphia, PA 19107',
      county: 'Philadelphia',
      city: 'Philadelphia',
      sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=999000111',
      raw: 'Official CivilView source record for sheriff sale 999000111.',
      dealScore: 20,
    });

    const evaluation = hunts.evaluateInventory(
      fullHunt,
      [matchListing, missListing],
      { now, suppressEvents: true },
    );
    const matches = evaluation.response.results.filter((result) => result.status === 'match');
    const nonMatches = evaluation.response.results.filter((result) => result.status === 'no_match');
    assert.ok(
      matches.length >= 1,
      `expected at least one match, got ${JSON.stringify(evaluation.response.results, null, 2)}`,
    );
    assert.ok(nonMatches.length >= 1, 'state mismatch must remain a non-match');
    assert.ok(matches.every((result) => result.relevance && Number.isFinite(result.relevance.rank)));
    assert.ok(evaluation.response.rankingNote);
    assert.ok(String(matches[0].relevance.note).includes('Not an appraisal'));
    assert.equal(evaluation.response.results[0].status, 'match');
  } finally {
    try { fs.unlinkSync(filePath); } catch {}
  }
});
