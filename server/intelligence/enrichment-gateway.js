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
//       Re-runs the registered enrichment scrapers, validates returned records,
//       persists schema-valid publishable listings only when opt-in live write
//       (SCRAPLING_LIVE_WRITE) and a DB writer are present, and returns the
//       updated aggregate view plus honest per-adapter outcomes & persistence.
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
//     operator opts into write mode for enrichment), and never claims a DB
//     write for notice/evidence-only or failed/unavailable scrapers.
//   - The module never fabricates bid, sale-date, or occupancy values; the
//     enrichment adapters themselves enforce that contract.

const { applyCrossSourceBakeOff } = require('../db/client');
const { scanAllListings } = require('../db/listings-scan');
const { buildParcelKey, extractRawApn, extractCountyFips } = require('../scrapers/normalization');
const courtlistener = require('../scrapers/courtlistener');
const flDor = require('../scrapers/fl-dor-cadastral');
const caController = require('../scrapers/ca-controller-tax-sale');
const { validateListingForIngestion } = require('../scrapers/validation');
const { SOURCE_HOSTS, inspectSourceRecordUrl } = require('../scrapers/source-policy');
const { isUsStateOrTerritoryCode } = require('../state-codes');

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
    source: listing.source || null,
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

// A parcelKey lookup has to consider every listing: a duplicate notice can
// sit anywhere in the store, not just the first 100,000. pageSize keeps this
// to a single round trip today while still reading to the end if the store
// ever exceeds it.
async function loadListingsForParcelKey(parcelKey, database) {
  let matched;
  if (database && typeof database.getListingsByParcelKeyNative === 'function') {
    matched = await database.getListingsByParcelKeyNative(parcelKey);
  } else {
    const { pool } = await scanAllListings(database, {}, { pageSize: 100000 });
    matched = pool.filter((listing) => {
      if (!listing) return false;
      if (listing.parcelKey === parcelKey || listing.provenance?.parcelKey === parcelKey) return true;
      return buildParcelKey({
        apn: extractRawApn(listing),
        countyFips: extractCountyFips(listing),
      }) === parcelKey;
    });
  }
  return (Array.isArray(matched) ? matched : []).map((listing) => {
    if (!listing || typeof listing !== 'object') return listing;
    const resolvedApn = listing.apn || listing.parcelNumber || listing.parcelId || extractRawApn(listing) || null;
    const resolvedKey = buildParcelKey({
      apn: resolvedApn,
      countyFips: extractCountyFips(listing),
    }) || listing.parcelKey || parcelKey;
    if (listing.parcelKey === resolvedKey && (listing.apn || !resolvedApn)) return listing;
    return {
      ...listing,
      parcelKey: resolvedKey,
      ...(resolvedApn && !listing.apn ? { apn: resolvedApn } : {}),
    };
  });
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

function parseParcelKeyParts(parcelKey) {
  const key = String(parcelKey || '').trim();
  const fipsMatch = key.match(/^(\d{5})-(.+)$/);
  if (fipsMatch) {
    return { countyFips: fipsMatch[1], apn: fipsMatch[2].trim() };
  }
  return { countyFips: null, apn: key };
}

function buildAdapterOptions(parcelKey, { limit = DEFAULT_REFRESH_LIMIT, env = process.env, courtId } = {}) {
  const { countyFips, apn } = parseParcelKeyParts(parcelKey);
  return {
    perPage: limit,
    maxRecords: limit,
    searchQuery: parcelKey,
    parcelKey,
    apn,
    countyFips,
    fips: countyFips,
    env,
    ...(courtId ? { courtId } : {}),
  };
}

function resolveScopedScraper(scraper, options = {}) {
  if (
    scraper &&
    typeof scraper === 'object' &&
    scraper.constructor &&
    scraper.constructor.name === 'CourtListenerScraper' &&
    !Object.hasOwn(scraper, 'scrapeFeed') &&
    !Object.hasOwn(scraper, 'scrape')
  ) {
    const env = options.env || {};
    const scoped = new scraper.constructor({
      searchQuery: options.searchQuery || options.parcelKey || scraper.searchQuery,
      maxRecords: options.maxRecords || options.perPage || scraper.maxRecords,
      apiKey: env.COURTLISTENER_API_KEY !== undefined ? env.COURTLISTENER_API_KEY : scraper.apiKey,
      courtId: options.courtId || env.COURTLISTENER_COURT || scraper.courtId,
    });
    if (scraper.circuitBreaker) {
      scoped.circuitBreaker = scraper.circuitBreaker;
    }
    return scoped;
  }
  return scraper;
}

function validateCollectedRecord(record, options = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, reason: 'record_not_object', publishable: false, listing: null };
  }
  if (record.error || record.observationError === true) {
    return { valid: false, reason: String(record.error || 'record_error'), publishable: false, listing: null };
  }
  if (record.publicationStatus === 'evidence_only' || record.role === 'discovery') {
    return { valid: false, reason: 'evidence_only_not_publishable', publishable: false, listing: null };
  }
  if (typeof record.id !== 'string' || !record.id.trim()) {
    return { valid: false, reason: 'missing_record_id', publishable: false, listing: null };
  }
  if (record.state !== undefined && record.state !== null && record.state !== '') {
    const stateCode = String(record.state).trim().toUpperCase();
    if (!isUsStateOrTerritoryCode(stateCode)) {
      return { valid: false, reason: 'invalid_state', publishable: false, listing: null };
    }
  }
  const sourceKey = String(record.source || options.source || '').trim().toLowerCase();
  if (record.sourceUrl !== undefined && record.sourceUrl !== null && record.sourceUrl !== '') {
    if (sourceKey && Object.prototype.hasOwnProperty.call(SOURCE_HOSTS, sourceKey)) {
      const urlCheck = inspectSourceRecordUrl(sourceKey, String(record.sourceUrl));
      if (!urlCheck.isValid) {
        return { valid: false, reason: urlCheck.error || 'invalid_source_url', publishable: false, listing: null };
      }
    } else {
      try {
        const parsed = new URL(String(record.sourceUrl));
        if (parsed.protocol !== 'https:') {
          return { valid: false, reason: 'unsafe_source_url', publishable: false, listing: null };
        }
      } catch (_) {
        return { valid: false, reason: 'invalid_source_url', publishable: false, listing: null };
      }
    }
  }
  for (const field of ['openingBid', 'estLow', 'estHigh']) {
    if (record[field] !== undefined && record[field] !== null && record[field] !== '') {
      const num = Number(record[field]);
      if (!Number.isFinite(num) || num < 0) {
        return { valid: false, reason: `invalid_${field}`, publishable: false, listing: null };
      }
    }
  }
  if (record.estLow != null && record.estHigh != null && Number(record.estHigh) < Number(record.estLow)) {
    return { valid: false, reason: 'invalid_estimate_range', publishable: false, listing: null };
  }

  const candidate = {
    ...record,
    ...(options.parcelKey && !record.parcelKey ? { parcelKey: options.parcelKey } : {}),
    ...(sourceKey && !record.source ? { source: sourceKey } : {}),
  };
  const listingValidation = validateListingForIngestion(
    candidate,
    sourceKey ? { expectedSource: sourceKey } : {}
  );
  return {
    valid: true,
    reason: null,
    publishable: listingValidation.isValid,
    listing: listingValidation.isValid ? listingValidation.listing : null,
  };
}

