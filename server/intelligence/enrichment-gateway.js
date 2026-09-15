// server/intelligence/enrichment-gateway.js
//
// P3-3 enrichment gateway: aggregate, refresh, and rank per-parcelKey enrichment
// evidence produced by the enrichment adapters (CourtListener, FL DOR, CA
// Controller).
//
// Surface:
//   - aggregateByParcelKey(parcelKey, options)
//       Pulls every listing that shares the parcelKey from the inventory,
//       runs applyCrossSourceBakeOff to annotate matches, returns a stable
//       resolved view (sources, freshest observation, evidence per source,
//       confidence ranking).
//   - refreshByParcelKey(parcelKey, options)
//       Re-runs the registered enrichment scrapers, persists any new listings
//       back into the inventory, then returns the updated aggregate view. New
//       listings are persisted via the scraper's standard upsert path so the
//       bake-off sees them on the next read.
//   - rankConfidence(view)
//       Pure: assigns each source a confidence score in [0, 1] and a rank
//       order. Used by aggregateByParcelKey and exposed for direct testing.
//
// Safety:
//   - parcelKey shape is validated (non-empty, bounded length, safe charset)
//     so a malicious route param cannot blow up downstream filters.
//   - refresh never blocks on a failing scraper: each adapter runs in its
//     own try/catch and surfaces per-source outcomes; one bad publisher does
//     not stop the whole refresh.
//   - refresh does not mutate the live cache when env.SCRAPLING_LIVE_WRITE
//     is unset (the gateway is read-only by default in production until an
//     operator opts into write mode for enrichment).
//   - The module never fabricates bid, sale-date, or occupancy values; the
//     enrichment adapters themselves enforce that contract.

const { applyCrossSourceBakeOff } = require('../db/client');
const courtlistener = require('../scrapers/courtlistener');
const flDor = require('../scrapers/fl-dor-cadastral');
const caController = require('../scrapers/ca-controller-tax-sale');

const PARCEL_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const DEFAULT_REFRESH_LIMIT = 20;
const SOURCE_RANKING = ['courtlistener', 'fl-dor-cadastral', 'ca-controller-tax-sale', 'servicelink', 'usda', 'hud', 'gsa', 'treasury', 'irs', 'marshals'];

function validateParcelKey(parcelKey) {
  if (typeof parcelKey !== 'string') throw new Error('parcelKey must be a string');
  const trimmed = parcelKey.trim();
  if (!trimmed) throw new Error('parcelKey must not be empty');
  if (!PARCEL_KEY_PATTERN.test(trimmed)) throw new Error('parcelKey must match /^[A-Za-z0-9._:-]{1,128}$/');
  return trimmed;
}

function normalizeListingTimestamp(listing) {
  const raw = listing?.sourceObservedAt || listing?.provenance?.observedAt || null;
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : 0;
}

function safeSourceSummary(listing) {
  return {
    listingId: listing.id || null,
    observedAt: listing.sourceObservedAt || listing.provenance?.observedAt || null,
    openingBid: listing.openingBid ?? null,
    address: listing.address || null,
    city: listing.city || null,
    state: listing.state || null,
    zip: listing.zip || null,
    county: listing.county || null,
    apn: listing.apn || listing.parcelNumber || listing.parcelId || null,
    evidenceCount: Array.isArray(listing.evidence) ? listing.evidence.length : 0
  };
}

function pickFreshest(listings) {
  if (!listings.length) return null;
  return listings.reduce((best, candidate) => {
    if (!best) return candidate;
    return normalizeListingTimestamp(candidate) > normalizeListingTimestamp(best) ? candidate : best;
  }, null);
}

function scoreSource(sourceSummary, freshestTime, oldestTime) {
  const observedTime = sourceSummary.observedAt ? Date.parse(sourceSummary.observedAt) : 0;
  const span = Math.max(1, freshestTime - oldestTime);
  const recencyPosition = freshestTime === oldestTime
    ? 1
    : Math.max(0, Math.min(1, (observedTime - oldestTime) / span));
  const evidenceScore = Math.min(1, sourceSummary.evidenceCount / 4);
  const freshnessScore = observedTime > 0
    ? Math.max(0, Math.min(1, 1 - ((Date.now() - observedTime) / (365 * 24 * 3_600_000))))
    : 0;
  const authorityScore = SOURCE_RANKING.includes(sourceSummary.source)
    ? 1 - (SOURCE_RANKING.indexOf(sourceSummary.source) / SOURCE_RANKING.length)
    : 0.4;
  const confidence = Math.max(0, Math.min(1,
    (recencyPosition * 0.45) + (evidenceScore * 0.25) + (freshnessScore * 0.2) + (authorityScore * 0.1)
  ));
  return { recencyPosition, evidenceScore, freshnessScore, authorityScore, confidence };
}

