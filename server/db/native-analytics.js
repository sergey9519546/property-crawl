'use strict';

const { buildParcelKey, extractRawApn, extractCountyFips } = require('../scrapers/normalization');
const {
  LISTING_SELECT,
  SUMMARY_LISTING_SELECT,
  buildCompsCandidatesSql,
} = require('./listing-sql-constants');
const { mapPgListingRow } = require('./listing-normalizers');

/**
 * Database-native aggregation for /api/neighborhoods.
 * Prefers mv_neighborhood_stats when unfiltered at default 365-day window,
 * falling back to live CTE aggregation or in-memory scanning.
 */
async function getNeighborhoodStatsNative(client, options = {}) {
  if (!client.isPg || !client.pool) {
    const { scanAllListings } = require('./listings-scan');
    const { computeNeighborhoodStats } = require('../intelligence/neighborhood-stats');
    const filters = {};
    if (options.state) filters.state = options.state;
    const { pool, scanned, availableTotal, truncated } = await scanAllListings(client, filters);
    const stats = computeNeighborhoodStats(pool, options);
    const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(500, Math.floor(options.limit))) : 100;
    const { serializeBucket } = require('../routes/neighborhoods');
    const buckets = stats.slice(0, limit).map(serializeBucket);
    const bucketsTotal = stats.length;
    const listingsBucketed = stats.reduce((sum, b) => sum + b.count, 0);
    const listingsCovered = stats.slice(0, limit).reduce((sum, b) => sum + b.count, 0);
    return {
      scanned,
      availableTotal,
      truncated,
      bucketsTotal,
      bucketsReturned: buckets.length,
      bucketsTruncated: buckets.length < bucketsTotal,
      listingsBucketed,
      listingsCovered,
      listingsNotCovered: listingsBucketed - listingsCovered,
      rowsWithoutNeighborhoodKey: scanned - listingsBucketed,
      neighborhoods: buckets
    };
  }

  const maxAgeDays = Number.isFinite(options.maxAgeDays) ? options.maxAgeDays : 365;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const cutoffDate = new Date(nowMs - maxAgeDays * 86_400_000).toISOString();
  const stateFilter = options.state ? String(options.state).toUpperCase() : null;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(500, Math.floor(options.limit))) : 100;
  const pool = client.getReadPool();

  if (options.useMaterializedView !== false && !stateFilter && maxAgeDays === 365) {
    try {
      const mvRes = await pool.query(`
        SELECT * FROM mv_neighborhood_stats
        ORDER BY count DESC, label ASC
        LIMIT $1
      `, [limit]);
      if (mvRes && mvRes.rows && mvRes.rows.length > 0) {
        const metaRes = await pool.query(`
          SELECT
            COUNT(*)::int AS scanned,
            COUNT(*) FILTER (
              WHERE (zip IS NOT NULL AND TRIM(zip) != '')
                 OR (city IS NOT NULL AND TRIM(city) != '' AND state IS NOT NULL AND TRIM(state) != '')
            )::int AS listings_bucketed,
            COUNT(DISTINCT (
              CASE
                WHEN zip IS NOT NULL AND TRIM(zip) != '' THEN 'zip:' || SUBSTRING(TRIM(zip) FROM 1 FOR 5)
                WHEN city IS NOT NULL AND TRIM(city) != '' AND state IS NOT NULL AND TRIM(state) != ''
                  THEN 'city:' || UPPER(TRIM(state)) || '::' || LOWER(TRIM(city))
                ELSE NULL
              END
            )) FILTER (
              WHERE (zip IS NOT NULL AND TRIM(zip) != '')
                 OR (city IS NOT NULL AND TRIM(city) != '' AND state IS NOT NULL AND TRIM(state) != '')
            )::int AS buckets_total
          FROM listings
          WHERE (status IN ('active', 'scheduled', 'pending', 'unknown') OR status IS NULL)
            AND source_observed_at IS NOT NULL
            AND source_observed_at >= $1::timestamptz
        `, [cutoffDate]);

        const scanned = metaRes.rows[0]?.scanned || 0;
        const listingsBucketed = metaRes.rows[0]?.listings_bucketed || 0;
        const bucketsTotal = metaRes.rows[0]?.buckets_total || mvRes.rows.length;
        const neighborhoods = mvRes.rows.map((r) => ({
          kind: r.kind,
          key: r.key,
          label: r.label,
          count: Number(r.count),
          medianOpeningBid: r.medianOpeningBid === null ? null : Number(Number(r.medianOpeningBid).toFixed(2)),
          meanOpeningBid: r.meanOpeningBid === null ? null : Number(Number(r.meanOpeningBid).toFixed(2)),
          medianSqft: r.medianSqft === null ? null : Number(Number(r.medianSqft).toFixed(0)),
          medianDealScore: r.medianDealScore === null ? null : Number(Number(r.medianDealScore).toFixed(1)),
          medianDiscount: r.medianDiscount === null ? null : Number(Number(r.medianDiscount).toFixed(4)),
          sources: r.sources || {},
          propTypes: r.prop_types || {}
        }));
        return {
          truncated: false,
          scanned,
          availableTotal: scanned,
          bucketsTotal,
          bucketsReturned: neighborhoods.length,
          bucketsTruncated: neighborhoods.length < bucketsTotal,
          listingsBucketed,
          listingsCovered: neighborhoods.reduce((sum, b) => sum + b.count, 0),
          listingsNotCovered: listingsBucketed - neighborhoods.reduce((sum, b) => sum + b.count, 0),
          rowsWithoutNeighborhoodKey: scanned - listingsBucketed,
          neighborhoods
        };
      }
    } catch {
      // Fall back to live CTE query below
    }
  }

  const metaSql = `
    SELECT
      COUNT(*)::int AS scanned,
      COUNT(*) FILTER (
        WHERE (zip IS NOT NULL AND TRIM(zip) != '')
           OR (city IS NOT NULL AND TRIM(city) != '' AND state IS NOT NULL AND TRIM(state) != '')
      )::int AS listings_bucketed,
      COUNT(DISTINCT (
        CASE
          WHEN zip IS NOT NULL AND TRIM(zip) != '' THEN 'zip:' || SUBSTRING(TRIM(zip) FROM 1 FOR 5)
          WHEN city IS NOT NULL AND TRIM(city) != '' AND state IS NOT NULL AND TRIM(state) != ''
            THEN 'city:' || UPPER(TRIM(state)) || '::' || LOWER(TRIM(city))
          ELSE NULL
        END
      )) FILTER (
        WHERE (zip IS NOT NULL AND TRIM(zip) != '')
           OR (city IS NOT NULL AND TRIM(city) != '' AND state IS NOT NULL AND TRIM(state) != '')
      )::int AS buckets_total
    FROM listings
    WHERE (status IN ('active', 'scheduled', 'pending', 'unknown') OR status IS NULL)
      AND source_observed_at IS NOT NULL
      AND source_observed_at >= $1::timestamptz
      AND ($2::text IS NULL OR state = $2)
  `;
  const metaRes = await pool.query(metaSql, [cutoffDate, stateFilter]);
  const scanned = metaRes.rows[0]?.scanned || 0;
  const listingsBucketed = metaRes.rows[0]?.listings_bucketed || 0;
  const bucketsTotal = metaRes.rows[0]?.buckets_total || 0;

  const bucketsSql = `
    WITH base AS (
      SELECT
        id,
        source_key,
        prop_type,
        opening_bid,
        sqft,
        deal_score,
        est_low,
        est_high,
        CASE
          WHEN zip IS NOT NULL AND TRIM(zip) != '' THEN 'zip'
          WHEN city IS NOT NULL AND TRIM(city) != '' AND state IS NOT NULL AND TRIM(state) != '' THEN 'city'
          ELSE NULL
        END AS kind,
        CASE
          WHEN zip IS NOT NULL AND TRIM(zip) != '' THEN SUBSTRING(TRIM(zip) FROM 1 FOR 5)
          WHEN city IS NOT NULL AND TRIM(city) != '' AND state IS NOT NULL AND TRIM(state) != ''
            THEN CONCAT(UPPER(TRIM(state)), '::', LOWER(TRIM(city)))
          ELSE NULL
        END AS key,
        CASE
          WHEN zip IS NOT NULL AND TRIM(zip) != '' THEN SUBSTRING(TRIM(zip) FROM 1 FOR 5)
          WHEN city IS NOT NULL AND TRIM(city) != '' AND state IS NOT NULL AND TRIM(state) != ''
            THEN CONCAT(LOWER(TRIM(city)), ', ', UPPER(TRIM(state)))
          ELSE NULL
        END AS label
      FROM listings
      WHERE (status IN ('active', 'scheduled', 'pending', 'unknown') OR status IS NULL)
        AND source_observed_at IS NOT NULL
        AND source_observed_at >= $1::timestamptz
        AND ($2::text IS NULL OR state = $2)
    ),
    valid_buckets AS (
      SELECT * FROM base WHERE kind IS NOT NULL
    ),
    top_buckets AS (
      SELECT
        kind,
        key,
        label,
        COUNT(*)::int AS count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY opening_bid) FILTER (WHERE opening_bid > 0)::float8 AS "medianOpeningBid",
        AVG(opening_bid) FILTER (WHERE opening_bid > 0)::float8 AS "meanOpeningBid",
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sqft) FILTER (WHERE sqft > 0)::float8 AS "medianSqft",
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY deal_score) FILTER (WHERE opening_bid > 0 AND est_low > 0 AND est_high >= est_low AND deal_score IS NOT NULL)::float8 AS "medianDealScore",
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (1.0 - (opening_bid / ((est_low + est_high) / 2.0)))) FILTER (WHERE opening_bid > 0 AND est_low > 0 AND est_high >= est_low)::float8 AS "medianDiscount"
      FROM valid_buckets
      GROUP BY kind, key, label
      ORDER BY count DESC, label ASC
      LIMIT $3
    ),
    top_sources AS (
      SELECT
        tb.kind,
        tb.key,
        jsonb_object_agg(s.source_key, s.cnt) AS sources
      FROM top_buckets tb
      JOIN (
        SELECT vb.kind, vb.key, vb.source_key, COUNT(*)::int AS cnt
        FROM valid_buckets vb
        GROUP BY vb.kind, vb.key, vb.source_key
      ) s ON tb.kind = s.kind AND tb.key = s.key
      GROUP BY tb.kind, tb.key
    ),
    top_props AS (
      SELECT
        tb.kind,
        tb.key,
        jsonb_object_agg(coalesce(p.prop_type, 'Unknown'), p.cnt) AS prop_types
      FROM top_buckets tb
      JOIN (
        SELECT vb.kind, vb.key, vb.prop_type, COUNT(*)::int AS cnt
        FROM valid_buckets vb
        GROUP BY vb.kind, vb.key, vb.prop_type
      ) p ON tb.kind = p.kind AND tb.key = p.key
      GROUP BY tb.kind, tb.key
    )
    SELECT
      tb.*,
      coalesce(ts.sources, '{}'::jsonb) AS sources,
      coalesce(tp.prop_types, '{}'::jsonb) AS "propTypes"
    FROM top_buckets tb
    LEFT JOIN top_sources ts ON tb.kind = ts.kind AND tb.key = ts.key
    LEFT JOIN top_props tp ON tb.kind = tp.kind AND tb.key = tp.key
    ORDER BY tb.count DESC, tb.label ASC;
  `;
  const bucketsRes = await pool.query(bucketsSql, [cutoffDate, stateFilter, limit]);
  const { serializeBucket } = require('../routes/neighborhoods');
  const buckets = bucketsRes.rows.map(serializeBucket);
  const listingsCovered = buckets.reduce((sum, b) => sum + b.count, 0);

  return {
    scanned,
    availableTotal: scanned,
    truncated: false,
    bucketsTotal,
    bucketsReturned: buckets.length,
    bucketsTruncated: buckets.length < bucketsTotal,
    listingsBucketed,
    listingsCovered,
    listingsNotCovered: listingsBucketed - listingsCovered,
    rowsWithoutNeighborhoodKey: scanned - listingsBucketed,
    neighborhoods: buckets
  };
}

