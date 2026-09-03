const fs = require('fs');
const path = require('path');

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
  beds, baths, sqft,
  year_built         AS "year",
  prop_type          AS "propType",
  opening_bid::float8 AS "openingBid",
  est_low::float8     AS "estLow",
  est_high::float8    AS "estHigh",
  assessed_value::float8 AS "assessed",
  mid_value::float8   AS "mid",
  CASE WHEN (est_low + est_high) > 0
       THEN (opening_bid / ((est_low + est_high) / 2.0))::float8
       ELSE 0 END      AS "ratio",
  equity_spread::float8 AS "equity",
  deal_score          AS "dealScore",
  sale_date::text     AS "saleDate",
  plaintiff, defendant,
  judgment_amount::float8 AS "judgment",
  attorney, occupancy,
  deposit_terms       AS "deposit",
  photo_url           AS "photo",
  source_url          AS "sourceUrl",
  raw_notice          AS "raw",
  price::float8       AS "price",
  listing_date::text  AS "listingDate",
  redemption_days     AS "redemptionDays",
  redemption_warning  AS "redemptionWarning",
  senior_lien_risk    AS "seniorLienRisk",
  senior_lien_warning AS "seniorLienWarning",
  cash_to_close::float8 AS "cashToClose",
  status
`;

class DatabaseClient {
  constructor() {
    this.isPg = false;
    this.pool = null;
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
    if (process.env.DATABASE_URL) {
      try {
        const { Pool } = require('pg');
        this.pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });
        this.isPg = true;
        console.log('[DB] Connected to PostgreSQL instance');
      } catch (err) {
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
        this.inMemoryData.listings = (sandbox.window.LISTINGS || []).map(l => ({
          ...l,
          price: l.price ?? null,
          listingDate: l.listingDate ?? null,
          status: l.status || 'active',
        }));
        console.log(`[DB] Seeded in-memory provider with ${this.inMemoryData.listings.length} listings across ${Object.keys(this.inMemoryData.sources).length} sources`);
      }
    } catch (err) {
      console.error('[DB] Failed to seed in-memory provider:', err);
    }
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
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
        sql += ` AND (senior_lien_risk IS NULL OR senior_lien_risk != 'high')`;
      } else if (seniorLien === 'risk') {
        sql += ` AND senior_lien_risk = 'high'`;
      }
      if (redemption === 'immediate') {
        sql += ` AND (redemption_days IS NULL OR redemption_days = 0)`;
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

      if (sort === 'equity') sql += ' ORDER BY equity_spread DESC';
      else if (sort === 'bid-asc') sql += ' ORDER BY opening_bid ASC';
      else if (sort === 'date') sql += ' ORDER BY sale_date ASC';
      else sql += ' ORDER BY deal_score DESC';

      sql += ` LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
      params.push(Number(limit), Number(offset));

      const res = await this.pool.query(sql, params);
      // total = full match count (COUNT(*) OVER), not the page size.
      const total = Number(res.rows[0]?.fullCount ?? 0);
      const listings = res.rows.map(({ fullCount, ...row }) => row);
      return { total, listings };
    }

    let results = this.inMemoryData.listings.filter(l => {
      if (state !== 'all' && l.state !== state) return false;
      if (source !== 'all' && l.source !== source) return false;
      if (type !== 'all' && l.propType !== type) return false;
      if (status !== 'all' && (l.status || 'active') !== status) return false;
      if (minScore && l.dealScore < Number(minScore)) return false;
      if (minEquity && l.equity < Number(minEquity)) return false;
      if (maxBid && l.openingBid > Number(maxBid)) return false;
      if (occupancy !== 'all' && l.occupancy !== occupancy) return false;
      if (seniorLien === 'clean' && l.seniorLienRisk === 'high') return false;
      if (seniorLien === 'risk' && l.seniorLienRisk !== 'high') return false;
      if (redemption === 'immediate' && (l.redemptionDays || 0) > 0) return false;
      if (redemption === 'redemption_active' && (!l.redemptionDays || l.redemptionDays <= 0)) return false;
      if (lat != null && lng != null) {
        const dist = this.calculateDistance(Number(lat), Number(lng), l.lat, l.lng);
        if (dist > Number(radiusKm)) return false;
      }
      if (q) {
        const needle = q.toLowerCase();
        const hay = [l.address, l.city, l.county, l.state, l.plaintiff, l.defendant, l.attorney, l.occupancy, l.deposit, this.inMemoryData.sources[l.source]?.label || ''].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    if (sort === 'equity') results.sort((a, b) => b.equity - a.equity);
    else if (sort === 'bid-asc') results.sort((a, b) => a.openingBid - b.openingBid);
    else if (sort === 'date') results.sort((a, b) => new Date(a.saleDate) - new Date(b.saleDate));
    else results.sort((a, b) => b.dealScore - a.dealScore);

    const total = results.length;
    const paginated = results.slice(Number(offset), Number(offset) + Number(limit));
    return { total, listings: paginated };
  }

  async getListingById(id) {
    if (this.isPg) {
      const res = await this.pool.query(`SELECT ${LISTING_SELECT} FROM listings WHERE id = $1`, [id]);
      return res.rows[0] || null;
    }
    return this.inMemoryData.listings.find(l => l.id === id) || null;
  }

  async createListing(listing) {
    const enriched = {
      ...listing,
      dealScore: listing.dealScore || Math.min(99, Math.max(1, Math.round((1 - (listing.openingBid / Math.max(1, (listing.estLow + listing.estHigh) / 2))) * 130))),
      equity: listing.equity || Math.max(0, Math.round(((listing.estLow + listing.estHigh) / 2) - listing.openingBid)),
      mid: listing.mid || Math.round((listing.estLow + listing.estHigh) / 2)
    };

    if (this.isPg) {
      const sql = `INSERT INTO listings (
        id, source_key, state, county, city, zip, address, latitude, longitude, geog,
        beds, baths, sqft, year_built, prop_type, opening_bid, est_low, est_high,
        deal_score, sale_date, plaintiff, defendant, judgment_amount, attorney,
        occupancy, deposit_terms, photo_url, source_url, raw_notice,
        price, listing_date, redemption_days, redemption_warning, senior_lien_risk,
        senior_lien_warning, cash_to_close, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,ST_SetSRID(ST_MakePoint($9,$8), 4326)::geography,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36)
      ON CONFLICT (id) DO UPDATE SET opening_bid = EXCLUDED.opening_bid, deal_score = EXCLUDED.deal_score, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, geog = EXCLUDED.geog, price = EXCLUDED.price, listing_date = EXCLUDED.listing_date, redemption_days = EXCLUDED.redemption_days, redemption_warning = EXCLUDED.redemption_warning, senior_lien_risk = EXCLUDED.senior_lien_risk, senior_lien_warning = EXCLUDED.senior_lien_warning, cash_to_close = EXCLUDED.cash_to_close, status = EXCLUDED.status, updated_at = NOW()
      RETURNING id;`;
      const params = [
        enriched.id, enriched.source, enriched.state, enriched.county, enriched.city, enriched.zip,
        enriched.address, enriched.lat, enriched.lng, enriched.beds || 0, enriched.baths || 0,
        enriched.sqft || 0, enriched.year || null, enriched.propType || 'Single Family',
        enriched.openingBid, enriched.estLow, enriched.estHigh, enriched.dealScore,
        enriched.saleDate, enriched.plaintiff, enriched.defendant, enriched.judgment || 0,
        enriched.attorney, enriched.occupancy || 'Unknown', enriched.deposit || 'Certified funds',
        enriched.photo, enriched.sourceUrl, enriched.raw,
        enriched.price ?? null, enriched.listingDate ?? null,
        enriched.redemptionDays || 0, enriched.redemptionWarning || null,
        enriched.seniorLienRisk || 'NORMAL', enriched.seniorLienWarning || null,
        enriched.cashToClose ?? null, enriched.status || 'active'
      ];
      await this.pool.query(sql, params);
      return enriched; // camelCase, matches the in-memory return contract
    }

    const idx = this.inMemoryData.listings.findIndex(l => l.id === enriched.id);
    if (idx >= 0) {
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
           l.beds, l.baths, l.sqft, l.year_built AS "year",
           l.prop_type AS "propType",
           l.opening_bid::float8 AS "openingBid",
           l.est_low::float8 AS "estLow", l.est_high::float8 AS "estHigh",
           l.assessed_value::float8 AS "assessed",
           l.mid_value::float8 AS "mid",
           CASE WHEN (l.est_low + l.est_high) > 0
                THEN (l.opening_bid / ((l.est_low + l.est_high) / 2.0))::float8
                ELSE 0 END AS "ratio",
           l.equity_spread::float8 AS "equity",
           l.deal_score AS "dealScore",
           l.sale_date::text AS "saleDate",
           l.plaintiff, l.defendant, l.judgment_amount::float8 AS "judgment",
           l.attorney, l.occupancy, l.deposit_terms AS "deposit",
           l.photo_url AS "photo", l.source_url AS "sourceUrl",
           l.raw_notice AS "raw",
           l.redemption_days AS "redemptionDays",
           l.redemption_warning AS "redemptionWarning",
           l.senior_lien_risk AS "seniorLienRisk",
           l.senior_lien_warning AS "seniorLienWarning",
           l.cash_to_close::float8 AS "cashToClose",
           sd.notes, sd.created_at AS "savedAt"
         FROM saved_deals sd
         JOIN listings l ON sd.listing_id = l.id
         WHERE sd.user_id = $1
         ORDER BY l.sale_date ASC`,
        [userId]
      );
      return res.rows;
    }
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
