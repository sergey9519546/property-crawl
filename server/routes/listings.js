const zlib = require('node:zlib');
const defaultDb = require('../db/client');
const Validator = require('../security/validation');
const { readMediaStore, attachMedia } = require('../db/property-media-store');
const discovery = require('../discovery/query');
const { buildDocumentEvidence } = require('../intelligence/document-evidence');
const { computeCatchSummary } = require('../intelligence/catch-summary');
const { computeTriage, buildParcelKey, extractRawApn, extractCountyFips, collectVerifiedImages } = require('../scrapers/normalization');
const { applyCrossSourceBakeOff } = defaultDb;
const { annotateListing, summarizeInventory } = require('../scrapers/listing-intelligence');
const { resolveCountyKey, resolveCountyEndpoint, queryArcgisParcel } = require('../enrichment/arcgis-parcels');
const { queryLocalParcelIndex } = require('../enrichment/local-parcel-index');
// Listing-admission gate (server/sources/catalog.js): a DISCOVERY_ONLY
// catalog source is discovery evidence, never an actionable sale listing,
// so its records answer the same 404 an absent record answers.
const { servesListings, SOURCE_CATALOG } = require('../sources/catalog');
const SOURCE_CADENCE_BY_KEY = new Map();
if (Array.isArray(SOURCE_CATALOG)) {
  for (const s of SOURCE_CATALOG) {
    if (s && s.adapterKey && !SOURCE_CADENCE_BY_KEY.has(s.adapterKey)) {
      SOURCE_CADENCE_BY_KEY.set(s.adapterKey, s.workflow?.cadenceHours || 24);
    }
  }
}
const { interpretAssessorParcel, MARKET_CONVERSION } = require('../enrichment/assessor-reading');
const ENROLLED_STATEWIDE_PREFIXES = ['FL-', 'CO-', 'NC-', 'NY-', 'WI-', 'AR-', 'CT-', 'NJ-'];
const { isCompatibleNjSitusAddress } = require('../enrichment/nj-cadastral');

function isParcelSitusMismatched(listing, parcel) {
  const listingAddr = String(listing?.address || '').trim();
  const situsAddr = String(parcel?.situsAddress || '').trim();
  if (!listingAddr || !situsAddr) return false;
  return !isCompatibleNjSitusAddress(listingAddr, situsAddr);
}

function buildMismatchedAssessorResponse(listing, countyKey, endpoint) {
  const mismatchReason = 'Parcel situs address does not corroborate listing street address.';
  const interpreted = interpretAssessorParcel({
    countyKey,
    parcel: null,
    openingBid: listing.openingBid,
  });
  return {
    listingId: listing.id,
    parcelKey: null,
    lookedUpAt: new Date().toISOString(),
    ...interpreted,
    enrolled: Boolean(interpreted.enrolled || endpoint),
    found: false,
    countyName: interpreted.countyName || endpoint?.name || null,
    endpoint: interpreted.endpoint || endpoint?.endpoint || null,
    withheldReason: mismatchReason,
    reason: mismatchReason,
  };
}
const { isWorkspaceAuthorized } = require('../security/workspace-identity');
const { getHudSafmrBenchmark } = require('../enrichment/hud-safmr');

function mediaEntries() {
  try { return readMediaStore(); }
  catch { return []; } // A damaged optional media cache never replaces listing evidence.
}

function neutralCustomerText(value) {
  return typeof value === 'string'
    ? value.replace(/servicelink(?:[\s_-]*auction)?/gi, 'Public Auction Network')
    : value;
}

const LISTINGS_RESPONSE_CACHE = (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) ? null : new WeakMap();
const LISTINGS_CACHE_TTL_MS = 20_000;
const LISTINGS_CACHE_MAX_ENTRIES = 32;

function resolveListingsCacheStore(db, options) {
  if (options && options.responseCache) return options.responseCache;
  if (!LISTINGS_RESPONSE_CACHE || !db || (typeof db !== 'object' && typeof db !== 'function')) return null;
  let store = LISTINGS_RESPONSE_CACHE.get(db);
  if (!store) {
    store = new Map();
    LISTINGS_RESPONSE_CACHE.set(db, store);
  }
  return store;
}

const parcelLookupCache = new Map();

function cachedLocalParcelLookup(params) {
  if (!params || !params.apn) return null;
  const key = `${params.countyFips || ''}:${params.state || ''}:${params.county || ''}:${params.apn}`;
  if (parcelLookupCache.has(key)) return parcelLookupCache.get(key);
  const result = queryLocalParcelIndex(params);
  if (parcelLookupCache.size >= 500) {
    const firstKey = parcelLookupCache.keys().next().value;
    parcelLookupCache.delete(firstKey);
  }
  parcelLookupCache.set(key, result);
  return result;
}

function isLegalDescriptionAddress(address) {
  if (!address || typeof address !== 'string') return true;
  const trimmed = address.trim();
  if (trimmed.length === 0) return true;
  if (/^(?:LOT\b|PARCEL\b|UNIT\b|BLOCK\b|SEC(?:TION)?\b|TWP\b|SUBD(?:IVISION)?\b|TRACT\b|LEGAL\b|PB\b|UNASSIGNED\b|VACANT\b)/i.test(trimmed)) {
    return true;
  }
  if (!/^\d+\s+[A-Za-z]/.test(trimmed) && /(?:LOT|BLOCK|SUBD|TRACT|PLAT|RANGE|SEC|TWP)/i.test(trimmed)) {
    return true;
  }
  return false;
}

