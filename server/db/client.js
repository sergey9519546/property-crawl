const fs = require('fs');
const path = require('path');
const { randomUUID: cryptoRandomUUID } = require('crypto');
const { seedProvenance } = require('./seed-provenance');
const { loadLiveRecords } = require('./live-record-store');
const { createAiCacheStore } = require('./ai-cache-store');
const { buildParcelKey, extractRawApn, extractCountyFips } = require('../scrapers/normalization');
const { computeCatchSummary } = require('../intelligence/catch-summary');
const { resolveStateQuery } = require('./us-state-query');
// Listing-admission gate (server/sources/catalog.js): a DISCOVERY_ONLY
// catalog source is discovery evidence, never an actionable sale listing.
// The catalog is the single source of truth; import the gate, never re-derive it.
const { servesListings, listingServingSourceSqlList } = require('../sources/catalog');
const { resolveDatabaseTarget } = require('./database-target');
const { queryWithStatementTimeout } = require('./observations-persistence');
const {
  LISTING_SELECT,
  SUMMARY_LISTING_SELECT,
  NORMALIZE_ADDR_SQL,
  SAME_ADDRESS_ON_CONFLICT_SQL,
  PROVENANCE_UPSERT_SQL,
  TRIAGE_PRIORITY_STALE_DAYS,
  ACCELERATED_LISTINGS_COLUMNS,
  buildCompsCandidatesSql,
} = require('./listing-sql-constants');
const {
  ALERT_MATCHES_DEFAULT_LIMIT,
  ALERT_MATCHES_MAX_LIMIT,
  finiteOrNull,
  clampAlertMatchesLimit,
  sameNormalizedListingAddress,
  optionalFiniteNumber,
  normalizeGeocode,
  isoOrNull,
  mapPgListingRow,
  normalizeTimestamp,
  normalizeDate,
  optionalText,
  canonicalStatus,
  normalizeProvenance,
  normalizeCashToCloseDetails,
  prepareListingForPersistence,
  mergeListingForInMemoryUpsert,
  compareNumbersUnknownLast,
  computeBakeOff,
  applyCrossSourceBakeOff,
  isFiniteTime,
} = require('./listing-normalizers');
const nativeAnalytics = require('./native-analytics');
const workspacePersistence = require('./workspace-persistence');
const listingReconciliation = require('./listing-reconciliation');
const { purgeStaleListings: purgeStaleListingsFromDb } = require('./listing-purge');

// Shared with live-record-store so read-only consumers and the DB client can
// never disagree about which file is the live record store.
const DEFAULT_LIVE_CACHE_PATH = require('./live-record-store').DEFAULT_LIVE_STORE_PATH;
const DEFAULT_WORKSPACE_STORE_PATH = path.resolve(__dirname, '../../.cache/workspace-store.json');
const WORKSPACE_STORE_VERSION = 1;

// A canonical STATE-COUNTY-NUMBER id (e.g. "OH-CUY-10231") is an unambiguous
// alias for the source-namespaced record "SHERIFF-OH-CUY-10231". It is resolved
// only when exactly one record matches - never a partial or numeric fragment.
//
// Note this alias is currently inert: real listing ids are source-prefixed with
// prefixes of 4+ characters (USDA-MS-6274, TRSY-27-66-804), and the first
// segment below allows only 2-3, so it matches 0 of the 2094 ids in data.js.
// Nothing passes a STATE-COUNTY-NUMBER form, so no lookup is mishandled - but do
// not assume the alias works. test/db/listing-id-alias.test.js pins this, and
// any widening must keep the exact-match and single-result requirements so
// getListingById('1') can never match a listing ending in "-1".
const NAMESPACED_ID = /^[A-Z]{2,3}-[A-Z]{2,3}-\d{2,6}$/;

// The collector's own cadence is six hours. Four missed cycles is a full day
// without a new observation, at which point nothing in the table can still be
// called current - and "still active" is exactly the claim a buyer makes.
const DEFAULT_STALE_AFTER_HOURS = 24;
const ACCELERATION_CACHE = new WeakMap();

/**
 * How old is the inventory, and is that old enough to matter?
 *
 * This is deliberately NOT used to delete anything. A record being stale says
 * the collector has not run; it does not say the opportunity passed. It is a
 * separate, reportable fact - the whole store can be one cycle behind while
 * every row in it is still live.
 */
class DatabaseClient {
  constructor(options = {}) {
    this.env = options.env || (options.PROPERTY_INVENTORY_BACKEND || options.NODE_ENV ? { ...process.env, ...(options.PROPERTY_INVENTORY_BACKEND ? { PROPERTY_INVENTORY_BACKEND: options.PROPERTY_INVENTORY_BACKEND } : {}), ...(options.NODE_ENV ? { NODE_ENV: options.NODE_ENV } : {}) } : process.env);
    this.isPg = Boolean(options.pool);
    this.pool = options.pool || null;
    this.externalPool = Boolean(options.pool);
    this.readPool = options.readPool || null;
    this.listingSelect = LISTING_SELECT;
    this.summaryListingSelect = SUMMARY_LISTING_SELECT;
    const explicitLiveCachePath = Object.prototype.hasOwnProperty.call(options, 'liveCachePath')
      ? options.liveCachePath
      : this.env.PROPERTY_LIVE_CACHE_PATH;
    const testMode = this.env.NODE_ENV === 'test' || /^test(?::|$)/.test(this.env.npm_lifecycle_event || '');
    this.liveCachePath = explicitLiveCachePath
      ? path.resolve(explicitLiveCachePath)
      : (explicitLiveCachePath === null || testMode ? null : DEFAULT_LIVE_CACHE_PATH);

    // Workspace store: file-backed persistence for saved searches + alert matches
    // in dev mode (DATABASE_URL unset). Disabled in tests or when explicitly set to null.
    const explicitWorkspaceStorePath = Object.prototype.hasOwnProperty.call(options, 'workspaceStorePath')
      ? options.workspaceStorePath
      : this.env.PROPERTY_WORKSPACE_STORE_PATH;
    this.workspaceStorePath = explicitWorkspaceStorePath
      ? path.resolve(explicitWorkspaceStorePath)
      : (explicitWorkspaceStorePath === null || testMode ? null : DEFAULT_WORKSPACE_STORE_PATH);
    this._workspaceStoreLoaded = false;
    this._workspaceStoreDirty = false;

    this.liveCacheSignature = null;
    this.liveCacheErrorSignature = null;
    // Set only after SELECT 1 succeeds. A Pool object is not a connection.
    this.postgresReachable = false;

    this.postgresError = null;
    this.inMemoryData = {
      sources: {},
      listings: [],
      savedDeals: new Map(), // userId -> Set of listingIds
      savedSearches: new Map(), // searchId -> { userId, label, filters, isActive, createdAt, updatedAt, lastRunAt, lastMatchCount }
      alertMatches: new Map(),   // matchId -> { searchId, userId, listingId, matchedAt, readAt }
      // listingHistory: listingId -> array of { sourceObservedAt, openingBid, mid, dealScore, source }
      // Most-recent-first; the price-drop detector reads [0] as the prior snapshot.
      listingHistory: new Map(),
      aiCache: new Map(),    // hash -> cached object
      logs: []
    };
    // The AI cache aggregate lives behind its own seam. isPg and pool are read
    // through accessors on purpose: init() forces isPg false, verifyConnection()
    // flips it true once Postgres answers, and tests assign db.isPg / db.pool
    // directly. The store therefore sees every backend switch, as the inline
    // branches it replaced did.
    const self = this;
    this.aiCacheStore = createAiCacheStore({
      get isPg() { return self.isPg; },
      get pool() { return self.pool; },
      seed: this.inMemoryData.aiCache,
    });
    this._activeWebQueries = 0;
    this._webDrainWaiters = [];
    this._activeBgDbTasks = 0;
    this._bgDbWaiters = [];
    const isRenderHosted = String(this.env.RENDER || '').toLowerCase() === 'true'
      || Boolean(this.env.RENDER_SERVICE_ID);
    this._maxBgDbConcurrency = Math.max(
      1,
      Math.min(4, Number.parseInt(this.env.DATABASE_BG_MAX || (isRenderHosted ? '1' : '2'), 10) || 1),
    );
    this.init();
  }

