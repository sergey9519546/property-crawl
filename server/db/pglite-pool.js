'use strict';

/**
 * Embedded PostgreSQL for this app, exposed through the `pg` Pool surface the
 * rest of the server already speaks.
 *
 * Why this exists
 * ---------------
 * `.env.local` points DATABASE_URL at postgres://localhost:5432, but nothing
 * listens there: there is no PostgreSQL install on this machine, and Docker's
 * `com.docker.service` is Stopped and needs elevation the session does not
 * have. Rather than leave the app serving a fake in-memory inventory, this runs
 * a real PostgreSQL engine (PGlite, the WASM build) against a directory on
 * disk, with the real PostGIS extension the schema requires.
 *
 * What it is, precisely
 * --------------------
 * A genuine PostgreSQL engine executing genuine SQL with genuine PostGIS 3.6.
 * Data is written to `dataDir` and survives restart. It is NOT a shared server:
 * it is embedded in this Node process, and because PGlite serves one connection,
 * that connection is shared by every caller - see "Known limits".
 *
 * Two behaviours this adapter must reproduce faithfully
 * ----------------------------------------------------
 * 1. Wire protocol. node-postgres picks its protocol from the arguments:
 *    `query(text)` with no params uses the SIMPLE protocol and accepts several
 *    statements in one string; `query(text, params)` uses the EXTENDED
 *    (prepared) protocol and accepts exactly one. PGlite's `query()` is always
 *    the extended form and rejects multi-statement SQL, so no-params calls go
 *    to `exec()`. The migration runner depends on this - it feeds whole .sql
 *    files to `client.query()`.
 *
 * 2. Result shape. PGlite's `exec()` answers with an ARRAY, one entry per
 *    statement; `query()` answers with a single object. node-postgres hands the
 *    caller only the final statement's result, so the last entry is taken.
 *    Reading `.rows` off that array yields undefined, which would quietly
 *    become an empty result set instead of an error.
 *
 * Known limits, stated rather than hidden
 * ---------------------------------------
 * PGlite serves one connection, so:
 * - Two transactions genuinely in flight at once cannot be isolated from each
 *   other the way separate server connections would be. Checkout is serialised
 *   (a second `connect()` waits), so `job-fence`, `hunt-store` and
 *   `ingestSnapshot` - which each hold one client for their whole transaction -
 *   are safe. A `pool.query()` from a *different* concurrent request would
 *   join the open transaction rather than waiting on it.
 * - Throughput is single-connection. Fine for this app's operator-beta load;
 *   not a substitute for a real Postgres under concurrent load. Point
 *   DATABASE_URL at a real server and this file is never loaded.
 */

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../.cache/pgdata');
const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

// PGlite answers one query at a time. A caller waiting on checkout gets this
// instead of hanging forever if a previous holder never releases.
const CONNECT_TIMEOUT_MS = 30_000;

// One in-flight "checkout" at a time. Scoped to the async call flow so that a
// pool.query() issued from inside a flow that already holds the connection -
// the single most common node-postgres pattern, and one the discovery store
// relies on - runs on that connection instead of deadlocking against it.
const flowStorage = new AsyncLocalStorage();

function loadRuntime() {
  // Required lazily so the production dependency graph is unchanged for anyone
  // running an external PostgreSQL: these are devDependencies, and a missing
  // module must not break a deployment that never asked for this mode.
  const { PGlite } = require('@electric-sql/pglite');
  const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
  const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
  const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
  const postgisModule = require('@electric-sql/pglite-postgis');
  const postgis = postgisModule.postgis || postgisModule.default || postgisModule;
  if (!postgis) throw new Error('@electric-sql/pglite-postgis exported no postgis extension');
  // pg_trgm and pgcrypto are created by the discovery migrations; registering
  // the bundles here is what makes those CREATE EXTENSION statements succeed.
  return { PGlite, extensions: { postgis, uuid_ossp, pg_trgm, pgcrypto } };
}

