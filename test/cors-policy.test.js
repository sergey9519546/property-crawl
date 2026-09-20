const assert = require('node:assert/strict');
const test = require('node:test');

const { isCorsOriginAllowed } = require('../server/server');

test('API CORS policy uses explicit allowlists, never request Host', () => {
  const request = { headers: { host: 'localhost:3000' } };
  // No Origin header → non-CORS request is allowed.
  assert.equal(isCorsOriginAllowed(undefined, request, {}), true);
  // Host-derived same-origin is NOT trusted (client-influenced / rebinding).
  assert.equal(isCorsOriginAllowed('http://localhost:3000', request, {}), false);
  assert.equal(isCorsOriginAllowed('https://attacker.example', request, {}), false);
  // Explicit CORS_ALLOWED_ORIGINS allowlist.
  assert.equal(
    isCorsOriginAllowed('https://preview.example', request, { CORS_ALLOWED_ORIGINS: 'https://preview.example' }),
    true,
  );
  // PUBLIC_APP_ORIGIN is the single public UI origin.
  assert.equal(
    isCorsOriginAllowed('http://localhost:3700', request, { PUBLIC_APP_ORIGIN: 'http://localhost:3700' }),
    true,
  );
  // Spoofed Host must not open CORS to arbitrary attacker origins.
  assert.equal(
    isCorsOriginAllowed('http://evil.example', { headers: { host: 'evil.example' } }, {}),
    false,
  );
});