function presentListing(listing) {
  if (!listing || typeof listing !== 'object') return listing;
  const presented = { ...listing };
  const timestamp = listing.sourceObservedAt || listing.provenance?.observedAt;
  const time = Date.parse(timestamp || '');
  const cadenceHours = SOURCE_CADENCE_BY_KEY.get(listing.source) || 24;
  const origin = listing.provenance?.origin;
  const ageHours = Number.isFinite(time) ? Math.max(0,(Date.now()-time)/3600000) : null;
  presented.sourceFreshness = { observedAt: timestamp || null, ageHours, cadenceHours,
    status: origin === 'archive' ? 'archive' : (origin !== 'live' && origin !== 'email_notice') || ageHours === null ? 'unknown' : ageHours > cadenceHours ? 'stale' : 'current' };
  presented.discoveryStatus = origin === 'archive' ? 'Dated archive snapshot' : presented.sourceFreshness.status === 'current'
    ? 'Within source refresh window' : presented.sourceFreshness.status === 'stale' ? 'Source refresh due' : 'Observation unresolved';
  const evidenceFields=['sourceUrl','sourceObservedAt','auctionProgram','lifecycleStatus','saleDate','openingBid','occupancy','hasDocuments'];
  const missing=evidenceFields.filter(field=>listing[field]===null || listing[field]===undefined || listing[field]==='');
  presented.evidenceCompleteness={known:evidenceFields.length-missing.length,total:evidenceFields.length,missing};
  // Triage + parcel identity are presentation-layer fields: they are computed
  // here so both the in-memory and Postgres listing paths emit the same shape.
  presented.triage = computeTriage(presented);
  // "Here's the Catch" one-liner. Persisted at ingest (migration 042), but
  // derived here when it is absent so records written before that column
  // existed -- and any backend that skips the write path -- emit the same shape
  // as fresh rows. Same reasoning as `triage` above: a presentation-layer
  // derivation, identical across the in-memory and Postgres paths, $0 and
  // deterministic. A persisted value always wins.
  const explicitWarnings = Array.isArray(presented.provenance?.titleWarnings)
    ? presented.provenance.titleWarnings
    : (Array.isArray(presented.titleWarnings) ? presented.titleWarnings : []);
  const derivedWarnings = Array.isArray(presented.provenance?.derivedFields?.catchWarnings)
    ? presented.provenance.derivedFields.catchWarnings
    : [];
  let titleWarnings = explicitWarnings.length > 0 ? explicitWarnings : derivedWarnings;
  let riskLevel = presented.provenance?.riskLevel
    || presented.provenance?.derivedFields?.titleRiskLevel
    || presented.riskLevel
    || null;
  if (titleWarnings.length === 0 && !riskLevel) {
    try {
      const { arbitrateTitleRisk } = require('../intelligence/title-risk-engine');
      // Never read raw notice at presentation time (pinned by catch-summary.test.js).
      const tr = arbitrateTitleRisk({ ...presented, raw: '', rawNotice: '' });
      if (tr?.riskLevel === 'CRITICAL' || tr?.riskLevel === 'HIGH') {
        if (Array.isArray(tr.titleWarnings)) titleWarnings = tr.titleWarnings;
        riskLevel = tr.riskLevel;
      } else if (tr?.riskLevel) {
        riskLevel = tr.riskLevel;
      }
    } catch {
      // Fail soft to listing-level signals
    }
  }
  const actionableCatchWarnings = titleWarnings
    .filter((w) => typeof w === 'string' && w.trim() && !/^(?:SENIOR FORECLOSURE|TAX SALE PRIORITY):/i.test(w.trim()))
    .slice(0, 6);
  if (actionableCatchWarnings.length > 0) {
    presented.catchWarnings = actionableCatchWarnings;
  }
  if (riskLevel) {
    presented.titleRiskSummary = {
      riskLevel,
      actionableCount: actionableCatchWarnings.length,
    };
  }
  if (!presented.catchSummary) {
    presented.catchSummary = computeCatchSummary(presented, titleWarnings, riskLevel) ?? null;
  }
  const hudSafmr = listing.hudSafmr || (listing.zip ? getHudSafmrBenchmark({ zip: listing.zip, bedrooms: listing.beds ?? 2 }) : null);
  if (hudSafmr) presented.hudSafmr = hudSafmr;
  const apn = extractRawApn(listing) ?? listing.apn ?? listing.parcelNumber ?? listing.parcelId
    ?? listing.provenance?.sourceFacts?.apn ?? listing.provenance?.sourceFacts?.parcelNumber ?? listing.provenance?.sourceFacts?.parcelId;
  const countyFips = extractCountyFips(listing) ?? listing.countyFips ?? listing.provenance?.countyFips ?? listing.provenance?.sourceFacts?.countyFips;
  if (presented.parcelKey == null) {
    presented.parcelKey = buildParcelKey({
      apn,
      countyFips
    });
  }
  if (apn && isLegalDescriptionAddress(presented.address) && (countyFips || (presented.state && presented.county))) {
    try {
      const localParcel = cachedLocalParcelLookup({
        apn,
        countyFips,
        state: presented.state,
        county: presented.county
      });
      if (localParcel && localParcel.situsAddress) {
        presented.situsAddress = localParcel.situsAddress;
        presented.cadastralMatch = {
          matchBasis: "cadastral_apn_lookup",
          parcelKey: localParcel.canonicalApn
            ? (localParcel.countyFips ? (localParcel.countyFips + "-" + localParcel.canonicalApn) : localParcel.canonicalApn)
            : presented.parcelKey,
          situsAddress: localParcel.situsAddress,
          countyFips: localParcel.countyFips || countyFips || null
        };
        if (isLegalDescriptionAddress(presented.address)) {
          presented.legalDescription = presented.address;
          presented.address = localParcel.situsAddress;
          if (presented.provenance && typeof presented.provenance === "object") {
            presented.provenance = {
              ...presented.provenance,
              addressResolution: {
                resolvedFrom: "cadastral_apn_lookup",
                originalAddress: listing.address,
                situsAddress: localParcel.situsAddress
              }
            };
          }
        }
      }
    } catch {
      // Local parcel query fallback fail-safe
    }
  }
  for (const field of ['raw', 'plaintiff', 'defendant', 'attorney', 'deposit', 'description', 'notes', 'photoProvider']) {
    if (typeof presented[field] === 'string') presented[field] = neutralCustomerText(presented[field]);
  }
  if (presented.provenance && typeof presented.provenance === 'object' && !Array.isArray(presented.provenance)) {
    presented.provenance = {
      ...presented.provenance,
      publisher: neutralCustomerText(presented.provenance.publisher),
    };
  }
  // Research quality + opportunity rank (10x listing intelligence layer).
  if (!Array.isArray(presented.images) || presented.images.length === 0) {
    const gallery = presented.provenance?.media?.gallery;
    const secondary = presented.provenance?.media?.secondary?.images;
    const hydratedImages = collectVerifiedImages({
      photo: presented.photo,
      gallery: [...(Array.isArray(gallery) ? gallery : []), ...(Array.isArray(secondary) ? secondary : [])],
      inputImages: presented.images,
      sourceValid: Boolean(presented.sourceUrl && presented.provenance?.observed !== false),
    });
    if (hydratedImages.length > 0) {
      presented.images = hydratedImages;
    } else if (!Array.isArray(presented.images)) {
      presented.images = [];
    }
  }
  const countyKey = resolveCountyKey(presented.state, presented.county);
  const hasPrefixRule = Boolean(countyKey && ENROLLED_STATEWIDE_PREFIXES.some((prefix) => countyKey.startsWith(prefix)));
  const interpretedEnrolled = countyKey ? interpretAssessorParcel({ countyKey }).enrolled : false;
  presented.enrolledAssessor = Boolean(countyKey && interpretedEnrolled && (MARKET_CONVERSION[countyKey] || hasPrefixRule));
  return annotateListing(presented);
}

