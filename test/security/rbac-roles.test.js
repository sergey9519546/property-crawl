'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

// Load CommonJS module from server/security/auth.js
const serverAuth = require('../../server/security/auth.js');

// Load TypeScript module from src/lib/workspace-session.ts via swc
function loadTs(relative) {
  const filename = path.resolve(__dirname, '../..', relative);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = instance.require.bind(instance);
  instance.require = function (name) {
    if (name === 'server-only') return {};
    return originalRequire(name);
  };
  instance._compile(
    transformSync(fs.readFileSync(filename, 'utf8'), {
      filename,
      module: { type: 'commonjs' },
      jsc: {
        parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') },
        target: 'es2022',
        transform: { react: { runtime: 'automatic' } },
      },
    }).code,
    filename
  );
  return instance.exports;
}

const clientAuth = loadTs('src/lib/workspace-session.ts');

test('RBAC: canonical roles and permissions are defined identically on server and client', () => {
  const expectedRoles = ['operator', 'analyst', 'viewer'];
  const expectedPermissions = [
    'canRunScrapers',
    'canReviewDocuments',
    'canExportDossier',
    'canManageHunts',
    'canViewWorkspace',
  ];

  assert.deepEqual([...serverAuth.CANONICAL_ROLES].sort(), [...expectedRoles].sort());
  assert.deepEqual([...clientAuth.CANONICAL_ROLES].sort(), [...expectedRoles].sort());

  assert.deepEqual([...serverAuth.PERMISSIONS].sort(), [...expectedPermissions].sort());
  assert.deepEqual([...clientAuth.PERMISSIONS].sort(), [...expectedPermissions].sort());
});

test('RBAC: operator role has all permissions', () => {
  for (const perm of serverAuth.PERMISSIONS) {
    assert.equal(serverAuth.hasPermission('operator', perm), true, `server operator should have ${perm}`);
    assert.equal(clientAuth.hasPermission('operator', perm), true, `client operator should have ${perm}`);
  }
});

test('RBAC: analyst role has review, export, hunts, and view workspace, but CANNOT run scrapers', () => {
  assert.equal(serverAuth.hasPermission('analyst', 'canRunScrapers'), false);
  assert.equal(clientAuth.hasPermission('analyst', 'canRunScrapers'), false);

  assert.equal(serverAuth.hasPermission('analyst', 'canReviewDocuments'), true);
  assert.equal(clientAuth.hasPermission('analyst', 'canReviewDocuments'), true);

  assert.equal(serverAuth.hasPermission('analyst', 'canExportDossier'), true);
  assert.equal(clientAuth.hasPermission('analyst', 'canExportDossier'), true);

  assert.equal(serverAuth.hasPermission('analyst', 'canManageHunts'), true);
  assert.equal(clientAuth.hasPermission('analyst', 'canManageHunts'), true);

  assert.equal(serverAuth.hasPermission('analyst', 'canViewWorkspace'), true);
  assert.equal(clientAuth.hasPermission('analyst', 'canViewWorkspace'), true);
});

test('RBAC: viewer role has NO mutation permissions and can only view workspace when authenticated', () => {
  // Mutation permissions must be strictly false
  const mutationPerms = ['canRunScrapers', 'canReviewDocuments', 'canExportDossier', 'canManageHunts'];
  for (const perm of mutationPerms) {
    assert.equal(serverAuth.hasPermission('viewer', perm), false, `server viewer must not have ${perm}`);
    assert.equal(clientAuth.hasPermission('viewer', perm), false, `client viewer must not have ${perm}`);
  }

  // canViewWorkspace is allowed for authenticated viewer
  assert.equal(serverAuth.hasPermission('viewer', 'canViewWorkspace'), true);
  assert.equal(clientAuth.hasPermission('viewer', 'canViewWorkspace'), true);

  // If explicitly unauthenticated, canViewWorkspace fails closed
  assert.equal(serverAuth.hasPermission('viewer', 'canViewWorkspace', { authenticated: false }), false);
  assert.equal(clientAuth.hasPermission('viewer', 'canViewWorkspace', { authenticated: false }), false);
});

test('RBAC: invalid or unknown roles return false for all permissions', () => {
  const invalidRoles = ['guest', 'admin', 'superuser', '', null, undefined, 123, {}];
  for (const role of invalidRoles) {
    assert.equal(serverAuth.hasPermission(role, 'canViewWorkspace'), false);
    assert.equal(serverAuth.hasPermission(role, 'canRunScrapers'), false);
    assert.equal(clientAuth.hasPermission(role, 'canViewWorkspace'), false);
    assert.equal(clientAuth.hasPermission(role, 'canRunScrapers'), false);
  }
});