  init() {
    if (this.externalPool) return;
    // Embedded Postgres starts asynchronously and attachPostgres() replaces
    // this pool. Off Render, an explicit embedded request must not also dial
    // DATABASE_URL: local env names a localhost server that is not running.
    // On Render the external URL is the live inventory, so it wins. See
    // database-target.js.
    const target = resolveDatabaseTarget(this.env);
    if (this.env.DISCOVERY_MODE === 'advanced' && target === 'missing') {
      throw new Error('DISCOVERY_MODE=advanced requires DATABASE_URL');
    }
    if (target === 'tcp') {
      const isServerlessHosted = Boolean(
        this.env.VERCEL || this.env.AWS_LAMBDA_FUNCTION_NAME || this.env.SERVERLESS
      );
      const isRenderHosted = String(this.env.RENDER || '').toLowerCase() === 'true'
        || Boolean(this.env.RENDER_SERVICE_ID);
      const isPgBouncerPooler = /:6543(?:\/|\?|$)/.test(String(this.env.DATABASE_URL || ''));
      const configuredMax = Number(this.env.DATABASE_POOL_MAX);
      const poolMax = Number.isInteger(configuredMax) && configuredMax > 0
        ? Math.min(configuredMax, 50)
        : (isServerlessHosted ? 2 : (isRenderHosted ? 4 : 10));
      const configuredConnectTimeout = Number(this.env.DATABASE_CONNECTION_TIMEOUT_MS);
      const connectionTimeoutMillis = Number.isFinite(configuredConnectTimeout) && configuredConnectTimeout > 0
        ? Math.min(configuredConnectTimeout, 60_000)
        : 12_000;
      const configuredStatementTimeout = Number(this.env.DATABASE_STATEMENT_TIMEOUT_MS);
      const statementTimeoutMs = Number.isFinite(configuredStatementTimeout) && configuredStatementTimeout >= 0
        ? Math.min(Math.trunc(configuredStatementTimeout), 120_000)
        : 30_000;
      const idleTimeoutMillis = isServerlessHosted ? 5000 : (isRenderHosted ? 15000 : 60000);
      const statementTimeoutOpt = (statementTimeoutMs > 0 && !isServerlessHosted && !isPgBouncerPooler)
        ? { statement_timeout: statementTimeoutMs }
        : {};
      try {
        const { Pool } = require('pg');
        this.pool = new Pool({
          connectionString: this.env.DATABASE_URL,
          max: poolMax,
          idleTimeoutMillis,
          connectionTimeoutMillis,
          keepAlive: true,
          ...statementTimeoutOpt,
        });
        this.pool.on('error', (err) => {
          console.error('[db] Idle PostgreSQL client error:', err?.message || err);
        });
        // Do not claim postgres until a query succeeds. Pool construction
        // does not open a socket.
        this.isPg = false;
        this.postgresReachable = false;
      } catch (err) {
        if (this.env.DISCOVERY_MODE === 'advanced') throw new Error(`Advanced discovery PostgreSQL initialization failed: ${err.message}`);
        console.warn('[DB] PostgreSQL driver not initialized, using resilient in-memory provider:', err.message);
        this.pool = null;
        this.isPg = false;
        this.postgresError = err.message;
      }

      const roUrl = this.env.DATABASE_RO_URL || this.env.DATABASE_READ_URL || null;
      if (roUrl && !this.readPool) {
        const configuredRoMax = Number(this.env.DATABASE_RO_POOL_MAX);
        const roPoolMax = Number.isInteger(configuredRoMax) && configuredRoMax > 0
          ? Math.min(configuredRoMax, 50)
          : poolMax;
        try {
          const { Pool } = require('pg');
          this.readPool = new Pool({
            connectionString: roUrl,
            max: roPoolMax,
            idleTimeoutMillis: 60000,
            connectionTimeoutMillis,
            keepAlive: true,
            ...statementTimeoutOpt,
          });
        } catch (err) {
          console.warn('[DB] PostgreSQL read-replica driver not initialized, using primary pool:', err.message);
          this.readPool = null;
        }
      }
    }

    if (!this.isPg) {
      this._loadWorkspaceStore();
      // There is no runtime in-memory inventory. A listing served from a seeded
      // JS array is not a listing: it looks current, scores like a real one and
      // cannot be traced to an observation. So the provider below is reachable
      // only when a caller asks for it explicitly - tests do; the runtime does
      // not. With no database configured, dataMode() is 'unavailable' and the
      // listing routes say so instead of inventing an answer.
      if (this.memoryInventoryRequested()) {
        this.seedInMemory();
      }
    }
  }

  /**
   * Adopt a PostgreSQL pool that something else built. Used by the embedded
   * engine, which has to start asynchronously and so cannot be built inside the
   * synchronous constructor.
   */
  attachPostgres(pool, engine = 'postgres') {
    if (!pool) throw new Error('attachPostgres requires a pool');
    this.pool = pool;
    this.isPg = true;
    this.externalPool = true;
    this.postgresReachable = false;
    this.postgresError = null;
    this.postgresEngine = engine;
  }

  /**
   * Prove the configured Postgres URL answers a query. On failure, drop the
   * unused pool and report the reason. There is deliberately nothing to fall
   * back to: a dead DATABASE_URL used to keep serving seeded in-memory
   * inventory so the public listing API would not 503, which meant a broken
   * database was indistinguishable from a working one that happened to hold
   * those rows. Now the API reports the outage instead. Advanced discovery
   * still fail-closes.
   */
  async verifyConnection() {
    if (!this.pool) {
      this.postgresReachable = false;
      this.isPg = false;
      return false;
    }
    let client;
    try {
      client = await this.pool.connect();
      await client.query('SELECT 1');
      this.postgresReachable = true;
      this.isPg = true;
      this.postgresError = null;
      if (this.readPool) {
        try {
          await this.readPool.query('SELECT 1');
        } catch (roErr) {
          console.warn('[DB] Read-replica pool unreachable, falling back to primary pool:', roErr.message);
          const dead = this.readPool;
          this.readPool = null;
          dead.end().catch(() => {});
        }
      }
      console.log('[DB] PostgreSQL connection verified');
      return true;
    } catch (err) {
      this.postgresReachable = false;
      this.isPg = false;
      this.postgresError = String(err && err.message ? err.message : err).slice(0, 240);
      const advanced = this.env.DISCOVERY_MODE === 'advanced';
      if (!advanced) {
        const dead = this.pool;
        this.pool = null;
        dead.end().catch(() => {});
        console.warn('[DB] PostgreSQL unreachable; no inventory will be served:', this.postgresError);
      } else {
        console.error('[DB] Advanced discovery PostgreSQL is unreachable:', this.postgresError);
      }
      return false;
    } finally {
      if (client) client.release();
    }
  }

  async hasAcceleratedDiscovery({ forceRefresh = false } = {}) {
    if (!this.isPg || !this.pool) return false;
    const pool = typeof this.getReadPool === 'function' ? (this.getReadPool() || this.pool) : this.pool;
    if (!forceRefresh && ACCELERATION_CACHE.has(pool)) {
      const cached = ACCELERATION_CACHE.get(pool);
      this.hasDiscoveryAcceleration = cached;
      return cached;
    }
    try {
      const result = await pool.query(
        `SELECT count(*)::int AS n, (to_regclass(quote_ident(current_schema()) || '.idx_listings_discovery_search_text_trgm') IS NOT NULL) AS idx_ready
           FROM pg_attribute a
           -- direct attrelid lookup avoids 3-table catalog join on throttled Postgres
           -- catalog schema scoped via current_schema() below
          WHERE a.attrelid = to_regclass(quote_ident(current_schema()) || '.listings')
            -- OID matched above without pg_class scan
            AND a.attname = ANY($1::text[])
            AND a.attnum > 0
            AND NOT a.attisdropped`,
        [ACCELERATED_LISTINGS_COLUMNS],
      );
      const ready = Number(result.rows[0]?.n || 0) === ACCELERATED_LISTINGS_COLUMNS.length && Boolean(result.rows[0]?.idx_ready);
      ACCELERATION_CACHE.set(pool, ready);
      if (this.pool && this.pool !== pool) ACCELERATION_CACHE.set(this.pool, ready);
      this.hasDiscoveryAcceleration = ready;
      return ready;
    } catch {
      return false;
    }
  }

  dataMode() {
    // 'demo' is gone. There is no state in which seeded in-memory inventory is
    // the product. 'memory' is reachable only by an explicit declaration, and
    // 'unavailable' means what it says: nothing is being served.
    if (this.isPg && this.postgresReachable) return 'postgres';
    return this.memoryInventoryRequested() ? 'memory' : 'unavailable';
  }

