'use strict';

const fs = require('fs');
const path = require('path');

const STUB_MARKER = 'Turbopack proxy compatibility module';

function resolveDistDir(rootDir = process.cwd(), env = process.env) {
  if (env.NEXT_DISCOVERY_PREVIEW === '1') return path.join(rootDir, '.next-discovery-preview');
  if (env.NEXT_VERIFY_BUILD === 'sources') return path.join(rootDir, '.next-sources-verify');
  if (env.NEXT_VERIFY_BUILD === '1') return path.join(rootDir, '.next-verify');
  return path.join(rootDir, '.next');
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Next 16 Turbopack compiles src/proxy.ts into the Edge bundle inside
 * server/middleware-manifest.json while still recording "/_middleware" as
 * nodejs in server/functions-config-manifest.json. Removing that conflicting
 * nodejs entry when server/middleware.js is only a compatibility stub lets
 * @vercel/next deploy the compiled Edge middleware bundle cleanly.
 */
function ensureEdgeMiddlewareManifest({ rootDir = process.cwd(), distDir = resolveDistDir(rootDir) } = {}) {
  const serverDir = path.join(distDir, 'server');
  const fcmPath = path.join(serverDir, 'functions-config-manifest.json');
  const mmPath = path.join(serverDir, 'middleware-manifest.json');
  const middlewareJsPath = path.join(serverDir, 'middleware.js');

  const fcm = readJsonSafe(fcmPath);
  const mm = readJsonSafe(mmPath);
  if (!fcm?.functions?.['/_middleware'] || !Array.isArray(mm?.sortedMiddleware) || mm.sortedMiddleware.length === 0) {
    return { updated: false, reason: 'no-conflict' };
  }

  const hasEdgeEntry = mm.sortedMiddleware.every((key) => {
    const entry = mm.middleware?.[key];
    return entry && Array.isArray(entry.files) && entry.files.length > 0;
  });
  if (!hasEdgeEntry) {
    return { updated: false, reason: 'missing-edge-bundle' };
  }

  const middlewareSource = fs.existsSync(middlewareJsPath)
    ? fs.readFileSync(middlewareJsPath, 'utf8')
    : '';
  const isStubOrMissing = !middlewareSource || middlewareSource.includes(STUB_MARKER);
  if (!isStubOrMissing) {
    return { updated: false, reason: 'real-node-middleware-present' };
  }

  delete fcm.functions['/_middleware'];
  fs.writeFileSync(fcmPath, JSON.stringify(fcm, null, 2));
  return { updated: true, fcmPath };
}

if (require.main === module) {
  const res = ensureEdgeMiddlewareManifest();
  if (res.updated) {
    console.log(`[ensure-edge-middleware-manifest] deferred /_middleware to edge bundle in ${res.fcmPath}`);
  } else {
    console.log(`[ensure-edge-middleware-manifest] skipped (${res.reason})`);
  }
}

module.exports = {
  ensureEdgeMiddlewareManifest,
  resolveDistDir,
};
