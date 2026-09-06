const fs = require('fs');
const path = require('path');
const { seedProvenance } = require('./seed-provenance');
const { loadLiveRecords } = require('./live-record-store');

const DEFAULT_LIVE_CACHE_PATH = path.resolve(__dirname, '../../.cache/live-listings.json');

// Canonical camelCase projection for listings. The in-memory provider emits
// camelCase (dealScore, openingBid, propType, ...) and the UUID-style record
// shape is what the API + Next.js UI consume. The Postgres schema stores
// snake_case (deal_score, opening_bid, prop_type) with NUMERIC columns that
// node-pg returns as strings — so every PG read must alias + cast back to the
// exact same contract or the UI silently breaks only in production.
const LISTING_SELECT = `
  id,
  source_key AS "source",
  state, county, city, zip, address,
  latitude::float8   AS "lat",
  longitude::float8  AS "lng",
  beds,
  baths::float8     AS "baths",
  sqft,
  year_built         AS "year",
  prop_type          AS "propType",
  opening_bid::float8 AS "openingBid",
  est_low::float8     AS "estLow",
  est_high::float8    AS "estHigh",
  assessed_value::float8 AS "assessed",
  CASE WHEN est_low > 0 AND est_high >= est_low
       THEN ((est_low + est_high) / 2.0)::float8
       ELSE NULL END   AS "mid",
  CASE WHEN opening_bid > 0 AND est_low > 0 AND est_high >= est_low
       THEN (opening_bid / ((est_low + est_high) / 2.0))::float8
       ELSE NULL END    AS "ratio",
  CASE WHEN opening_bid > 0 AND est_low > 0 AND est_high >= est_low
       THEN GREATEST(0, ((est_low + est_high) / 2.0) - opening_bid)::float8
       ELSE NULL END    AS "equity",
  CASE WHEN opening_bid > 0 AND est_low > 0 AND est_high >= est_low
       THEN deal_score
       ELSE NULL END    AS "dealScore",
  sale_date::text     AS "saleDate",
  plaintiff, defendant,
  judgment_amount::float8 AS "judgment",
  attorney, occupancy,
  deposit_terms       AS "deposit",
  photo_url           AS "photo",
  images              AS "images",
  source_url          AS "sourceUrl",
  raw_notice          AS "raw",
  provenance,
  source_observed_at::text AS "sourceObservedAt",
  fetched_at::text     AS "fetchedAt",
  price::float8       AS "price",
  listing_date::text  AS "listingDate",
  redemption_days     AS "redemptionDays",
  redemption_warning  AS "redemptionWarning",
  senior_lien_risk    AS "seniorLienRisk",
  senior_lien_warning AS "seniorLienWarning",
  cash_to_close::float8 AS "cashToClose",
  cash_to_close_details AS "cashToCloseDetails",
  status,
  auction_program AS "auctionProgram",
  lifecycle_status AS "lifecycleStatus",
  transaction_outcome AS "transactionOutcome",
  has_documents AS "hasDocuments"
`;

function optionalFiniteNumber(value, { positive = false, nonNegative = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (positive && number <= 0) return null;
  if (nonNegative && number < 0) return null;
  return number;
}

function normalizeGeocode(latValue, lngValue) {
  const lat = optionalFiniteNumber(latValue);
  const lng = optionalFiniteNumber(lngValue);
  const valid = lat !== null && lng !== null
    && lat >= -90 && lat <= 90
    && lng >= -180 && lng <= 180;
  return valid ? { lat, lng } : { lat: null, lng: null };
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const timestamp = Date.parse(String(value));
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString().slice(0, 10);
}

function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function canonicalStatus(value) {
  const raw=optionalText(value); if(!raw)return 'active';
  if (/cancel|withdraw/i.test(raw)) return 'cancelled';
  if (/postpon/i.test(raw)) return 'postponed';
  if (/adjourn/i.test(raw)) return 'adjourned';
  if (/scheduled|coming soon|pre.?auction/i.test(raw)) return 'scheduled';
  if (/pending|closed|post.?auction|auctioned/i.test(raw)) return 'pending';
  return ['active','stayed','STAYED_BANKRUPTCY','ACTIVE_SCHEDULED'].includes(raw) ? raw : 'active';
}

function normalizeProvenance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || Buffer.byteLength(serialized, 'utf8') > 256_000) return null;
    return JSON.parse(serialized);
  } catch (_) {
    return null;
  }
}

function normalizeCashToCloseDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || Buffer.byteLength(serialized, 'utf8') > 65_536) return null;
    const normalized = JSON.parse(serialized);
    return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
      ? normalized
      : null;
  } catch (_) {
    return null;
  }
}

