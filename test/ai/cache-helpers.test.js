'use strict';

// test/ai/cache-helpers.test.js
//
// Direct unit coverage for server/ai/cache.js. The cache's hashPrompt
// method is the only pure part of the module — it pins the SHA-256
// contract so the cache lookup works across processes and restarts.
// Silent drift in the hash function would silently invalidate every
// cached AI response.
//
//   - hashPrompt: deterministic for the same (prompt, model)
//   - hashPrompt: whitespace-trimmed prompt input
//   - hashPrompt: model is part of the input
//   - hashPrompt: 64-character hex digest
//   - hashPrompt: different prompts / models yield different hashes

const assert = require('node:assert/strict');
const test = require('node:test');

const AiCache = require('../../server/ai/cache');

// --- hashPrompt --------------------------------------------------------

test('hashPrompt: deterministic for the same prompt + model', () => {
  const a = AiCache.hashPrompt('hello', 'gpt-4o-mini');
  const b = AiCache.hashPrompt('hello', 'gpt-4o-mini');
  assert.equal(a, b);
});

test('hashPrompt: different models produce different hashes', () => {
  const a = AiCache.hashPrompt('hello', 'gpt-4o-mini');
  const b = AiCache.hashPrompt('hello', 'gpt-4o');
  assert.notEqual(a, b);
});

test('hashPrompt: different prompts produce different hashes', () => {
  const a = AiCache.hashPrompt('hello', 'gpt-4o-mini');
  const b = AiCache.hashPrompt('world', 'gpt-4o-mini');
  assert.notEqual(a, b);
});

test('hashPrompt: prompt whitespace is trimmed before hashing', () => {
  const a = AiCache.hashPrompt('  hello  ', 'gpt-4o-mini');
  const b = AiCache.hashPrompt('hello', 'gpt-4o-mini');
  assert.equal(a, b);
});

test('hashPrompt: empty model is allowed and produces a stable hash', () => {
  const h = AiCache.hashPrompt('hello', '');
  assert.equal(h.length, 64);
  // Determinism check
  assert.equal(h, AiCache.hashPrompt('hello', ''));
});

test('hashPrompt: defaults model to empty string', () => {
  const a = AiCache.hashPrompt('hello');
  const b = AiCache.hashPrompt('hello', '');
  assert.equal(a, b);
});

test('hashPrompt: returns a 64-character hex digest', () => {
  const h = AiCache.hashPrompt('hello', 'gpt-4o-mini');
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('hashPrompt: matches a known SHA-256 of "gpt-4o-mini:hello"', () => {
  // Pre-computed reference: SHA-256 of "gpt-4o-mini:hello"
  const crypto = require('node:crypto');
  const expected = crypto.createHash('sha256').update('gpt-4o-mini:hello').digest('hex');
  assert.equal(AiCache.hashPrompt('hello', 'gpt-4o-mini'), expected);
});