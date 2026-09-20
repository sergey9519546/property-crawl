'use strict';

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

// source-network.tsx is a large client module; extract pure helpers via transform
// and a light stub for lucide/framer if required.
const filename = path.resolve(__dirname, '..', 'src/components/sources/source-network.tsx');
let compiled;
try {
  compiled = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    module: { type: 'commonjs' },
    jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
  }).code;
} catch {
  compiled = '';
}

test('source-network component distinguishes approved collection gate', () => {
  assert.ok(compiled, 'source-network.tsx must compile for static contract test');
  assert.match(compiled, /Collection approved/);
  assert.match(compiled, /Recurring collection approved/);
  assert.match(compiled, /releaseGate/);
  assert.match(compiled, /OH, NJ promoted run scope/);
  const catalog = fs.readFileSync(path.join(__dirname, '..', 'server/sources/catalog.js'), 'utf8');
  assert.match(catalog, /'hud-homestore': 'SCOPE_LIMITED'/);
  assert.match(catalog, /HUD_STATES=OH,NJ/);
});

test('Docker production image ships database schema for document_reviews', () => {
  const docker = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile.production'), 'utf8');
  assert.match(docker, /server\/db\/schema\.sql/);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'server/db/schema.sql'), 'utf8');
  assert.match(schema, /document_reviews/);
});