/**
 * Run `fn` with exclusive use of the one connection. If the current async flow
 * already holds it, run inline - that is the re-entrancy node-postgres gets for
 * free from connection pooling.
 */
function withConnection(storage, exclusive, fn) {
  if (storage.flow) return Promise.resolve(fn(storage.client));
  return storage.waiter.acquire().then(() => {
    storage.flow = true;
    storage.client = exclusive;
    return flowStorage.run(storage, () => Promise.resolve()
      .then(fn)
      .finally(() => {
        storage.flow = false;
        storage.client = null;
        storage.waiter.release();
      }));
  });
}

/** One permit, FIFO. */
class SingleConnectionGate {
  constructor(timeoutMs = CONNECT_TIMEOUT_MS) {
    this.held = false;
    this.queue = [];
    this.timeoutMs = timeoutMs;
  }

  acquire() {
    if (!this.held) {
      this.held = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.queue.indexOf(waiter);
        if (index !== -1) this.queue.splice(index, 1);
        reject(new Error(
          `Timed out after ${this.timeoutMs}ms waiting for the embedded PostgreSQL connection`
        ));
      }, this.timeoutMs);
      this.queue.push(waiter);
    });
  }

  release() {
    const next = this.queue.shift();
    if (!next) {
      this.held = false;
      return;
    }
    clearTimeout(next.timer);
    next.resolve();
  }
}

/**
 * Adapt a PGlite result to the `pg` result shape the app already reads.
 * `rowCount` matters: call sites branch on it to tell an upsert that inserted
 * from one that updated.
 */
function toPgResult(result) {
  const last = Array.isArray(result) ? result[result.length - 1] : result;
  if (!last) return { rows: [], rowCount: 0, fields: [], command: '', oid: null };
  return {
    rows: last.rows || [],
    rowCount: last.rowCount != null
      ? last.rowCount
      : (last.affectedRows != null ? last.affectedRows : (last.rows ? last.rows.length : 0)),
    fields: last.fields || [],
    command: last.command || '',
    oid: null,
  };
}

async function runSql(db, text, params) {
  if (params === undefined || params === null) return db.exec(text);
  return db.query(text, params);
}

/**
 * A `pg`-compatible client bound to the one connection. Holds checkout from
 * connect() until release(), so a transaction's own statements cannot be
 * interleaved with another checkout.
 */
class EmbeddedClient {
  constructor(pool, storage) {
    this._pool = pool;
    this._storage = storage;
    this._released = false;
    this.on = () => {};        // pg Client emits 'error'; nothing listens here
  }

  query(text, params) {
    if (this._released) {
      return Promise.reject(new Error('Cannot run a query on a released embedded PostgreSQL client'));
    }
    return withConnection(this._storage, this, async () => {
      try {
        return toPgResult(await runSql(this._pool._db, text, params));
      } catch (err) {
        throw decorate(err);
      }
    });
  }

  /**
   * Give the connection back. This is what ends the checkout: the flow stops
   * being the holder and the next `connect()` proceeds. Calling it twice is a
   * no-op, matching node-postgres.
   */
  release() {
    if (this._released) return;
    this._released = true;
    if (this._storage.flow && this._storage.client === this) {
      this._storage.flow = false;
      this._storage.client = null;
      this._storage.waiter.release();
    }
  }
}

class EmbeddedPool {
  constructor(db, options = {}) {
    this._db = db;
    this._waiter = new SingleConnectionGate(options.connectTimeoutMs);
    this._storage = { flow: false, client: null, waiter: this._waiter };
    this.ended = false;
    this.on = () => {};
  }

  query(text, params) {
    if (this.ended) return Promise.reject(new Error('Embedded PostgreSQL pool has ended'));
    return withConnection(this._storage, null, async () => {
      try {
        return toPgResult(await runSql(this._db, text, params));
      } catch (err) {
        throw decorate(err);
      }
    });
  }

