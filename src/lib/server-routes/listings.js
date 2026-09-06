const db = require('../db/client');
const Validator = require('../security/validation');

function neutralCustomerText(value) {
  return typeof value === 'string'
    ? value.replace(/servicelink(?:[\s_-]*auction)?/gi, 'Public Auction Network')
    : value;
}

function presentListing(listing) {
  if (!listing || typeof listing !== 'object') return listing;
  const presented = { ...listing };
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
  sort:       { maxLen: 16,  defaultIfEmpty: 'score'}
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

async function handleListings(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;

  if (method === 'GET') {
    const encodedId = url.pathname.split('/api/listings/')[1];
    if (encodedId) {
      let id;
      try { id = decodeURIComponent(encodedId); } catch (_) { return res.status(400).json({ error: 'Invalid listing identifier encoding' }); }
      if (id.length > 256 || /[\/\\\u0000-\u001f\u007f]/.test(id)) return res.status(400).json({ error: 'Invalid listing identifier' });
      const listing = await db.getListingById(id);
      if (!listing) return res.status(404).json({ error: 'Listing not found' });
      return res.json(presentListing(listing));
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

    const result = await db.getListings(filters);
    return res.json({ ...result, listings: result.listings.map(presentListing) });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = handleListings;
module.exports.presentListing = presentListing;
