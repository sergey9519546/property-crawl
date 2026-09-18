'use strict';

/**
 * Operator credential resolution.
 * Primary: SCRAPER_ADMIN_TOKEN
 * Alias:   PROPERTY_OPERATOR_SECRET (Render-generated secret name)
 */

function resolveOperatorToken(env = process.env) {
  const primary = String(env.SCRAPER_ADMIN_TOKEN || '').trim();
  if (primary) return primary;
  return String(env.PROPERTY_OPERATOR_SECRET || '').trim();
}

function operatorTokenConfigured(env = process.env) {
  return resolveOperatorToken(env).length > 0;
}

module.exports = { resolveOperatorToken, operatorTokenConfigured };
