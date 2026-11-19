'use strict';

// server/routes/neighborhoods.js
//
// GET /api/neighborhoods                  — list every neighborhood bucket
// GET /api/neighborhoods/:kind/:key       — single bucket (e.g. zip:12345)
//
// Reads from server/intelligence/neighborhood-stats.js. Read-only,
// public analytics; no auth.
//
// Query params:
//   maxAgeDays  — drop stale listings (default 365)
//   state       — restrict to one state on the list endpoint
//   limit       — cap on rows returned by the list endpoint (default 100)

const db = require('../db/client');
const { scanAllListings } = require('../db/listings-scan');
const neighborhoodStats = require('../intelligence/neighborhood-stats');
const { computeNeighborhoodStats, getNeighborhoodStats, normalizeCountyToken } = neighborhoodStats;

function boundedInt(raw, fallback, min, max) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

function parseStatePrefixSlug(raw) {
  const match = String(raw || '').match(/^([A-Za-z]{2})[-:](.+)$/);
  if (!match) return null;
  const state = match[1].toUpperCase();
  const slug = match[2].trim();
  if (!slug || slug === '.' || slug === '..' || /[\\/]/.test(slug)) return null;
  return { state, slug };
}

function parseKey(remaining) {
  // Supported shapes after /api/neighborhoods/:
  //   Colon-delimited: zip:12345, city:TX:houston, county:FL:Miami-Dade, county:FL-Miami-Dade
  //   Two-segment proxy: zip/12345, city/FL-Miami, county/FL-Miami-Dade
  if (typeof remaining !== 'string' || !remaining) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(remaining);
  } catch {
    return null;
  }
  if (!decoded || /[\u0000-\u001f\u007f\\]/.test(decoded)) return null;

  if (decoded.includes('/')) {
    const parts = decoded.split('/');
    if (parts.length !== 2) return null;
    const [kindRaw, rawVal] = parts;
    const kind = kindRaw.toLowerCase();
    if (!rawVal || rawVal === '.' || rawVal === '..' || rawVal.includes(':')) {
      if (!(kind === 'city' && /^[A-Za-z]{2}:[^:]+$/.test(rawVal))) return null;
    }
    if (kind === 'zip') {
      const m = rawVal.match(/^(\d{5})(?:-\d{4})?$/);
      return m ? { kind: 'zip', key: m[1] } : null;
    }
    if (kind === 'city') {
      const parsedCity = parseStatePrefixSlug(rawVal);
      if (!parsedCity) return null;
      return {
        kind: 'city',
        key: `${parsedCity.state}::${parsedCity.slug.replace(/-/g, ' ').trim().toLowerCase()}`
      };
    }
    if (kind === 'county') {
      const parsedCounty = parseStatePrefixSlug(rawVal);
      if (!parsedCounty) return null;
      const cleanSlug = parsedCounty.slug.replace(/\s+/g, '-');
      if (!normalizeCountyToken(cleanSlug)) return null;
      return { kind: 'county', key: `${parsedCounty.state}-${cleanSlug}` };
    }
    return null;
  }

  if (!decoded.includes(':')) return null;
  const parts = decoded.split(':');
  if (parts.some((p) => !p || p === '.' || p === '..')) return null;
  const [kindRaw, ...rest] = parts;
  const kind = kindRaw.toLowerCase();
  if (kind === 'zip') {
    const val = rest.join(':');
    const m = val.match(/^(\d{5})(?:-\d{4})?$/);
    return m ? { kind: 'zip', key: m[1] } : null;
  }
  if (kind === 'city' && rest.length === 2 && /^[A-Za-z]{2}$/.test(rest[0])) {
    return { kind: 'city', key: `${rest[0].toUpperCase()}::${rest[1].trim().toLowerCase()}` };
  }
  if (kind === 'county') {
    if (rest.length === 2 && /^[A-Za-z]{2}$/.test(rest[0])) {
      const cleanSlug = rest[1].trim().replace(/\s+/g, '-');
      return normalizeCountyToken(cleanSlug)
        ? { kind: 'county', key: `${rest[0].toUpperCase()}-${cleanSlug}` }
        : null;
    }
    if (rest.length === 1) {
      const parsedCounty = parseStatePrefixSlug(rest[0]);
      if (!parsedCounty || !normalizeCountyToken(parsedCounty.slug)) return null;
      return { kind: 'county', key: `${parsedCounty.state}-${parsedCounty.slug.replace(/\s+/g, '-')}` };
    }
  }
  return null;
}