  async transaction(fn) {
    if (!this.isPg || !this.pool) {
      throw new Error("DatabaseClient.transaction requires a PostgreSQL pool");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
        // Best-effort rollback; the connection may already be dead.
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * How much of the inventory is stale, and how stale is the rest?
   *
   * Reported, never acted on. Stale means the collector has not observed a
   * listing recently; it does not mean the opportunity passed. Deleting on age
   * would throw away live auctions, and the prune rule already refuses to.
   *
   * Freshness is a COVERAGE question, not a max(). Collection is deliberately
   * bounded - one page per sweep, resumed by continuation token - so a single
   * successful sweep makes `max(source_observed_at)` seconds old while the
   * other 6,500 rows are three weeks old. Deriving `stale` from the newest row
   * would then report "fresh" on a sweep that refreshed a rounding error, which
   * is worse than reporting nothing. So `freshListings` is reported alongside,
   * and `stale` is true unless every listed record sits inside the window.
   */
  async inventoryFreshness(now = Date.now(), options = {}) {
    const staleAfterHours = Number(this.env.PROPERTY_STALE_AFTER_HOURS) > 0
      ? Number(this.env.PROPERTY_STALE_AFTER_HOURS)
      : DEFAULT_STALE_AFTER_HOURS;
    const cutoffMs = now - staleAfterHours * 3_600_000;

    // A single flat window is wrong the moment sources declare different
    // cadences, which they do: ServiceLink publishes every 6h, fl-dor-cadastral
    // every 720h. Judging a 6h source against a 24h window hides a source that
    // has not been collected in a week, and that is exactly what happened - the
    // whole ServiceLink inventory sat at 689h old while the health endpoint
    // reported "296 of 7999 listings" stale, because those 296 were the only
    // ones past 24h. The per-record sourceFreshness in routes/listings.js
    // already respects each source's cadence; this aggregate disagreed with it.
    const cadences = options.cadences && typeof options.cadences === 'object'
      ? options.cadences : null;
    const cadenceHoursFor = (source) => {
      const declared = cadences && Number(cadences[source]);
      return Number.isFinite(declared) && declared > 0 ? declared : null;
    };

    let newest = null;
    let oldest = null;
    let count = null;
    let freshCount = null;
    let bySource = null;

    if (cadences) {
      // One query, per-source cutoffs. Still a COVERAGE question per source:
      // a sweep that refreshes one page must not make the source look fresh.
      const cutoffs = Object.keys(cadences)
        .map((source) => {
          const hours = cadenceHoursFor(source);
          return hours === null ? null : { source, cutoff: new Date(now - hours * 3_600_000).toISOString() };
        })
        .filter(Boolean);
      if (this.isPg && cutoffs.length) {
        // Pass the sources and their cutoffs as arrays and pair them with unnest,
        // rather than generating a VALUES list of placeholders. A generated
        // placeholder list has to be numbered exactly right for the extended
        // protocol and infers each value's type from its neighbours.
        //
        // One statement, one scan. The store-wide oldest has to come from each
        // source's OLDEST observation and then be minimised across sources.
        // Taking min() over the per-source NEWEST - which is what this did -
        // returns the least-recently-refreshed source's newest row, so the
        // reported "oldest" was a few hours old while the store held rows over a
        // month old. Live health answered 2026-10-06T07:34Z, which was exactly
        // HUD's newest record. On an endpoint whose stated job is "a database full
        // of rows is not the same claim as an inventory somebody checked today",
        // that understated the oldest data by weeks; the flat-window branch below
        // used a true min(), so the same field meant two different things
        // depending on which branch ran.
        //
        // The extra aggregate rides along in the grouped scan rather than as a
        // second pool.query or an uncorrelated subquery. Both were measured on
        // the same warm process against a 79ms baseline: a second round trip ran
        // 156ms and the subquery form 240ms, because a store-wide aggregate
        // re-scans this 46-column table and listings.source_observed_at has no
        // index. The data-mode banner fetches this endpoint on every page render,
        // so the per-source column is the only version that costs nothing.
        const res = await queryWithStatementTimeout(
          this.pool,
          `SELECT c.source::text AS source,
                  count(l.id)::int AS n,
                  count(l.id) FILTER (WHERE l.source_observed_at >= c.cutoff OR (l.discovery_terminal IS TRUE AND l.updated_at >= c.cutoff))::int AS fresh,
                  max(l.source_observed_at)::text AS newest,
                  min(l.source_observed_at)::text AS oldest
             FROM unnest($1::text[], $2::timestamptz[]) AS c(source, cutoff)
             LEFT JOIN listings l ON l.source_key = c.source
            GROUP BY c.source`,
          [cutoffs.map((entry) => entry.source), cutoffs.map((entry) => entry.cutoff)],
          8000,
        );
        const rows = res.rows.map((row) => ({
          source: row.source,
          listings: row.n,
          freshListings: row.fresh,
          cadenceHours: cadenceHoursFor(row.source),
          newestObservation: row.newest,
          stale: row.fresh < row.n,
        }));
        // A catalog source that holds nothing contributes no information to a
        // breakdown of the store, and this payload is polled by the data-mode
        // banner on every page render. LEFT JOINing the whole catalog put 152
        // empty rows into the response - 18KB of the 20.5KB, describing nothing.
        bySource = rows.filter((row) => row.listings > 0);
        count = rows.reduce((total, row) => total + row.listings, 0);
        freshCount = rows.reduce((total, row) => total + row.freshListings, 0);
        // The per-source minimum is read here rather than carried into bySource:
        // it exists to compute the store-wide oldest, and shipping it on every
        // row would put a field no consumer reads back into the polled payload.
        const oldestTimes = res.rows.map((row) => row.oldest).filter(isFiniteTime).map(Date.parse);
        if (oldestTimes.length) oldest = new Date(Math.min(...oldestTimes)).toISOString();
        const newestTimes = rows.map((row) => row.newestObservation).filter(isFiniteTime).map(Date.parse);
        if (newestTimes.length) newest = new Date(Math.max(...newestTimes)).toISOString();
      } else if (this.memoryInventoryRequested()) {
        bySource = Object.keys(cadences).map((source) => {
          const rows = this.inMemoryData.listings.filter((listing) => listing.source === source);
          const cutoff = now - cadenceHoursFor(source) * 3_600_000;
          const sortedTimes = rows.map((row) => row.sourceObservedAt).filter(isFiniteTime).sort();
          return {
            source,
            listings: rows.length,
            freshListings: rows.filter((row) => (isFiniteTime(row.sourceObservedAt) && Date.parse(row.sourceObservedAt) >= cutoff) || (isFiniteTime(row.provenance?.publisherAbsence?.at) && Date.parse(row.provenance.publisherAbsence.at) >= cutoff)).length,

            cadenceHours: cadenceHoursFor(source),
            newestObservation: sortedTimes[sortedTimes.length - 1] || null,
            stale: rows.some((row) => (!isFiniteTime(row.sourceObservedAt) || Date.parse(row.sourceObservedAt) < cutoff) && (!isFiniteTime(row.provenance?.publisherAbsence?.at) || Date.parse(row.provenance.publisherAbsence.at) < cutoff)),

          };
        }).filter((row) => row.listings > 0);
        // Count every stored listing, not only those whose source declared a
        // cadence, so both backends report the same population.
        count = this.inMemoryData.listings.length;
        freshCount = bySource.reduce((total, row) => total + row.freshListings, 0);
        const times = this.inMemoryData.listings.map((l) => l.sourceObservedAt)
          .filter(isFiniteTime).map(Date.parse);
        if (times.length) {
          oldest = new Date(Math.min(...times)).toISOString();
          newest = new Date(Math.max(...times)).toISOString();
        }
      }
    }

    if (count === null) {
      if (this.isPg) {
        const res = await this.pool.query(
          `SELECT count(*)::int AS n,
                  count(*) FILTER (WHERE source_observed_at >= $1::timestamptz OR (provenance->'publisherAbsence'->>'at')::timestamptz >= $1::timestamptz)::int AS fresh,
                  min(source_observed_at)::text AS oldest,
                  max(source_observed_at)::text AS newest
             FROM listings`,
          [new Date(cutoffMs).toISOString()]);
        count = res.rows[0].n;
        freshCount = res.rows[0].fresh;
        oldest = res.rows[0].oldest;
        newest = res.rows[0].newest;
      } else if (this.memoryInventoryRequested()) {
        const times = this.inMemoryData.listings
          .map(l => l.sourceObservedAt)
          .filter(isFiniteTime)
          .map(Date.parse);
        count = this.inMemoryData.listings.length;
        freshCount = this.inMemoryData.listings
          .filter(l => (isFiniteTime(l.sourceObservedAt) && Date.parse(l.sourceObservedAt) >= cutoffMs) || (isFiniteTime(l.provenance?.publisherAbsence?.at) && Date.parse(l.provenance.publisherAbsence.at) >= cutoffMs)).length;
        if (times.length) {
          oldest = new Date(Math.min(...times)).toISOString();
          newest = new Date(Math.max(...times)).toISOString();
        }
      }
    }

    const ageHours = isFiniteTime(newest) ? (now - Date.parse(newest)) / 3_600_000 : null;
    const known = count != null && freshCount != null;
    const stale = known && freshCount < count;
    // Name the sources that are actually behind, worst first. A single
    // "N of M listings" line hides which publisher stopped being collected,
    // which is the only part an operator can act on.
    const laggingSources = bySource
      ? bySource.filter((row) => row.stale).sort((a, b) => b.listings - a.listings)
      : null;
    return {
      listings: count,
      freshListings: freshCount,
      oldestObservation: oldest,
      newestObservation: newest,
      ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
      staleAfterHours,
      bySource,
      laggingSources,
      stale,
      staleBecause: stale
        ? (laggingSources && laggingSources.length
          ? `${(count || 0) - (freshCount || 0)} of ${count || 0} listings are past their own source's refresh cadence. `
            + `Behind: ${laggingSources.map((row) => `${row.source} ${row.listings - row.freshListings}/${row.listings} (every ${row.cadenceHours}h)`).join(', ')}.`
          : `${(count || 0) - (freshCount || 0)} of ${count || 0} listings were last observed more than ${staleAfterHours}h ago.`)
        : null,
    };
  }

  /**
   * Database-native aggregation for /api/neighborhoods.
   * Performs SQL GROUP BY and native percentiles in Postgres, eliminating
   * full-store memory scans and accelerating response times by 30x+.
   */

  /**
   * Returns dedicated read-replica pool if configured, or default pool.
   */
  getReadPool() {
    return this.readPool || this.pool;
  }

  /**
   * Refreshes the mv_neighborhood_stats materialized view concurrently.
   * Runs non-blocking without locking analytical reads.
   */
  async refreshNeighborhoodStatsMaterializedView({ concurrent = true } = {}) {
    if (!this.isPg || !this.pool) return false;
    try {
      const sql = concurrent
        ? 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_neighborhood_stats;'
        : 'REFRESH MATERIALIZED VIEW mv_neighborhood_stats;';
      await this.pool.query(sql);
      return true;
    } catch (err) {
      if (concurrent) {
        try {
          await this.pool.query('REFRESH MATERIALIZED VIEW mv_neighborhood_stats;');
          return true;
        } catch (innerErr) {
          console.warn('[DB] Materialized view refresh failed:', innerErr.message);
          return false;
        }
      }
      console.warn('[DB] Materialized view refresh failed:', err.message);
      return false;
    }
  }

  /**
   * Gracefully drains all connection pools.
   */
  async close() {
    if (this.readPool) {
      await this.readPool.end().catch(() => {});
      this.readPool = null;
    }
    if (this.pool && !this.externalPool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }

  async getNeighborhoodStatsNative(options = {}) { return nativeAnalytics.getNeighborhoodStatsNative(this, options); }
  async getSingleNeighborhoodStatsNative(kind, key, options = {}) { return nativeAnalytics.getSingleNeighborhoodStatsNative(this, kind, key, options); }
  async getAuctionCalendarNative(options = {}) { return nativeAnalytics.getAuctionCalendarNative(this, options); }
  async getSourceInventoryAggregatesNative() { return nativeAnalytics.getSourceInventoryAggregatesNative(this); }
  async getCompsCandidatesNative(target, options = {}) { return nativeAnalytics.getCompsCandidatesNative(this, target, options); }
  async getListingsByParcelKeyNative(parcelKey) { return nativeAnalytics.getListingsByParcelKeyNative(this, parcelKey); }


  /**
   * Is the in-memory provider explicitly requested?
   *
   * It answers "declared" only for an explicit PROPERTY_INVENTORY_BACKEND, or
   * under NODE_ENV=test. Both are deliberate: the env var is an operator asking
   * for it, and NODE_ENV=test is the test runner saying so. A production or dev
   * process cannot reach this branch, which is what keeps 'demo' from coming
   * back as an undeclared fallback.
   */
  memoryInventoryRequested() {
    return this.env.PROPERTY_INVENTORY_BACKEND === 'memory' || this.env.NODE_ENV === 'test';
  }

  /**
   * Which backend is actually serving listings: 'postgres', 'memory' (only
   * when explicitly asked for), or null for neither.
   */
  inventorySource() {
    if (this.dataMode() === 'postgres') return 'postgres';
    if (this.memoryInventoryRequested()) return 'memory';
    return null;
  }

  /**
   * Why there is no inventory, in one sentence, for health and error payloads.
   * Null whenever listings genuinely can be served.
   */
  inventoryUnavailableReason() {
    if (this.dataMode() === 'postgres') return null;
    // An explicit opt-in is a declared source, not a silent fallback. It is
    // never the runtime default; PROPERTY_INVENTORY_BACKEND must be set.
    if (this.memoryInventoryRequested()) return null;
    if (this.postgresError) return `PostgreSQL is not answering: ${this.postgresError}`;
    if (!this.env.DATABASE_URL && !this.pool) {
      return 'No database is configured. Set DATABASE_URL, or PROPERTY_DB=embedded to run the embedded PostgreSQL engine.';
    }
    return 'PostgreSQL is configured but has not been verified as reachable.';
  }

  // ---------------------------------------------------------------------------
  // Workspace store: file-backed persistence for saved searches + alert matches
  // ---------------------------------------------------------------------------

  _loadWorkspaceStore() {
    if (!this.workspaceStorePath) return;
    try {
      if (!fs.existsSync(this.workspaceStorePath)) return;
      const raw = fs.readFileSync(this.workspaceStorePath, 'utf8');
      const data = JSON.parse(raw);
      if (data.version !== WORKSPACE_STORE_VERSION) {
        throw new Error(`Workspace store version mismatch (expected ${WORKSPACE_STORE_VERSION}, got ${data.version}); preserved existing data.`);
        // Version mismatch throws to trigger quarantine
      }
      if (data.savedSearches && typeof data.savedSearches === 'object') {
        for (const [id, record] of Object.entries(data.savedSearches)) {
          this.inMemoryData.savedSearches.set(id, record);
        }
      }
      if (data.alertMatches && typeof data.alertMatches === 'object') {
        for (const [id, record] of Object.entries(data.alertMatches)) {
          this.inMemoryData.alertMatches.set(id, record);
        }
      }
      this._workspaceStoreLoaded = true;
      console.log(`[DB] Loaded ${this.inMemoryData.savedSearches.size} saved searches, ${this.inMemoryData.alertMatches.size} alert matches from workspace store`);
    } catch (err) {
      // "starting empty" is honest about the process and dishonest about the
      // user's data: their saved searches and alert matches still exist on disk
      // and are simply not loaded, and nothing said so. _workspaceStoreLoaded is
      // already true, so there is no retry either. Reported through
      // workspaceStoreError, the same shape seedError uses for the inventory.
      this.workspaceStoreError = err instanceof Error ? err.message : String(err);
      // Starting empty is also destructive: the maps are now empty, so the next
      // _persistWorkspaceStore() would write that emptiness over the real file
      // and delete everything in it. Move the unreadable store aside first, so
      // the bytes survive and the next write starts a clean file. If the move
      // fails, the original is still the only copy, so block writes entirely.
      this._quarantineWorkspaceStore();
      console.warn('[DB] Failed to load workspace store; starting empty:', err.message);
    }
  }

  // Move an unreadable store aside so a later persist cannot destroy it. If
  // the move fails the original is still the only copy, so writes are blocked
  // instead - losing the ability to save is strictly better than silently
  // deleting every saved search.
  _quarantineWorkspaceStore() {
    if (!this.workspaceStorePath) return null;
    try {
      if (!fs.existsSync(this.workspaceStorePath)) return null;
      const quarantined = `${this.workspaceStorePath}.corrupt-${Date.now()}`;
      fs.renameSync(this.workspaceStorePath, quarantined);
      this.workspaceStoreQuarantined = quarantined;
      console.warn(`[DB] Unreadable workspace store moved aside to ${quarantined}; nothing was overwritten.`);
      return quarantined;
    } catch (err) {
      this._workspaceStoreWriteBlocked = true;
      console.warn('[DB] Could not set the unreadable workspace store aside; writes are now blocked to avoid destroying it:', err.message);
      return null;
    }
  }

  _persistWorkspaceStore() {
    if (!this.workspaceStorePath || this.isPg) return;
    // Set when the store was unreadable and could not be moved aside. Without
    // this, a failed load leaves the maps empty and the next mutation - the
    // user saves ONE search - persists a store containing only that search,
    // silently deleting every other saved search and alert match on disk.
    if (this._workspaceStoreWriteBlocked) {
      console.warn('[DB] Persist refused: the workspace store is unreadable and was not set aside; writing would destroy it.');
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.workspaceStorePath), { recursive: true });
      const body = JSON.stringify({
        version: WORKSPACE_STORE_VERSION,
        updatedAt: new Date().toISOString(),
        savedSearches: Object.fromEntries(this.inMemoryData.savedSearches),
        alertMatches: Object.fromEntries(this.inMemoryData.alertMatches)
      });
      const tempPath = this.workspaceStorePath + '.' + cryptoRandomUUID() + '.tmp';
      try {
        fs.writeFileSync(tempPath, body, { flag: 'wx', mode: 0o600 });
        fs.renameSync(tempPath, this.workspaceStorePath);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
      this._workspaceStoreDirty = false;
    } catch (err) {
      console.warn('[DB] Failed to persist workspace store:', err.message);
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
        // Current inventory is live-only. Snapshots, fixtures, and demos are
        // kept out — they exist in data/listings.snapshot.json for the build
        // pipeline, not for the running API.
        this.inMemoryData.listings = Array.from(sandbox.window.LISTINGS || []).flatMap((l) => {
          const provenance = seedProvenance(l);
          if (provenance === null) return [];
          // Live listings without images get an empty array — never fabricate URLs.
          const images = Array.isArray(l.images) && l.images.length > 0 ? l.images : [];
          // Deterministic "Here's the Catch" one-liner — same $0 computation the
          // Postgres write path uses, so a seed record and its persisted twin
          // report the same catch. Title warnings/risk come from provenance when
          // the seed carries them, else empty.
          const catchSummary = computeCatchSummary(
            { ...l, images },
            Array.isArray(provenance?.titleWarnings) ? provenance.titleWarnings
              : (Array.isArray(l.titleWarnings) ? l.titleWarnings : []),
            provenance?.riskLevel || l.riskLevel || null,
          );
          return [{
            ...l,
            images,
            provenance,
            catchSummary,
            sourceObservedAt: l.sourceObservedAt ?? null,
            fetchedAt: l.fetchedAt ?? null,
            price: l.price ?? null,
            listingDate: l.listingDate ?? null,
            // Routed through the SAME canonicaliser the Postgres write path
            // uses, so a seed record and that same record persisted to
            // PostgreSQL report the same status.
            //
            // It used to be `l.status || 'active'`, which labels a record with
            // no publisher-reported status as active. The Postgres path calls
            // canonicalStatus(), which returns 'unknown' for exactly that input.
            // The two backends therefore disagreed about the same record, and
            // nothing caught it: no caller passes a `status` filter to
            // getListings, so the divergence is currently latent. It is a trap
            // rather than a bug -- the first person to add a status filter gets
            // 2,094 rows in memory and 0 in Postgres, with no error anywhere.
            //
            // 'unknown' is also the honest answer. A seed record genuinely does
            // not have a known status, and 'active' was a guess presented as
            // fact. Nothing user-visible changes: the listing card renders
            // `lifecycle || lifecycleStatus`, not `status`.
            status: canonicalStatus(l.status),
          }];
        });
        console.log(`[DB] Loaded ${this.inMemoryData.listings.length} live records (snapshots excluded) across ${Object.keys(this.inMemoryData.sources).length} sources`);
      }
    } catch (err) {
      // Seeding IS the demo inventory. Swallowing this left the process healthy
      // with an empty provider, so the app served `total: 0` listings and
      // /api/health still said demo, reachable, fine - one log line the only
      // evidence. A corrupt or oversized live-listings.json (the file scrapers
      // rewrite continuously, and loadLiveRecords throws on both) was enough.
      //
      // refreshLiveCache() below cannot rescue it: that one deliberately
      // preserves current inventory when the cache is bad, which is right for a
      // refresh and useless when the inventory it would preserve is empty.
      //
      // Recorded, not thrown: an operator still gets a running server, and the
      // health and listings payloads now carry the reason - the same shape as
      // postgresError.
      this.seeded = false;
      this.seedError = err instanceof Error ? err.message : String(err);
      console.error('[DB] Failed to seed in-memory provider:', err);
    }
    if (this.seeded === undefined) this.seeded = true;
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
      applyCrossSourceBakeOff(this.inMemoryData.listings);
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
      const selectCols = filters.summary ? SUMMARY_LISTING_SELECT : LISTING_SELECT;
      let sql = `SELECT ${selectCols}, COUNT(*) OVER() AS "fullCount" FROM listings WHERE 1=1`;
      // Admission gate: DISCOVERY_ONLY and uncataloged sources never serve.
      sql += ` AND source_key IN (${listingServingSourceSqlList()})`;
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
      if (filters.county && filters.county !== 'all') {
        sql += ` AND county ILIKE $${paramIdx++}`;
        params.push(String(filters.county));
      }
      if (filters.missingAssessorRoll) {
        // The durable roll marker is the authority: `assessed_value` alone can
        // pre-exist from other enrichment paths.
        sql += ` AND provenance #> '{derivedFields,assessorRoll}' IS NULL AND (assessed_value IS NULL OR assessed_value <= 0)`;
      }
      if (minScore) {
        sql += ` AND deal_score >= $${paramIdx++}`;
        params.push(Number(minScore));
      }
      if (minEquity) {
        sql += ` AND equity_spread >= $${paramIdx++}`;
        params.push(Number(minEquity));
      }
      if (maxBid !== undefined && maxBid !== null && maxBid !== '') {
        sql += ` AND opening_bid <= $${paramIdx++}`;
        params.push(Number(maxBid));
      }
      if (occupancy && occupancy !== 'all') {
        sql += ` AND occupancy = $${paramIdx++}`;
        params.push(occupancy);
      }
      if (seniorLien === 'clean') {
        sql += ` AND senior_lien_risk IS NOT NULL AND senior_lien_risk NOT IN ('high', 'unknown')`;
      } else if (seniorLien === 'risk') {
        sql += ` AND senior_lien_risk = 'high'`;
      }
      if (redemption === 'immediate') {
        sql += ` AND redemption_days = 0 AND provenance #> '{derivedFields,redemption}' IS NULL`;
      } else if (redemption === 'redemption_active') {
        sql += ` AND redemption_days > 0 AND provenance #> '{derivedFields,redemption}' IS NULL`;
      }
      const stateQuery = q ? resolveStateQuery(q) : null;
      if (q) {
        const literalQuery = q.replace(/[\\%_]/g, (ch) => '\\' + ch);
        const qParamIdx = paramIdx++;
        params.push(`%${literalQuery}%`);
        const stateClause = stateQuery ? ` OR UPPER(state) = $${paramIdx++}` : '';
        if (stateQuery) params.push(stateQuery.stateCode);
        sql += ` AND (address ILIKE $${qParamIdx} ESCAPE '\\' OR city ILIKE $${qParamIdx} ESCAPE '\\' OR county ILIKE $${qParamIdx} ESCAPE '\\' OR state ILIKE $${qParamIdx} ESCAPE '\\' OR plaintiff ILIKE $${qParamIdx} ESCAPE '\\' OR defendant ILIKE $${qParamIdx} ESCAPE '\\' OR attorney ILIKE $${qParamIdx} ESCAPE '\\' OR occupancy ILIKE $${qParamIdx} ESCAPE '\\' OR deposit_terms ILIKE $${qParamIdx} ESCAPE '\\' OR EXISTS (SELECT 1 FROM sources s WHERE s.key = listings.source_key AND s.label ILIKE $${qParamIdx} ESCAPE '\\')${stateClause})`;
      }
      if (filters.hasDocuments) {
        sql += ` AND has_documents = TRUE`;
      }
      if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        sql += ` AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint($${paramIdx++}, $${paramIdx++}), 4326)::geography, $${paramIdx++})`;
        params.push(lng, lat, radiusKm * 1000);
      }

      let statePriorityPrefix = '';
      if (stateQuery && (!sort || sort === 'score' || sort === 'opportunity' || sort === 'triage')) {
        statePriorityPrefix = `CASE WHEN UPPER(state) = $${paramIdx++} THEN 0 ELSE 1 END ASC, `;
        params.push(stateQuery.stateCode);
      }
      if (sort === 'equity') sql += ' ORDER BY equity_spread DESC NULLS LAST, id ASC';
      else if (sort === 'bid-asc') sql += ' ORDER BY opening_bid ASC NULLS LAST, id ASC';
      else if (sort === 'date') sql += ' ORDER BY sale_date ASC NULLS LAST, id ASC';
      else if (sort === 'images') sql += ' ORDER BY COALESCE(array_length(images, 1), 0) DESC NULLS LAST, id ASC';
      // DB-side research-priority ranking on the persisted, indexed
      // triage_priority column (migration 025 + 026). The staleness guard
      // ranks never-refreshed or older-than-TRIAGE_PRIORITY_STALE_DAYS rows
      // last: a stale score must never read as a fresh ranking.
      else if (sort === 'triage' && statePriorityPrefix) sql += ` ORDER BY ${statePriorityPrefix}(CASE WHEN triage_priority_refreshed_at >= NOW() - INTERVAL '${TRIAGE_PRIORITY_STALE_DAYS} days' THEN triage_priority END) DESC NULLS LAST, id ASC`;
      else if (sort === 'triage') sql += ` ORDER BY (CASE WHEN triage_priority_refreshed_at >= NOW() - INTERVAL '${TRIAGE_PRIORITY_STALE_DAYS} days' THEN triage_priority END) DESC NULLS LAST, id ASC`;
      else sql += ` ORDER BY ${statePriorityPrefix}deal_score DESC NULLS LAST, id ASC`;

      sql += ` LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
      params.push(Number(limit), Number(offset));

      const res = await this.getReadPool().query(sql, params);
      // total = full match count (COUNT(*) OVER), not the page size.
      const total = Number(res.rows[0]?.fullCount ?? 0);
      const listings = res.rows.map(({ fullCount, ...row }) => mapPgListingRow(row));
      return { total, listings };
    }

    this.refreshLiveCache();
    const stateQuery = q ? resolveStateQuery(q) : null;
    let results = this.inMemoryData.listings.filter(l => {
      // Admission gate: a record whose declared source is DISCOVERY_ONLY or
      // unknown to the catalog is discovery evidence, not a sale listing.
      if (typeof l.source === 'string' && l.source !== '' && !servesListings(l.source)) return false;
      if (state !== 'all' && String(l.state || '').toUpperCase() !== state.toUpperCase()) return false;
      if (source !== 'all' && l.source !== source) return false;
      if (type !== 'all' && l.propType !== type) return false;
      if (status !== 'all' && (l.status || 'active') !== status) return false;
      if (minScore && l.dealScore < Number(minScore)) return false;
      if (minEquity && l.equity < Number(minEquity)) return false;
      if (maxBid && (l.openingBid == null || l.openingBid > Number(maxBid))) return false;
      if (occupancy !== 'all' && l.occupancy !== occupancy) return false;
      if (seniorLien === 'clean' && (!l.seniorLienRisk || ['high', 'unknown'].includes(l.seniorLienRisk))) return false;
      if (seniorLien === 'risk' && l.seniorLienRisk !== 'high') return false;
      const redemptionStamp = l?.provenance?.derivedFields?.redemption;
      const rawRedemption = l.redemptionDays;
      const publishedRedemption = redemptionStamp || rawRedemption == null || rawRedemption === ''
        ? null
        : Number(rawRedemption);
      const publishedRedemptionKnown = Number.isFinite(publishedRedemption) ? publishedRedemption : null;
      if (redemption === 'immediate' && publishedRedemptionKnown !== 0) return false;
      if (redemption === 'redemption_active' && !(publishedRedemptionKnown > 0)) return false;
      if (filters.county && filters.county !== 'all' && String(l.county || '').toUpperCase() !== String(filters.county).toUpperCase()) return false;
      if (filters.missingAssessorRoll && (l.assessorParcel || l?.provenance?.derivedFields?.assessorRoll || (Number(l.assessed) > 0))) return false;
      if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        const dist = this.calculateDistance(Number(lat), Number(lng), l.lat, l.lng);
        if (dist === null || dist > Number(radiusKm)) return false;
      }
      if (q) {
        const needle = q.toLowerCase();
        const hay = [l.address, l.city, l.county, l.state, l.plaintiff, l.defendant, l.attorney, l.occupancy, l.deposit, this.inMemoryData.sources[l.source]?.label || ''].join(' ').toLowerCase();
        const exactStateMatch = stateQuery && String(l.state || '').toUpperCase() === stateQuery.stateCode;
        if (!hay.includes(needle) && !exactStateMatch) return false;
      }
      if (filters.hasDocuments && l.hasDocuments !== true) return false;
      return true;
    });

    // Postgres ends every one of these sorts with `id ASC`; see the ORDER BY
    // clauses in the isPg branch above. The same tie-break is applied here so
    // the two backends agree on what "tied" means, and -- the part that
    // actually bites -- so the order is a total order. Offset paging is only
    // safe over a total order: with ties left to the sort's discretion two
    // pages can repeat a row or skip one, and the caller cannot tell.
    //
    // The collation is Node's, not the server's, so the two do not have to
    // agree byte-for-byte on exotic ids. What matters is that this ordering is
    // deterministic and self-consistent across pages.
    const thenId = (cmp) => (a, b) => cmp(a, b) || String(a.id).localeCompare(String(b.id));

    const withStateBoost = (cmp) => {
      if (!stateQuery || (sort && sort !== 'score' && sort !== 'opportunity' && sort !== 'triage')) {
        return thenId(cmp);
      }
      return (a, b) => {
        const aMatch = String(a.state || '').toUpperCase() === stateQuery.stateCode ? 0 : 1;
        const bMatch = String(b.state || '').toUpperCase() === stateQuery.stateCode ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return thenId(cmp)(a, b);
      };
    };

    if (sort === 'equity') results.sort(thenId((a, b) => compareNumbersUnknownLast(a.equity, b.equity)));
    else if (sort === 'bid-asc') results.sort(thenId((a, b) => compareNumbersUnknownLast(a.openingBid, b.openingBid, false)));
    else if (sort === 'date') {
      results.sort(thenId((a, b) => compareNumbersUnknownLast(Date.parse(a.saleDate), Date.parse(b.saleDate), false)));
    } else if (sort === 'images') {
      results.sort(thenId((a, b) => (b.images?.length || 0) - (a.images?.length || 0)));
    } else if (sort === 'triage') {
      // The in-memory provider holds no observation history, so no triage
      // priority is computed here: listings sort by any carried value and
      // unknowns rank last. The real ranking lives in Postgres, where the
      // evaluator writes triage_priority at ingest (migration 025 + 026).
      results.sort(withStateBoost((a, b) => compareNumbersUnknownLast(a.triagePriority, b.triagePriority)));
    } else results.sort(withStateBoost((a, b) => compareNumbersUnknownLast(a.dealScore, b.dealScore)));

    const total = results.length;
    const paginated = results.slice(Number(offset), Number(offset) + Number(limit));
    return { total, listings: paginated };
  }

  enterWebQuery() {
    this._activeWebQueries = (this._activeWebQueries || 0) + 1;
  }

  leaveWebQuery() {
    this._activeWebQueries = Math.max(0, (this._activeWebQueries || 0) - 1);
    if (this._activeWebQueries === 0 && Array.isArray(this._webDrainWaiters) && this._webDrainWaiters.length > 0) {
      const waiters = this._webDrainWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }

  async yieldToWebQueries(maxWaitMs = 2500) {
    if (!(this._activeWebQueries > 0)) return;
    await new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (Array.isArray(this._webDrainWaiters)) {
          const idx = this._webDrainWaiters.indexOf(finish);
          if (idx !== -1) this._webDrainWaiters.splice(idx, 1);
        }
        resolve();
      };
      if (!Array.isArray(this._webDrainWaiters)) this._webDrainWaiters = [];
      this._webDrainWaiters.push(finish);
      timer = setTimeout(finish, maxWaitMs);
      if (typeof timer.unref === 'function') timer.unref();
    });
  }

  async runBackgroundDbTask(fn, options = {}) {
    const maxWaitMs = Number.isFinite(options.maxWebWaitMs) ? options.maxWebWaitMs : 2500;
    const yieldOnWeb = options.yieldToWeb !== false;
    if (yieldOnWeb) await this.yieldToWebQueries(maxWaitMs);
    const maxBg = this._maxBgDbConcurrency || 2;
    if (!Array.isArray(this._bgDbWaiters)) this._bgDbWaiters = [];
    while ((this._activeBgDbTasks || 0) >= maxBg) {
      await new Promise((resolve) => this._bgDbWaiters.push(resolve));
      if (yieldOnWeb) await this.yieldToWebQueries(maxWaitMs);
    }
    this._activeBgDbTasks = (this._activeBgDbTasks || 0) + 1;
    try {
      return await fn();
    } finally {
      this._activeBgDbTasks = Math.max(0, (this._activeBgDbTasks || 0) - 1);
      const next = this._bgDbWaiters.shift();
      if (next) next();
    }
  }

  async getListingById(id, options = {}) {
    if (this.isPg) {
      const queryClient = options.client || this.getReadPool();
      const res = await queryClient.query(`SELECT ${LISTING_SELECT} FROM listings WHERE id = $1`, [id]);
      if (res.rows[0]) return mapPgListingRow(res.rows[0]);
      if (NAMESPACED_ID.test(id)) {
        const alias = await queryClient.query(
          `SELECT ${LISTING_SELECT} FROM listings WHERE id LIKE $1`, [`%-${id}`]);
        if (alias.rows.length === 1) return mapPgListingRow(alias.rows[0]);
      }
      return null;
    }
    this.refreshLiveCache();
    const exact = this.inMemoryData.listings.find(l => l.id === id);
    if (exact) return exact;
    if (NAMESPACED_ID.test(id)) {
      const alias = this.inMemoryData.listings.filter(l => typeof l.id === 'string' && l.id.endsWith(`-${id}`));
      if (alias.length === 1) return alias[0];
    }
    return null;
  }

  async createListing(listing, options = {}) {
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
        auction_program, lifecycle_status, transaction_outcome, has_documents, parcel_key,
        catch_summary, initial_opening_bid, peak_opening_bid
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        CASE WHEN $8::float8 IS NOT NULL AND $9::float8 IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint($9,$8), 4326)::geography ELSE NULL END,
        $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,
        $43, $44, $45, $46, $47, $48, $15, $15
      )
      ON CONFLICT (id) DO UPDATE SET
        source_key = EXCLUDED.source_key,
        state = EXCLUDED.state,
        county = COALESCE(EXCLUDED.county, listings.county),
        city = COALESCE(EXCLUDED.city, listings.city),
        zip = COALESCE(EXCLUDED.zip, listings.zip),
        address = EXCLUDED.address,
        latitude = CASE WHEN EXCLUDED.geog IS NOT NULL THEN EXCLUDED.latitude WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN listings.latitude ELSE NULL END,
        longitude = CASE WHEN EXCLUDED.geog IS NOT NULL THEN EXCLUDED.longitude WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN listings.longitude ELSE NULL END,
        geog = CASE WHEN EXCLUDED.geog IS NOT NULL THEN EXCLUDED.geog WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN listings.geog ELSE NULL END,
        beds = COALESCE(EXCLUDED.beds, listings.beds),
        baths = COALESCE(EXCLUDED.baths, listings.baths),
        sqft = COALESCE(EXCLUDED.sqft, listings.sqft),
        year_built = COALESCE(EXCLUDED.year_built, listings.year_built),
        prop_type = COALESCE(CASE WHEN lower(btrim(coalesce(EXCLUDED.prop_type,''))) IN ('', 'unknown', 'n/a', 'none') THEN NULL ELSE btrim(EXCLUDED.prop_type) END, CASE WHEN lower(btrim(coalesce(listings.prop_type,''))) IN ('', 'unknown', 'n/a', 'none') THEN NULL ELSE listings.prop_type END),
        opening_bid = COALESCE(EXCLUDED.opening_bid, listings.opening_bid),
        initial_opening_bid = COALESCE(listings.initial_opening_bid, EXCLUDED.opening_bid),
        peak_opening_bid = CASE WHEN listings.peak_opening_bid IS NULL THEN EXCLUDED.opening_bid WHEN EXCLUDED.opening_bid IS NULL THEN listings.peak_opening_bid ELSE GREATEST(listings.peak_opening_bid, EXCLUDED.opening_bid) END,
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
        images = CASE WHEN EXCLUDED.photo_url IS NULL AND EXCLUDED.images IS NULL THEN NULL ELSE COALESCE(EXCLUDED.images, listings.images) END,
        source_url = COALESCE(EXCLUDED.source_url, listings.source_url),
        raw_notice = COALESCE(EXCLUDED.raw_notice, listings.raw_notice),
        provenance = ${PROVENANCE_UPSERT_SQL},
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
        status = CASE WHEN EXCLUDED.status IS NOT NULL AND EXCLUDED.status <> 'unknown' THEN EXCLUDED.status ELSE listings.status END,
        auction_program = COALESCE(EXCLUDED.auction_program, listings.auction_program),
        lifecycle_status = COALESCE(EXCLUDED.lifecycle_status, listings.lifecycle_status),
        transaction_outcome = COALESCE(EXCLUDED.transaction_outcome, listings.transaction_outcome),
        has_documents = COALESCE(EXCLUDED.has_documents, listings.has_documents),
        parcel_key = COALESCE(EXCLUDED.parcel_key, listings.parcel_key),
        catch_summary = EXCLUDED.catch_summary,
        updated_at = NOW()
      WHERE EXCLUDED.source_observed_at IS NULL
         OR listings.source_observed_at IS NULL
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
        enriched.cashToClose ?? null, enriched.cashToCloseDetails, enriched.status || 'unknown',
        enriched.auctionProgram ?? null, enriched.lifecycleStatus ?? null, enriched.transactionOutcome ?? null,
        typeof enriched.hasDocuments === 'boolean' ? enriched.hasDocuments : null,
        enriched.parcelKey ?? null,
        enriched.catchSummary ?? null,
      ];
      const queryClient = options.client || this.pool;
      const result = await queryClient.query(sql, params);
      if (result.rows[0]) return mapPgListingRow(result.rows[0]);
      // UPSERT WHERE can reject a stale partial refresh (e.g. null observedAt
      // on an existing newer row). Surface the retained record instead of null.
      if (enriched && typeof enriched.id === 'string' && enriched.id) {
        return this.getListingById(enriched.id, { client: queryClient });
      }
      return null;
    }

    const idx = this.inMemoryData.listings.findIndex(l => l.id === enriched.id);
    if (idx >= 0) {
      enriched = mergeListingForInMemoryUpsert(this.inMemoryData.listings[idx], enriched);
      this.inMemoryData.listings[idx] = enriched;
    } else {
      this.inMemoryData.listings.unshift(enriched);
    }
    applyCrossSourceBakeOff(this.inMemoryData.listings);
    return enriched;
  }

  /**
   * Bulk upsert a batch of listings in a single parameterized query, chunked to
   * avoid exceeding the PostgreSQL parameter limit ($1..$65535).  Falls back to
   * sequential createListing() for the in-memory backend or when the pool is
   * unavailable.  Callers should collect listings across a source run and call
   * createListingsBulk() once per batch rather than createListing() per item.
   *
   * @param {object[]} listings  - Array of listing objects (same shape as createListing input).
   * @param {object}   [options] - { client?: pg.Client, chunkSize?: number, yieldEveryChunks?: number }
   * @returns {Promise<number>}  - Total rows upserted (may be 0 for no-op rows that failed the WHERE guard).
   */
  async createListingsBulk(listings, options = {}) {
    const returnPersisted = options.returnPersisted === true;
    if (!Array.isArray(listings) || listings.length === 0) {
      return returnPersisted ? { count: 0, persistedById: new Map() } : 0;
    }
    if (!this.isPg || !this.pool) {
      // In-memory fallback: sequential upsert
      const persistedById = returnPersisted ? new Map() : null;
      for (const l of listings) {
        const persisted = await this.createListing(l, options);
        if (persistedById && persisted?.id) persistedById.set(persisted.id, persisted);
      }
      return returnPersisted ? { count: listings.length, persistedById } : listings.length;
    }

    const CHUNK = Math.min(100, Math.max(1, Math.trunc(Number(options.chunkSize) || 50)));
    const YIELD_EVERY = Math.max(1, Math.trunc(Number(options.yieldEveryChunks) || 5));
    const queryClient = options.client || this.pool;
    const persistedById = returnPersisted ? new Map() : null;
    let total = 0;

    for (let i = 0; i < listings.length; i += CHUNK) {
      const chunk = listings.slice(i, i + CHUNK);
      // Build parameterized VALUES list.  Each listing maps to 48 params ($N..$N+47).
      const valueParts = [];
      const params = [];
      let pIdx = 1;

      for (const listing of chunk) {
        const e = prepareListingForPersistence(listing);
        const p = (n) => `$${pIdx + n}`;
        valueParts.push(
          `(${p(0)},${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)},` +
          `CASE WHEN ${p(7)}::float8 IS NOT NULL AND ${p(8)}::float8 IS NOT NULL ` +
          `  THEN ST_SetSRID(ST_MakePoint(${p(8)},${p(7)}),4326)::geography ELSE NULL END,` +
          `${p(9)},${p(10)},${p(11)},${p(12)},${p(13)},${p(14)},${p(15)},${p(16)},` +
          `${p(17)},${p(18)},${p(19)},${p(20)},${p(21)},${p(22)},${p(23)},${p(24)},` +
          `${p(25)},${p(26)},${p(27)},${p(28)},${p(29)},${p(30)},${p(31)},${p(32)},` +
          `${p(33)},${p(34)},${p(35)},${p(36)},${p(37)},${p(38)},${p(39)},${p(40)},` +
          `${p(41)},${p(42)},${p(43)},${p(44)},${p(45)},${p(46)},${p(47)},${p(14)},${p(14)})`
        );
        params.push(
          e.id, e.source, e.state, e.county, e.city, e.zip, e.address, e.lat, e.lng,
          e.beds, e.baths, e.sqft, e.year, e.propType,
          e.openingBid, e.estLow, e.estHigh, e.assessed, e.dealScore,
          e.saleDate, e.plaintiff ?? null, e.defendant ?? null, e.judgment,
          e.attorney ?? null, e.occupancy, e.deposit,
          e.photo, e.images || null, e.sourceUrl, e.raw,
          e.provenance, e.sourceObservedAt, e.fetchedAt,
          e.price ?? null, e.listingDate ?? null,
          e.redemptionDays, e.redemptionWarning || null,
          e.seniorLienRisk, e.seniorLienWarning || null,
          e.cashToClose ?? null, e.cashToCloseDetails, e.status || 'unknown',
          e.auctionProgram ?? null, e.lifecycleStatus ?? null, e.transactionOutcome ?? null,
          typeof e.hasDocuments === 'boolean' ? e.hasDocuments : null,
          e.parcelKey ?? null,
          e.catchSummary ?? null,
        );
        pIdx += 48;
      }

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
        auction_program, lifecycle_status, transaction_outcome, has_documents, parcel_key,
        catch_summary, initial_opening_bid, peak_opening_bid
      ) VALUES ${valueParts.join(',')}
      ON CONFLICT (id) DO UPDATE SET
        source_key = EXCLUDED.source_key,
        state = EXCLUDED.state,
        county = COALESCE(EXCLUDED.county, listings.county),
        city = COALESCE(EXCLUDED.city, listings.city),
        zip = COALESCE(EXCLUDED.zip, listings.zip),
        address = EXCLUDED.address,
        latitude = CASE WHEN EXCLUDED.geog IS NOT NULL THEN EXCLUDED.latitude WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN listings.latitude ELSE NULL END,
        longitude = CASE WHEN EXCLUDED.geog IS NOT NULL THEN EXCLUDED.longitude WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN listings.longitude ELSE NULL END,
        geog = CASE WHEN EXCLUDED.geog IS NOT NULL THEN EXCLUDED.geog WHEN ${SAME_ADDRESS_ON_CONFLICT_SQL} THEN listings.geog ELSE NULL END,
        beds = COALESCE(EXCLUDED.beds, listings.beds),
        baths = COALESCE(EXCLUDED.baths, listings.baths),
        sqft = COALESCE(EXCLUDED.sqft, listings.sqft),
        year_built = COALESCE(EXCLUDED.year_built, listings.year_built),
        prop_type = COALESCE(CASE WHEN lower(btrim(coalesce(EXCLUDED.prop_type,''))) IN ('', 'unknown', 'n/a', 'none') THEN NULL ELSE btrim(EXCLUDED.prop_type) END, CASE WHEN lower(btrim(coalesce(listings.prop_type,''))) IN ('', 'unknown', 'n/a', 'none') THEN NULL ELSE listings.prop_type END),
        opening_bid = COALESCE(EXCLUDED.opening_bid, listings.opening_bid),
        initial_opening_bid = COALESCE(listings.initial_opening_bid, EXCLUDED.opening_bid),
        peak_opening_bid = CASE WHEN listings.peak_opening_bid IS NULL THEN EXCLUDED.opening_bid WHEN EXCLUDED.opening_bid IS NULL THEN listings.peak_opening_bid ELSE GREATEST(listings.peak_opening_bid, EXCLUDED.opening_bid) END,
        est_low = ${resolvedEstLowSql},
        est_high = ${resolvedEstHighSql},
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
        images = CASE WHEN EXCLUDED.photo_url IS NULL AND EXCLUDED.images IS NULL THEN NULL ELSE COALESCE(EXCLUDED.images, listings.images) END,
        source_url = COALESCE(EXCLUDED.source_url, listings.source_url),
        raw_notice = COALESCE(EXCLUDED.raw_notice, listings.raw_notice),
        provenance = ${PROVENANCE_UPSERT_SQL},
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
        status = CASE WHEN EXCLUDED.status IS NOT NULL AND EXCLUDED.status <> 'unknown' THEN EXCLUDED.status ELSE listings.status END,
        auction_program = COALESCE(EXCLUDED.auction_program, listings.auction_program),
        lifecycle_status = COALESCE(EXCLUDED.lifecycle_status, listings.lifecycle_status),
        transaction_outcome = COALESCE(EXCLUDED.transaction_outcome, listings.transaction_outcome),
        has_documents = COALESCE(EXCLUDED.has_documents, listings.has_documents),
        parcel_key = COALESCE(EXCLUDED.parcel_key, listings.parcel_key),
        catch_summary = EXCLUDED.catch_summary,
        updated_at = NOW()
      WHERE EXCLUDED.source_observed_at IS NULL
         OR listings.source_observed_at IS NULL
         OR (EXCLUDED.source_observed_at IS NOT NULL AND EXCLUDED.source_observed_at >= listings.source_observed_at)${
        returnPersisted
          ? '\n      RETURNING id, latitude::float8 AS "lat", longitude::float8 AS "lng", assessed_value::float8 AS "assessed", year_built AS "year", prop_type AS "propType", provenance->\'derivedFields\' AS "derivedFields"'
          : ''
      }`;

