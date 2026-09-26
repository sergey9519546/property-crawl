'use strict';

// test/security/operator-token-helpers.test.js
//
// Direct unit coverage for server/security/operator-token.js. The
// operator token gates scraper admin endpoints; resolution priority
// and missing-token behavior are pinned.
//
//   - resolveOperatorToken: SCRAPER_ADMIN_TOKEN wins over the alias
//   - resolveOperatorToken: PROPERTY_OPERATOR_SECRET is the alias
//   - operatorTokenConfigured: returns true iff a non-empty token resolves
//   - whitespace and empty-string handling

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveOperatorToken,
  operatorTokenConfigured,
} = require('../../server/security/operator-token');

// --- resolveOperatorToken ----------------------------------------------

test('resolveOperatorToken: SCRAPER_ADMIN_TOKEN takes precedence', () => {
  assert.equal(resolveOperatorToken({
    SCRAPER_ADMIN_TOKEN: 'primary-xyz',
    PROPERTY_OPERATOR_SECRET: 'alias-abc',
  }), 'primary-xyz');
});

test('resolveOperatorToken: falls back to PROPERTY_OPERATOR_SECRET', () => {
  assert.equal(resolveOperatorToken({
    SCRAPER_ADMIN_TOKEN: '',
    PROPERTY_OPERATOR_SECRET: 'alias-abc',
  }), 'alias-abc');
});

test('resolveOperatorToken: returns empty string when both unset', () => {
  assert.equal(resolveOperatorToken({}), '');
});

test('resolveOperatorToken: trims surrounding whitespace', () => {
  assert.equal(resolveOperatorToken({ SCRAPER_ADMIN_TOKEN: '  tok-1  ' }), 'tok-1');
  assert.equal(resolveOperatorToken({ PROPERTY_OPERATOR_SECRET: '\tabc\n' }), 'abc');
});

test('resolveOperatorToken: whitespace-only primary falls back to alias', () => {
  assert.equal(resolveOperatorToken({
    SCRAPER_ADMIN_TOKEN: '   ',
    PROPERTY_OPERATOR_SECRET: 'fallback',
  }), 'fallback');
});

// --- operatorTokenConfigured -------------------------------------------

test('operatorTokenConfigured: true when SCRAPER_ADMIN_TOKEN set', () => {
  assert.equal(operatorTokenConfigured({ SCRAPER_ADMIN_TOKEN: 'tok' }), true);
});

test('operatorTokenConfigured: true when only alias set', () => {
  assert.equal(operatorTokenConfigured({ PROPERTY_OPERATOR_SECRET: 'tok' }), true);
});

test('operatorTokenConfigured: false when neither set', () => {
  assert.equal(operatorTokenConfigured({}), false);
});

test('operatorTokenConfigured: false when both empty / whitespace', () => {
  assert.equal(operatorTokenConfigured({ SCRAPER_ADMIN_TOKEN: '', PROPERTY_OPERATOR_SECRET: '   ' }), false);
});