// Bounds for query-string parameters. The HTTP server already caps the request
// line at 8 KB (next-adapter.js), so these caps are about preventing wasted
// CPU on absurdly long search strings and keeping the API surface honest.
const PARAM_CAPS = Object.freeze({
  q:          { maxLen: 256, defaultIfEmpty: ''     },
  state:      { maxLen: 160, defaultIfEmpty: 'all'  }, // 2-letter US state code(s) or CSV
  source:     { maxLen: 160, defaultIfEmpty: 'all'  },
  type:       { maxLen: 160, defaultIfEmpty: 'all'  },
  status:     { maxLen: 16,  defaultIfEmpty: 'all'  },
  occupancy:  { maxLen: 32,  defaultIfEmpty: 'all'  },
  seniorLien: { maxLen: 16,  defaultIfEmpty: 'all'  },
  redemption: { maxLen: 32,  defaultIfEmpty: 'all'  },
  sort:       { maxLen: 16,  defaultIfEmpty: 'score' },
  mode:       { maxLen: 16,  defaultIfEmpty: ''     }
});

const INTELLIGENCE_SORTS = new Set(['quality', 'opportunity']);

/**
 * What the `total` in this response counts, and how many listings were actually
 * examined to produce it.
 *
 * Once the intelligence view is active the ranking and any minimum-quality
 * threshold are applied AFTER the database page is fetched, so `total` becomes
 * how many survived on that page. Nothing said so, and a client reading it as a
 * search total gets an unproven negative presented as a counted one: live,
 * minQuality=95 over 9,798 listings answered `total: 0`, not because the store
 * holds nothing above 95 but because none of the 20 rows loaded on that page
 * cleared the threshold. The store was never counted.
 *
 * `evaluated` is what was loaded, `matched` is what survived - which is the
 * only honest way to describe an empty page in this mode, and it lets the UI
 * say "none of the 20 listings loaded here met the threshold" instead of "this
 * search returns 0 matching listings".
 */