      try {
        const result = await queryClient.query(sql, params);
        total += result.rowCount || 0;
        if (persistedById) {
          for (const row of result.rows || []) {
            if (row?.id) {
              persistedById.set(row.id, {
                lat: finiteOrNull(row.lat),
                lng: finiteOrNull(row.lng),
                assessed: finiteOrNull(row.assessed),
                year: row.year == null ? null : Number(row.year),
                propType: row.propType || null,
                provenance: row.derivedFields ? { derivedFields: row.derivedFields } : undefined,
              });
            }
          }
          const missingIds = chunk.map((l) => l?.id).filter((id) => typeof id === 'string' && id && !persistedById.has(id));
          if (missingIds.length > 0) {
            try {
              const retained = await queryClient.query(
                `SELECT id, latitude::float8 AS "lat", longitude::float8 AS "lng", assessed_value::float8 AS "assessed", year_built AS "year", prop_type AS "propType", provenance->'derivedFields' AS "derivedFields"
                   FROM listings WHERE id = ANY($1::text[])`,
                [missingIds],
              );
              for (const row of retained.rows || []) {
                if (row?.id) {
                  persistedById.set(row.id, {
                    lat: finiteOrNull(row.lat),
                    lng: finiteOrNull(row.lng),
                    assessed: finiteOrNull(row.assessed),
                    year: row.year == null ? null : Number(row.year),
                    propType: row.propType || null,
                    provenance: row.derivedFields ? { derivedFields: row.derivedFields } : undefined,
                  });
                }
              }
            } catch (readBackErr) {
              console.warn('[DB] createListingsBulk persistedById readback warning:', readBackErr?.message || readBackErr);
            }
          }
        }
      } catch (err) {
        // On bulk failure, fall back to sequential createListing for this chunk
        for (const l of chunk) {
          try {
            const persisted = await this.createListing(l, options);
            total += 1;
            if (persistedById && persisted?.id) persistedById.set(persisted.id, persisted);
          } catch (seqErr) {
            console.warn('[DB] createListingsBulk fallback sequential createListing failed for', l?.id, seqErr?.message || seqErr);
          }
        }
      }