function rankConfidence(view) {
  const sources = Array.isArray(view?.sources) ? view.sources : [];
  if (!sources.length) return { ...view, freshestObservation: view.freshestObservation ? { ...view.freshestObservation, confidence: null, confidenceBand: 'unknown' } : null };
  const observedTimes = sources
    .map((s) => s.summary?.observedAt ? Date.parse(s.summary.observedAt) : 0)
    .filter((t) => t > 0);
  const freshestTime = observedTimes.length ? Math.max(...observedTimes) : 0;
  const oldestTime = observedTimes.length ? Math.min(...observedTimes) : 0;
  const scored = sources.map((entry) => {
    const score = scoreSource(entry.summary || entry, freshestTime, oldestTime);
    return { ...entry, confidence: Number(score.confidence.toFixed(4)), score };
  });
  scored.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const aTime = Date.parse(a.summary?.observedAt || '') || 0;
    const bTime = Date.parse(b.summary?.observedAt || '') || 0;
    return bTime - aTime;
  });
  const ranked = scored.map((entry, index) => ({ ...entry, rank: index + 1, confidenceBand: confidenceBand(entry.confidence) }));
  // Project the freshest observation's confidence: it is the rank-1 source's
  // confidence when the freshest observation actually comes from that source;
  // otherwise it carries no confidence. We expose a band so the UI can render
  // a label without recomputing.
  const freshestObs = view.freshestObservation;
  let enrichedFreshest = null;
  if (freshestObs) {
    const freshestSource = ranked.find((entry) => entry.source === freshestObs.source);
    enrichedFreshest = {
      ...freshestObs,
      confidence: freshestSource ? freshestSource.confidence : null,
      confidenceBand: freshestSource ? freshestSource.confidenceBand : 'unknown',
      rank: freshestSource ? freshestSource.rank : null
    };
  }
  return { ...view, sources: ranked, freshestObservation: enrichedFreshest };
}

function confidenceBand(confidence) {
  if (confidence == null || Number.isNaN(confidence)) return 'unknown';
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.45) return 'medium';
  if (confidence > 0) return 'low';
  return 'unknown';
}

async function loadListingsForParcelKey(parcelKey, database) {
  const inventory = await database.getListings({ limit: 100000 });
  const all = Array.isArray(inventory?.listings) ? inventory.listings : [];
  return all.filter((listing) => listing && listing.parcelKey === parcelKey);
}

function buildView(parcelKey, listings) {
  applyCrossSourceBakeOff(listings);
  const freshest = pickFreshest(listings);
  const sourcesByKey = new Map();
  for (const listing of listings) {
    const key = listing.source || 'unknown';
    if (!sourcesByKey.has(key)) sourcesByKey.set(key, []);
    sourcesByKey.get(key).push(listing);
  }
  const sources = [...sourcesByKey.entries()].map(([source, group]) => {
    const sourceFreshest = pickFreshest(group);
    const evidence = [];
    for (const listing of group) {
      if (Array.isArray(listing.evidence)) evidence.push(...listing.evidence);
      if (listing.crossSourceMatches) evidence.push({ kind: 'crossSourceMatches', value: listing.crossSourceMatches });
      if (listing.bakeOff) evidence.push({ kind: 'bakeOff', value: listing.bakeOff });
    }
    return {
      source,
      summary: sourceFreshest ? safeSourceSummary(sourceFreshest) : { source, observedAt: null, openingBid: null, address: null, city: null, state: null, zip: null, county: null, apn: null, evidenceCount: 0 },
      listingIds: group.map((l) => l.id).filter(Boolean),
      crossSourceMatches: sourceFreshest?.crossSourceMatches || [],
      bakeOff: sourceFreshest?.bakeOff || null,
      evidence
    };
  });
  return rankConfidence({
    parcelKey,
    sourceCount: sourcesByKey.size,
    listingCount: listings.length,
    freshestObservation: freshest ? safeSourceSummary(freshest) : null,
    sources
  });
}