function intelligenceScope(evaluated, matched, filters) {
  const sort = String(filters.sort || '');
  const minQuality = Number(filters.minQuality) || 0;
  const totalIsPageScoped = INTELLIGENCE_SORTS.has(sort) || minQuality > 0;
  return {
    sort: INTELLIGENCE_SORTS.has(sort) ? sort : null,
    minQuality,
    totalIsPageScoped,
    pageScope: { evaluated, matched },
    note: minQuality > 0
      ? 'Quality and opportunity ranking, and any minimum-quality threshold, are applied after this page is loaded. total counts matches on this page, not in the whole search.'
      : totalIsPageScoped
        ? 'Quality and opportunity ranking reorder the candidate window loaded for this page; total reflects the whole search.'
        : 'quality/opportunity sorts apply after listing intelligence annotation.',
  };
}

function applyIntelligenceView(presentedListings, filters) {
  let view = presentedListings;
  const minQuality = Number(filters.minQuality) || 0;
  if (minQuality > 0) {
    view = view.filter((listing) => (listing.researchQuality?.score ?? 0) >= minQuality);
  }
  const sort = String(filters.sort || '');
  if (INTELLIGENCE_SORTS.has(sort)) {
    view = [...view].sort((a, b) => {
      const aVal = sort === 'quality' ? a.researchQuality?.score : a.opportunity?.rank;
      const bVal = sort === 'quality' ? b.researchQuality?.score : b.opportunity?.rank;
      const av = Number.isFinite(aVal) ? aVal : -1;
      const bv = Number.isFinite(bVal) ? bVal : -1;





      return bv - av || String(a.id).localeCompare(String(b.id));
    });
  }
  return view;
}

const NUMERIC_RANGES = Object.freeze({
  limit:      { defaultValue: 50, min: 1, max: 1000    },
  offset:     { defaultValue: 0,  min: 0, max: 100000  },
  minScore:   { defaultValue: 0,  min: 0, max: 100     },
  minEquity:  { defaultValue: 0,  min: 0, max: 50000000 },
  maxBid:     { defaultValue: 0,  min: 0, max: 50000000 },
  minQuality: { defaultValue: 0,  min: 0, max: 100     }
});

function parseStringParam(raw, field, maxLen) {
  const result = Validator.boundedStringParam(raw, field, maxLen);
  if (!result.ok) return { ok: false, response: { error: result.error } };
  return { ok: true, value: result.value };
}

function parseIntParam(raw, field, defaultValue, min, max) {
  const result = Validator.strictIntParam(raw, field, defaultValue, min, max);
  if (!result.ok) return { ok: false, response: { error: result.error } };
  return { ok: true, value: result.value };
}

