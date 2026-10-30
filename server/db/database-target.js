'use strict';

// Which PostgreSQL this process opens: the external DATABASE_URL, the
// in-process engine, or neither.
//
// Local development and tests keep the explicit-embedded rule. .env.local and
// the Base44 compose set PROPERTY_DB=embedded so a dead localhost DATABASE_URL
// is not dialed. That request still wins when neither RENDER=true nor
// NODE_ENV=production is set.
//
// Production hosts (Render, Koyeb, Fly.io, Docker Compose) do not. The live
// service's inventory is external Postgres. render.yaml used to set
// PROPERTY_DB=embedded anyway, and this function used to honor that over
// DATABASE_URL. A blueprint sync or container carrying PROPERTY_DB=embedded
// alongside DATABASE_URL would then boot an empty embedded engine and leave
// the real database unopened. Whenever RENDER=true or NODE_ENV=production is
// set and DATABASE_URL is configured, the external database wins even if
// PROPERTY_DB or PROPERTY_PG_DATA_DIR is also set.

function embeddedDatabaseRequested(env = process.env) {
  return env.PROPERTY_DB === 'embedded' || Boolean(env.PROPERTY_PG_DATA_DIR);
}

function productionHost(env = process.env) {
  return String(env.RENDER) === 'true' || env.NODE_ENV === 'production';
}

function resolveDatabaseTarget(env = process.env) {
  const embedded = embeddedDatabaseRequested(env);
  const hasUrl = Boolean(env.DATABASE_URL);
  if (embedded && hasUrl && productionHost(env)) return 'tcp';
  if (embedded) return 'embedded';
  if (hasUrl) return 'tcp';
  return 'missing';
}

function databaseTargetReason(env = process.env) {
  if (embeddedDatabaseRequested(env) && env.DATABASE_URL && productionHost(env)) {
    const why = String(env.RENDER) === 'true' ? 'RENDER is set' : 'NODE_ENV=production';
    return `${why} and DATABASE_URL is configured, so PROPERTY_DB/PROPERTY_PG_DATA_DIR is ignored and the external database is used.`;
  }
  if (resolveDatabaseTarget(env) === 'embedded' && env.DATABASE_URL) {
    return 'PROPERTY_DB/PROPERTY_PG_DATA_DIR is set, so the embedded engine is used and DATABASE_URL is ignored for this process.';
  }
  return '';
}

module.exports = {
  embeddedDatabaseRequested,
  resolveDatabaseTarget,
  databaseTargetReason,
};
