'use strict';

// Which PostgreSQL this process opens: the external DATABASE_URL, the
// in-process engine, or neither.
//
// Local and tests keep the explicit-embedded rule. .env.local and the Base44
// compose set PROPERTY_DB=embedded so a dead localhost DATABASE_URL is not
// dialed. That request still wins off Render.
//
// Render does not. The live service's inventory is external Postgres, and the
// service does not set PROPERTY_DB. render.yaml used to set
// PROPERTY_DB=embedded anyway, and this function used to honor that over
// DATABASE_URL. A blueprint sync would then boot an empty embedded engine and
// leave the real database unopened. RENDER=true is injected by the platform.
// When it is set and DATABASE_URL is set, the external database wins even if
// PROPERTY_DB or PROPERTY_PG_DATA_DIR is also set.

function embeddedDatabaseRequested(env = process.env) {
  return env.PROPERTY_DB === 'embedded' || Boolean(env.PROPERTY_PG_DATA_DIR);
}

function renderHost(env = process.env) {
  return String(env.RENDER) === 'true';
}

function resolveDatabaseTarget(env = process.env) {
  const embedded = embeddedDatabaseRequested(env);
  const hasUrl = Boolean(env.DATABASE_URL);
  if (embedded && hasUrl && renderHost(env)) return 'tcp';
  if (embedded) return 'embedded';
  if (hasUrl) return 'tcp';
  return 'missing';
}

function databaseTargetReason(env = process.env) {
  if (embeddedDatabaseRequested(env) && env.DATABASE_URL && renderHost(env)) {
    return 'RENDER is set and DATABASE_URL is configured, so PROPERTY_DB/PROPERTY_PG_DATA_DIR is ignored and the external database is used.';
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