      // Yield to the event loop every YIELD_EVERY chunks to avoid starving the HTTP server
      const chunkNumber = Math.floor(i / CHUNK) + 1;
      if (chunkNumber % YIELD_EVERY === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    return returnPersisted ? { count: total, persistedById } : total;
  }

  async reconcilePublisherAbsence(sourceKey, seenIds, options = {}) {
    return listingReconciliation.reconcilePublisherAbsence(this, sourceKey, seenIds, options);
  }

  async reconcileDuplicateDockets(sourceKey, seenListings = [], options = {}) {
    return listingReconciliation.reconcileDuplicateDockets(this, sourceKey, seenListings, options);
  }

  async reconcileCrossSourceDuplicates(options = {}) {
    return listingReconciliation.reconcileCrossSourceDuplicates(this, options);
  }

  async getSavedDeals(userId) { return workspacePersistence.getSavedDeals(this, userId); }
  async saveDeal(userId, listingId) { return workspacePersistence.saveDeal(this, userId, listingId); }
  async removeSavedDeal(userId, listingId) { return workspacePersistence.removeSavedDeal(this, userId, listingId); }
  async updateSavedDealStage(userId, listingId, stage) { return workspacePersistence.updateSavedDealStage(this, userId, listingId, stage); }
  async createSavedSearch(userId, payload) { return workspacePersistence.createSavedSearch(this, userId, payload); }
  async listSavedSearchUserIds() { return workspacePersistence.listSavedSearchUserIds(this); }
  async listSavedSearches(userId, options) { return workspacePersistence.listSavedSearches(this, userId, options); }
  async getSavedSearchById(userId, id) { return workspacePersistence.getSavedSearchById(this, userId, id); }
  async updateSavedSearch(userId, id, updates) { return workspacePersistence.updateSavedSearch(this, userId, id, updates); }
  async deleteSavedSearch(userId, id) { return workspacePersistence.deleteSavedSearch(this, userId, id); }
  async recordAlertMatches(userId, searchId, listingIds) { return workspacePersistence.recordAlertMatches(this, userId, searchId, listingIds); }
  async listAlertMatches(userId, options) { return workspacePersistence.listAlertMatches(this, userId, options); }
  async markAlertMatchesRead(userId, matchIds) { return workspacePersistence.markAlertMatchesRead(this, userId, matchIds); }
  _serializeSavedSearch(row) { return workspacePersistence.serializeSavedSearch(row); }
  _serializeAlertMatch(row) { return workspacePersistence.serializeAlertMatch(row); }