// Extract the best-available observation timestamp from a listing record.
// Priority matches presentListing: sourceObservedAt first, then provenance
// observedAt, then fetchedAt as a last-resort persistence-time fallback.
function listingTimestampMs(listing) {
  if (!listing || typeof listing !== 'object') return null;
  const raw = listing.sourceObservedAt
    || listing.provenance?.observedAt
    || listing.fetchedAt;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function publishedApn(listing) {
  const facts = listing?.provenance?.sourceFacts || {};
  const candidates = [
    listing?.apn,
    listing?.parcelNumber,
    listing?.parcelId,
    facts.apn,
    facts.parcelNumber,
    facts.parcelId,
    listing?.provenance?.parcelNumber,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return extractRawApn(listing) || null;
}

async function handleAssessorLookup(encodedId, req, res, db = defaultDb, options = {}) {
  let id;
  try { id = decodeURIComponent(encodedId); }
  catch (_) { return res.status(400).json({ error: 'Invalid listing identifier encoding' }); }
  if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) {
    return res.status(400).json({ error: 'Invalid listing identifier' });
  }
  let listing;
  try { listing = await db.getListingById(id); }
  catch (error) { return res.status(error.status || 503).json({ error: error.message }); }
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const endpoint = resolveCountyEndpoint(listing.state, listing.county);
  const countyKey = endpoint?.key || resolveCountyKey(listing.state, listing.county);
  if (!countyKey) {
    return res.json({
      listingId: listing.id,
      parcelKey: listing.parcelKey || null,
      lookedUpAt: new Date().toISOString(),
      ...interpretAssessorParcel({ countyKey: null, parcel: null, openingBid: listing.openingBid }),
    });
  }

  const cachedParcel = listing.assessorParcel || listing.provenance?.derivedFields?.assessorRoll?.parcel;
  if (cachedParcel) {
    if (isParcelSitusMismatched(listing, cachedParcel)) {
      return res.json(buildMismatchedAssessorResponse(listing, countyKey, endpoint));
    }
    const resolvedParcelKey = listing.parcelKey || (cachedParcel?.canonicalApn ? buildParcelKey({ apn: cachedParcel.canonicalApn, countyFips: cachedParcel.countyFips }) : null);
    return res.json({
      listingId: listing.id,
      parcelKey: resolvedParcelKey || null,
      lookedUpAt: listing.provenance?.derivedFields?.assessorRoll?.observedAt || new Date().toISOString(),
      ...(cachedParcel?.situsAddress ? { situsAddress: cachedParcel.situsAddress } : {}),
      ...interpretAssessorParcel({ countyKey, parcel: cachedParcel, openingBid: listing.openingBid }),
    });
  }

  const lat = Number(listing.lat);
  const lng = Number(listing.lng);
  let parcel = null;
  try {
    const queryParcelFn = typeof options?.queryArcgisParcel === 'function' ? options.queryArcgisParcel : queryArcgisParcel;
    parcel = await queryParcelFn({
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      apn: publishedApn(listing) || undefined,
      state: listing.state,
      county: listing.county,
      fetchFn: typeof options?.fetchFn === 'function' ? options.fetchFn : (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }),
    });
  } catch (_) {
    parcel = null;
  }

  if (parcel && isParcelSitusMismatched(listing, parcel)) {
    return res.json(buildMismatchedAssessorResponse(listing, countyKey, endpoint));
  }

  const authorizedToPersist = isWorkspaceAuthorized(req);
  if (parcel) {
    // A lookup response is public (the listing page reads it anonymously),
    // but caching the parcel onto the listing and upserting it is a state
    // mutation: gate it behind the operator credential so an unauthenticated
    // GET cannot poison parcel identity. The server-side backfill
    // (server/enrichment/assessor-backfill.js) still covers bulk refresh.
    if (authorizedToPersist) {
      listing.assessorParcel = parcel;
      listing.provenance = listing.provenance || {};
      listing.provenance.derivedFields = listing.provenance.derivedFields || {};
      listing.provenance.derivedFields.assessorRoll = {
        parcel,
        countyKey,
        apn: parcel.canonicalApn || parcel.rawApn || publishedApn(listing) || null,
        observedAt: new Date().toISOString(),
        found: true,
      };
    }
  }

  const resolvedParcelKey = listing.parcelKey || (parcel?.canonicalApn ? buildParcelKey({ apn: parcel.canonicalApn, countyFips: parcel.countyFips }) : null);
  if (authorizedToPersist && ((!listing.parcelKey && resolvedParcelKey || parcel)) && typeof db.createListing === 'function') {
    if (resolvedParcelKey) listing.parcelKey = resolvedParcelKey;
    try { await db.createListing(listing); } catch (persistErr) {
      console.warn('[Listings] Failed to persist enriched assessor parcel for', listing?.id, persistErr?.message || persistErr);
    }
  }

  return res.json({
    listingId: listing.id,
    parcelKey: resolvedParcelKey || null,
    lookedUpAt: new Date().toISOString(),
    ...(parcel?.situsAddress ? { situsAddress: parcel.situsAddress } : {}),
    ...interpretAssessorParcel({ countyKey, parcel, openingBid: listing.openingBid }),
  });
}

