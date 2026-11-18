'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ensureEdgeMiddlewareManifest } = require('../scripts/ensure-edge-middleware-manifest');

function makeTempDist(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const serverDir = path.join(dir, 'server');
  fs.mkdirSync(serverDir, { recursive: true });
  return { dir, serverDir };
}

test('ensureEdgeMiddlewareManifest removes /_middleware when Turbopack emitted edge chunks and stub middleware.js', () => {
  const { dir, serverDir } = makeTempDist('pc-edge-mw-pos-');
  try {
    fs.writeFileSync(path.join(serverDir, 'functions-config-manifest.json'), JSON.stringify({
      version: 1,
      functions: {
        '/_middleware': { runtime: 'nodejs', matchers: [{ originalSource: '/:path*' }] },
        '/api/health': {},
      },
    }));
    fs.writeFileSync(path.join(serverDir, 'middleware-manifest.json'), JSON.stringify({
      sortedMiddleware: ['/'],
      middleware: { '/': { files: ['server/edge/chunks/proxy.js'] } },
    }));
    fs.writeFileSync(path.join(serverDir, 'middleware.js'), '// Turbopack proxy compatibility module\nmodule.exports = {};\n');

    const res = ensureEdgeMiddlewareManifest({ distDir: dir });
    assert.equal(res.updated, true);

    const updated = JSON.parse(fs.readFileSync(path.join(serverDir, 'functions-config-manifest.json'), 'utf8'));
    assert.equal(updated.functions['/_middleware'], undefined);
    assert.deepEqual(updated.functions['/api/health'], {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureEdgeMiddlewareManifest leaves /_middleware intact when a real non-stub middleware.js exists', () => {
  const { dir, serverDir } = makeTempDist('pc-edge-mw-neg-');
  try {
    fs.writeFileSync(path.join(serverDir, 'functions-config-manifest.json'), JSON.stringify({
      version: 1,
      functions: { '/_middleware': { runtime: 'nodejs' } },
    }));
    fs.writeFileSync(path.join(serverDir, 'middleware-manifest.json'), JSON.stringify({
      sortedMiddleware: ['/'],
      middleware: { '/': { files: ['server/edge/chunks/proxy.js'] } },
    }));
    fs.writeFileSync(path.join(serverDir, 'middleware.js'), 'module.exports = async function realMiddleware() {};\n');

    const res = ensureEdgeMiddlewareManifest({ distDir: dir });
    assert.equal(res.updated, false);
    assert.equal(res.reason, 'real-node-middleware-present');

    const kept = JSON.parse(fs.readFileSync(path.join(serverDir, 'functions-config-manifest.json'), 'utf8'));
    assert.equal(kept.functions['/_middleware'].runtime, 'nodejs');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
