'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  spaXhrEnabled,
  validateSpaXhrUrl,
  captureSpaXhr,
} = require('../../server/scrapers/spa-xhr');

test('SPA XHR Hardening: validates enabled flags and source allowlists', () => {
  assert.equal(spaXhrEnabled('fannie', {}), false);
  assert.equal(spaXhrEnabled('fannie', { SCRAPLING_SPA_XHR: '1' }), true);
  assert.equal(spaXhrEnabled('freddie', { SCRAPLING_SPA_XHR: '1' }), true);
  assert.equal(spaXhrEnabled('hud', { SCRAPLING_SPA_XHR: '1' }), false);
  assert.equal(
    spaXhrEnabled('hud', { SCRAPLING_SPA_XHR: '1', SCRAPLING_SPA_XHR_SOURCES: 'hud,fannie' }),
    true
  );
});

test('SPA XHR Hardening: validates and rejects SSRF and insecure URLs', () => {
  assert.equal(validateSpaXhrUrl('http://insecure.com'), 'SPA_XHR_HTTPS_REQUIRED');
  assert.equal(validateSpaXhrUrl('https://user:pass@example.com'), 'SPA_XHR_CREDENTIALS_NOT_ALLOWED');
  assert.equal(validateSpaXhrUrl('https://localhost/api'), 'SPA_XHR_PRIVATE_HOST_REFUSED');
  assert.equal(validateSpaXhrUrl('https://127.0.0.1/api'), 'SPA_XHR_PRIVATE_HOST_REFUSED');
  assert.equal(validateSpaXhrUrl('https://internal.local/api'), 'SPA_XHR_PRIVATE_HOST_REFUSED');
  assert.equal(validateSpaXhrUrl('not a url'), 'SPA_XHR_INVALID_URL');
  assert.equal(validateSpaXhrUrl('https://homepath.fanniemae.com/search'), null);
});

test('SPA XHR Hardening: captureSpaXhr short-circuits on invalid URL before child spawn', async () => {
  const result = await captureSpaXhr('http://insecure.org/api', { sourceKey: 'fannie' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'SPA_XHR_HTTPS_REQUIRED');
});

test('SPA XHR Hardening: fails closed safely when python/scrapling runtime is missing', async () => {
  const result = await captureSpaXhr('https://homepath.fanniemae.com/search', {
    sourceKey: 'fannie',
    env: { SCRAPLING_PYTHON: '/non/existent/python' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'SPA_XHR_RUNTIME_MISSING');
});