  connect() {
    if (this.ended) return Promise.reject(new Error('Embedded PostgreSQL pool has ended'));
    const storage = this._storage;
    return new Promise((resolve, reject) => {
      this._waiter.acquire().then(() => {
        const client = new EmbeddedClient(this, storage);
        storage.flow = true;
        storage.client = client;
        // Hand the connection to the caller's flow. Every later query in that
        // flow - including plain pool.query() calls - resolves to this client.
        flowStorage.run(storage, () => resolve(client));
      }, reject);
    });
  }

  async end() {
    if (this.ended) return;
    this.ended = true;
    await this._db.close();
  }
}

/**
 * PGlite surfaces engine errors as plain Error. node-postgres callers in this
 * codebase check `.code` (e.g. '23505' for a unique violation), so preserve it
 * when the engine gave us one.
 */
function decorate(err) {
  if (err && typeof err === 'object' && !err.code && err.cause && err.cause.code) {
    err.code = err.cause.code;
  }
  return err;
}

async function schemaIsPresent(db) {
  const result = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'listings'`
  );
  return Number(result.rows[0].n) > 0;
}

/**
 * Boot the embedded database: apply the real schema when absent, prove the
 * engine answers, and hand back a `pg`-shaped pool.
 *
 * @param {object} [options]
 * @param {string}   [options.dataDir]      where the database lives on disk
 * @param {string}   [options.schemaPath]   defaults to server/db/schema.sql
 * @param {boolean}  [options.applySchema] default true
 * @param {function} [options.log]
 */
async function startEmbeddedPostgres(options = {}) {
  const log = options.log || (() => {});
  const dataDir = path.resolve(options.dataDir || process.env.PROPERTY_PG_DATA_DIR || DEFAULT_DATA_DIR);
  const schemaPath = options.schemaPath || DEFAULT_SCHEMA_PATH;

  fs.mkdirSync(dataDir, { recursive: true });
  const { PGlite, extensions } = loadRuntime();
  const db = new PGlite({ dataDir, extensions });

  // The extension bundles are registered above; CREATE EXTENSION is what makes
  // the functions actually exist. schema.sql does this itself, but a directory
  // created before PostGIS was added would otherwise be unusable.
  await db.exec('CREATE EXTENSION IF NOT EXISTS postgis;');
  await db.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

  // Applied every boot, not only into an empty directory. Every statement in
  // schema.sql is idempotent - CREATE ... IF NOT EXISTS, CREATE OR REPLACE,
  // and INSERT ... ON CONFLICT DO NOTHING - and that matters: gating the apply
  // on "is the listings table there" meant a newly added seed row never reached
  // an existing database, so two real scrapers' records could not be stored
  // and the FK failure looked like missing data rather than a missing seed.
  if (options.applySchema !== false) {
    const fresh = !(await schemaIsPresent(db));
    await db.exec(fs.readFileSync(schemaPath, 'utf8'));
    log(`[PG] applied schema from ${path.relative(process.cwd(), schemaPath)}${fresh ? '' : ' (idempotent re-apply)'}`);
  }

  // A Pool is not a connection. Prove the engine answers before claiming the
  // database is up, so a broken data directory can never look healthy.
  const probe = await db.query('SELECT postgis_version() AS postgis');
  const version = probe.rows[0] && probe.rows[0].postgis;
  if (!version) throw new Error('Embedded PostgreSQL started without a usable PostGIS');

  const pool = new EmbeddedPool(db, options);
  log(`[PG] embedded PostgreSQL ready at ${dataDir} (PostGIS ${version}); embedded, single connection`);

  return { db, pool, dataDir, postgisVersion: version, engine: 'pglite-embedded' };
}

module.exports = { startEmbeddedPostgres, EmbeddedPool, DEFAULT_DATA_DIR };