test('RBAC: role hierarchy ordering operator > analyst > viewer', () => {
  assert.equal(serverAuth.isAtLeastRole('operator', 'operator'), true);
  assert.equal(serverAuth.isAtLeastRole('operator', 'analyst'), true);
  assert.equal(serverAuth.isAtLeastRole('operator', 'viewer'), true);

  assert.equal(serverAuth.isAtLeastRole('analyst', 'operator'), false);
  assert.equal(serverAuth.isAtLeastRole('analyst', 'analyst'), true);
  assert.equal(serverAuth.isAtLeastRole('analyst', 'viewer'), true);

  assert.equal(serverAuth.isAtLeastRole('viewer', 'operator'), false);
  assert.equal(serverAuth.isAtLeastRole('viewer', 'analyst'), false);
  assert.equal(serverAuth.isAtLeastRole('viewer', 'viewer'), true);

  assert.equal(clientAuth.isAtLeastRole('operator', 'analyst'), true);
  assert.equal(clientAuth.isAtLeastRole('analyst', 'operator'), false);
});

test('RBAC: token role extraction extracts prefixed, JSON, and session roles', () => {
  // Prefixed tokens
  assert.equal(serverAuth.extractRoleFromToken('analyst:secret-token-key'), 'analyst');
  assert.equal(serverAuth.extractRoleFromToken('viewer:some-read-token'), 'viewer');
  assert.equal(serverAuth.extractRoleFromToken('operator:master-admin-token'), 'operator');

  // JSON tokens
  assert.equal(serverAuth.extractRoleFromToken('{"role":"analyst","token":"xyz"}'), 'analyst');
  assert.equal(serverAuth.extractRoleFromToken('{"role":"viewer"}'), 'viewer');

  // Object tokens
  assert.equal(serverAuth.extractRoleFromToken({ role: 'analyst' }), 'analyst');
  assert.equal(serverAuth.extractRoleFromToken({ role: 'viewer', id: 'usr_1' }), 'viewer');

  // v2 session cookie format
  assert.equal(serverAuth.extractRoleFromToken('v2.1760000000.analyst.rand.sig'), 'analyst');
  assert.equal(serverAuth.extractRoleFromToken('v2.1760000000.viewer.rand.sig'), 'viewer');

  // Client library parity
  assert.equal(clientAuth.extractRoleFromToken('analyst:secret-token-key'), 'analyst');
  assert.equal(clientAuth.extractRoleFromToken('viewer:some-read-token'), 'viewer');
  assert.equal(clientAuth.extractRoleFromToken({ role: 'analyst' }), 'analyst');
});

test('RBAC: token role extraction maintains 100% backward compatibility for single-operator setups', () => {
  // Unadorned / legacy secret tokens with no role metadata default to operator
  assert.equal(serverAuth.extractRoleFromToken('plain-legacy-secret-token'), 'operator');
  assert.equal(serverAuth.extractRoleFromToken('my-super-secret-admin-pass'), 'operator');
  assert.equal(serverAuth.extractRoleFromToken({ token: 'legacy-token' }), 'operator');

  // Client library parity for legacy tokens
  assert.equal(clientAuth.extractRoleFromToken('plain-legacy-secret-token'), 'operator');
  assert.equal(clientAuth.extractRoleFromToken({ token: 'legacy-token' }), 'operator');

  // Missing token with default options returns operator (for single-operator fallback)
  assert.equal(serverAuth.extractRoleFromToken(undefined), 'operator');
  assert.equal(clientAuth.extractRoleFromToken(undefined), 'operator');

  // If explicit allowNull option is provided, missing token yields null
  assert.equal(serverAuth.extractRoleFromToken(null, { allowNull: true }), null);
  assert.equal(serverAuth.extractRoleFromToken('', { allowNull: true }), null);
  assert.equal(clientAuth.extractRoleFromToken(null, { allowNull: true }), null);
});