/**
 * Database-native lookup for a single neighborhood bucket (/api/neighborhoods/:kind/:key).
 * Queries only the specific matching zip or city records using B-tree indexes,
 * avoiding scanning 10,000+ national records.
 */
async function getSingleNeighborhoodStatsNative(client, kind, key, options = {}) {
  if (!client.isPg || !client.pool) {
    const { scanAllListings } = require('./listings-scan');
    const { getNeighborhoodStats } = require('../intelligence/neighborhood-stats');
    const { pool, scanned, availableTotal, truncated } = await scanAllListings(client, { summary: true });
    const bucket = getNeighborhoodStats(`${kind}:${key}`, pool, options);
    return bucket ? { scanned, availableTotal, truncated, neighborhood: bucket } : null;
  }

  const maxAgeDays = Number.isFinite(options.maxAgeDays) ? options.maxAgeDays : 365;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const cutoffDate = new Date(nowMs - maxAgeDays * 86_400_000).toISOString();

  let sql = `
    SELECT ${SUMMARY_LISTING_SELECT}
    FROM listings
    WHERE (status IN ('active', 'scheduled', 'pending', 'unknown') OR status IS NULL)
      AND source_observed_at IS NOT NULL
      AND source_observed_at >= $1::timestamptz
  `;
  const params = [cutoffDate];

  if (kind === 'zip') {
    sql += ` AND zip LIKE $2 || '%'`;
    params.push(key.trim());
  } else if (kind === 'city') {
    const parts = key.split('::');
    if (parts.length !== 2) return null;
    sql += ` AND (zip IS NULL OR TRIM(zip) = '') AND state = $2 AND LOWER(city) = $3`;
    params.push(parts[0].toUpperCase(), parts[1].toLowerCase());
  } else if (kind === 'county') {
    const m = String(key || '').trim().match(/^([A-Za-z]{2})(?:::|-)(.+)$/);
    if (!m) return null;
    const normCounty = m[2].trim().toLowerCase()
      .replace(/['’]/g, '')
      .replace(/\.+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+(?:county|parish|borough)$/, '')
      .trim();
    if (!normCounty) return null;
    sql += ` AND state = $2 AND btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(county,'')), '[''’]', '', 'g'), '\\.+', ' ', 'g'), '\\s+(county|parish|borough)\\s*$', '')) = $3`;
    params.push(m[1].toUpperCase(), normCounty);
  } else {
    return null;
  }

  const pool = client.getReadPool();

  if (options.useMaterializedView !== false && maxAgeDays === 365) {
    try {
      const [mvRes, countRes] = await Promise.all([
        pool.query(`
          SELECT * FROM mv_neighborhood_stats
          WHERE kind = $1 AND key = $2
          LIMIT 1
        `, [kind, key]),
        pool.query(`SELECT COUNT(*)::int AS count FROM listings WHERE (status IN ('active', 'scheduled', 'pending', 'unknown') OR status IS NULL)`)
      ]);
      if (mvRes && mvRes.rows && mvRes.rows.length > 0) {
        const r = mvRes.rows[0];
        const totalAvailable = countRes.rows[0]?.count || 1;
        return {
          scanned: totalAvailable,
          availableTotal: totalAvailable,
          truncated: false,
          neighborhood: {
            kind: r.kind,
            key: r.key,
            label: r.label,
            count: Number(r.count),
            medianOpeningBid: r.medianOpeningBid === null ? null : Number(Number(r.medianOpeningBid).toFixed(2)),
            meanOpeningBid: r.meanOpeningBid === null ? null : Number(Number(r.meanOpeningBid).toFixed(2)),
            medianSqft: r.medianSqft === null ? null : Number(Number(r.medianSqft).toFixed(0)),
            medianDealScore: r.medianDealScore === null ? null : Number(Number(r.medianDealScore).toFixed(1)),
            medianDiscount: r.medianDiscount === null ? null : Number(Number(r.medianDiscount).toFixed(4)),
            sources: r.sources || {},
            propTypes: r.prop_types || {}
          }
        };
      }
    } catch {
      // Fall back to live single neighborhood query
    }
  }

  const [rowsRes, countRes] = await Promise.all([
    pool.query(sql, params),
    pool.query(`SELECT COUNT(*)::int AS count FROM listings WHERE (status IN ('active', 'scheduled', 'pending', 'unknown') OR status IS NULL)`)
  ]);

  const rows = rowsRes.rows.map(mapPgListingRow);
  const { getNeighborhoodStats } = require('../intelligence/neighborhood-stats');
  const bucket = getNeighborhoodStats(`${kind}:${key}`, rows, options);
  if (!bucket) return null;

  const totalAvailable = countRes.rows[0]?.count || rows.length;
  return {
    scanned: totalAvailable,
    availableTotal: totalAvailable,
    truncated: false,
    neighborhood: bucket
  };
}

/**
 * Database-native aggregation for /api/auction-calendar.
 * Leverages DATE_TRUNC('week', sale_date) and PERCENTILE_CONT directly in Postgres,
 * returning grouped weeks with sample preview listings in ~15ms.
 */
async function getAuctionCalendarNative(client, options = {}) {
  if (!client.isPg || !client.pool) {
    const { scanAllListings } = require('./listings-scan');
    const { buildAuctionCalendar } = require('../intelligence/auction-calendar');
    const { pool, scanned, availableTotal, truncated } = await scanAllListings(client, { summary: true });
    const result = buildAuctionCalendar(pool, options);
    return {
      startMs: result.startMs,
      endMs: result.endMs,
      scanned,
      availableTotal,
      truncated,
      dropped: {
        noDate: result.droppedNoDate,
        outsideWindow: result.droppedOutside,
        stateFilter: result.droppedState
      },
      weeks: result.weeks
    };
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const windowDays = Number.isFinite(options.windowDays) ? Math.max(1, options.windowDays) : 60;
  const startMs = Number.isFinite(options.startMs) ? options.startMs : nowMs;
  const endMs = Number.isFinite(options.endMs) ? options.endMs : (startMs + windowDays * 86_400_000);
  const startDate = new Date(startMs).toISOString().slice(0, 10);
  const endDate = new Date(endMs).toISOString().slice(0, 10);
  const states = Array.isArray(options.states) && options.states.length
    ? options.states.map((s) => String(s).toUpperCase())
    : null;
  const sampleSize = Number.isFinite(options.sampleSize) ? Math.max(1, Math.min(10, options.sampleSize)) : 3;

  const metaSql = `
    SELECT
      COUNT(*)::int AS scanned,
      COUNT(*) FILTER (WHERE sale_date IS NULL)::int AS dropped_no_date,
      COUNT(*) FILTER (WHERE sale_date IS NOT NULL AND (sale_date < $1::date OR sale_date > $2::date))::int AS dropped_outside,
      COUNT(*) FILTER (WHERE sale_date IS NOT NULL AND sale_date >= $1::date AND sale_date <= $2::date AND ($3::text[] IS NOT NULL AND (state IS NULL OR NOT (state = ANY($3::text[])))))::int AS dropped_state
    FROM listings
    WHERE COALESCE(status, 'unknown') NOT IN ('sold', 'closed', 'cancelled');
  `;
  const pool = client.getReadPool();
  const metaRes = await pool.query(metaSql, [startDate, endDate, states]);
  const scanned = metaRes.rows[0]?.scanned || 0;
  const droppedNoDate = metaRes.rows[0]?.dropped_no_date || 0;
  const droppedOutside = metaRes.rows[0]?.dropped_outside || 0;
  const droppedState = metaRes.rows[0]?.dropped_state || 0;

  const weeksSql = `
    WITH in_scope AS (
      SELECT
        id,
        address,
        city,
        state,
        opening_bid,
        est_low,
        est_high,
        deal_score,
        prop_type,
        source_key,
        sale_date,
        DATE_TRUNC('week', sale_date::timestamp) AT TIME ZONE 'UTC' AS week_start,
        ROW_NUMBER() OVER(
          PARTITION BY DATE_TRUNC('week', sale_date::timestamp)
          ORDER BY sale_date ASC, deal_score DESC NULLS LAST, id ASC
        ) AS rn
      FROM listings
      WHERE COALESCE(status, 'unknown') NOT IN ('sold', 'closed', 'cancelled')
        AND sale_date IS NOT NULL
        AND sale_date >= $1::date
        AND sale_date <= $2::date
        AND ($3::text[] IS NULL OR state = ANY($3::text[]))
    ),
    week_sources AS (
      SELECT week_start, jsonb_object_agg(source_key, cnt) AS sources
      FROM (
        SELECT week_start, source_key, count(*)::int AS cnt
        FROM in_scope
        GROUP BY week_start, source_key
      ) s
      GROUP BY week_start
    ),
    week_props AS (
      SELECT week_start, jsonb_object_agg(coalesce(prop_type, 'Unknown'), cnt) AS prop_types
      FROM (
        SELECT week_start, prop_type, count(*)::int AS cnt
        FROM in_scope
        GROUP BY week_start, prop_type
      ) p
      GROUP BY week_start
    ),
    week_samples AS (
      SELECT
        week_start,
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'source', source_key,
            'address', address,
            'city', city,
            'state', state,
            'openingBid', opening_bid::float8,
            'mid', CASE WHEN est_low > 0 AND est_high >= est_low THEN ((est_low + est_high) / 2.0)::float8 ELSE NULL END,
            'dealScore', deal_score,
            'propType', coalesce(prop_type, 'Unknown'),
            'saleDate', sale_date::text
          )
          ORDER BY rn
        ) AS sample
      FROM in_scope
      WHERE rn <= $4
      GROUP BY week_start
    )
    SELECT
      w.week_start,
      COUNT(*)::int AS count,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY w.opening_bid) FILTER (WHERE w.opening_bid > 0)::float8 AS "medianOpeningBid",
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY w.deal_score) FILTER (WHERE w.deal_score IS NOT NULL)::float8 AS "medianDealScore",
      coalesce(ws.sources, '{}'::jsonb) AS sources,
      coalesce(wp.prop_types, '{}'::jsonb) AS "propTypes",
      coalesce(samp.sample, '[]'::jsonb) AS sample
    FROM in_scope w
    LEFT JOIN week_sources ws ON w.week_start = ws.week_start
    LEFT JOIN week_props wp ON w.week_start = wp.week_start
    LEFT JOIN week_samples samp ON w.week_start = samp.week_start
    GROUP BY w.week_start, ws.sources, wp.prop_types, samp.sample
    ORDER BY w.week_start ASC;
  `;
  const weeksRes = await pool.query(weeksSql, [startDate, endDate, states, sampleSize]);

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function formatWeekLabel(date) {
    const start = new Date(date);
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const startMonth = MONTHS[start.getUTCMonth()];
    const endMonth = MONTHS[end.getUTCMonth()];
    const startDay = start.getUTCDate();
    const endDay = end.getUTCDate();
    if (startMonth === endMonth) return `${startMonth} ${startDay}–${endDay}`;
    return `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
  }

  const weeks = weeksRes.rows.map((row) => ({
    weekStart: new Date(row.week_start).toISOString(),
    weekLabel: formatWeekLabel(row.week_start),
    count: row.count,
    medianOpeningBid: row.medianOpeningBid !== null ? Number(row.medianOpeningBid.toFixed(2)) : null,
    medianDealScore: row.medianDealScore !== null ? Math.round(row.medianDealScore) : null,
    sources: row.sources || {},
    propTypes: row.propTypes || {},
    sample: row.sample || []
  }));

  const auctionsInWindow = weeks.reduce((sum, w) => sum + w.count, 0);

  return {
    startMs,
    endMs,
    scanned,
    availableTotal: scanned,
    truncated: false,
    auctionsInWindow,
    dropped: {
      noDate: droppedNoDate,
      outsideWindow: droppedOutside,
      stateFilter: droppedState
    },
    weeks
  };
}

/**
 * Database-native aggregation for /api/source-network.
 * Computes per-source observed counts, active states, and latest observation timestamps
 * via a single GROUP BY query in ~3ms.
 */
async function getSourceInventoryAggregatesNative(client) {
  if (!client.isPg || !client.pool) {
    if (typeof client.refreshLiveCache === 'function') {
      client.refreshLiveCache();
    }
    const counts = new Map();
    const rows = (client.inMemoryData && Array.isArray(client.inMemoryData.listings)) ? client.inMemoryData.listings : [];
    for (const listing of rows) {
      if (!listing.source) continue;
      const entry = counts.get(listing.source) || { observedRecords: 0, latestObservation: null, states: new Set() };
      entry.observedRecords++;
      if (listing.state) entry.states.add(listing.state);
      const time = listing.sourceObservedAt || listing.provenance?.observedAt;
      if (time && (!entry.latestObservation || Date.parse(time) > Date.parse(entry.latestObservation))) {
        entry.latestObservation = time;
      }
      counts.set(listing.source, entry);
    }
    return counts;
  }

  const sql = `
    SELECT
      source_key AS source,
      COUNT(*)::int AS "observedRecords",
      ARRAY_AGG(DISTINCT state ORDER BY state) FILTER (WHERE state IS NOT NULL AND state != '') AS states,
      MAX(source_observed_at)::text AS "latestObservation"
    FROM listings
    WHERE (status IN ('active', 'scheduled', 'pending', 'unknown') OR status IS NULL)
      AND (provenance IS NULL OR provenance->>'origin' IN ('live', 'email_notice'))
    GROUP BY source_key;
  `;
  const res = await client.getReadPool().query(sql);
  const counts = new Map();
  for (const row of res.rows) {
    counts.set(row.source, {
      observedRecords: row.observedRecords,
      latestObservation: row.latestObservation,
      states: new Set(row.states || [])
    });
  }
  return counts;
}

/**
 * Database-native geospatial bounding-box retrieval for /api/watchlist/:id/comps.
 * Restricts candidate fetching to properties within radiusKm (or same state),
 * avoiding full-store scanning.
 */
async function getCompsCandidatesNative(client, target, options = {}) {
  if (!client.isPg || !client.pool || !target) {
    const { scanAllListings } = require('./listings-scan');
    return scanAllListings(client, { summary: true });
  }

  const radiusKm = Number.isFinite(options.radiusKm) ? options.radiusKm : 8;

  if (typeof target.lat === 'number' && typeof target.lng === 'number') {
    const radiusMeters = radiusKm * 1000.0;
    const latDelta = radiusKm / 111.0;
    const latRad = (target.lat * Math.PI) / 180.0;
    const lngDelta = radiusKm / (111.0 * Math.max(0.1, Math.cos(latRad)));

    const params = [
      target.lng,
      target.lat,
      radiusMeters,
      target.lat - latDelta,
      target.lat + latDelta,
      target.lng - lngDelta,
      target.lng + lngDelta
    ];
    let idCondition = '';
    if (target.id) {
      params.push(String(target.id));
      idCondition = 'AND id != $' + params.length;
    }

    const sql = buildCompsCandidatesSql({ idCondition });
    const res = await client.getReadPool().query(sql, params);

    if (res.rows.length > 0) {
      const rows = res.rows.map(mapPgListingRow);
      return {
        pool: rows,
        scanned: rows.length,
        availableTotal: rows.length,
        truncated: false
      };
    }
  }

  // Fallback: state-scoped candidate retrieval
  if (target.state) {
    const params = [String(target.state).toUpperCase()];
    let idCondition = '';
    if (target.id) {
      params.push(String(target.id));
      idCondition = 'AND id != $' + params.length;
    }
    const stateSql = `
      SELECT ${SUMMARY_LISTING_SELECT}
      FROM listings
      WHERE (status IN ('active', 'scheduled', 'pending', 'unknown') OR status IS NULL)
        AND state = $1
        ${idCondition}
      ORDER BY id ASC
      LIMIT 500;
    `;
    const res = await client.getReadPool().query(stateSql, params);
    const rows = res.rows.map(mapPgListingRow);
    return {
      pool: rows,
      scanned: rows.length,
      availableTotal: rows.length,
      truncated: false
    };
  }

  const { scanAllListings } = require('./listings-scan');
  return scanAllListings(client, { summary: true });
}

/**
 * Database-native lookup for listings matching a parcelKey.
 * Avoids scanning 100,000 listings into memory when looking up a specific parcel.
 */
async function getListingsByParcelKeyNative(client, parcelKey) {
  const key = typeof parcelKey === 'string' ? parcelKey.trim() : '';
  const fipsMatch = key.match(/^(\d{5})-(.+)$/);
  const fips5 = fipsMatch ? fipsMatch[1] : null;
  const rawApnPart = fipsMatch ? fipsMatch[2] : key;
  const cleanApn = rawApnPart.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;

  if (!client.isPg || !client.pool || !key) {
    if (!key) return [];
    const { scanAllListings } = require('./listings-scan');
    const { pool } = await scanAllListings(client, {}, { pageSize: 100000 });
    return pool.filter((listing) => {
      if (!listing) return false;
      if (listing.parcelKey === key || listing.provenance?.parcelKey === key) return true;
      const derivedKey = buildParcelKey({
        apn: extractRawApn(listing),
        countyFips: extractCountyFips(listing),
      });
      return derivedKey === key;
    });
  }

  const sql = `
    SELECT ${LISTING_SELECT}
    FROM listings
    WHERE (
        provenance->>'parcelKey' = $1
        OR (state = split_part($1, ':', 1) AND id = $1)
        OR (
          $2::text IS NOT NULL AND $3::text IS NOT NULL
          AND COALESCE(
            provenance->'derivedFields'->'assessorRoll'->'parcel'->>'countyFips',
            provenance->>'countyFips',
            provenance->'sourceFacts'->>'countyFips',
            ''
          ) = $2
          AND (
            UPPER(regexp_replace(COALESCE(provenance->'derivedFields'->'assessorRoll'->'parcel'->>'canonicalApn', ''), '[^A-Za-z0-9]', '', 'g')) = $3
            OR UPPER(regexp_replace(COALESCE(provenance->'derivedFields'->'assessorRoll'->>'apn', ''), '[^A-Za-z0-9]', '', 'g')) = $3
            OR UPPER(regexp_replace(COALESCE(provenance->'derivedFields'->'assessorRoll'->'parcel'->>'rawApn', ''), '[^A-Za-z0-9]', '', 'g')) = $3
            OR UPPER(regexp_replace(COALESCE(provenance->'sourceFacts'->>'apn', ''), '[^A-Za-z0-9]', '', 'g')) = $3
            OR UPPER(regexp_replace(COALESCE(provenance->>'parcelNumber', ''), '[^A-Za-z0-9]', '', 'g')) = $3
          )
        )
      )
    ORDER BY id ASC;
  `;
  const res = await client.getReadPool().query(sql, [key, fips5, cleanApn]);
  return res.rows.map(mapPgListingRow);
}

module.exports = {
  getNeighborhoodStatsNative,
  getSingleNeighborhoodStatsNative,
  getAuctionCalendarNative,
  getSourceInventoryAggregatesNative,
  getCompsCandidatesNative,
  getListingsByParcelKeyNative,
};