function prepareListingForPersistence(listing = {}) {
  const openingBid = optionalFiniteNumber(listing.openingBid, { positive: true });
  const estLow = optionalFiniteNumber(listing.estLow, { positive: true });
  const estHigh = optionalFiniteNumber(listing.estHigh, { positive: true });
  const hasValidEstimateRange = estLow !== null && estHigh !== null && estHigh >= estLow;
  const mid = hasValidEstimateRange ? (estLow + estHigh) / 2 : null;
  const ratio = openingBid !== null && mid !== null && mid > 0 ? openingBid / mid : null;
  const equity = openingBid !== null && mid !== null ? Math.max(0, mid - openingBid) : null;
  const dealScore = ratio !== null
    ? Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)))
    : null;
  const geocode = normalizeGeocode(listing.lat, listing.lng);
  const seniorLienRisk = typeof listing.seniorLienRisk === 'string' && listing.seniorLienRisk.trim()
    ? listing.seniorLienRisk.trim().toLowerCase()
    : null;

  return {
    ...listing,
    ...geocode,
    openingBid,
    estLow,
    estHigh,
    assessed: optionalFiniteNumber(listing.assessed, { positive: true }),
    mid,
    ratio,
    equity,
    dealScore,
    county: optionalText(listing.county),
    city: optionalText(listing.city),
    zip: optionalText(listing.zip),
    propType: optionalText(listing.propType),
    saleDate: normalizeDate(listing.saleDate),
    listingDate: normalizeDate(listing.listingDate),
    beds: optionalFiniteNumber(listing.beds, { nonNegative: true }),
    baths: optionalFiniteNumber(listing.baths, { nonNegative: true }),
    sqft: optionalFiniteNumber(listing.sqft, { nonNegative: true }),
    year: optionalFiniteNumber(listing.year, { positive: true }),
    judgment: optionalFiniteNumber(listing.judgment, { nonNegative: true }),
    price: optionalFiniteNumber(listing.price, { nonNegative: true }),
    redemptionDays: optionalFiniteNumber(listing.redemptionDays, { nonNegative: true }),
    cashToClose: optionalFiniteNumber(listing.cashToClose, { nonNegative: true }),
    cashToCloseDetails: normalizeCashToCloseDetails(listing.cashToCloseDetails),
    deposit: listing.deposit || null,
    occupancy: listing.occupancy || null,
    plaintiff: optionalText(listing.plaintiff),
    defendant: optionalText(listing.defendant),
    attorney: optionalText(listing.attorney),
    photo: optionalText(listing.photo),
    seniorLienRisk,
    auctionProgram: optionalText(listing.auctionProgram ?? listing.provenance?.sourceFacts?.auctionProgram),
    lifecycleStatus: optionalText(listing.lifecycleStatus ?? listing.status),
    transactionOutcome: optionalText(listing.transactionOutcome),
    hasDocuments: listing.hasDocuments === true,
    status: canonicalStatus(listing.status),
    provenance: normalizeProvenance(listing.provenance),
    sourceObservedAt: normalizeTimestamp(listing.sourceObservedAt ?? listing.observedAt),
    // This is deliberately assigned at the trusted persistence boundary rather
    // than accepted from a source payload.
    fetchedAt: new Date().toISOString(),
  };
}

function mergeListingForInMemoryUpsert(existing, incoming) {
  if (!existing) return incoming;
  const merged = { ...existing, ...incoming };
  const incomingHasEstimateBand = incoming.estLow !== null && incoming.estHigh !== null;
  if (!incomingHasEstimateBand && existing.estLow !== null && existing.estHigh !== null) {
    merged.estLow = existing.estLow;
    merged.estHigh = existing.estHigh;
  }
  if ((incoming.lat === null || incoming.lng === null) && existing.lat !== null && existing.lng !== null) {
    merged.lat = existing.lat;
    merged.lng = existing.lng;
  }
  if (existing.provenance || incoming.provenance) {
    merged.provenance = { ...(existing.provenance || {}), ...(incoming.provenance || {}) };
  }
  for (const field of ['baths', 'openingBid', 'saleDate', 'deposit', 'occupancy', 'redemptionDays', 'seniorLienRisk', 'cashToCloseDetails', 'sourceObservedAt']) {
    if (incoming[field] === null && existing[field] !== null && existing[field] !== undefined) {
      merged[field] = existing[field];
    }
  }
  return prepareListingForPersistence(merged);
}

