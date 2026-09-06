const assert = require('node:assert/strict');
const test = require('node:test');

const { isCorsOriginAllowed } = require('../server/server');

test('API CORS policy allows same-origin or configured origins and rejects arbitrary sites', () => {
  const request = { headers: { host: 'localhost:3000' } };
  assert.equal(isCorsOriginAllowed(undefined, request, {}), true);
  assert.equal(isCorsOriginAllowed('http://localhost:3000', request, {}), true);
  assert.equal(isCorsOriginAllowed('https://attacker.example', request, {}), false);
  assert.equal(
    isCorsOriginAllowed('https://preview.example', request, { CORS_ALLOWED_ORIGINS: 'https://preview.example' }),
    true,
  );
});