async function runScraperWithMetadata(scraper, options = {}) {
  if (!scraper || (typeof scraper.scrape !== 'function' && typeof scraper.scrapeByApns !== 'function' && typeof scraper.scrapeFeed !== 'function')) {
    return {
      outcome: {
        outcome: 'skipped',
        reason: 'no_scrape_method',
        records: [],
        validCount: 0,
        rejectedCount: 0,
        publishableCount: 0,
        persisted: 0,
        persistedToDb: false,
        persistenceStatus: 'scraper_unavailable',
      },
      publishableListings: [],
    };
  }
  const targetScraper = resolveScopedScraper(scraper, options);
  try {
    let rawResult = null;
    let rawRecords = [];
    if (typeof targetScraper.scrapeByApns === 'function' && (options.apn || options.searchQuery || Array.isArray(options.apns))) {
      const apns = Array.isArray(options.apns) && options.apns.length
        ? options.apns
        : [options.apn || options.searchQuery];
      rawResult = await targetScraper.scrapeByApns(apns, options);
      rawRecords = Array.isArray(rawResult)
        ? rawResult
        : Array.isArray(rawResult?.listings) ? rawResult.listings
        : Array.isArray(rawResult?.records) ? rawResult.records
        : [];
    } else if (typeof targetScraper.scrape === 'function') {
      rawResult = await targetScraper.scrape(options);
      rawRecords = Array.isArray(rawResult?.listings) ? rawResult.listings
        : Array.isArray(rawResult?.records) ? rawResult.records
        : Array.isArray(rawResult) ? rawResult
        : [];
    } else if (typeof targetScraper.scrapeFeed === 'function') {
      rawResult = await targetScraper.scrapeFeed(options);
      rawRecords = Array.isArray(rawResult?.listings) ? rawResult.listings
        : Array.isArray(rawResult?.records) ? rawResult.records
        : Array.isArray(rawResult) ? rawResult
        : [];
    }

    const report = targetScraper.lastRunReport && typeof targetScraper.lastRunReport === 'object'
      ? targetScraper.lastRunReport
      : null;
    const explicitError =
      rawResult && !Array.isArray(rawResult)
        ? (rawResult.error
            || (rawResult.observationError === true ? (rawResult.report?.reason || rawResult.reason || 'observation_error') : null)
            || (rawResult.ok === false ? (rawResult.reason || 'scraper_failed') : null)
            || (rawResult.blocked === true ? (rawResult.reason || 'scraper_blocked') : null))
        : null;
    const reportFailed = report && ['failed', 'blocked'].includes(report.outcome) && rawRecords.length === 0;
    if (explicitError || reportFailed) {
      const message = String(explicitError || report?.reason || report?.outcome || 'scraper_unavailable');
      return {
        outcome: {
          outcome: 'failed',
          reason: message,
          error: message,
          records: [],
          validCount: 0,
          rejectedCount: 0,
          publishableCount: 0,
          persisted: 0,
          persistedToDb: false,
          persistenceStatus: 'scraper_unavailable',
        },
        publishableListings: [],
      };
    }

    const isEvidenceEnvelope = Boolean(
      rawResult && !Array.isArray(rawResult) && (
        rawResult.publicationStatus === 'evidence_only'
        || rawResult.role === 'discovery'
        || (Number(rawResult.evidencePackets) > 0 && rawRecords.length === 0)
      )
    );
    const allEvidenceRecords = rawRecords.length > 0 && rawRecords.every(
      (r) => r && typeof r === 'object' && (r.publicationStatus === 'evidence_only' || r.role === 'discovery')
    );
    if (isEvidenceEnvelope || allEvidenceRecords) {
      return {
        outcome: {
          outcome: 'evidence_only',
          reason: 'evidence_only_not_published',
          evidencePackets: Number(rawResult?.evidencePackets || rawRecords.length || 0),
          records: [],
          validCount: 0,
          rejectedCount: 0,
          publishableCount: 0,
          persisted: 0,
          persistedToDb: false,
          persistenceStatus: 'evidence_only_not_persisted',
          error: null,
        },
        publishableListings: [],
      };
    }

    if (rawRecords.length === 0) {
      return {
        outcome: {
          outcome: 'empty',
          records: [],
          validCount: 0,
          rejectedCount: 0,
          publishableCount: 0,
          persisted: 0,
          persistedToDb: false,
          persistenceStatus: 'no_records',
          error: null,
        },
        publishableListings: [],
      };
    }

    const validRecords = [];
    const publishableListings = [];
    const rejectionReasons = [];
    for (const rec of rawRecords) {
      const checked = validateCollectedRecord(rec, options);
      if (!checked.valid) {
        rejectionReasons.push(checked.reason);
        continue;
      }
      validRecords.push(rec);
      if (checked.publishable && checked.listing) {
        publishableListings.push(checked.listing);
      }
    }

    if (validRecords.length === 0) {
      return {
        outcome: {
          outcome: 'rejected',
          reason: 'all_records_invalid',
          rejectionReasons,
          records: [],
          validCount: 0,
          rejectedCount: rejectionReasons.length,
          publishableCount: 0,
          persisted: 0,
          persistedToDb: false,
          persistenceStatus: 'rejected_invalid_records',
          error: null,
        },
        publishableListings: [],
      };
    }

    return {
      outcome: {
        outcome: 'success',
        records: validRecords,
        validCount: validRecords.length,
        rejectedCount: rejectionReasons.length,
        publishableCount: publishableListings.length,
        persisted: 0,
        persistedToDb: false,
        persistenceStatus: publishableListings.length > 0 ? 'not_persisted' : 'schema_unpublishable',
        error: null,
      },
      publishableListings,
    };
  } catch (error) {
    return {
      outcome: {
        outcome: 'failed',
        error: error.message,
        records: [],
        validCount: 0,
        rejectedCount: 0,
        publishableCount: 0,
        persisted: 0,
        persistedToDb: false,
        persistenceStatus: 'scraper_unavailable',
      },
      publishableListings: [],
    };
  }
}

