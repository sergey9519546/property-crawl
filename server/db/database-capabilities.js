'use strict';

const { REQUIRED_TABLES } = require('../discovery-readiness');

// What the database named by DATABASE_URL must already be, or what
// AUTO_MIGRATE=1 must be able to create, before this process is functional.
// SELECT 1 only proves the URL opens. Migrations install the four extensions
// into public, and every query uses unqualified names, so public has to be
// on search_path. Listings read geography and the columns added after the
// original table (triage_priority was the live miss). Discovery readiness
// reads discovery_jobs lease columns and discovery_source_runs.coverage.
const REQUIRED_EXTENSIONS = ['postgis', 'uuid-ossp', 'pg_trgm', 'pgcrypto'];
const EXTRA_TABLES = [
  'sources',
  'saved_deals',
  'listing_history',
  'saved_searches',
  'alert_matches',
  'ai_cache',
  'source_observations',
  'source_observation_runs',
  'document_reviews',
  'accounts',
  'account_login_tokens',
  'stripe_webhook_events',
  'worker_leases',
  'discovery_atlas_ledger',
  'discovery_schema_migrations',
  'mv_neighborhood_stats',
];
const REQUIRED_COLUMNS = [
  ['listings', 'geog'],
  ['listings', 'equity_spread'],
  ['listings', 'auction_program'],
  ['listings', 'lifecycle_status'],
  ['listings', 'transaction_outcome'],
  ['listings', 'has_documents'],
  ['listings', 'provenance'],
  ['listings', 'source_observed_at'],
  ['listings', 'status'],
  ['listings', 'triage_priority'],
  ['listings', 'triage_priority_refreshed_at'],
  ['discovery_jobs', 'status'],
  ['discovery_jobs', 'idempotency_scope_hash'],
  ['discovery_jobs', 'lease_owner'],
  ['discovery_jobs', 'lease_expires_at'],
  ['discovery_source_runs', 'coverage'],
];
const MIN_SERVER_VERSION_NUM = 140000;

function requiredRelationNames() {
  return [...new Set([...REQUIRED_TABLES, ...EXTRA_TABLES])];
}

function asJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

async function probeDatabaseCapabilities(pool) {
  if (!pool || typeof pool.query !== 'function') {
    return { functional: false, missing: ['connection'], version: null, postgisVersion: null };
  }
  const names = requiredRelationNames();
  const columnTables = [...new Set(REQUIRED_COLUMNS.map(([table]) => table))];
  const columnNames = [...new Set(REQUIRED_COLUMNS.map(([, column]) => column))];
  const result = await pool.query(
    `SELECT current_setting('server_version_num')::int AS version_num,
            current_setting('server_version') AS version,
            EXISTS (
              SELECT 1 FROM unnest(string_to_array(current_setting('search_path'), ',')) AS path(entry)
              WHERE btrim(entry) IN ('public', '"public"')
            ) AS public_visible,
            has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
            has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
            has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
            CASE WHEN to_regclass('public.listings') IS NULL THEN NULL
                 ELSE has_table_privilege(current_user, 'public.listings', 'SELECT') END AS listings_select,
            CASE WHEN to_regclass('public.listings') IS NULL THEN NULL
                 ELSE has_table_privilege(current_user, 'public.listings', 'INSERT') END AS listings_insert,
            CASE WHEN to_regclass('public.listings') IS NULL THEN NULL
                 ELSE has_table_privilege(current_user, 'public.listings', 'UPDATE') END AS listings_update,
            CASE WHEN to_regclass('public.listings') IS NULL THEN NULL
                 ELSE has_table_privilege(current_user, 'public.listings', 'DELETE') END AS listings_delete,
            to_regtype('geography') IS NOT NULL AS geography,
            EXISTS (
              SELECT 1 FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname = 'uuid_generate_v4' AND n.nspname = ANY (current_schemas(true))
            ) AS uuid_generate_v4,
            EXISTS (
              SELECT 1 FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname = 'st_dwithin' AND n.nspname = ANY (current_schemas(true))
            ) AS st_dwithin,
            EXISTS (
              SELECT 1 FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname = 'digest' AND n.nspname = ANY (current_schemas(true))
            ) AS digest,
            EXISTS (
              SELECT 1 FROM pg_opclass oc
              JOIN pg_namespace n ON n.oid = oc.opcnamespace
              WHERE oc.opcname = 'gin_trgm_ops' AND n.nspname = ANY (current_schemas(true))
            ) AS gin_trgm_ops,
            (SELECT coalesce(jsonb_object_agg(extname, extversion), '{}'::jsonb)
               FROM pg_extension WHERE extname = ANY($1::text[])) AS extensions,
            (SELECT coalesce(jsonb_agg(c.relname), '[]'::jsonb)
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relkind IN ('r', 'p', 'v', 'm')
                AND c.relname = ANY($2::text[])) AS tables,
            (SELECT coalesce(jsonb_agg(table_name || '.' || column_name), '[]'::jsonb)
               FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = ANY($3::text[])
                AND column_name = ANY($4::text[])) AS columns`,
    [REQUIRED_EXTENSIONS, names, columnTables, columnNames]
  );
  const row = result.rows[0] || {};
  const extensions = asJson(row.extensions, {});
  const present = new Set(asJson(row.tables, []));
  const presentColumns = new Set(asJson(row.columns, []));
  const missing = [];
  if (!Number.isInteger(row.version_num) || row.version_num < MIN_SERVER_VERSION_NUM) {
    missing.push(`postgresql>=14 (connected ${row.version || 'unknown'})`);
  }
  if (row.public_visible !== true) missing.push('search_path:public');
  if (row.schema_usage !== true) missing.push('privilege:public:usage');
  if (row.schema_create !== true) missing.push('privilege:public:create');
  if (row.database_create !== true) missing.push('privilege:database:create');
  if (row.listings_select === false) missing.push('privilege:listings:select');
  if (row.listings_insert === false) missing.push('privilege:listings:insert');
  if (row.listings_update === false) missing.push('privilege:listings:update');
  if (row.listings_delete === false) missing.push('privilege:listings:delete');
  for (const name of REQUIRED_EXTENSIONS) {
    if (extensions[name] == null) missing.push(`extension:${name}`);
  }
  if (row.geography !== true) missing.push('type:geography');
  if (row.uuid_generate_v4 !== true) missing.push('function:uuid_generate_v4');
  if (row.st_dwithin !== true) missing.push('function:st_dwithin');
  if (row.digest !== true) missing.push('function:digest');
  if (row.gin_trgm_ops !== true) missing.push('opclass:gin_trgm_ops');
  for (const name of names) {
    if (!present.has(name)) missing.push(`table:${name}`);
  }
  for (const [table, column] of REQUIRED_COLUMNS) {
    if (!presentColumns.has(`${table}.${column}`)) missing.push(`column:${table}.${column}`);
  }
  let postgisVersion = extensions.postgis || null;
  if (extensions.postgis != null) {
    try {
      const version = await pool.query('SELECT postgis_version() AS v');
      postgisVersion = version.rows[0] && version.rows[0].v;
    } catch {
      missing.push('function:postgis_version');
      postgisVersion = null;
    }
  }
  return {
    functional: missing.length === 0,
    version: row.version || null,
    postgisVersion,
    missing,
  };
}

module.exports = {
  probeDatabaseCapabilities,
  requiredRelationNames,
  REQUIRED_EXTENSIONS,
  REQUIRED_COLUMNS,
  MIN_SERVER_VERSION_NUM,
};