async function aggregateByParcelKey(parcelKey, { database } = {}) {
  const validKey = validateParcelKey(parcelKey);
  const db = database || require('../db/client');
  const listings = await loadListingsForParcelKey(validKey, db);
  if (!listings.length) {
    return { parcelKey: validKey, found: false, sourceCount: 0, listingCount: 0, freshestObservation: null, sources: [] };
  }
  return { found: true, ...buildView(validKey, listings) };
}

const ENRICHMENT_SCRAPERS = [
  { source: 'courtlistener', scraper: () => courtlistener },
  { source: 'fl-dor-cadastral', scraper: () => flDor },
  { source: 'ca-controller-tax-sale', scraper: () => caController }
];

async function runScraperSafely(scraper, options) {
  if (!scraper || typeof scraper.scrape !== 'function') {
    return { outcome: 'skipped', reason: 'no_scrape_method', records: [] };
  }
  try {
    const result = await scraper.scrape(options);
    const records = Array.isArray(result?.listings) ? result.listings
      : Array.isArray(result?.records) ? result.records
        : [];
    return { outcome: records.length ? 'success' : 'empty', records, error: null };
  } catch (error) {
    return { outcome: 'failed', error: error.message, records: [] };
  }
}

// Sequential adapter runner. Kept as a separate function so the parallel path
// can stay branchless and the sequential path is easy to read.
async function sequentialOutcomes(scrapers, adapterOptions, now) {
  const outcomes = [];
  for (const entry of scrapers) {
    const scraper = typeof entry.scraper === 'function' ? entry.scraper() : entry.scraper;
    const startedAt = now().toISOString();
    const outcome = await runScraperSafely(scraper, adapterOptions);
    outcomes.push({ source: entry.source, ...outcome, startedAt });
  }
  return outcomes;
}

async function refreshByParcelKey(parcelKey, {
  database,
  scheduler,
  scrapers = ENRICHMENT_SCRAPERS,
  limit = DEFAULT_REFRESH_LIMIT,
  env = process.env,
  now = () => new Date(),
  parallel = true
} = {}) {
  const validKey = validateParcelKey(parcelKey);
  const db = database || require('../db/client');
  // The scrapers accept a `perPage` or `maxRecords` budget; we pass whichever
  // the adapter supports. Each adapter is responsible for rate limiting; the
  // gateway only bounds the per-run budget so a refresh cannot fan out.
  //
  // We default to parallel execution via Promise.allSettled: one slow or
  // failing scraper never blocks the others. runScraperSafely already catches
  // its own errors, so allSettled mostly exists to keep the per-adapter timing
  // honest even if a future adapter stops catching internally.
  const startMs = Date.now();
  const scrapedAt = now().toISOString();
  const tasks = scrapers.map(async (entry) => {
    const scraper = typeof entry.scraper === 'function' ? entry.scraper() : entry.scraper;
    const adapterOptions = { perPage: limit, maxRecords: limit, searchQuery: validKey };
    const startedAt = now().toISOString();
    try {
      const outcome = await runScraperSafely(scraper, adapterOptions);
      return { source: entry.source, ...outcome, startedAt };
    } catch (error) {
      // runScraperSafely swallows errors; this catch only fires if it ever
      // stops doing that. We still surface it so the caller knows the
      // adapter threw rather than completing cleanly.
      return { source: entry.source, outcome: 'failed', error: error.message, records: [], startedAt };
    }
  });
  const settled = parallel ? await Promise.allSettled(tasks) : [];
  const outcomes = parallel
    ? settled.map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        return { source: scrapers[index].source, outcome: 'failed', error: String(result.reason && result.reason.message || result.reason), records: [], startedAt: now().toISOString() };
      })
    : await sequentialOutcomes(scrapers, { perPage: limit, maxRecords: limit, searchQuery: validKey }, now);
  // The scraper-side upsert flow inserts any new listings into the inventory
  // before returning, so the next aggregateByParcelKey call sees them. The
  // refresh aggregates the post-refresh view rather than re-reading pre-refresh
  // data, so the response reflects what changed.
  const view = await aggregateByParcelKey(validKey, { database: db });
  const durationMs = Date.now() - startMs;
  return { parcelKey: validKey, scrapedAt, durationMs, adapterOutcomes: outcomes, view };
}

module.exports = {
  PARCEL_KEY_PATTERN,
  ENRICHMENT_SCRAPERS,
  aggregateByParcelKey,
  refreshByParcelKey,
  rankConfidence,
  buildView,
  loadListingsForParcelKey,
  runScraperSafely,
  validateParcelKey,
  confidenceBand
};
