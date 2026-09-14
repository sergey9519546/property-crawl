const db = require('../db/client');
const Validator = require('../security/validation');
const { readMediaStore, attachMedia } = require('../db/property-media-store');
const discovery = require('../discovery/query');
const { buildDocumentEvidence } = require('../intelligence/document-evidence');
const { computeTriage, buildParcelKey } = require('../scrapers/normalization');
const { applyCrossSourceBakeOff } = db;

function mediaEntries() {
  try { return readMediaStore(); }
  catch { return []; } // A damaged optional media cache never replaces listing evidence.
}

function neutralCustomerText(value) {
  return typeof value === 'string'
    ? value.replace(/servicelink(?:[\s_-]*auction)?/gi, 'Public Auction Network')
    : value;
}

function presentListing(listing) {
  if (!listing || typeof listing !== 'object') return listing;
  const presented = { ...listing };
  const timestamp = listing.sourceObservedAt || listing.provenance?.observedAt;
  const time = Date.parse(timestamp || '');
  const cadenceHours = require('../sources/catalog').SOURCE_CATALOG.find(source => source.adapterKey === listing.source)?.workflow.cadenceHours || 24;
  const origin = listing.provenance?.origin;
  const ageHours = Number.isFinite(time) ? Math.max(0,(Date.now()-time)/3600000) : null;
  presented.sourceFreshness = { observedAt: timestamp || null, ageHours, cadenceHours,
    status: origin === 'archive' ? 'archive' : origin !== 'live' || ageHours === null ? 'unknown' : ageHours > cadenceHours ? 'stale' : 'current' };
  presented.discoveryStatus = origin === 'archive' ? 'Dated archive snapshot' : presented.sourceFreshness.status === 'current'
    ? 'Within source refresh window' : presented.sourceFreshness.status === 'stale' ? 'Source refresh due' : 'Observation unresolved';
  const evidenceFields=['sourceUrl','sourceObservedAt','auctionProgram','lifecycleStatus','saleDate','openingBid','occupancy','hasDocuments'];
  const missing=evidenceFields.filter(field=>listing[field]===null || listing[field]===undefined || listing[field]==='');
  presented.evidenceCompleteness={known:evidenceFields.length-missing.length,total:evidenceFields.length,missing};
  // Triage + parcel identity are presentation-layer fields: they are computed
  // here so both the in-memory and Postgres listing paths emit the same shape.
  presented.triage = computeTriage({ ...listing, ...presented });
  if (presented.parcelKey == null) {
    const sourceFacts = listing.provenance?.sourceFacts || {};
    presented.parcelKey = buildParcelKey({
      apn: listing.apn ?? listing.parcelNumber ?? listing.parcelId
        ?? sourceFacts.apn ?? sourceFacts.parcelNumber ?? sourceFacts.parcelId,
      countyFips: listing.countyFips ?? sourceFacts.countyFips ?? listing.provenance?.countyFips
    });
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
  return presented;
}

// Bounds for query-string parameters. The HTTP server already caps the request
// line at 8 KB (next-adapter.js), so these caps are about preventing wasted
// CPU on absurdly long search strings and keeping the API surface honest.
const PARAM_CAPS = Object.freeze({
  q:          { maxLen: 256, defaultIfEmpty: ''     },
  state:      { maxLen: 2,   defaultIfEmpty: 'all'  }, // 2-letter US state code
  source:     { maxLen: 32,  defaultIfEmpty: 'all'  },
  type:       { maxLen: 32,  defaultIfEmpty: 'all'  },
  status:     { maxLen: 16,  defaultIfEmpty: 'all'  },
  occupancy:  { maxLen: 32,  defaultIfEmpty: 'all'  },
  seniorLien: { maxLen: 16,  defaultIfEmpty: 'all'  },
  redemption: { maxLen: 32,  defaultIfEmpty: 'all'  },
  sort:       { maxLen: 16,  defaultIfEmpty: 'score' }
});

const NUMERIC_RANGES = Object.freeze({
  limit:      { defaultValue: 50, min: 1, max: 1000    },
  offset:     { defaultValue: 0,  min: 0, max: 100000  },
  minScore:   { defaultValue: 0,  min: 0, max: 100     },
  minEquity:  { defaultValue: 0,  min: 0, max: 50000000 },
  maxBid:     { defaultValue: 0,  min: 0, max: 50000000 }
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

async function handleListings(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;

  if (method === 'GET') {
    if (url.pathname === '/api/listings/map') {
      try { return res.json(await discovery.map(db, discovery.queryFromUrl(url))); }
      catch (error) { return res.status(error.status || 503).json({ error: error.message }); }
    }
    const encodedId = url.pathname.split('/api/listings/')[1];
    if (encodedId) {
      let id;
      try { id = decodeURIComponent(encodedId); } catch (_) { return res.status(400).json({ error: 'Invalid listing identifier encoding' }); }
      if (id.length > 256 || /[\/\\\u0000-\u001f\u007f]/.test(id)) return res.status(400).json({ error: 'Invalid listing identifier' });
      const listing = await db.getListingById(id);
      if (!listing) return res.status(404).json({ error: 'Listing not found' });
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
    filters.lat = url.searchParams.get('lat') ? parseFloat(url.searchParams.get('lat')) : undefined;
    filters.lng = url.searchParams.get('lng') ? parseFloat(url.searchParams.get('lng')) : undefined;
    filters.radiusKm = url.searchParams.get('radiusKm') ? parseFloat(url.searchParams.get('radiusKm')) : 100;

    // Delta-sync: ?since=<ISO 8601> filters to records observed after that time.
    const sinceRaw = url.searchParams.get('since');
    let sinceMs = null;
    let sinceIso = null;
    if (sinceRaw != null && sinceRaw !== '') {
      sinceMs = Date.parse(sinceRaw);
      if (!Number.isFinite(sinceMs)) {
        return res.status(400).json({ error: 'Invalid since parameter. Use ISO 8601 date.' });
      }
      sinceIso = new Date(sinceMs).toISOString();
    }

    const usesDiscovery = true;
    let result;
    try { result = usesDiscovery ? await discovery.search(db, discovery.queryFromUrl(url)) : await db.getListings(filters); }
    catch (error) { return res.status(error.status || 503).json({ error: error.message }); }

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

    const entries = mediaEntries();
    const page = result.page || { nextCursor: null, hasMore: filters.offset + result.listings.length < result.total };
    // Cross-source bake-off: detect parcelKey collisions from different
    // publishers on this page and annotate each listing with its matches +
    // a per-listing bake-off descriptor (preferredSource / reason / confidence).
    // presentListing preserves these fields through the spread.
    applyCrossSourceBakeOff(result.listings);
    const body = { ...result, page, revision: result.revision || null, facets: result.facets || {}, listings: result.listings.map(listing => presentListing(attachMedia(listing, entries))) };
    if (sinceMs !== null) {
      body.delta = true;
      body.since = sinceIso;
    }
    return res.json(body);
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = handleListings;
module.exports.presentListing = presentListing;
