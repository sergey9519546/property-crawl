'use strict';

/**
 * Unit coverage for Next workspace mutation gate (CSRF residual).
 * Loaded via next/dist/build/swc transform like other src/lib tests.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

function loadTs(relative) {
  const filename = path.resolve(__dirname, '..', relative);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = instance.require.bind(instance);
  instance.require = function (name) {
    if (name === 'server-only') return {};
    return originalRequire(name);
  };
  instance._compile(transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    module: { type: 'commonjs' },
    jsc: { parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
  }).code, filename);
  return instance.exports;
}

const { workspaceMutationAllowed } = loadTs('src/lib/workspace-session.ts');

function req(url, headers = {}) {
  return {
    url,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === key) return v;
        }
        return null;
      },
    },
  };
}

test('mutation allowed for same-origin Origin including loopback 0.0.0.0 normalize', () => {
  assert.equal(workspaceMutationAllowed(req('http://127.0.0.1:3000/api/x', { origin: 'http://localhost:3000' })), true);
  assert.equal(workspaceMutationAllowed(req('http://0.0.0.0:3700/api/x', { origin: 'http://127.0.0.1:3700' })), true);
});

test('mutation requires x-workspace-request when Origin is missing', () => {
  assert.equal(workspaceMutationAllowed(req('http://127.0.0.1:3000/api/x', {})), false);
  assert.equal(workspaceMutationAllowed(req('http://127.0.0.1:3000/api/x', { 'x-workspace-request': '1' })), true);
});

test('cross-site sec-fetch-site is denied even with matching origin header spoof', () => {
  assert.equal(
    workspaceMutationAllowed(req('http://127.0.0.1:3000/api/x', {
      origin: 'http://127.0.0.1:3000',
      'sec-fetch-site': 'cross-site',
    })),
    false
  );
});

test('attacker X-Forwarded-Host cannot mint same-origin for foreign Origin', () => {
  const allowed = workspaceMutationAllowed(req('http://127.0.0.1:3970/api/x', {
    origin: 'https://evil.example',
    host: 'evil.example',
    'x-forwarded-host': 'evil.example',
    'x-forwarded-proto': 'https',
  }));
  assert.equal(allowed, false);
});