async function runScraperSafely(scraper, options = {}) {
  const { outcome } = await runScraperWithMetadata(scraper, options);
  return outcome;
}

async function persistPublishableListings(db, publishableListings, env) {
  const liveWrite = env?.SCRAPLING_LIVE_WRITE === '1' || String(env?.SCRAPLING_LIVE_WRITE || '').toLowerCase() === 'true';
  if (!liveWrite) {
    return { persisted: 0, persistedToDb: false, status: 'read_only_live_write_disabled' };
  }
  const writer = typeof db?.upsertListing === 'function'
    ? (item) => db.upsertListing(item)
    : typeof db?.createListing === 'function'
      ? (item) => db.createListing(item)
      : null;
  if (!writer) {
    return { persisted: 0, persistedToDb: false, status: 'no_db_writer' };
  }
  let persisted = 0;
  for (const listing of publishableListings) {
    try {
      const saved = await writer(listing);
      if (saved !== false && saved?.ok !== false) {
        persisted += 1;
      }
    } catch (_) {}
  }
  return {
    persisted,
    persistedToDb: persisted > 0,
    status: persisted > 0 ? 'persisted' : 'db_write_failed',
  };
}

async function runAdapterEntry(entry, adapterOptions, { db, env, now }) {
  const startedAt = now().toISOString();
  try {
    const scraper = typeof entry.scraper === 'function' ? entry.scraper() : entry.scraper;
    const { outcome, publishableListings } = await runScraperWithMetadata(scraper, {
      ...adapterOptions,
      source: entry.source,
    });
    if (outcome.outcome === 'success' && publishableListings.length > 0) {
      const persisted = await persistPublishableListings(db, publishableListings, env);
      return {
        source: entry.source,
        ...outcome,
        persisted: persisted.persisted,
        persistedToDb: persisted.persistedToDb,
        persistenceStatus: persisted.status,
        startedAt,
      };
    }
    return { source: entry.source, ...outcome, startedAt };
  } catch (error) {
    return {
      source: entry.source,
      outcome: 'failed',
      error: error.message,
      records: [],
      validCount: 0,
      rejectedCount: 0,
      publishableCount: 0,
      persisted: 0,
      persistedToDb: false,
      persistenceStatus: 'scraper_unavailable',
      startedAt,
    };
  }
}