test('RBAC: Next workspace-proxy enforces role permissions across private, member, and watchlist proxies', async () => {
  const prevSecret = process.env.SCRAPER_ADMIN_TOKEN;
  const prevAnalyst = process.env.PROPERTY_ANALYST_SECRET;
  const prevViewer = process.env.PROPERTY_VIEWER_SECRET;
  process.env.SCRAPER_ADMIN_TOKEN = 'op-secret-test';
  process.env.PROPERTY_ANALYST_SECRET = 'an-secret-test';
  process.env.PROPERTY_VIEWER_SECRET = 'vw-secret-test';

  const forwardedCalls = [];
  function loadProxy() {
    const filename = path.resolve(__dirname, '../../src/lib/workspace-proxy.ts');
    const instance = new Module(filename, module);
    instance.filename = filename;
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const originalRequire = instance.require.bind(instance);
    instance.require = function (name) {
      if (name === 'server-only') return {};
      if (name === '@/lib/workspace-session') return clientAuth;
      if (name === '@/lib/member-account') return { currentMember: async () => null };
      if (name === '@/lib/property-api') {
        return {
          proxyPropertyApi: async (req, opts = {}) => {
            forwardedCalls.push({ url: req.url, method: req.method, opts });
            return Response.json({ proxied: true, hasToken: Boolean(opts.operatorToken) }, { status: 200 });
          },
        };
      }
      return originalRequire(name);
    };
    instance._compile(
      transformSync(fs.readFileSync(filename, 'utf8'), {
        filename,
        module: { type: 'commonjs' },
        jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      }).code,
      filename
    );
    return instance.exports;
  }

  try {
    const { proxyPrivatePropertyApi, proxyMemberPropertyApi, proxyWatchlistPropertyApi } = loadProxy();
    const makeCookie = (role) => `${clientAuth.WORKSPACE_SESSION_COOKIE}=${clientAuth.issueWorkspaceSession(Date.now(), process.env, role).value}`;

    // 1. Viewer cannot call document-review, scrapers, or hunt mutations
    const viewerHeaders = { cookie: makeCookie('viewer'), origin: 'http://localhost:3001' };
    const docReviewViewer = await proxyPrivatePropertyApi(new Request('http://localhost:3001/api/document-review', { method: 'GET', headers: viewerHeaders }));
    assert.equal(docReviewViewer.status, 403);
    const huntMutateViewer = await proxyMemberPropertyApi(new Request('http://localhost:3001/api/hunts', { method: 'POST', headers: viewerHeaders }));
    assert.equal(huntMutateViewer.status, 403);
    const alertDeleteViewer = await proxyWatchlistPropertyApi(new Request('http://localhost:3001/api/alerts', { method: 'DELETE', headers: viewerHeaders }));
    assert.equal(alertDeleteViewer.status, 403);

    // 2. Viewer watchlist GET stays isolated (no operatorToken credential leak)
    forwardedCalls.length = 0;
    const alertReadViewer = await proxyWatchlistPropertyApi(new Request('http://localhost:3001/api/alerts', { method: 'GET', headers: viewerHeaders }));
    assert.equal(alertReadViewer.status, 200);
    assert.equal(forwardedCalls[0].opts.operatorToken, undefined);

    // 3. Analyst can review documents & manage hunts, but cannot run scrapers or enrichments
    const analystHeaders = { cookie: makeCookie('analyst'), origin: 'http://localhost:3001' };
    const scraperRunAnalyst = await proxyPrivatePropertyApi(new Request('http://localhost:3001/api/scrapers/run', { method: 'POST', headers: analystHeaders }));
    assert.equal(scraperRunAnalyst.status, 403);
    const enrichmentAnalyst = await proxyPrivatePropertyApi(new Request('http://localhost:3001/api/enrichment/refresh', { method: 'POST', headers: analystHeaders }));
    assert.equal(enrichmentAnalyst.status, 403);
    const docReviewAnalyst = await proxyPrivatePropertyApi(new Request('http://localhost:3001/api/document-review', { method: 'GET', headers: analystHeaders }));
    assert.equal(docReviewAnalyst.status, 200);
    const huntCreateAnalyst = await proxyMemberPropertyApi(new Request('http://localhost:3001/api/hunts', { method: 'POST', headers: analystHeaders }));
    assert.equal(huntCreateAnalyst.status, 200);

    // 4. Operator has full access
    const operatorHeaders = { cookie: makeCookie('operator'), origin: 'http://localhost:3001' };
    const scraperRunOp = await proxyPrivatePropertyApi(new Request('http://localhost:3001/api/scrapers/run', { method: 'POST', headers: operatorHeaders }));
    assert.equal(scraperRunOp.status, 200);
  } finally {
    if (prevSecret === undefined) delete process.env.SCRAPER_ADMIN_TOKEN;
    else process.env.SCRAPER_ADMIN_TOKEN = prevSecret;
    if (prevAnalyst === undefined) delete process.env.PROPERTY_ANALYST_SECRET;
    else process.env.PROPERTY_ANALYST_SECRET = prevAnalyst;
    if (prevViewer === undefined) delete process.env.PROPERTY_VIEWER_SECRET;
    else process.env.PROPERTY_VIEWER_SECRET = prevViewer;
  }
});