function medianNumber(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeCountyBucket(countyKey, pool, { maxAgeDays = 365, nowMs = Date.now() } = {}) {
  const parsed = parseStatePrefixSlug(countyKey);
  if (!parsed || !Array.isArray(pool)) return null;
  const targetToken = normalizeCountyToken(parsed.slug);
  if (!targetToken) return null;

  const cutoffMs = nowMs - maxAgeDays * 86_400_000;
  const matched = [];
  let displayCounty = null;

  for (const listing of pool) {
    if (!listing || typeof listing !== 'object') continue;
    if (String(listing.state || '').toUpperCase() !== parsed.state) continue;
    const rawCounty = String(listing.county || '').trim();
    if (!rawCounty || normalizeCountyToken(rawCounty) !== targetToken) continue;

    const observedRaw = listing.sourceObservedAt || listing.observedAt;
    const observedMs = observedRaw ? Date.parse(observedRaw) : NaN;
    if (!Number.isFinite(observedMs) || observedMs < cutoffMs) continue;

    if (!displayCounty) displayCounty = rawCounty;
    matched.push(listing);
  }

  if (matched.length === 0) return null;

  const bids = [];
  const sqfts = [];
  const scores = [];
  const discounts = [];
  const sources = {};
  const propTypes = {};

  for (const row of matched) {
    if (typeof row.openingBid === 'number' && Number.isFinite(row.openingBid) && row.openingBid > 0) {
      bids.push(row.openingBid);
    }
    if (typeof row.sqft === 'number' && Number.isFinite(row.sqft) && row.sqft > 0) {
      sqfts.push(row.sqft);
    }
    if (typeof row.dealScore === 'number' && Number.isFinite(row.dealScore)) {
      scores.push(row.dealScore);
    }
    if (
      typeof row.openingBid === 'number' && Number.isFinite(row.openingBid) && row.openingBid > 0 &&
      typeof row.mid === 'number' && Number.isFinite(row.mid) && row.mid > 0
    ) {
      discounts.push(1 - row.openingBid / row.mid);
    }
    const src = row.source ? String(row.source) : 'unknown';
    sources[src] = (sources[src] || 0) + 1;
    const pt = row.propType ? String(row.propType) : 'Unknown';
    propTypes[pt] = (propTypes[pt] || 0) + 1;
  }

  const medianOpeningBid = medianNumber(bids);
  const meanOpeningBid = bids.length
    ? Number((bids.reduce((sum, v) => sum + v, 0) / bids.length).toFixed(2))
    : null;
  const medianSqft = medianNumber(sqfts);
  const rawMedianScore = medianNumber(scores);
  const medianDealScore = rawMedianScore === null ? null : Number(rawMedianScore.toFixed(1));
  const rawMedianDiscount = medianNumber(discounts);
  const medianDiscount = rawMedianDiscount === null ? null : Number(rawMedianDiscount.toFixed(4));

  return {
    kind: 'county',
    key: `${parsed.state}-${parsed.slug}`,
    label: `${displayCounty}, ${parsed.state}`,
    count: matched.length,
    medianOpeningBid,
    meanOpeningBid,
    medianSqft,
    medianDealScore,
    medianDiscount,
    sources,
    propTypes
  };
}

function serializeBucket(bucket) {
  return {
    kind: bucket.kind,
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
    medianOpeningBid: bucket.medianOpeningBid === null ? null : Number(bucket.medianOpeningBid.toFixed(2)),
    meanOpeningBid: bucket.meanOpeningBid,
    medianSqft: bucket.medianSqft === null ? null : Number(bucket.medianSqft.toFixed(0)),
    medianDealScore: bucket.medianDealScore,
    medianDiscount: bucket.medianDiscount,
    sources: bucket.sources,
    propTypes: bucket.propTypes
  };
}

function createNeighborhoodsHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const now = typeof dependencies.now === 'function'
    ? dependencies.now
    : (dependencies.now ? () => dependencies.now : () => Date.now());

  return async function handleNeighborhoods(req, res, urlInput) {
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      return res.json({ error: 'method_not_allowed' });
    }

    const sendJsonStatus = (code, payload) => {
      if (typeof res.status === 'function') return res.status(code).json(payload);
      res.statusCode = code;
      return res.json(payload);
    };

    const rawPath = String(req?.url || '').split('?')[0];
    if (/(?:^|\/)\.\.?(?:\/|$)|%2e/i.test(rawPath)) {
      return sendJsonStatus(400, { error: 'invalid_neighborhood_key', remaining: rawPath });
    }

    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    // Path shapes:
    //   /api/neighborhoods
    //   /api/neighborhoods/{kind}/{key...}     (key may itself contain a colon)
    const remaining = segments.slice(2).join('/');

    const maxAgeDays = boundedInt(url.searchParams.get('maxAgeDays'), 365, 1, 730);
    const limit = boundedInt(url.searchParams.get('limit'), 100, 1, 500);
    const stateFilter = typeof url.searchParams.get('state') === 'string'
      ? url.searchParams.get('state').toUpperCase()
      : null;

    if (!remaining) {
      if (database.isPg && typeof database.getNeighborhoodStatsNative === 'function') {
        const nativeResult = await database.getNeighborhoodStatsNative({
          maxAgeDays,
          state: stateFilter,
          limit,
          nowMs: now()
        });
        res.setHeader('Cache-Control', 'no-store');
        return res.json({
          schema: 'property-crawl.neighborhoods/v1',
          count: nativeResult.neighborhoods.length,
          maxAgeDays,
          state: stateFilter,
          scanned: nativeResult.scanned,
          availableTotal: nativeResult.availableTotal,
          truncated: nativeResult.truncated,
          bucketsTotal: nativeResult.bucketsTotal,
          bucketsReturned: nativeResult.bucketsReturned,
          bucketsTruncated: nativeResult.bucketsTruncated,
          listingsBucketed: nativeResult.listingsBucketed,
          listingsCovered: nativeResult.listingsCovered,
          listingsNotCovered: nativeResult.listingsNotCovered,
          rowsWithoutNeighborhoodKey: nativeResult.rowsWithoutNeighborhoodKey,
          neighborhoods: nativeResult.neighborhoods
        });
      }

      const filters = { summary: true };
      if (stateFilter) filters.state = stateFilter;
      const { pool, availableTotal, scanned, truncated } = await scanAllListings(database, filters);

      const stats = computeNeighborhoodStats(pool, { maxAgeDays, nowMs: now() });
      const buckets = stats.slice(0, limit).map(serializeBucket);

      // `truncated` above describes the STORE READ, and the read is complete.
      // It says nothing about the result, which is the top `limit` buckets --
      // and on the live store that is 100 of 5,815 buckets covering 869 of
      // 9,831 listings, 8.8%. A payload that reads "scanned 9831, truncated
      // false" alongside a hundred rows invites the reading that nothing was
      // dropped. So the result gets its own counts.
      const bucketsTotal = stats.length;
      const listingsBucketed = stats.reduce((sum, b) => sum + b.count, 0);
      const listingsCovered = stats.slice(0, limit).reduce((sum, b) => sum + b.count, 0);

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        schema: 'property-crawl.neighborhoods/v1',
        count: buckets.length,
        maxAgeDays,
        state: stateFilter,
        // The store read, and whether it came back whole.
        scanned,
        availableTotal,
        truncated,
        // The result, and how much of the inventory these rows actually cover.
        bucketsTotal,
        bucketsReturned: buckets.length,
        bucketsTruncated: buckets.length < bucketsTotal,
        listingsBucketed,
        listingsCovered,
        listingsNotCovered: listingsBucketed - listingsCovered,
        // Rows the bucketer could not place: no zip, and no city+state pair.
        rowsWithoutNeighborhoodKey: scanned - listingsBucketed,
        neighborhoods: buckets
      });
    }

    const parsed = parseKey(remaining);
    if (!parsed) {
      return sendJsonStatus(400, { error: 'invalid_neighborhood_key', remaining });
    }

    if (
      parsed.kind !== 'county' &&
      database.isPg &&
      typeof database.getSingleNeighborhoodStatsNative === 'function'
    ) {
      const nativeSingle = await database.getSingleNeighborhoodStatsNative(parsed.kind, parsed.key, { maxAgeDays, nowMs: now() });
      if (!nativeSingle) {
        return sendJsonStatus(404, { error: 'neighborhood_not_found', key: `${parsed.kind}:${parsed.key}` });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        schema: 'property-crawl.neighborhoods/v1',
        maxAgeDays,
        scanned: nativeSingle.scanned,
        availableTotal: nativeSingle.availableTotal,
        truncated: nativeSingle.truncated,
        neighborhood: serializeBucket(nativeSingle.neighborhood)
      });
    }

    const filters = { summary: true };
    if (stateFilter) {
      filters.state = stateFilter;
    } else if (parsed.kind === 'county' || parsed.kind === 'city') {
      const derivedState = parsed.key.slice(0, 2);
      if (/^[A-Z]{2}$/.test(derivedState)) filters.state = derivedState;
    }
    const { pool, availableTotal, scanned, truncated } = await scanAllListings(database, filters);

    let bucket = null;
    const statsOpts = { maxAgeDays, nowMs: now() };
    if (parsed.kind === 'county') {
      bucket = typeof neighborhoodStats.computeCountyStats === 'function'
        ? neighborhoodStats.computeCountyStats(parsed.key, pool, statsOpts)
        : computeCountyBucket(parsed.key, pool, statsOpts);
    } else if (parsed.kind === 'zip' && typeof neighborhoodStats.computeZipStats === 'function') {
      bucket = neighborhoodStats.computeZipStats(parsed.key, pool, statsOpts);
    } else if (parsed.kind === 'city' && typeof neighborhoodStats.computeCityStats === 'function') {
      bucket = neighborhoodStats.computeCityStats(parsed.key, pool, statsOpts);
    } else {
      bucket = getNeighborhoodStats(`${parsed.kind}:${parsed.key}`, pool, statsOpts);
    }
    if (!bucket) {
      return sendJsonStatus(404, { error: 'neighborhood_not_found', key: `${parsed.kind}:${parsed.key}` });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      schema: 'property-crawl.neighborhoods/v1',
      maxAgeDays,
      // Same disclosure as the list form: these medians describe the pool that
      // was read, and the pool is only the whole store if truncated is false.
      scanned,
      availableTotal,
      truncated,
      neighborhood: serializeBucket(bucket)
    });
  };
}

module.exports = {
  createNeighborhoodsHandler,
  parseKey,
  serializeBucket
};
