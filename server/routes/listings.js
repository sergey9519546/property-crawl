const db = require('../db/client');
const Validator = require('../security/validation');

async function handleListings(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;

  if (method === 'GET') {
    const id = url.pathname.split('/api/listings/')[1];
    if (id) {
      const listing = await db.getListingById(id);
      if (!listing) return res.status(404).json({ error: 'Listing not found' });
      return res.json(listing);
    }

    const filters = {
      q: url.searchParams.get('q') || '',
      state: url.searchParams.get('state') || 'all',
      source: url.searchParams.get('source') || 'all',
      type: url.searchParams.get('type') || 'all',
      status: url.searchParams.get('status') || 'all',
      sort: url.searchParams.get('sort') || 'score',
      limit: Math.min(1000, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10))),
      offset: Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10)),
      lat: url.searchParams.get('lat') ? parseFloat(url.searchParams.get('lat')) : undefined,
      lng: url.searchParams.get('lng') ? parseFloat(url.searchParams.get('lng')) : undefined,
      radiusKm: url.searchParams.get('radiusKm') ? parseFloat(url.searchParams.get('radiusKm')) : 100
    };

    const result = await db.getListings(filters);
    return res.json(result);
  }

  if (method === 'POST') {
    const body = req.body || {};
    const validation = Validator.validateListing(body);
    if (!validation.isValid) {
      return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }

    // Normalize sourceUrl: strip generic source homepages so the DB stays
    // consistent with the build-data.js pipeline normalization.
    if (body.sourceUrl && body.source) {
      // Any URL that is just the source's homepage root is treated as null.
      // We check by stripping trailing slashes and comparing path depth.
      const candidate = body.sourceUrl.replace(/\/+$/, '');
      try {
        const parsed = new URL(candidate);
        if (parsed.pathname === '' || parsed.pathname === '/') {
          body.sourceUrl = null;
        }
      } catch (_) {
        body.sourceUrl = null; // malformed URL
      }
    }

    const created = await db.createListing(body);
    return res.status(201).json(created);
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = handleListings;
