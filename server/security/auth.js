'use strict';

/**
 * Role-Based Access Control (RBAC) definitions and permission enforcement.
 *
 * Canonical Roles:
 * - operator: Highest privilege (full write/unlock/export/scrapers run/purge).
 * - analyst:  Read listings, save hunts, view documents, run research export.
 * - viewer:   Read-only (listings, public source radar; cannot trigger runs or mutate cases).
 *
 * Canonical Permissions:
 * - canRunScrapers
 * - canReviewDocuments
 * - canExportDossier
 * - canManageHunts
 * - canViewWorkspace
 */

const ROLES = Object.freeze({
  OPERATOR: 'operator',
  ANALYST: 'analyst',
  VIEWER: 'viewer',
});

const CANONICAL_ROLES = Object.freeze(['operator', 'analyst', 'viewer']);

const PERMISSIONS = Object.freeze([
  'canRunScrapers',
  'canReviewDocuments',
  'canExportDossier',
  'canManageHunts',
  'canViewWorkspace',
]);

const ROLE_PERMISSIONS = Object.freeze({
  operator: Object.freeze(new Set([
    'canRunScrapers',
    'canReviewDocuments',
    'canExportDossier',
    'canManageHunts',
    'canViewWorkspace',
  ])),
  analyst: Object.freeze(new Set([
    'canReviewDocuments',
    'canExportDossier',
    'canManageHunts',
    'canViewWorkspace',
  ])),
  viewer: Object.freeze(new Set([
    'canViewWorkspace',
  ])),
});

const ROLE_HIERARCHY = Object.freeze({
  operator: 3,
  analyst: 2,
  viewer: 1,
});

/**
 * Checks if a given role has a specified permission.
 *
 * @param {string|null|undefined} role - The role to evaluate ('operator', 'analyst', 'viewer')
 * @param {string} permission - The permission name to test
 * @param {object} [options={}] - Options (e.g. { authenticated: true })
 * @returns {boolean}
 */
function hasPermission(role, permission, options = {}) {
  if (!role || typeof role !== 'string') return false;
  const normalizedRole = role.trim().toLowerCase();
  if (!CANONICAL_ROLES.includes(normalizedRole)) return false;

  // Viewer role has NO mutation permissions (canRunScrapers, canReviewDocuments, canExportDossier, canManageHunts).
  // Viewer can only view workspace if explicitly authenticated.
  if (normalizedRole === 'viewer') {
    if (permission === 'canViewWorkspace') {
      return options.authenticated !== false;
    }
    return false;
  }

  const perms = ROLE_PERMISSIONS[normalizedRole];
  return Boolean(perms && perms.has(permission));
}

/**
 * Extracts or resolves the role from an incoming token, credential, or session representation.
 * Backward compatible: tokens without an explicit role default to 'operator'.
 *
 * @param {string|object|null|undefined} token - Token string or object
 * @param {object} [options={}] - Options: { defaultRole: 'operator', allowNull: false }
 * @returns {string|null}
 */
function extractRoleFromToken(token, options = {}) {
  const defaultRole = options.defaultRole || ROLES.OPERATOR;
  if (!token) {
    return options.allowNull ? null : defaultRole;
  }

  if (typeof token === 'object') {
    if (token.role && typeof token.role === 'string') {
      const candidate = token.role.trim().toLowerCase();
      if (CANONICAL_ROLES.includes(candidate)) return candidate;
    }
    return defaultRole;
  }

  if (typeof token === 'string') {
    const trimmed = token.trim();
    if (!trimmed) {
      return options.allowNull ? null : defaultRole;
    }

    // Check JSON representation (e.g. {"role":"analyst",...})
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.role && typeof parsed.role === 'string') {
          const candidate = parsed.role.trim().toLowerCase();
          if (CANONICAL_ROLES.includes(candidate)) return candidate;
        }
      } catch {}
    }

    // Check prefixed token formats:
    // e.g. "analyst:abc123secret", "viewer:token", "operator:xyz"
    // or "analyst_key", "analyst.token"
    const prefixMatch = trimmed.match(/^(operator|analyst|viewer)[:._/-]/i);
    if (prefixMatch) {
      return prefixMatch[1].toLowerCase();
    }

    // Check URL / query formatted strings (e.g. "role=analyst&token=...")
    const queryMatch = trimmed.match(/(?:^|[&?])role=(operator|analyst|viewer)(?:[&;]|$)/i);
    if (queryMatch) {
      return queryMatch[1].toLowerCase();
    }

    // Check v2 session cookie format: v2.<expiresAt>.<role>.<random>.<sig>
    const v2Match = trimmed.match(/^v2\.\d+\.(operator|analyst|viewer)\./i);
    if (v2Match) {
      return v2Match[1].toLowerCase();
    }

    // Missing role in token: defaults to operator for single-operator backward compatibility
    return defaultRole;
  }

  return defaultRole;
}

/**
 * Checks if userRole has at least the privilege level of requiredRole.
 *
 * @param {string} userRole
 * @param {string} requiredRole
 * @returns {boolean}
 */
function isAtLeastRole(userRole, requiredRole) {
  const userLevel = ROLE_HIERARCHY[String(userRole || '').trim().toLowerCase()] || 0;
  const reqLevel = ROLE_HIERARCHY[String(requiredRole || '').trim().toLowerCase()] || 0;
  return userLevel >= reqLevel && reqLevel > 0;
}

module.exports = {
  ROLES,
  CANONICAL_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_HIERARCHY,
  hasPermission,
  extractRoleFromToken,
  isAtLeastRole,
};