async function refreshByParcelKey(parcelKey, {
  database,
  scheduler,
  scrapers = ENRICHMENT_SCRAPERS,
  limit = DEFAULT_REFRESH_LIMIT,
  env = process.env,
  now = () => new Date(),
  parallel = true,
  courtId
} = {}) {
  const validKey = validateParcelKey(parcelKey);
  const db = database || require('../db/client');
  const adapterOptions = buildAdapterOptions(validKey, { limit, env, courtId });

  const startMs = Date.now();
  const scrapedAt = now().toISOString();
  let outcomes;
  if (parallel) {
    const settled = await Promise.allSettled(
      scrapers.map((entry) => runAdapterEntry(entry, adapterOptions, { db, env, now }))
    );
    outcomes = settled.map((result, index) => (
      result.status === 'fulfilled'
        ? result.value
        : {
            source: scrapers[index].source,
            outcome: 'failed',
            error: String((result.reason && result.reason.message) || result.reason),
            records: [],
            validCount: 0,
            rejectedCount: 0,
            publishableCount: 0,
            persisted: 0,
            persistedToDb: false,
            persistenceStatus: 'scraper_unavailable',
            startedAt: now().toISOString(),
          }
    ));
  } else {
    outcomes = [];
    for (const entry of scrapers) {
      outcomes.push(await runAdapterEntry(entry, adapterOptions, { db, env, now }));
    }
  }

  // Only listings validated against LISTING_SCHEMA and persisted under
  // SCRAPLING_LIVE_WRITE appear in the post-refresh aggregate view.
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
  confidenceBand,
  parseParcelKeyParts,
  buildAdapterOptions,
};