  async getAiCache(contentHash) {
    return this.aiCacheStore.get(contentHash);
  }

  async setAiCache(record) {
    return this.aiCacheStore.set(record);
  }

  // ---------------------------------------------------------------------------
  // Listing price history
  //
  // The price-drop detector reads the most-recent prior snapshot per
  // listing and compares it against the current opening_bid. Snapshots
  // are idempotent on (listing_id, source_observed_at) so re-running the
  // same scrape does not create duplicate history rows.
  // ---------------------------------------------------------------------------

  async recordListingHistorySnapshots(listings, options = {}) { return workspacePersistence.recordListingHistorySnapshots(this, listings, options); }
  async getListingHistory(listingIds, options = {}) { return workspacePersistence.getListingHistory(this, listingIds, options); }


  async purgeStaleListings(options = {}) {
    return purgeStaleListingsFromDb(this, options);
  }
}

module.exports = new DatabaseClient();
module.exports.DatabaseClient = DatabaseClient;
module.exports.DEFAULT_LIVE_CACHE_PATH = DEFAULT_LIVE_CACHE_PATH;
module.exports.LISTING_SELECT = LISTING_SELECT;
module.exports.SUMMARY_LISTING_SELECT = SUMMARY_LISTING_SELECT;
module.exports.NORMALIZE_ADDR_SQL = NORMALIZE_ADDR_SQL;
module.exports.SAME_ADDRESS_ON_CONFLICT_SQL = SAME_ADDRESS_ON_CONFLICT_SQL;
module.exports.PROVENANCE_UPSERT_SQL = PROVENANCE_UPSERT_SQL;
module.exports.TRIAGE_PRIORITY_STALE_DAYS = TRIAGE_PRIORITY_STALE_DAYS;
module.exports.ACCELERATED_LISTINGS_COLUMNS = ACCELERATED_LISTINGS_COLUMNS;
module.exports.buildCompsCandidatesSql = buildCompsCandidatesSql;
module.exports.ALERT_MATCHES_DEFAULT_LIMIT = ALERT_MATCHES_DEFAULT_LIMIT;
module.exports.ALERT_MATCHES_MAX_LIMIT = ALERT_MATCHES_MAX_LIMIT;
module.exports.finiteOrNull = finiteOrNull;
module.exports.clampAlertMatchesLimit = clampAlertMatchesLimit;
module.exports.sameNormalizedListingAddress = sameNormalizedListingAddress;
module.exports.optionalFiniteNumber = optionalFiniteNumber;
module.exports.normalizeGeocode = normalizeGeocode;
module.exports.isoOrNull = isoOrNull;
module.exports.mapPgListingRow = mapPgListingRow;
module.exports.normalizeTimestamp = normalizeTimestamp;
module.exports.normalizeDate = normalizeDate;
module.exports.optionalText = optionalText;
module.exports.canonicalStatus = canonicalStatus;
module.exports.normalizeProvenance = normalizeProvenance;
module.exports.normalizeCashToCloseDetails = normalizeCashToCloseDetails;
module.exports.prepareListingForPersistence = prepareListingForPersistence;
module.exports.mergeListingForInMemoryUpsert = mergeListingForInMemoryUpsert;
module.exports.compareNumbersUnknownLast = compareNumbersUnknownLast;
module.exports.computeBakeOff = computeBakeOff;
module.exports.applyCrossSourceBakeOff = applyCrossSourceBakeOff;
module.exports.isFiniteTime = isFiniteTime;