function compareNumbersUnknownLast(left, right, descending = true) {
  const leftKnown = Number.isFinite(Number(left)) && left !== null;
  const rightKnown = Number.isFinite(Number(right)) && right !== null;
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  if (!leftKnown) return 0;
  return descending ? Number(right) - Number(left) : Number(left) - Number(right);
}

class DatabaseClient {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.isPg = false;
    this.pool = null;
    this.listingSelect = LISTING_SELECT;
    const explicitLiveCachePath = Object.prototype.hasOwnProperty.call(options, 'liveCachePath')
      ? options.liveCachePath
      : this.env.PROPERTY_LIVE_CACHE_PATH;
    const testMode = this.env.NODE_ENV === 'test' || /^test(?::|$)/.test(this.env.npm_lifecycle_event || '');
    this.liveCachePath = explicitLiveCachePath
      ? path.resolve(explicitLiveCachePath)
      : (explicitLiveCachePath === null || testMode ? null : DEFAULT_LIVE_CACHE_PATH);
    this.liveCacheSignature = null;
    this.liveCacheErrorSignature = null;
    this.inMemoryData = {
      sources: {},
      listings: [],
      savedDeals: new Map(), // userId -> Set of listingIds
      aiCache: new Map(),    // hash -> cached object
      logs: []
    };
    this.init();
  }

  init() {
    if (this.env.DISCOVERY_MODE === 'advanced' && !this.env.DATABASE_URL) {
      throw new Error('DISCOVERY_MODE=advanced requires DATABASE_URL');
    }
    if (this.env.DATABASE_URL) {
      try {
        const { Pool } = require('pg');
        this.pool = new Pool({
          connectionString: this.env.DATABASE_URL,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });
        this.isPg = true;
        console.log('[DB] Connected to PostgreSQL instance');
      } catch (err) {
        if (this.env.DISCOVERY_MODE === 'advanced') throw new Error(`Advanced discovery PostgreSQL initialization failed: ${err.message}`);
        console.warn('[DB] PostgreSQL driver not initialized, using resilient in-memory provider:', err.message);
        this.isPg = false;
      }
    }

    if (!this.isPg) {
      this.seedInMemory();
    }
  }

  seedInMemory() {
    try {
      const dataJsPath = path.resolve(__dirname, '../../data.js');
      if (fs.existsSync(dataJsPath)) {
        const vm = require('vm');
        const sandbox = { window: {}, Math };
        vm.createContext(sandbox);
        vm.runInContext(fs.readFileSync(dataJsPath, 'utf8'), sandbox);
        this.inMemoryData.sources = sandbox.window.SOURCES || {};
        this.inMemoryData.listings = Array.from(sandbox.window.LISTINGS || [], l => {
          let images = Array.isArray(l.images) && l.images.length > 0 ? l.images : null;
          if (!images) {
            let hash = 0;
            for (let i = 0; i < (l.id || '').length; i++) {
              hash = ((hash << 5) - hash + (l.id || '').charCodeAt(i)) | 0;
            }
            const count = (Math.abs(hash) % 5) + 1; // 1 to 5
            const pool = [
              'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=640&q=70',
              'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=640&q=70',
              'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=640&q=70',
              'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=640&q=70',
              'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=640&q=70',
              'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=640&q=70',
              'https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=640&q=70',
              'https://images.unsplash.com/photo-1598228723793-52759bba239c?w=640&q=70',
            ];
            images = [l.photo || pool[0]];
            for (let i = 1; i < count; i++) {
              images.push(pool[(Math.abs(hash >> (i * 4)) + i) % pool.length]);
            }
          }
          return {
            ...l,
            images,
            provenance: seedProvenance(l),
            sourceObservedAt: l.sourceObservedAt ?? null,
            fetchedAt: l.fetchedAt ?? null,
            price: l.price ?? null,
            listingDate: l.listingDate ?? null,
            status: l.status || 'active',
          };
        });
        console.log(`[DB] Loaded ${this.inMemoryData.listings.length} persisted records across ${Object.keys(this.inMemoryData.sources).length} sources; provenance retained per record`);
      }
    } catch (err) {
      console.error('[DB] Failed to seed in-memory provider:', err);
    }
    this.refreshLiveCache({ force: true });
  }

  refreshLiveCache(options = {}) {
    if (this.isPg || !this.liveCachePath) return { refreshed: false, applied: 0 };
    let signature;
    try {
      const stats = fs.statSync(this.liveCachePath);
      if (!stats.isFile()) throw new Error('Live record cache path is not a regular file');
      signature = `${stats.mtimeMs}:${stats.size}`;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.liveCacheSignature = 'missing';
        this.liveCacheErrorSignature = null;
        return { refreshed: false, applied: 0 };
      }
      console.warn('[DB] Could not inspect live record cache; current inventory was preserved:', error.message);
      return { refreshed: false, applied: 0, error };
    }
    if (!options.force && (signature === this.liveCacheSignature || signature === this.liveCacheErrorSignature)) {
      return { refreshed: false, applied: 0 };
    }
    try {
      const observed = loadLiveRecords(this.liveCachePath);
      const byId = new Map(this.inMemoryData.listings.map((record) => [record.id, record]));
      let applied = 0;
      for (const record of observed) {
        const incoming = prepareListingForPersistence(record);
        incoming.sourceObservedAt = normalizeTimestamp(record.sourceObservedAt ?? record.provenance?.observedAt);
        incoming.fetchedAt = normalizeTimestamp(record.fetchedAt) || incoming.fetchedAt;
        const existing = byId.get(incoming.id);
        const incomingTime = Date.parse(incoming.sourceObservedAt || incoming.provenance?.observedAt || '');
        const existingTime = Date.parse(existing?.sourceObservedAt || existing?.provenance?.observedAt || '');
        const latestSafeTime = Date.now() + 300_000;
        if (!Number.isFinite(incomingTime) || incomingTime > latestSafeTime) continue;
        if (existing && Number.isFinite(existingTime) && existingTime <= latestSafeTime && existingTime >= incomingTime) continue;
        const merged = mergeListingForInMemoryUpsert(existing, incoming);
        merged.sourceObservedAt = incoming.sourceObservedAt;
        merged.fetchedAt = incoming.fetchedAt;
        byId.set(incoming.id, merged);
        applied++;
      }
      this.inMemoryData.listings = [...byId.values()];
      this.liveCacheSignature = signature;
      this.liveCacheErrorSignature = null;
      if (applied) console.log(`[DB] Refreshed ${applied} validated source-observed records from the local store`);
      return { refreshed: true, applied };
    } catch (error) {
      this.liveCacheErrorSignature = signature;
      console.warn('[DB] Invalid live record cache was ignored; current inventory was preserved:', error.message);
      return { refreshed: false, applied: 0, error };
    }
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    if ([lat1, lon1, lat2, lon2].some((value) => value === null || value === undefined || value === '')) {
      return null;
    }
    const coordinates = [lat1, lon1, lat2, lon2].map(Number);
    if (!coordinates.every(Number.isFinite)) return null;
    [lat1, lon1, lat2, lon2] = coordinates;
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async getSources() {
    if (this.isPg) {
      const res = await this.pool.query(
        `SELECT key, label, tier, color, note, website_url AS "websiteUrl"
         FROM sources WHERE is_active = TRUE ORDER BY tier, label`
      );
      return res.rows;
    }
    this.refreshLiveCache();
    return Object.entries(this.inMemoryData.sources).map(([key, s]) => ({ key, ...s }));
  }

  async getListings(filters = {}) {
    const {
      q = '',
      state = 'all',
      source = 'all',
      type = 'all',
      status = 'all',
      sort = 'score',
      limit = 50,
      offset = 0,
      minScore,
      minEquity,
      maxBid,
      occupancy = 'all',
      seniorLien = 'all',
      redemption = 'all',
      lat,
      lng,
      radiusKm = 100
    } = filters;

    if (this.isPg) {
      let sql = `SELECT ${LISTING_SELECT}, COUNT(*) OVER() AS "fullCount" FROM listings WHERE 1=1`;
      const params = [];
      let paramIdx = 1;

      if (state !== 'all') {
        sql += ` AND state = $${paramIdx++}`;
        params.push(state.toUpperCase());
      }
      if (source !== 'all') {
        sql += ` AND source_key = $${paramIdx++}`;
        params.push(source);
      }
      if (type !== 'all') {
        sql += ` AND prop_type = $${paramIdx++}`;
        params.push(type);
      }
      if (status !== 'all') {
        sql += ` AND status = $${paramIdx++}`;
        params.push(status);
      }
      if (minScore) {
        sql += ` AND deal_score >= $${paramIdx++}`;
        params.push(Number(minScore));
      }
      if (minEquity) {
        sql += ` AND equity_spread >= $${paramIdx++}`;
        params.push(Number(minEquity));
      }
      if (maxBid) {
        sql += ` AND opening_bid <= $${paramIdx++}`;
        params.push(Number(maxBid));
      }
      if (occupancy && occupancy !== 'all') {
        sql += ` AND occupancy = $${paramIdx++}`;
        params.push(occupancy);
      }
      if (seniorLien === 'clean') {
        sql += ` AND senior_lien_risk IS NOT NULL AND senior_lien_risk != 'high'`;
      } else if (seniorLien === 'risk') {
        sql += ` AND senior_lien_risk = 'high'`;
      }
      if (redemption === 'immediate') {
        sql += ` AND redemption_days = 0`;
      } else if (redemption === 'redemption_active') {
        sql += ` AND redemption_days > 0`;
      }
      if (q) {
        sql += ` AND (address ILIKE $${paramIdx} OR city ILIKE $${paramIdx} OR county ILIKE $${paramIdx} OR plaintiff ILIKE $${paramIdx} OR defendant ILIKE $${paramIdx} OR attorney ILIKE $${paramIdx})`;
        params.push(`%${q}%`);
        paramIdx++;
      }
      if (lat != null && lng != null) {
        sql += ` AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint($${paramIdx++}, $${paramIdx++}), 4326)::geography, $${paramIdx++})`;
        params.push(lng, lat, radiusKm * 1000);
      }

      if (sort === 'equity') sql += ' ORDER BY equity_spread DESC NULLS LAST';
      else if (sort === 'bid-asc') sql += ' ORDER BY opening_bid ASC NULLS LAST';
      else if (sort === 'date') sql += ' ORDER BY sale_date ASC NULLS LAST';
      else if (sort === 'images') sql += ' ORDER BY COALESCE(array_length(images, 1), 0) DESC NULLS LAST';
      else sql += ' ORDER BY deal_score DESC NULLS LAST';

      sql += ` LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
      params.push(Number(limit), Number(offset));

      const res = await this.pool.query(sql, params);
      // total = full match count (COUNT(*) OVER), not the page size.
      const total = Number(res.rows[0]?.fullCount ?? 0);
      const listings = res.rows.map(({ fullCount, ...row }) => row);
      return { total, listings };
    }

    this.refreshLiveCache();
    let results = this.inMemoryData.listings.filter(l => {
      if (state !== 'all' && l.state !== state) return false;
      if (source !== 'all' && l.source !== source) return false;
      if (type !== 'all' && l.propType !== type) return false;
      if (status !== 'all' && (l.status || 'active') !== status) return false;
      if (minScore && l.dealScore < Number(minScore)) return false;
      if (minEquity && l.equity < Number(minEquity)) return false;
      if (maxBid && (l.openingBid == null || l.openingBid > Number(maxBid))) return false;
      if (occupancy !== 'all' && l.occupancy !== occupancy) return false;
      if (seniorLien === 'clean' && (!l.seniorLienRisk || l.seniorLienRisk === 'high')) return false;
      if (seniorLien === 'risk' && l.seniorLienRisk !== 'high') return false;
      if (redemption === 'immediate' && l.redemptionDays !== 0) return false;
      if (redemption === 'redemption_active' && (!l.redemptionDays || l.redemptionDays <= 0)) return false;
      if (lat != null && lng != null) {
        const dist = this.calculateDistance(Number(lat), Number(lng), l.lat, l.lng);
        if (dist === null || dist > Number(radiusKm)) return false;
      }
      if (q) {
        const needle = q.toLowerCase();
        const hay = [l.address, l.city, l.county, l.state, l.plaintiff, l.defendant, l.attorney, l.occupancy, l.deposit, this.inMemoryData.sources[l.source]?.label || ''].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    if (sort === 'equity') results.sort((a, b) => compareNumbersUnknownLast(a.equity, b.equity));
    else if (sort === 'bid-asc') results.sort((a, b) => compareNumbersUnknownLast(a.openingBid, b.openingBid, false));
    else if (sort === 'date') {
      results.sort((a, b) => compareNumbersUnknownLast(Date.parse(a.saleDate), Date.parse(b.saleDate), false));
    } else if (sort === 'images') {
      results.sort((a, b) => (b.images?.length || 0) - (a.images?.length || 0));
    } else results.sort((a, b) => compareNumbersUnknownLast(a.dealScore, b.dealScore));

    const total = results.length;
    const paginated = results.slice(Number(offset), Number(offset) + Number(limit));
    return { total, listings: paginated };
  }

  async getListingById(id) {
    if (this.isPg) {
      const res = await this.pool.query(`SELECT ${LISTING_SELECT} FROM listings WHERE id = $1`, [id]);
      if (res.rows[0]) return res.rows[0];
      const aliasRes = await this.pool.query(`SELECT ${LISTING_SELECT} FROM listings WHERE id LIKE '%' || $1 OR $1 LIKE '%' || id LIMIT 1`, [id]);
      if (aliasRes.rows[0]) return aliasRes.rows[0];
      return null;
    }
    this.refreshLiveCache();
    const exact = this.inMemoryData.listings.find(l => l.id === id);
    if (exact) return exact;
    const aliased = this.inMemoryData.listings.find(l => l.id.endsWith(id) || id.endsWith(l.id));
    if (aliased) return aliased;
    return null;
  }

  async createListing(listing) {
    let enriched = prepareListingForPersistence(listing);

    if (this.isPg) {
      const resolvedOpeningBidSql = 'COALESCE(EXCLUDED.opening_bid, listings.opening_bid)';
      const resolvedEstLowSql = 'CASE WHEN EXCLUDED.est_low IS NOT NULL AND EXCLUDED.est_high IS NOT NULL THEN EXCLUDED.est_low ELSE listings.est_low END';
      const resolvedEstHighSql = 'CASE WHEN EXCLUDED.est_low IS NOT NULL AND EXCLUDED.est_high IS NOT NULL THEN EXCLUDED.est_high ELSE listings.est_high END';
      const sql = `INSERT INTO listings (
        id, source_key, state, county, city, zip, address, latitude, longitude, geog,
        beds, baths, sqft, year_built, prop_type, opening_bid, est_low, est_high,
        assessed_value, deal_score, sale_date, plaintiff, defendant, judgment_amount, attorney,
        occupancy, deposit_terms, photo_url, images, source_url, raw_notice,
        provenance, source_observed_at, fetched_at,
        price, listing_date, redemption_days, redemption_warning, senior_lien_risk,
        senior_lien_warning, cash_to_close, cash_to_close_details, status,
        auction_program, lifecycle_status, transaction_outcome, has_documents
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        CASE WHEN $8::float8 IS NOT NULL AND $9::float8 IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint($9,$8), 4326)::geography ELSE NULL END,
        $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,
        NULLIF($31::jsonb #>> '{sourceFacts,auctionProgram}',''), $42,
        NULLIF($31::jsonb #>> '{sourceFacts,transactionOutcome}',''),
        CASE WHEN jsonb_typeof($31::jsonb #> '{sourceFacts,documents}')='array'
          THEN jsonb_array_length($31::jsonb #> '{sourceFacts,documents}') > 0 ELSE FALSE END
      )
      ON CONFLICT (id) DO UPDATE SET
        source_key = EXCLUDED.source_key,
        state = EXCLUDED.state,
        county = COALESCE(EXCLUDED.county, listings.county),
        city = COALESCE(EXCLUDED.city, listings.city),
        zip = COALESCE(EXCLUDED.zip, listings.zip),
        address = EXCLUDED.address,
        latitude = CASE WHEN EXCLUDED.geog IS NOT NULL THEN EXCLUDED.latitude ELSE listings.latitude END,
        longitude = CASE WHEN EXCLUDED.geog IS NOT NULL THEN EXCLUDED.longitude ELSE listings.longitude END,
        geog = COALESCE(EXCLUDED.geog, listings.geog),
        beds = COALESCE(EXCLUDED.beds, listings.beds),
        baths = COALESCE(EXCLUDED.baths, listings.baths),
        sqft = COALESCE(EXCLUDED.sqft, listings.sqft),
        year_built = COALESCE(EXCLUDED.year_built, listings.year_built),
        prop_type = COALESCE(EXCLUDED.prop_type, listings.prop_type),
        opening_bid = COALESCE(EXCLUDED.opening_bid, listings.opening_bid),
        est_low = CASE WHEN EXCLUDED.est_low IS NOT NULL AND EXCLUDED.est_high IS NOT NULL THEN EXCLUDED.est_low ELSE listings.est_low END,
        est_high = CASE WHEN EXCLUDED.est_low IS NOT NULL AND EXCLUDED.est_high IS NOT NULL THEN EXCLUDED.est_high ELSE listings.est_high END,
        assessed_value = COALESCE(EXCLUDED.assessed_value, listings.assessed_value),
        deal_score = CASE
          WHEN ${resolvedOpeningBidSql} > 0
            AND ${resolvedEstLowSql} > 0
            AND ${resolvedEstHighSql} >= ${resolvedEstLowSql}
          THEN GREATEST(1, LEAST(99, ROUND(
            (1 - (${resolvedOpeningBidSql} / ((${resolvedEstLowSql} + ${resolvedEstHighSql}) / 2))) * 130
          )))::int
          ELSE NULL
        END,
        sale_date = COALESCE(EXCLUDED.sale_date, listings.sale_date),
        plaintiff = COALESCE(EXCLUDED.plaintiff, listings.plaintiff),
        defendant = COALESCE(EXCLUDED.defendant, listings.defendant),
        judgment_amount = COALESCE(EXCLUDED.judgment_amount, listings.judgment_amount),
        attorney = COALESCE(EXCLUDED.attorney, listings.attorney),
        occupancy = COALESCE(EXCLUDED.occupancy, listings.occupancy),
        deposit_terms = COALESCE(EXCLUDED.deposit_terms, listings.deposit_terms),
        photo_url = EXCLUDED.photo_url,
        images = COALESCE(EXCLUDED.images, listings.images),
        source_url = COALESCE(EXCLUDED.source_url, listings.source_url),
        raw_notice = COALESCE(EXCLUDED.raw_notice, listings.raw_notice),
        provenance = CASE
          WHEN EXCLUDED.provenance IS NULL THEN listings.provenance
          WHEN listings.provenance IS NULL THEN EXCLUDED.provenance
          ELSE listings.provenance || EXCLUDED.provenance
        END,
        source_observed_at = COALESCE(EXCLUDED.source_observed_at, listings.source_observed_at),
        fetched_at = EXCLUDED.fetched_at,
        price = COALESCE(EXCLUDED.price, listings.price),
        listing_date = COALESCE(EXCLUDED.listing_date, listings.listing_date),
        redemption_days = COALESCE(EXCLUDED.redemption_days, listings.redemption_days),
        redemption_warning = COALESCE(EXCLUDED.redemption_warning, listings.redemption_warning),
        senior_lien_risk = COALESCE(EXCLUDED.senior_lien_risk, listings.senior_lien_risk),
        senior_lien_warning = COALESCE(EXCLUDED.senior_lien_warning, listings.senior_lien_warning),
        cash_to_close = COALESCE(EXCLUDED.cash_to_close, listings.cash_to_close),
        cash_to_close_details = COALESCE(EXCLUDED.cash_to_close_details, listings.cash_to_close_details),
        status = EXCLUDED.status,
        auction_program = COALESCE(EXCLUDED.auction_program, listings.auction_program),
        lifecycle_status = COALESCE(EXCLUDED.lifecycle_status, listings.lifecycle_status),
        transaction_outcome = COALESCE(EXCLUDED.transaction_outcome, listings.transaction_outcome),
        has_documents = listings.has_documents OR EXCLUDED.has_documents,
        updated_at = NOW()
      WHERE listings.source_observed_at IS NULL
         OR (EXCLUDED.source_observed_at IS NOT NULL AND EXCLUDED.source_observed_at >= listings.source_observed_at)
      RETURNING ${LISTING_SELECT};`;
      const params = [
        enriched.id, enriched.source, enriched.state, enriched.county, enriched.city, enriched.zip,
        enriched.address, enriched.lat, enriched.lng, enriched.beds, enriched.baths,
        enriched.sqft, enriched.year, enriched.propType,
        enriched.openingBid, enriched.estLow, enriched.estHigh, enriched.assessed, enriched.dealScore,
        enriched.saleDate, enriched.plaintiff ?? null, enriched.defendant ?? null, enriched.judgment,
        enriched.attorney ?? null, enriched.occupancy, enriched.deposit,
        enriched.photo, enriched.images || null, enriched.sourceUrl, enriched.raw,
        enriched.provenance, enriched.sourceObservedAt, enriched.fetchedAt,
        enriched.price ?? null, enriched.listingDate ?? null,
        enriched.redemptionDays, enriched.redemptionWarning || null,
        enriched.seniorLienRisk, enriched.seniorLienWarning || null,
        enriched.cashToClose ?? null, enriched.cashToCloseDetails, enriched.status || 'active'
      ];
      const result = await this.pool.query(sql, params);
      return result.rows[0];
    }

    const idx = this.inMemoryData.listings.findIndex(l => l.id === enriched.id);
    if (idx >= 0) {
      enriched = mergeListingForInMemoryUpsert(this.inMemoryData.listings[idx], enriched);
      this.inMemoryData.listings[idx] = enriched;
    } else {
      this.inMemoryData.listings.unshift(enriched);
    }
    return enriched;
  }

  async getSavedDeals(userId) {
    if (this.isPg) {
      const res = await this.pool.query(
        `SELECT
           l.id,
           l.source_key AS "source",
           l.state, l.county, l.city, l.zip, l.address,
           l.latitude::float8 AS "lat", l.longitude::float8 AS "lng",
           l.beds, l.baths::float8 AS "baths", l.sqft, l.year_built AS "year",
           l.prop_type AS "propType",
           l.opening_bid::float8 AS "openingBid",
           l.est_low::float8 AS "estLow", l.est_high::float8 AS "estHigh",
           l.assessed_value::float8 AS "assessed",
           CASE WHEN l.est_low > 0 AND l.est_high >= l.est_low
                THEN ((l.est_low + l.est_high) / 2.0)::float8
                ELSE NULL END AS "mid",
           CASE WHEN l.opening_bid > 0 AND l.est_low > 0 AND l.est_high >= l.est_low
                THEN (l.opening_bid / ((l.est_low + l.est_high) / 2.0))::float8
                ELSE NULL END AS "ratio",
           CASE WHEN l.opening_bid > 0 AND l.est_low > 0 AND l.est_high >= l.est_low
                THEN GREATEST(0, ((l.est_low + l.est_high) / 2.0) - l.opening_bid)::float8
                ELSE NULL END AS "equity",
           CASE WHEN l.opening_bid > 0 AND l.est_low > 0 AND l.est_high >= l.est_low
                THEN l.deal_score
                ELSE NULL END AS "dealScore",
           l.sale_date::text AS "saleDate",
           l.plaintiff, l.defendant, l.judgment_amount::float8 AS "judgment",
           l.attorney, l.occupancy, l.deposit_terms AS "deposit",
           l.photo_url AS "photo", l.images AS "images", l.source_url AS "sourceUrl",
           l.raw_notice AS "raw",
           l.provenance,
           l.source_observed_at::text AS "sourceObservedAt",
           l.fetched_at::text AS "fetchedAt",
           l.redemption_days AS "redemptionDays",
           l.redemption_warning AS "redemptionWarning",
           l.senior_lien_risk AS "seniorLienRisk",
           l.senior_lien_warning AS "seniorLienWarning",
           l.cash_to_close::float8 AS "cashToClose",
           l.cash_to_close_details AS "cashToCloseDetails",
           sd.notes, sd.created_at AS "savedAt"
         FROM saved_deals sd
         JOIN listings l ON sd.listing_id = l.id
         WHERE sd.user_id = $1
         ORDER BY l.sale_date ASC NULLS LAST`,
        [userId]
      );
      return res.rows;
    }
    this.refreshLiveCache();
    const ids = this.inMemoryData.savedDeals.get(userId) || new Set();
    return this.inMemoryData.listings.filter(l => ids.has(l.id));
  }

  async saveDeal(userId, listingId) {
    if (this.isPg) {
      await this.pool.query(
        `INSERT INTO saved_deals (user_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, listingId]
      );
      return true;
    }
    if (!this.inMemoryData.savedDeals.has(userId)) {
      this.inMemoryData.savedDeals.set(userId, new Set());
    }
    this.inMemoryData.savedDeals.get(userId).add(listingId);
    return true;
  }

  async removeSavedDeal(userId, listingId) {
    if (this.isPg) {
      await this.pool.query(`DELETE FROM saved_deals WHERE user_id = $1 AND listing_id = $2`, [userId, listingId]);
      return true;
    }
    if (this.inMemoryData.savedDeals.has(userId)) {
      this.inMemoryData.savedDeals.get(userId).delete(listingId);
    }
    return true;
  }

  async getAiCache(contentHash) {
    if (this.isPg) {
      const res = await this.pool.query('SELECT * FROM ai_cache WHERE content_hash = $1', [contentHash]);
      return res.rows[0] || null;
    }
    return this.inMemoryData.aiCache.get(contentHash) || null;
  }

  async setAiCache(record) {
    if (this.isPg) {
      await this.pool.query(
        `INSERT INTO ai_cache (content_hash, prompt_type, model_used, input_tokens, output_tokens, cost_usd, response_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (content_hash) DO NOTHING`,
        [record.contentHash, record.promptType, record.model, record.inputTokens, record.outputTokens, record.costUsd, record.responseText]
      );
      return;
    }
    this.inMemoryData.aiCache.set(record.contentHash, record);
  }
}

module.exports = new DatabaseClient();
module.exports.DatabaseClient = DatabaseClient;
module.exports.DEFAULT_LIVE_CACHE_PATH = DEFAULT_LIVE_CACHE_PATH;
module.exports.LISTING_SELECT = LISTING_SELECT;
module.exports.prepareListingForPersistence = prepareListingForPersistence;