async function handleListings(req, res, dbOverride = null, options = {}) {
  const db = dbOverride || defaultDb;
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;

  if (method === 'GET') {
    const assessorMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/assessor$/);
    if (assessorMatch) return handleAssessorLookup(assessorMatch[1], req, res, db, options);
    if (url.pathname === '/api/listings/map') {
      try {
        // The map view is fed by the same filter state as the grid, so it can
        // arrive carrying an intelligence sort (quality/opportunity) that the
        // workbench legitimately offers. The discovery SQL layer only
        // understands score/date/bid-asc/equity and 400s on anything else, so
        // choosing one of those sorts and then switching to Map rendered
        // "Invalid sort" instead of a map. The grid path already normalises
        // this below (see the discoveryUrl rewrite); the map path has to do the
        // same, or the whole view is dead for those filters.
        const mapUrl = new URL(url);
        if (INTELLIGENCE_SORTS.has(String(mapUrl.searchParams.get('sort')))) {
          mapUrl.searchParams.set('sort', 'score');
        }
        if (!mapUrl.searchParams.has('limit') || !mapUrl.searchParams.get('limit')) {
          mapUrl.searchParams.set('limit', '500');
        }
        if (typeof db.inventoryUnavailableReason === 'function') { const unavailable = db.inventoryUnavailableReason(); if (unavailable) return res.status(503).json({ error: 'No inventory is being served.', reason: unavailable, dataMode: typeof db.dataMode === 'function' ? db.dataMode() : null, clusters: [], points: [], total: 0 }); }
        return res.json(await discovery.map(db, discovery.queryFromUrl(mapUrl)));
      }
      catch (error) { return res.status(error.status || 503).json({ error: error.message }); }
    }
    const encodedId = url.pathname.split('/api/listings/')[1];
    if (encodedId) {
      let id;
      try { id = decodeURIComponent(encodedId); } catch (_) { return res.status(400).json({ error: 'Invalid listing identifier encoding' }); }
      if (id.length > 256 || /[\/\\\u0000-\u001f\u007f]/.test(id)) return res.status(400).json({ error: 'Invalid listing identifier' });
      if (typeof db.inventoryUnavailableReason === 'function') {
        const unavailable = db.inventoryUnavailableReason();
        if (unavailable) {
          return res.status(503).json({
            error: 'No inventory is being served.',
            reason: unavailable,
            dataMode: typeof db.dataMode === 'function' ? db.dataMode() : null,
          });
        }
      }
      const listing = await db.getListingById(id);
      if (!listing) return res.status(404).json({ error: 'Listing not found' });
      // Admission gate: a stored record from a DISCOVERY_ONLY source is not
      // an actionable listing and is presented as not found, not as data.
      if (typeof listing.source === 'string' && listing.source !== '' && !servesListings(listing.source)) {
        return res.status(404).json({ error: 'Listing not found' });
      }
      return res.json({ ...presentListing(attachMedia(listing, mediaEntries())), documentEvidence: buildDocumentEvidence(listing) });
    }

    // Strict input validation. Each reject short-circuits with 400 so the
    // client can correct the input instead of receiving silently-wrong data.
    const filters = {};
    for (const [field, cap] of Object.entries(PARAM_CAPS)) {
      const r = parseStringParam(url.searchParams.get(field), field, cap.maxLen);
      if (!r.ok) return res.status(400).json(r.response);
      // Empty / missing param becomes the per-field default (e.g. 'all' for
      // categorical filters, 'score' for sort, '' for free-text q).
      // Control-character strip is applied to free-form strings only.
      const value = r.value === '' ? cap.defaultIfEmpty : r.value;
      filters[field] = field === 'q' ? Validator.stripControlChars(value) : value;
    }
    for (const [field, range] of Object.entries(NUMERIC_RANGES)) {
      const r = parseIntParam(url.searchParams.get(field), field, range.defaultValue, range.min, range.max);
      if (!r.ok) return res.status(400).json(r.response);
      filters[field] = r.value;
    }

    // lat / lng / radiusKm are passed through to the geo filter unchanged;
    // they were already guarded by the underlying db.getListings and are not
    // part of the P0/P2 attack surface.
    const rawLat = url.searchParams.get('lat');
    const rawLng = url.searchParams.get('lng');
    const rawRadius = url.searchParams.get('radiusKm');
    const parsedLat = rawLat !== null && rawLat !== '' ? parseFloat(rawLat) : undefined;
    const parsedLng = rawLng !== null && rawLng !== '' ? parseFloat(rawLng) : undefined;
    const parsedRadius = rawRadius !== null && rawRadius !== '' ? parseFloat(rawRadius) : 100;
    filters.lat = Number.isFinite(parsedLat) ? parsedLat : undefined;
    filters.lng = Number.isFinite(parsedLng) ? parsedLng : undefined;
    filters.radiusKm = Number.isFinite(parsedRadius) && parsedRadius > 0 ? parsedRadius : 100;



    // Delta-sync: ?since=<ISO 8601> filters to records observed after that time.
    const sinceRaw = url.searchParams.get('since');
    let sinceMs = null;
    let sinceIso = null;
    if (sinceRaw != null && sinceRaw !== '') {
      if (typeof sinceRaw !== 'string' || sinceRaw.length > 64) {
        return res.status(400).json({ error: 'Invalid since parameter length' });
      }
      sinceMs = Date.parse(sinceRaw);
      if (!Number.isFinite(sinceMs)) {
        return res.status(400).json({ error: 'Invalid since parameter. Use ISO 8601 date.' });
      }
      sinceIso = new Date(sinceMs).toISOString();
    }

    const usesDiscovery = true;
    // Refuse before querying. With no database the query below would answer
    // `total: 0`, and an outage would render as "no listings match" - the one
    // result a caller cannot tell apart from a real finding. Say what is wrong
    // instead. An explicit PROPERTY_INVENTORY_BACKEND=memory run still serves.
    if (typeof db.inventoryUnavailableReason === 'function') {
      const unavailable = db.inventoryUnavailableReason();
      if (unavailable) {
        return res.status(503).json({
          error: 'No inventory is being served.',
          reason: unavailable,
          dataMode: typeof db.dataMode === 'function' ? db.dataMode() : null,
          listings: [],
          total: 0,
        });
      }
    }
    const isAutocomplete = filters.mode === 'autocomplete';
    if (filters.mode && filters.mode !== 'autocomplete' && filters.mode !== 'default') {
      return res.status(400).json({ error: 'Invalid mode' });
    }
    const isSummaryRequest = url.searchParams.get('summary') === '1' || url.searchParams.get('summary') === 'true';
    const cacheStore = (!isAutocomplete && !isSummaryRequest && sinceMs === null && !options?.signal && (typeof db.dataMode !== 'function' || db.dataMode() !== 'unavailable'))
      ? resolveListingsCacheStore(db, options)
      : null;
    const cacheRev = cacheStore
      ? (db.isPg && typeof discovery.pgRevisionCoalesced === 'function'
          ? await discovery.pgRevisionCoalesced(db).catch(() => null)
          : (Array.isArray(db) && typeof discovery.revisionOf === 'function' ? discovery.revisionOf(db) : null))
      : null;
    const cacheKey = cacheStore && cacheRev !== null && cacheRev !== undefined ? `${cacheRev}|${url.search}` : null;
    if (cacheKey) {
      const cached = cacheStore.get(cacheKey);
      if (cached && Date.now() - cached.ts < LISTINGS_CACHE_TTL_MS) {
        if (typeof res.sendPrecompressedJson === 'function') {
          return res.sendPrecompressedJson(cached);
        }
        return res.json(JSON.parse(cached.json));
      }
      if (cached) cacheStore.delete(cacheKey);
    }
    let result;
    try {
      if (usesDiscovery) {
        // Intelligence sorts (quality/opportunity) are applied after annotation.
        // The discovery SQL layer only understands score/date/bid-asc/equity.
        const discoveryUrl = new URL(url);
        const isIntelligenceView = !isAutocomplete && (INTELLIGENCE_SORTS.has(String(filters.sort)) || (Number(filters.minQuality) || 0) > 0);
        const candidateLimit = (filters.offset === 0 && !filters.cursor && isIntelligenceView && filters.limit < 250)
          ? Math.min(250, Math.max(filters.limit * 5, 100))
          : filters.limit;
        if (String(filters.sort) === 'quality') {
          discoveryUrl.searchParams.set('sort', 'score');
        }
        if (candidateLimit > filters.limit) {
          discoveryUrl.searchParams.set('limit', String(candidateLimit));
        }
        const ac = new AbortController();
        if (options?.signal?.aborted) ac.abort();
        const onParentAbort = () => ac.abort();
        options?.signal?.addEventListener?.('abort', onParentAbort, { once: true });
        const onClose = () => { if (!res?.writableEnded) ac.abort(); };
        if (typeof res?.on === 'function') res.on('close', onClose);
        try {
          result = await discovery.search(db, discovery.queryFromUrl(discoveryUrl), { signal: ac.signal });
        } finally {
          options?.signal?.removeEventListener?.('abort', onParentAbort);
          if (typeof res?.off === 'function') res.off('close', onClose);
          else if (typeof res?.removeListener === 'function') res.removeListener('close', onClose);
        }
      } else {
        result = await db.getListings(filters);
      }
    }
    catch (error) {
      if (error?.name === 'AbortError' || error?.status === 499 || res.writableEnded) return;
      const status = error?.status || 503;
      if (status >= 500) {
        console.warn('[api/listings] error:', status, error?.message || error);
      }
      return res.status(status).json({ error: error.message });
    }
    if (isAutocomplete) {
      return res.json({
        ...result,
        dataMode: typeof db.dataMode === 'function' ? db.dataMode() : (db.isPg ? 'postgres' : 'unavailable'),
        postgresReachable: db.postgresReachable === true,
      });
    }

    // Apply delta filter when since is present: keep only listings whose
    // observation timestamp is strictly greater than the provided cutoff.
    if (sinceMs !== null) {
      const before = result.listings.length;
      result = {
        ...result,
        listings: result.listings.filter(l => {
          const ts = listingTimestampMs(l);
          return ts !== null && ts > sinceMs;
        }),
      };
      // Adjust total to reflect the filtered count for this page context.
      // The discovery layer already paginated; we shrink total proportionally
      // so clients see a consistent delta view rather than the full-catalog total.
      if (result.total != null && before > 0) {
        result.total = result.listings.length;
      }
    }

    const page = result.page || { nextCursor: null, hasMore: filters.offset + result.listings.length < result.total };
    const isIntelligenceView = INTELLIGENCE_SORTS.has(String(filters.sort)) || (Number(filters.minQuality) || 0) > 0;
    // Fast summary path (used by sitemap pagination): skips media disk scans,
    // bake-off, intelligence scoring, and full provenance serialization.
    if (isSummaryRequest && !isIntelligenceView && sinceMs === null) {
      return res.json({
        ...result,
        page,
        revision: result.revision || null,
        facets: result.facets || {},
        listings: result.listings.map(({ id, source, state, county, saleDate, status, lifecycleStatus }) => ({
          id,
          source,
          state,
          county: county ?? null,
          saleDate: saleDate ?? null,
          status: status ?? null,
          lifecycleStatus: lifecycleStatus ?? null,
        })),
        dataMode: typeof db.dataMode === 'function' ? db.dataMode() : (db.isPg ? 'postgres' : 'unavailable'),
        postgresReachable: db.postgresReachable === true,
      });
    }
    const entries = mediaEntries();
    // Cross-source bake-off: detect parcelKey collisions from different
    // publishers on this page and annotate each listing with its matches +
    // a per-listing bake-off descriptor (preferredSource / reason / confidence).
    // presentListing preserves these fields through the spread.
    applyCrossSourceBakeOff(result.listings);
    // The grid response omits `raw`; the single-listing route above still sends
    // it. Measured on a 48-listing page: `raw` is 44.8 KB of 270.7 KB, 16.6% of
    // the whole payload, and it is a 1,103-element array per listing -- the
    // publisher's entire raw feed, carried on every card.
    //
    // The grid does not serve it to card consumers: the workbench and cards
    // never read `raw` (test/list-response-payload.test.mjs pins that). Two
    // readers remain and both are deliberate: the watchlist import modal
    // (watchlist-modal.tsx, guarded typeof check) and the single-listing
    // detail route. Keep the strip grid-only, not global.
    //
    // The detail route keeps it deliberately. That is where inspecting the raw
    // publisher record is a real capability rather than a dead field, and
    // stripping evidence from a product whose entire value is provenance is
    // not a payload optimisation.
    const presentedListings = result.listings
      .map(listing => presentListing(entries.length ? attachMedia(listing, entries) : listing));
    const stripGridListings = (items) => items.map(({ raw, provenance, ...rest }) => {
        if (!provenance || typeof provenance !== 'object') return rest;
        // Two more fields with no reader, same reasoning as `raw` above:
        //   sourceFields   67.0 KB of the page (24.7%) -- the publisher's
        //                  extracted field->value map, 1.6 KB per card
        //   statusHistory  11.8 KB -- a 13-entry per-card audit trail
        // The only `statusHistory` consumer in the codebase is
        // alachua-second-chance.tsx, and that renders a purchase record's
        // history, not a listing's provenance. `sourceFields` has no reader
        // anywhere under src/.
        //   sourceFacts    ~1.3-3.5 KB per card -- publisher facts only read by the detail page (/listings/[id]) and SaleMechanics.
        const { sourceFields, statusHistory, sourceFacts, ...kept } = provenance;
        // Trim multi-KB duplicated sub-arrays inside `media` and `derivedFields.assessorRoll` on grid cards
        // (top-level `images` already carries normalized gallery URLs; detail routes still return full provenance).
        if (kept.media && typeof kept.media === 'object') {
          const compactMedia = { ...kept.media };
          if (Array.isArray(compactMedia.gallery)) compactMedia.galleryCount = compactMedia.gallery.length;
          delete compactMedia.gallery;
          if (compactMedia.secondary && typeof compactMedia.secondary === 'object') {
            const { images: _secImages, ...secRest } = compactMedia.secondary;
            compactMedia.secondary = secRest;
          }
          kept.media = compactMedia;
        }
        if (kept.derivedFields && typeof kept.derivedFields === 'object' && 'assessorRoll' in kept.derivedFields) {
          const { assessorRoll: _assessorRoll, ...derivedRest } = kept.derivedFields;
          kept.derivedFields = derivedRest;
        }
        return { ...rest, provenance: kept };
      });
    // Post-annotation intelligence view: quality/opportunity sort + minQuality.
    const viewListingsAll = applyIntelligenceView(presentedListings, filters);
    // `isIntelligenceView` was computed above the summary fast-path check.
    const viewListings = (filters.offset === 0 && !filters.cursor && isIntelligenceView && viewListingsAll.length > filters.limit)
      ? viewListingsAll.slice(0, filters.limit)
      : viewListingsAll;
    const effectiveTotal = (isIntelligenceView && filters.minQuality > 0)
      ? viewListingsAll.length
      : result.total;
    const effectivePage = (viewListings.length < result.listings.length)
      ? {
          ...page,
          nextCursor: null,
          hasMore: (filters.offset + viewListings.length) < (Number(effectiveTotal) || 0),
        }
      : page;
    const body = {
      ...result,
      page: effectivePage,
      revision: result.revision || null,
      facets: result.facets || {},
      intelligence: intelligenceScope(presentedListings.length, viewListingsAll.length, filters),
      pipeline: summarizeInventory(viewListings),
      listings: stripGridListings(viewListings),
      total: effectiveTotal,
      // Surface the same honesty signals the health endpoint provides so
      // clients (workbench, tests) can see demo vs postgres without a second call.
      dataMode: typeof db.dataMode === 'function' ? db.dataMode() : (db.isPg ? 'postgres' : 'unavailable'),
      postgresReachable: db.postgresReachable === true,
      // A demo inventory that failed to seed reads here as an ordinary "no
      // results", which is the one thing the caller cannot tell apart from a
      // real empty search. Carry the reason alongside the count.
      ...(typeof db.seeded === 'boolean' ? { seeded: db.seeded } : {}),
      ...(db.seedError ? { seedError: db.seedError } : {}),
      documentReviewStore: db.isPg ? 'postgres' : (require('../intelligence/document-review-store').defaultStorePath?.(process.env) ? 'file' : 'none'),
    };
    if (sinceMs !== null) {
      body.delta = true;
      body.since = sinceIso;
    }
    if (cacheKey && cacheStore) {
      const json = JSON.stringify(body);
      const gzip = Buffer.byteLength(json) >= 1024 ? zlib.gzipSync(json, { level: 1 }) : null;
      if (cacheStore.size >= LISTINGS_CACHE_MAX_ENTRIES) {
        const oldest = cacheStore.keys().next().value;
        if (oldest !== undefined) cacheStore.delete(oldest);
      }
      cacheStore.set(cacheKey, { ts: Date.now(), json, gzip });
      if (typeof res.sendPrecompressedJson === 'function') {
        return res.sendPrecompressedJson({ json, gzip });
      }
    }
    return res.json(body);
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = handleListings;
module.exports.presentListing = presentListing;
module.exports.isLegalDescriptionAddress = isLegalDescriptionAddress;
module.exports.cachedLocalParcelLookup = cachedLocalParcelLookup;
module.exports.parcelLookupCache = parcelLookupCache;
module.exports.applyIntelligenceView = applyIntelligenceView;
module.exports.intelligenceScope = intelligenceScope;
